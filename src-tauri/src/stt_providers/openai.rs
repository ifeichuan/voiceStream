use crate::audio::convert_chunk_to_pcm16;
use crate::stt::{
    mark_runtime_error, mark_runtime_finished, push_final_transcript,
    update_partial_transcript, SttProvider, PROVIDER_OPENAI,
};
use crate::stt_providers::{emit_status, emit_transcript};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::mpsc;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

/// OpenAI Realtime Transcription uses 24kHz mono PCM.
const TARGET_SAMPLE_RATE: u32 = 24_000;
const TARGET_CHANNELS: u16 = 1;

enum Cmd {
    Audio { pcm: Vec<i16>, sample_rate: u32, channels: u16 },
    Finish,
}

pub struct OpenAiSttProvider {
    sender: mpsc::UnboundedSender<Cmd>,
}

impl SttProvider for OpenAiSttProvider {
    fn push_chunk(&self, pcm: Vec<i16>, sample_rate: u32, channels: u16) -> Result<(), String> {
        self.sender
            .send(Cmd::Audio { pcm, sample_rate, channels })
            .map_err(|_| "OpenAI session closed".to_string())
    }

    fn finish(&self) -> Result<(), String> {
        self.sender
            .send(Cmd::Finish)
            .map_err(|_| "OpenAI session closed".to_string())
    }
}

impl OpenAiSttProvider {
    pub fn new(app: AppHandle, api_key: String, endpoint: String, model: String, language: String) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();

        tauri::async_runtime::spawn(async move {
            if let Err(error) = run_session(app.clone(), api_key, endpoint, model, language, receiver).await {
                mark_runtime_error(&error);
                emit_status(&app, PROVIDER_OPENAI, &format!("error: {}", error));
            }
        });

        Self { sender }
    }
}

/// Build the OpenAI Realtime WebSocket URL with model query param.
fn build_url(endpoint: &str, model: &str) -> String {
    let base = endpoint.trim_end_matches('/');
    let model_param = if model.is_empty() { "whisper-1" } else { model };
    if base.contains('?') {
        format!("{}&model={}", base, model_param)
    } else {
        format!("{}?model={}", base, model_param)
    }
}

async fn run_session(
    app: AppHandle,
    api_key: String,
    endpoint: String,
    model: String,
    language: String,
    mut receiver: mpsc::UnboundedReceiver<Cmd>,
) -> Result<(), String> {
    emit_status(&app, PROVIDER_OPENAI, "connecting");

    let url = build_url(&endpoint, &model);
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("invalid OpenAI endpoint: {}", e))?;

    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", api_key)
            .parse()
            .map_err(|e| format!("invalid auth header: {}", e))?,
    );
    request.headers_mut().insert(
        "OpenAI-Beta",
        "realtime=v1"
            .parse()
            .map_err(|e| format!("invalid header: {}", e))?,
    );

    let (socket, _) = connect_async(request)
        .await
        .map_err(|e| format!("OpenAI connect failed: {}", e))?;
    let (mut writer, mut reader) = socket.split();

    // Send session update to configure transcription
    let session_update = json!({
        "type": "transcription_session.update",
        "session": {
            "input_audio_format": "pcm16",
            "input_audio_transcription": {
                "model": if model.is_empty() { "whisper-1" } else { &model },
                "language": if language.is_empty() { Value::Null } else { Value::String(language.clone()) },
            },
            "turn_detection": {
                "type": "server_vad",
            },
        }
    });

    writer
        .send(Message::Text(session_update.to_string().into()))
        .await
        .map_err(|e| format!("session update failed: {}", e))?;

    emit_status(&app, PROVIDER_OPENAI, "listening");
    let mut finish_sent = false;

    loop {
        tokio::select! {
            Some(cmd) = receiver.recv(), if !finish_sent => {
                match cmd {
                    Cmd::Audio { pcm, sample_rate, channels } => {
                        let payload = convert_chunk_to_pcm16(
                            &pcm, sample_rate, channels,
                            TARGET_SAMPLE_RATE, TARGET_CHANNELS,
                        );
                        if !payload.is_empty() {
                            // OpenAI Realtime: send base64-encoded PCM in JSON
                            use base64::Engine;
                            let b64 = base64::engine::general_purpose::STANDARD.encode(&payload);
                            let msg = json!({
                                "type": "input_audio_buffer.append",
                                "audio": b64
                            });
                            writer.send(Message::Text(msg.to_string().into()))
                                .await
                                .map_err(|e| format!("audio send failed: {}", e))?;
                        }
                    }
                    Cmd::Finish => {
                        // Commit the audio buffer and signal done
                        let commit = json!({"type": "input_audio_buffer.commit"});
                        writer.send(Message::Text(commit.to_string().into()))
                            .await
                            .map_err(|e| format!("commit failed: {}", e))?;
                        finish_sent = true;
                        emit_status(&app, PROVIDER_OPENAI, "finishing");
                    }
                }
            }
            message = reader.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        if handle_message(&app, &text) {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    Some(Ok(_)) => {}
                    Some(Err(e)) => return Err(format!("ws read error: {}", e)),
                    None => break,
                }
            }
            else => break,
        }
    }

    mark_runtime_finished();
    emit_status(&app, PROVIDER_OPENAI, "closed");
    Ok(())
}

/// Handle an OpenAI Realtime message. Returns true if session should end.
fn handle_message(app: &AppHandle, text: &str) -> bool {
    let payload: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return false,
    };

    let msg_type = payload.get("type").and_then(Value::as_str).unwrap_or_default();

    match msg_type {
        // Delta transcript events (partial)
        "conversation.item.input_audio_transcription.delta"
        | "transcription_session.input_audio_buffer.transcription.delta" => {
            let transcript = payload
                .get("delta")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();

            if !transcript.is_empty() {
                update_partial_transcript(&transcript);
                emit_transcript(app, &transcript, false);
            }
        }
        // Completed transcript events (final)
        "conversation.item.input_audio_transcription.completed"
        | "transcription_session.input_audio_buffer.transcription.completed" => {
            let transcript = payload
                .get("transcript")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_string();

            if !transcript.is_empty() {
                push_final_transcript(&transcript);
                emit_transcript(app, &transcript, true);
            }
        }
        "error" => {
            let msg = payload
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            mark_runtime_error(msg);
            emit_status(app, PROVIDER_OPENAI, &format!("error: {}", msg));
            return true;
        }
        "session.created" | "transcription_session.created" => {
            // Session established successfully
        }
        _ => {}
    }

    false
}

/// Test OpenAI Realtime connection.
pub async fn test_connection(api_key: &str, endpoint: &str, model: &str) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    let url = build_url(endpoint, model);
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("invalid endpoint: {}", e))?;

    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", api_key)
            .parse()
            .map_err(|e| format!("invalid auth header: {}", e))?,
    );
    request.headers_mut().insert(
        "OpenAI-Beta",
        "realtime=v1"
            .parse()
            .map_err(|e| format!("invalid header: {}", e))?,
    );

    let (socket, _) = connect_async(request)
        .await
        .map_err(|e| format!("OpenAI connect failed: {}", e))?;
    let (_writer, mut reader) = socket.split();

    // Wait for session.created
    let response = tokio::time::timeout(
        tokio::time::Duration::from_secs(5),
        reader.next(),
    )
    .await
    .map_err(|_| "Timed out waiting for OpenAI response".to_string())?;

    match response {
        Some(Ok(Message::Text(text))) => {
            let payload: Value = serde_json::from_str(&text)
                .map_err(|e| format!("invalid response: {}", e))?;
            let msg_type = payload.get("type").and_then(Value::as_str).unwrap_or_default();
            if msg_type == "error" {
                let msg = payload
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("auth failed");
                Err(msg.to_string())
            } else {
                Ok("OpenAI Realtime connection test succeeded".to_string())
            }
        }
        Some(Ok(Message::Close(frame))) => {
            let reason = frame.map(|f| f.reason.to_string()).unwrap_or_default();
            Err(format!("Connection closed: {}", reason))
        }
        Some(Ok(_)) => Ok("OpenAI Realtime connection test succeeded".to_string()),
        Some(Err(e)) => Err(format!("ws error: {}", e)),
        None => Err("Connection closed immediately".to_string()),
    }
}
