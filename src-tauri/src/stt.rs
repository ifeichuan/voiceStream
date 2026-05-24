use crate::audio::convert_chunk_to_pcm16;
use crate::native_hud;
use crate::settings;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

const TARGET_SAMPLE_RATE: u32 = 16_000;
const TARGET_CHANNELS: u16 = 1;
static TRANSCRIPT_STATE: Mutex<TranscriptState> = Mutex::new(TranscriptState::new());

struct TranscriptState {
    finals: Vec<String>,
    partial: String,
    stable_partial_prefix: String,
    finished: bool,
    error: Option<String>,
}

impl TranscriptState {
    const fn new() -> Self {
        Self {
            finals: Vec::new(),
            partial: String::new(),
            stable_partial_prefix: String::new(),
            finished: true,
            error: None,
        }
    }
}

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

pub use settings::{SttSettingsInput, SttSettingsView};

type StoredSttSettings = settings::SttSettingsInput;

/// Known STT provider identifiers.
pub const PROVIDER_ALIYUN_BAILIAN: &str = "aliyun-bailian";
pub const PROVIDER_DEEPGRAM: &str = "deepgram";
pub const PROVIDER_ASSEMBLYAI: &str = "assemblyai";
pub const PROVIDER_SONIOX: &str = "soniox";
pub const PROVIDER_GLADIA: &str = "gladia";
pub const PROVIDER_OPENAI: &str = "openai";
pub const PROVIDER_LOCAL_ZIPFORMER: &str = "local-zipformer";

/// List of all known provider IDs for frontend display.
#[allow(dead_code)]
pub const KNOWN_PROVIDERS: &[(&str, &str)] = &[
    (PROVIDER_ALIYUN_BAILIAN, "阿里云百炼"),
    (PROVIDER_DEEPGRAM, "Deepgram"),
    (PROVIDER_ASSEMBLYAI, "AssemblyAI"),
    (PROVIDER_SONIOX, "Soniox"),
    (PROVIDER_GLADIA, "Gladia"),
    (PROVIDER_OPENAI, "OpenAI Realtime"),
    (PROVIDER_LOCAL_ZIPFORMER, "本地 Zipformer (中英)"),
];

/// Metadata about a provider's requirements, used by frontend for adaptive UI.
#[derive(Debug, Serialize, Clone)]
pub struct SttProviderMeta {
    pub id: String,
    pub label: String,
    pub needs_api_key: bool,
    pub needs_endpoint: bool,
    pub needs_model: bool,
    pub needs_workspace_id: bool,
    pub default_endpoint: String,
    pub default_model: String,
    pub default_sample_rate: u32,
}

pub fn provider_meta_list() -> Vec<SttProviderMeta> {
    vec![
        SttProviderMeta {
            id: PROVIDER_ALIYUN_BAILIAN.to_string(),
            label: "阿里云百炼".to_string(),
            needs_api_key: true,
            needs_endpoint: true,
            needs_model: true,
            needs_workspace_id: true,
            default_endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/inference".to_string(),
            default_model: "fun-asr-realtime".to_string(),
            default_sample_rate: 16_000,
        },
        SttProviderMeta {
            id: PROVIDER_DEEPGRAM.to_string(),
            label: "Deepgram".to_string(),
            needs_api_key: true,
            needs_endpoint: true,
            needs_model: true,
            needs_workspace_id: false,
            default_endpoint: "wss://api.deepgram.com/v1/listen".to_string(),
            default_model: "nova-2".to_string(),
            default_sample_rate: 16_000,
        },
        SttProviderMeta {
            id: PROVIDER_ASSEMBLYAI.to_string(),
            label: "AssemblyAI".to_string(),
            needs_api_key: true,
            needs_endpoint: true,
            needs_model: false,
            needs_workspace_id: false,
            default_endpoint: "wss://api.assemblyai.com/v2/realtime/ws".to_string(),
            default_model: String::new(),
            default_sample_rate: 16_000,
        },
        SttProviderMeta {
            id: PROVIDER_SONIOX.to_string(),
            label: "Soniox".to_string(),
            needs_api_key: true,
            needs_endpoint: true,
            needs_model: true,
            needs_workspace_id: false,
            default_endpoint: "wss://api.soniox.com/transcribe-websocket".to_string(),
            default_model: "soniox-default".to_string(),
            default_sample_rate: 16_000,
        },
        SttProviderMeta {
            id: PROVIDER_GLADIA.to_string(),
            label: "Gladia".to_string(),
            needs_api_key: true,
            needs_endpoint: true,
            needs_model: false,
            needs_workspace_id: false,
            default_endpoint: "https://api.gladia.io/v2/live".to_string(),
            default_model: String::new(),
            default_sample_rate: 16_000,
        },
        SttProviderMeta {
            id: PROVIDER_OPENAI.to_string(),
            label: "OpenAI Realtime".to_string(),
            needs_api_key: true,
            needs_endpoint: true,
            needs_model: true,
            needs_workspace_id: false,
            default_endpoint: "wss://api.openai.com/v1/realtime".to_string(),
            default_model: "whisper-1".to_string(),
            default_sample_rate: 24_000,
        },
        SttProviderMeta {
            id: PROVIDER_LOCAL_ZIPFORMER.to_string(),
            label: "本地 Zipformer (中英)".to_string(),
            needs_api_key: false,
            needs_endpoint: false,
            needs_model: false,
            needs_workspace_id: false,
            default_endpoint: String::new(),
            default_model: String::new(),
            default_sample_rate: 16_000,
        },
    ]
}

pub trait SttProvider: Send {
    fn push_chunk(&self, pcm: Vec<i16>, sample_rate: u32, channels: u16) -> Result<(), String>;
    fn finish(&self) -> Result<(), String>;
}

pub fn reset_runtime_state() {
    if let Ok(mut state) = TRANSCRIPT_STATE.lock() {
        state.finals.clear();
        state.partial.clear();
        state.stable_partial_prefix.clear();
        state.finished = false;
        state.error = None;
    }
}

pub fn mark_runtime_finished() {
    if let Ok(mut state) = TRANSCRIPT_STATE.lock() {
        state.finished = true;
    }
}

pub fn mark_runtime_error(message: &str) {
    if let Ok(mut state) = TRANSCRIPT_STATE.lock() {
        state.error = Some(message.to_string());
        state.finished = true;
    }
}

/// Push a finalized transcript segment into the shared state.
/// Called by provider adapters when they receive a final/completed result.
pub fn push_final_transcript(text: &str) {
    if let Ok(mut state) = TRANSCRIPT_STATE.lock() {
        state.finals.push(text.to_string());
        state.partial.clear();
        state.stable_partial_prefix.clear();
    }
}

/// Update the partial (interim) transcript in the shared state.
/// Called by provider adapters when they receive a partial/delta result.
pub fn update_partial_transcript(text: &str) {
    if let Ok(mut state) = TRANSCRIPT_STATE.lock() {
        state.partial = text.to_string();
    }
}

/// Read the current accumulated transcript for HUD display.
pub fn current_transcript_for_hud() -> (String, String) {
    if let Ok(state) = TRANSCRIPT_STATE.lock() {
        let finalized = state.finals.concat();
        let partial = state.partial.clone();
        (finalized, partial)
    } else {
        (String::new(), String::new())
    }
}

pub async fn wait_for_final_text(timeout_duration: Duration) -> Result<String, String> {
    let started = std::time::Instant::now();

    loop {
        let (finished, error, finals, partial) = {
            let state = TRANSCRIPT_STATE
                .lock()
                .map_err(|_| "Transcript state lock poisoned".to_string())?;
            (
                state.finished,
                state.error.clone(),
                state.finals.concat(),
                state.partial.clone(),
            )
        };

        if let Some(error) = error {
            return Err(error);
        }

        if finished || started.elapsed() >= timeout_duration {
            return Ok(combine_transcript(&finals, &partial));
        }

        tokio::time::sleep(Duration::from_millis(40)).await;
    }
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
    settings::load_stt_settings_view(app)
}

pub fn save_settings(app: &AppHandle, input: SttSettingsInput) -> Result<SttSettingsView, String> {
    settings::save_stt_settings(app, input)
}

pub async fn test_settings(app: &AppHandle, input: SttSettingsInput) -> Result<String, String> {
    let settings = settings::stt_test_merged(app, input)?;

    if settings.api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    match settings.provider.as_str() {
        PROVIDER_ALIYUN_BAILIAN | "" => {
            test_connection(settings).await?;
            Ok("Bailian connection test succeeded".to_string())
        }
        PROVIDER_DEEPGRAM => {
            crate::stt_providers::deepgram::test_connection(
                &settings.api_key,
                &settings.api_endpoint,
                &settings.model,
            )
            .await
        }
        PROVIDER_ASSEMBLYAI => {
            crate::stt_providers::assemblyai::test_connection(
                &settings.api_key,
                &settings.api_endpoint,
            )
            .await
        }
        PROVIDER_SONIOX => {
            crate::stt_providers::soniox::test_connection(
                &settings.api_key,
                &settings.api_endpoint,
            )
            .await
        }
        PROVIDER_GLADIA => {
            crate::stt_providers::gladia::test_connection(
                &settings.api_key,
                &settings.api_endpoint,
            )
            .await
        }
        PROVIDER_OPENAI => {
            crate::stt_providers::openai::test_connection(
                &settings.api_key,
                &settings.api_endpoint,
                &settings.model,
            )
            .await
        }
        PROVIDER_LOCAL_ZIPFORMER => {
            let model_dir = if settings.extra_config.is_empty() {
                default_local_model_dir()
            } else {
                settings.extra_config.clone()
            };
            crate::stt_providers::local_zipformer::test_model(&model_dir)
        }
        other => Err(format!("Provider '{}' does not support connection testing yet", other)),
    }
}

pub fn create_default_stt_provider(app: AppHandle) -> Result<Option<Box<dyn SttProvider>>, String> {
    let settings = settings::runtime_stt_settings(&app)?;

    // Local providers don't need an API key
    let is_local = settings.provider == PROVIDER_LOCAL_ZIPFORMER;

    if !is_local && settings.api_key.is_empty() {
        mark_runtime_finished();
        emit_status(
            &app,
            &settings.provider,
            "disabled: save API key in Settings to enable realtime STT",
        );
        return Ok(None);
    }

    create_stt_provider(app, settings)
}

/// Factory: create an STT provider instance based on the provider field in settings.
pub fn create_stt_provider(
    app: AppHandle,
    settings: StoredSttSettings,
) -> Result<Option<Box<dyn SttProvider>>, String> {
    match settings.provider.as_str() {
        PROVIDER_ALIYUN_BAILIAN | "" => {
            Ok(Some(Box::new(AliyunBailianSttProvider::new(app, settings))))
        }
        PROVIDER_DEEPGRAM => {
            Ok(Some(Box::new(
                crate::stt_providers::deepgram::DeepgramSttProvider::new(
                    app,
                    settings.api_key,
                    settings.api_endpoint,
                    settings.model,
                    settings.language,
                ),
            )))
        }
        PROVIDER_ASSEMBLYAI => {
            Ok(Some(Box::new(
                crate::stt_providers::assemblyai::AssemblyAiSttProvider::new(
                    app,
                    settings.api_key,
                    settings.api_endpoint,
                ),
            )))
        }
        PROVIDER_SONIOX => {
            Ok(Some(Box::new(
                crate::stt_providers::soniox::SonioxSttProvider::new(
                    app,
                    settings.api_key,
                    settings.api_endpoint,
                    settings.model,
                    settings.language,
                ),
            )))
        }
        PROVIDER_GLADIA => {
            Ok(Some(Box::new(
                crate::stt_providers::gladia::GladiaSttProvider::new(
                    app,
                    settings.api_key,
                    settings.api_endpoint,
                    settings.language,
                ),
            )))
        }
        PROVIDER_OPENAI => {
            Ok(Some(Box::new(
                crate::stt_providers::openai::OpenAiSttProvider::new(
                    app,
                    settings.api_key,
                    settings.api_endpoint,
                    settings.model,
                    settings.language,
                ),
            )))
        }
        PROVIDER_LOCAL_ZIPFORMER => {
            let model_dir = if settings.extra_config.is_empty() {
                default_local_model_dir()
            } else {
                settings.extra_config.clone()
            };
            match crate::stt_providers::local_zipformer::LocalZipformerSttProvider::new(
                app.clone(),
                model_dir,
            ) {
                Ok(provider) => Ok(Some(Box::new(provider))),
                Err(error) => {
                    mark_runtime_finished();
                    emit_status(&app, PROVIDER_LOCAL_ZIPFORMER, &format!("error: {}", error));
                    Err(error)
                }
            }
        }
        unknown => {
            mark_runtime_finished();
            emit_status(
                &app,
                unknown,
                &format!("unknown STT provider: {}", unknown),
            );
            Ok(None)
        }
    }
}

impl AliyunBailianSttProvider {
    fn new(app: AppHandle, settings: StoredSttSettings) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();

        tauri::async_runtime::spawn(async move {
            if let Err(error) = run_session(app.clone(), settings, receiver).await {
                mark_runtime_error(&error);
                emit_status(&app, PROVIDER_ALIYUN_BAILIAN, &format!("error: {}", error));
            }
        });

        Self { sender }
    }
}

fn longest_common_prefix(left: &str, right: &str) -> String {
    let mut prefix = String::new();
    for (l, r) in left.chars().zip(right.chars()) {
        if l != r {
            break;
        }
        prefix.push(l);
    }
    prefix
}

fn partial_tail<'a>(partial: &'a str, stable_prefix: &str) -> &'a str {
    partial.strip_prefix(stable_prefix).unwrap_or(partial)
}

fn combine_transcript(finals: &str, partial: &str) -> String {
    format!("{}{}", finals, partial).trim().to_string()
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
        Some(Ok(Message::Close(_))) => {
            Err("Connection closed before handshake completed".to_string())
        }
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
    emit_status(&app, PROVIDER_ALIYUN_BAILIAN, "connecting");
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

    emit_status(&app, PROVIDER_ALIYUN_BAILIAN, "starting");

    let mut task_started = false;
    let mut finish_requested = false;
    let mut finish_sent = false;
    let mut pending_audio: Vec<Vec<u8>> = Vec::new();

    loop {
        tokio::select! {
            Some(command) = receiver.recv(), if !finish_sent => {
                match command {
                    SttCommand::Audio { pcm, sample_rate, channels } => {
                        let payload = convert_chunk_to_pcm16(
                            &pcm,
                            sample_rate,
                            channels,
                            TARGET_SAMPLE_RATE,
                            TARGET_CHANNELS,
                        );
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
                            emit_status(&app, PROVIDER_ALIYUN_BAILIAN, "finishing");
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

    emit_status(&app, PROVIDER_ALIYUN_BAILIAN, "closed");
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
            emit_status(app, PROVIDER_ALIYUN_BAILIAN, "listening");

            for audio in pending_audio.drain(..) {
                writer
                    .send(Message::Binary(audio.into()))
                    .await
                    .map_err(|e| format!("buffered audio send failed: {}", e))?;
            }

            if *finish_requested && !*finish_sent {
                send_finish(writer, task_id).await?;
                *finish_sent = true;
                emit_status(app, PROVIDER_ALIYUN_BAILIAN, "finishing");
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
                    let (finalized_text, partial_text) = if let Ok(mut state) =
                        TRANSCRIPT_STATE.lock()
                    {
                        if is_final {
                            state.finals.push(text.clone());
                            state.partial.clear();
                            state.stable_partial_prefix.clear();
                        } else {
                            let candidate_prefix = longest_common_prefix(&state.partial, &text);
                            if !candidate_prefix.is_empty() {
                                state.stable_partial_prefix = candidate_prefix;
                            } else if !text.starts_with(&state.stable_partial_prefix) {
                                state.stable_partial_prefix.clear();
                            }
                            state.partial = text.clone();
                        }

                        let finalized_text =
                            format!("{}{}", state.finals.concat(), state.stable_partial_prefix);
                        let partial_text =
                            partial_tail(&state.partial, &state.stable_partial_prefix).to_string();
                        (finalized_text, partial_text)
                    } else {
                        (String::new(), text.clone())
                    };
                    let event = SttTranscriptEvent { text, is_final };
                    native_hud::update_transcript(app, &finalized_text, &partial_text);
                    let _ = app.emit("stt-transcript", event);
                }
            }
        }
        "task-finished" => {
            mark_runtime_finished();
            return Ok(true);
        }
        "task-failed" => {
            let message = payload
                .get("header")
                .and_then(|header| header.get("error_message"))
                .and_then(Value::as_str)
                .unwrap_or("unknown task failure");
            mark_runtime_error(message);
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

/// Default model directory for local STT models.
/// Looks in ~/Library/Application Support/com.voicestream.app/models/
/// or falls back to ./models/ relative to the app.
fn default_local_model_dir() -> String {
    if let Some(dir) = crate::settings::app_data_dir_path() {
        let models_dir = dir.join("models");
        if models_dir.exists() {
            // Find first subdirectory that looks like a zipformer model
            if let Ok(entries) = std::fs::read_dir(&models_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_dir() && path.join("tokens.txt").exists() {
                        return path.to_string_lossy().to_string();
                    }
                }
            }
            return models_dir.to_string_lossy().to_string();
        }
    }
    "models".to_string()
}

fn emit_status(app: &AppHandle, provider: &str, status: &str) {
    let _ = app.emit(
        "stt-status",
        SttStatusEvent {
            provider: provider.to_string(),
            status: status.to_string(),
        },
    );
}

fn build_ws_request(settings: &StoredSttSettings) -> Result<http::Request<()>, String> {
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
