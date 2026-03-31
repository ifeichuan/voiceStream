use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

const DEFAULT_PROVIDER: &str = "aliyun-bailian";
const DEFAULT_MODEL: &str = "fun-asr-realtime";
const DEFAULT_API_ENDPOINT: &str = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
const TARGET_SAMPLE_RATE: u32 = 16_000;
const TARGET_CHANNELS: u16 = 1;
const STORE_FILE_NAME: &str = "credentials.json";

#[derive(Debug, Serialize, Clone)]
pub struct SttTranscriptEvent {
    pub text: String,
    pub is_final: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct SttStatusEvent {
    pub provider: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SttSettingsInput {
    pub api_key: String,
    pub api_endpoint: String,
    pub model: String,
    pub workspace_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SttSettingsView {
    pub provider: String,
    pub api_endpoint: String,
    pub model: String,
    pub workspace_id: String,
    pub has_api_key: bool,
    pub api_key_hint: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StoredSttSettings {
    api_key: String,
    api_endpoint: String,
    model: String,
    workspace_id: String,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct StoredCredentialFile {
    #[serde(default)]
    vs_stt_bailian: Option<StoredSttSettings>,
}

pub trait SttProvider: Send {
    fn push_chunk(&self, pcm: Vec<i16>, sample_rate: u32, channels: u16) -> Result<(), String>;
    fn finish(&self) -> Result<(), String>;
}

enum SttCommand {
    Audio {
        pcm: Vec<i16>,
        sample_rate: u32,
        channels: u16,
    },
    Finish,
}

pub struct AliyunBailianSttProvider {
    sender: mpsc::UnboundedSender<SttCommand>,
}

impl SttProvider for AliyunBailianSttProvider {
    fn push_chunk(&self, pcm: Vec<i16>, sample_rate: u32, channels: u16) -> Result<(), String> {
        self.sender
            .send(SttCommand::Audio {
                pcm,
                sample_rate,
                channels,
            })
            .map_err(|_| "STT session is closed".to_string())
    }

    fn finish(&self) -> Result<(), String> {
        self.sender
            .send(SttCommand::Finish)
            .map_err(|_| "STT session is closed".to_string())
    }
}

pub fn load_settings_view(app: &AppHandle) -> Result<SttSettingsView, String> {
    let stored = read_stored_settings(app)?;

    Ok(SttSettingsView {
        provider: DEFAULT_PROVIDER.to_string(),
        api_endpoint: stored
            .as_ref()
            .map(|value| value.api_endpoint.clone())
            .unwrap_or_else(|| DEFAULT_API_ENDPOINT.to_string()),
        model: stored
            .as_ref()
            .map(|value| value.model.clone())
            .unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        workspace_id: stored
            .as_ref()
            .map(|value| value.workspace_id.clone())
            .unwrap_or_default(),
        has_api_key: stored
            .as_ref()
            .map(|value| !value.api_key.is_empty())
            .unwrap_or(false),
        api_key_hint: stored
            .as_ref()
            .map(|value| mask_api_key(&value.api_key))
            .unwrap_or_default(),
    })
}

pub fn save_settings(app: &AppHandle, input: SttSettingsInput) -> Result<SttSettingsView, String> {
    let existing = read_stored_settings(app)?;
    let next = merge_settings(existing, input);
    write_stored_settings(app, &next)?;
    load_settings_view(app)
}

pub async fn test_settings(app: &AppHandle, input: SttSettingsInput) -> Result<String, String> {
    let existing = read_stored_settings(app)?;
    let settings = merge_settings(existing, input);

    if settings.api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    test_connection(settings).await?;
    Ok("Bailian connection test succeeded".to_string())
}

pub fn create_default_stt_provider(app: AppHandle) -> Result<Option<Box<dyn SttProvider>>, String> {
    let settings = match read_stored_settings(&app)? {
        Some(value) if !value.api_key.is_empty() => value,
        _ => {
            emit_status(
                &app,
                "disabled: save Bailian API key in Settings to enable realtime STT",
            );
            return Ok(None);
        }
    };

    Ok(Some(Box::new(AliyunBailianSttProvider::new(
        app,
        settings,
    ))))
}

impl AliyunBailianSttProvider {
    fn new(app: AppHandle, settings: StoredSttSettings) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();

        tauri::async_runtime::spawn(async move {
            if let Err(error) = run_session(app.clone(), settings, receiver).await {
                emit_status(&app, &format!("error: {}", error));
            }
        });

        Self { sender }
    }
}

async fn test_connection(settings: StoredSttSettings) -> Result<(), String> {
    let request = build_ws_request(&settings)?;

    let (socket, _) = connect_async(request)
        .await
        .map_err(|e| format!("websocket connect failed: {}", e))?;
    let (mut writer, mut reader) = socket.split();

    let task_id = format!(
        "test{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    );

    let run_task = json!({
        "header": {
            "action": "run-task",
            "task_id": task_id,
            "streaming": "duplex"
        },
        "payload": {
            "task_group": "audio",
            "task": "asr",
            "function": "recognition",
            "model": settings.model,
            "parameters": {
                "format": "pcm",
                "sample_rate": TARGET_SAMPLE_RATE
            },
            "input": {}
        }
    });

    writer
        .send(Message::Text(run_task.to_string().into()))
        .await
        .map_err(|e| format!("run-task send failed: {}", e))?;

    let response = timeout(Duration::from_secs(5), reader.next())
        .await
        .map_err(|_| "Timed out waiting for Bailian handshake".to_string())?;

    match response {
        Some(Ok(Message::Text(text))) => {
            let payload: Value =
                serde_json::from_str(&text).map_err(|e| format!("invalid STT response: {}", e))?;
            let event = payload
                .get("header")
                .and_then(|header| header.get("event"))
                .and_then(Value::as_str)
                .unwrap_or_default();

            match event {
                "task-started" => {
                    send_finish(&mut writer, &task_id).await?;
                    Ok(())
                }
                "task-failed" => {
                    let message = payload
                        .get("header")
                        .and_then(|header| header.get("error_message"))
                        .and_then(Value::as_str)
                        .unwrap_or("unknown task failure");
                    Err(message.to_string())
                }
                other => Err(format!("Unexpected handshake event: {}", other)),
            }
        }
        Some(Ok(Message::Close(_))) => Err("Connection closed before handshake completed".to_string()),
        Some(Ok(_)) => Err("Unexpected non-text handshake response".to_string()),
        Some(Err(error)) => Err(format!("websocket read failed: {}", error)),
        None => Err("Connection closed before handshake completed".to_string()),
    }
}

async fn run_session(
    app: AppHandle,
    settings: StoredSttSettings,
    mut receiver: mpsc::UnboundedReceiver<SttCommand>,
) -> Result<(), String> {
    emit_status(&app, "connecting");
    let request = build_ws_request(&settings)?;

    let (socket, _) = connect_async(request)
        .await
        .map_err(|e| format!("websocket connect failed: {}", e))?;
    let (mut writer, mut reader) = socket.split();

    let task_id = format!(
        "vs{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    );

    let run_task = json!({
        "header": {
            "action": "run-task",
            "task_id": task_id,
            "streaming": "duplex"
        },
        "payload": {
            "task_group": "audio",
            "task": "asr",
            "function": "recognition",
            "model": settings.model,
            "parameters": {
                "format": "pcm",
                "sample_rate": TARGET_SAMPLE_RATE
            },
            "input": {}
        }
    });

    writer
        .send(Message::Text(run_task.to_string().into()))
        .await
        .map_err(|e| format!("run-task send failed: {}", e))?;

    emit_status(&app, "starting");

    let mut task_started = false;
    let mut finish_requested = false;
    let mut finish_sent = false;
    let mut pending_audio: Vec<Vec<u8>> = Vec::new();

    loop {
        tokio::select! {
            Some(command) = receiver.recv(), if !finish_sent => {
                match command {
                    SttCommand::Audio { pcm, sample_rate, channels } => {
                        let payload = convert_chunk_to_pcm16_mono_16k(&pcm, sample_rate, channels);
                        if payload.is_empty() {
                            continue;
                        }

                        if task_started {
                            writer
                                .send(Message::Binary(payload.into()))
                                .await
                                .map_err(|e| format!("audio send failed: {}", e))?;
                        } else {
                            pending_audio.push(payload);
                        }
                    }
                    SttCommand::Finish => {
                        finish_requested = true;
                        if task_started {
                            send_finish(&mut writer, &task_id).await?;
                            finish_sent = true;
                            emit_status(&app, "finishing");
                        }
                    }
                }
            }
            message = reader.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        if handle_server_event(
                            &app,
                            &mut writer,
                            &task_id,
                            &text,
                            &mut task_started,
                            &mut finish_requested,
                            &mut finish_sent,
                            &mut pending_audio,
                        ).await? {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Ok(_)) => {}
                    Some(Err(error)) => return Err(format!("websocket read failed: {}", error)),
                    None => break,
                }
            }
            else => break,
        }
    }

    emit_status(&app, "closed");
    Ok(())
}

async fn handle_server_event(
    app: &AppHandle,
    writer: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    task_id: &str,
    text: &str,
    task_started: &mut bool,
    finish_requested: &mut bool,
    finish_sent: &mut bool,
    pending_audio: &mut Vec<Vec<u8>>,
) -> Result<bool, String> {
    let payload: Value =
        serde_json::from_str(text).map_err(|e| format!("invalid STT response: {}", e))?;
    let event = payload
        .get("header")
        .and_then(|header| header.get("event"))
        .and_then(Value::as_str)
        .unwrap_or_default();

    match event {
        "task-started" => {
            *task_started = true;
            emit_status(app, "listening");

            for audio in pending_audio.drain(..) {
                writer
                    .send(Message::Binary(audio.into()))
                    .await
                    .map_err(|e| format!("buffered audio send failed: {}", e))?;
            }

            if *finish_requested && !*finish_sent {
                send_finish(writer, task_id).await?;
                *finish_sent = true;
                emit_status(app, "finishing");
            }
        }
        "result-generated" => {
            if let Some(sentence) = payload
                .get("payload")
                .and_then(|value| value.get("output"))
                .and_then(|value| value.get("sentence"))
            {
                let text = sentence
                    .get("text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim()
                    .to_string();

                if !text.is_empty() {
                    let is_final = sentence
                        .get("sentence_end")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let event = SttTranscriptEvent { text, is_final };
                    let _ = app.emit("stt-transcript", event);
                }
            }
        }
        "task-finished" => return Ok(true),
        "task-failed" => {
            let message = payload
                .get("header")
                .and_then(|header| header.get("error_message"))
                .and_then(Value::as_str)
                .unwrap_or("unknown task failure");
            return Err(message.to_string());
        }
        _ => {}
    }

    Ok(false)
}

async fn send_finish(
    writer: &mut futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    task_id: &str,
) -> Result<(), String> {
    let finish_task = json!({
        "header": {
            "action": "finish-task",
            "task_id": task_id,
            "streaming": "duplex"
        },
        "payload": {
            "input": {}
        }
    });

    writer
        .send(Message::Text(finish_task.to_string().into()))
        .await
        .map_err(|e| format!("finish-task send failed: {}", e))
}

fn emit_status(app: &AppHandle, status: &str) {
    let _ = app.emit(
        "stt-status",
        SttStatusEvent {
            provider: DEFAULT_PROVIDER.to_string(),
            status: status.to_string(),
        },
    );
}

fn credentials_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create app data dir: {}", e))?;
    Ok(dir.join(STORE_FILE_NAME))
}

fn read_stored_settings(app: &AppHandle) -> Result<Option<StoredSttSettings>, String> {
    let path = credentials_path(app)?;
    if !path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("failed to read credentials store: {}", e))?;
    let file: StoredCredentialFile =
        serde_json::from_str(&content).map_err(|e| format!("invalid credentials store: {}", e))?;
    Ok(file.vs_stt_bailian)
}

fn write_stored_settings(app: &AppHandle, settings: &StoredSttSettings) -> Result<(), String> {
    let path = credentials_path(app)?;
    let file = StoredCredentialFile {
        vs_stt_bailian: Some(settings.clone()),
    };
    let content = serde_json::to_string_pretty(&file)
        .map_err(|e| format!("failed to encode credentials store: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("failed to write credentials store: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("failed to secure credentials store: {}", e))?;
    }

    Ok(())
}

fn merge_settings(existing: Option<StoredSttSettings>, input: SttSettingsInput) -> StoredSttSettings {
    let existing = existing.unwrap_or_else(default_settings);
    let api_key = sanitize(&input.api_key).unwrap_or(existing.api_key);

    StoredSttSettings {
        api_key,
        api_endpoint: sanitize(&input.api_endpoint)
            .unwrap_or(existing.api_endpoint)
            .trim_end_matches('/')
            .to_string(),
        model: sanitize(&input.model).unwrap_or(existing.model),
        workspace_id: sanitize(&input.workspace_id).unwrap_or_default(),
    }
}

fn build_ws_request(
    settings: &StoredSttSettings,
) -> Result<http::Request<()>, String> {
    let mut request = settings
        .api_endpoint
        .clone()
        .into_client_request()
        .map_err(|e| format!("invalid websocket endpoint: {}", e))?;

    request.headers_mut().insert(
        "Authorization",
        format!("bearer {}", settings.api_key)
            .parse()
            .map_err(|e| format!("invalid authorization header: {}", e))?,
    );
    request.headers_mut().insert(
        "user-agent",
        "VoiceStream/0.1.0"
            .parse()
            .map_err(|e| format!("invalid user-agent header: {}", e))?,
    );

    if !settings.workspace_id.is_empty() {
        request.headers_mut().insert(
            "X-DashScope-WorkSpace",
            settings
                .workspace_id
                .parse()
                .map_err(|e| format!("invalid workspace header: {}", e))?,
        );
    }

    Ok(request)
}

fn default_settings() -> StoredSttSettings {
    StoredSttSettings {
        api_key: String::new(),
        api_endpoint: DEFAULT_API_ENDPOINT.to_string(),
        model: DEFAULT_MODEL.to_string(),
        workspace_id: String::new(),
    }
}

fn sanitize(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn mask_api_key(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let chars: Vec<char> = trimmed.chars().collect();
    let visible = chars.len().min(4);
    let suffix: String = chars[chars.len() - visible..].iter().collect();
    format!("••••{}", suffix)
}

fn convert_chunk_to_pcm16_mono_16k(samples: &[i16], sample_rate: u32, channels: u16) -> Vec<u8> {
    let normalized: Vec<f32> = samples.iter().copied().map(pcm_i16_to_f32).collect();
    let mono = remix_channels(&normalized, channels, TARGET_CHANNELS);
    let resampled = resample_interleaved(&mono, TARGET_CHANNELS, sample_rate, TARGET_SAMPLE_RATE);

    resampled
        .into_iter()
        .map(normalize_f32_sample)
        .flat_map(|sample| sample.to_le_bytes())
        .collect()
}

fn normalize_f32_sample(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16
}

fn pcm_i16_to_f32(sample: i16) -> f32 {
    sample as f32 / i16::MAX as f32
}

fn remix_channels(samples: &[f32], source_channels: u16, target_channels: u16) -> Vec<f32> {
    if source_channels == target_channels {
        return samples.to_vec();
    }

    let source_channels = source_channels as usize;
    let target_channels = target_channels as usize;

    if source_channels == 0 || target_channels == 0 {
        return Vec::new();
    }

    let mut remixed = Vec::with_capacity(samples.len() / source_channels * target_channels);

    for frame in samples.chunks_exact(source_channels) {
        if target_channels == 1 {
            remixed.push(frame.iter().copied().sum::<f32>() / source_channels as f32);
            continue;
        }

        if source_channels == 1 {
            remixed.extend(std::iter::repeat_n(frame[0], target_channels));
            continue;
        }

        for channel in 0..target_channels {
            remixed.push(frame[channel.min(source_channels - 1)]);
        }
    }

    remixed
}

fn resample_interleaved(
    samples: &[f32],
    channels: u16,
    source_rate: u32,
    target_rate: u32,
) -> Vec<f32> {
    if source_rate == target_rate || samples.is_empty() {
        return samples.to_vec();
    }

    let channels = channels as usize;
    if channels == 0 {
        return Vec::new();
    }

    let source_frames = samples.len() / channels;
    if source_frames <= 1 {
        return samples.to_vec();
    }

    let target_frames =
        ((source_frames as f64 * target_rate as f64) / source_rate as f64).round() as usize;
    let last_frame = source_frames - 1;
    let mut resampled = Vec::with_capacity(target_frames * channels);

    for target_index in 0..target_frames {
        let source_position = target_index as f64 * source_rate as f64 / target_rate as f64;
        let base_index = source_position.floor() as usize;
        let next_index = (base_index + 1).min(last_frame);
        let fraction = (source_position - base_index as f64) as f32;

        for channel in 0..channels {
            let base_sample = samples[base_index * channels + channel];
            let next_sample = samples[next_index * channels + channel];
            resampled.push(base_sample + (next_sample - base_sample) * fraction);
        }
    }

    resampled
}
