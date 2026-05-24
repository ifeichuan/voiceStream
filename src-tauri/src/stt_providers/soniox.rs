use crate::audio::convert_chunk_to_pcm16;
use crate::stt::{
    mark_runtime_error, mark_runtime_finished, push_final_transcript,
    update_partial_transcript, SttProvider, PROVIDER_SONIOX,
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

const TARGET_SAMPLE_RATE: u32 = 16_000;
const TARGET_CHANNELS: u16 = 1;

enum Cmd {
    Audio { pcm: Vec<i16>, sample_rate: u32, channels: u16 },
    Finish,
}

pub struct SonioxSttProvider {
    sender: mpsc::UnboundedSender<Cmd>,
}

impl SttProvider for SonioxSttProvider {
    fn push_chunk(&self, pcm: Vec<i16>, sample_rate: u32, channels: u16) -> Result<(), String> {
        self.sender
            .send(Cmd::Audio { pcm, sample_rate, channels })
            .map_err(|_| "Soniox session closed".to_string())
    }

    fn finish(&self) -> Result<(), String> {
        self.sender
            .send(Cmd::Finish)
            .map_err(|_| "Soniox session closed".to_string())
    }
}

impl SonioxSttProvider {
    pub fn new(app: AppHandle, api_key: String, endpoint: String, model: String, language: String) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();

        tauri::async_runtime::spawn(async move {
            if let Err(error) = run_session(app.clone(), api_key, endpoint, model, language, receiver).await {
                mark_runtime_error(&error);
                emit_status(&app, PROVIDER_SONIOX, &format!("error: {}", error));
            }
        });

        Self { sender }
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
    emit_status(&app, PROVIDER_SONIOX, "connecting");

    let mut request = endpoint
        .trim_end_matches('/')
        .to_string()
        .into_client_request()
        .map_err(|e| format!("invalid Soniox endpoint: {}", e))?;

    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", api_key)
            .parse()
            .map_err(|e| format!("invalid auth header: {}", e))?,
    );

    let (socket, _) = connect_async(request)
        .await
        .map_err(|e| format!("Soniox connect failed: {}", e))?;
    let (mut writer, mut reader) = socket.split();

    // Send configuration message after connection
    let config = json!({
        "type": "start",
        "model": if model.is_empty() { "soniox-default" } else { &model },
        "language": if language.is_empty() { "en" } else { &language },
        "sample_rate": TARGET_SAMPLE_RATE,
        "encoding": "pcm_s16le",
        "channels": TARGET_CHANNELS,
    });

    writer
        .send(Message::Text(config.to_string().into()))
        .await
        .map_err(|e| format!("config send failed: {}", e))?;

    emit_status(&app, PROVIDER_SONIOX, "listening");
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
                            writer.send(Message::Binary(payload.into()))
                                .await
                                .map_err(|e| format!("audio send failed: {}", e))?;
                        }
                    }
                    Cmd::Finish => {
                        let stop = json!({"type": "stop"});
                        writer.send(Message::Text(stop.to_string().into()))
                            .await
                            .map_err(|e| format!("stop send failed: {}", e))?;
                        finish_sent = true;
                        emit_status(&app, PROVIDER_SONIOX, "finishing");
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
    emit_status(&app, PROVIDER_SONIOX, "closed");
    Ok(())
}

/// Handle a Soniox message. Soniox uses token-level results with `is_final`.
/// Returns true if session should end.
fn handle_message(app: &AppHandle, text: &str) -> bool {
    let payload: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return false,
    };

    let msg_type = payload.get("type").and_then(Value::as_str).unwrap_or_default();

    match msg_type {
        "result" | "transcript" => {
            // Soniox sends tokens with is_final flag per token/segment
            let is_final = payload
                .get("is_final")
                .and_then(Value::as_bool)
                .unwrap_or(false);

            // Try to get text from various possible fields
            let transcript = payload
                .get("text")
                .or_else(|| payload.get("transcript"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_string();

            // If no direct text, try to assemble from tokens
            let transcript = if transcript.is_empty() {
                payload
                    .get("tokens")
                    .and_then(Value::as_array)
                    .map(|tokens| {
                        tokens
                            .iter()
                            .filter_map(|t| t.get("text").and_then(Value::as_str))
                            .collect::<Vec<_>>()
                            .join("")
                    })
                    .unwrap_or_default()
                    .trim()
                    .to_string()
            } else {
                transcript
            };

            if transcript.is_empty() {
                return false;
            }

            if is_final {
                push_final_transcript(&transcript);
            } else {
                update_partial_transcript(&transcript);
            }
            emit_transcript(app, &transcript, is_final);
        }
        "done" | "stopped" | "end" => {
            return true;
        }
        "error" => {
            let msg = payload
                .get("message")
                .or_else(|| payload.get("error"))
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            mark_runtime_error(msg);
            emit_status(app, PROVIDER_SONIOX, &format!("error: {}", msg));
            return true;
        }
        _ => {}
    }

    false
}

/// Test Soniox connection.
pub async fn test_connection(api_key: &str, endpoint: &str) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    let mut request = endpoint
        .trim_end_matches('/')
        .to_string()
        .into_client_request()
        .map_err(|e| format!("invalid endpoint: {}", e))?;

    request.headers_mut().insert(
        "Authorization",
        format!("Bearer {}", api_key)
            .parse()
            .map_err(|e| format!("invalid auth header: {}", e))?,
    );

    let (socket, _) = connect_async(request)
        .await
        .map_err(|e| format!("Soniox connect failed: {}", e))?;
    let (mut writer, _reader) = socket.split();

    // If we connected successfully, the auth is valid
    let stop = json!({"type": "stop"});
    let _ = writer.send(Message::Text(stop.to_string().into())).await;

    Ok("Soniox connection test succeeded".to_string())
}
