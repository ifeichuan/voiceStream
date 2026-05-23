use crate::audio::convert_chunk_to_pcm16;
use crate::stt::{
    mark_runtime_error, mark_runtime_finished, push_final_transcript,
    update_partial_transcript, SttProvider, PROVIDER_ASSEMBLYAI,
};
use crate::stt_providers::{emit_status, emit_transcript};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
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

pub struct AssemblyAiSttProvider {
    sender: mpsc::UnboundedSender<Cmd>,
}

impl SttProvider for AssemblyAiSttProvider {
    fn push_chunk(&self, pcm: Vec<i16>, sample_rate: u32, channels: u16) -> Result<(), String> {
        self.sender
            .send(Cmd::Audio { pcm, sample_rate, channels })
            .map_err(|_| "AssemblyAI session closed".to_string())
    }

    fn finish(&self) -> Result<(), String> {
        self.sender
            .send(Cmd::Finish)
            .map_err(|_| "AssemblyAI session closed".to_string())
    }
}

impl AssemblyAiSttProvider {
    pub fn new(app: AppHandle, api_key: String, endpoint: String) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();

        tauri::async_runtime::spawn(async move {
            if let Err(error) = run_session(app.clone(), api_key, endpoint, receiver).await {
                mark_runtime_error(&error);
                emit_status(&app, PROVIDER_ASSEMBLYAI, &format!("error: {}", error));
            }
        });

        Self { sender }
    }
}

/// Build AssemblyAI WebSocket URL with sample_rate query param.
fn build_url(endpoint: &str) -> String {
    let mut url = endpoint.trim_end_matches('/').to_string();
    let separator = if url.contains('?') { "&" } else { "?" };
    url.push_str(&format!("{}sample_rate={}", separator, TARGET_SAMPLE_RATE));
    url
}

async fn run_session(
    app: AppHandle,
    api_key: String,
    endpoint: String,
    mut receiver: mpsc::UnboundedReceiver<Cmd>,
) -> Result<(), String> {
    emit_status(&app, PROVIDER_ASSEMBLYAI, "connecting");

    let url = build_url(&endpoint);
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("invalid AssemblyAI endpoint: {}", e))?;

    request.headers_mut().insert(
        "Authorization",
        api_key
            .parse()
            .map_err(|e| format!("invalid auth header: {}", e))?,
    );

    let (socket, _) = connect_async(request)
        .await
        .map_err(|e| format!("AssemblyAI connect failed: {}", e))?;
    let (mut writer, mut reader) = socket.split();

    emit_status(&app, PROVIDER_ASSEMBLYAI, "listening");
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
                            // AssemblyAI expects base64-encoded audio in a JSON message
                            // for Universal Streaming, or raw binary.
                            // Universal Streaming v2 accepts binary frames directly.
                            writer.send(Message::Binary(payload.into()))
                                .await
                                .map_err(|e| format!("audio send failed: {}", e))?;
                        }
                    }
                    Cmd::Finish => {
                        // AssemblyAI: send terminate_session message
                        let terminate = serde_json::json!({"terminate_session": true});
                        writer.send(Message::Text(terminate.to_string().into()))
                            .await
                            .map_err(|e| format!("terminate failed: {}", e))?;
                        finish_sent = true;
                        emit_status(&app, PROVIDER_ASSEMBLYAI, "finishing");
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
    emit_status(&app, PROVIDER_ASSEMBLYAI, "closed");
    Ok(())
}

/// Handle an AssemblyAI message. Returns true if session should end.
fn handle_message(app: &AppHandle, text: &str) -> bool {
    let payload: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return false,
    };

    let msg_type = payload.get("message_type").and_then(Value::as_str).unwrap_or_default();

    match msg_type {
        "PartialTranscript" => {
            let transcript = payload
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_string();

            if !transcript.is_empty() {
                update_partial_transcript(&transcript);
                emit_transcript(app, &transcript, false);
            }
        }
        "FinalTranscript" => {
            let transcript = payload
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_string();

            if !transcript.is_empty() {
                push_final_transcript(&transcript);
                emit_transcript(app, &transcript, true);
            }
        }
        "SessionTerminated" => {
            return true;
        }
        "SessionBegins" => {
            // Session started successfully
        }
        "Error" | "error" => {
            let msg = payload
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            mark_runtime_error(msg);
            emit_status(app, PROVIDER_ASSEMBLYAI, &format!("error: {}", msg));
            return true;
        }
        _ => {}
    }

    false
}

/// Test AssemblyAI connection.
pub async fn test_connection(api_key: &str, endpoint: &str) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    let url = build_url(endpoint);
    let mut request = url
        .into_client_request()
        .map_err(|e| format!("invalid endpoint: {}", e))?;

    request.headers_mut().insert(
        "Authorization",
        api_key
            .parse()
            .map_err(|e| format!("invalid auth header: {}", e))?,
    );

    let (socket, _) = connect_async(request)
        .await
        .map_err(|e| format!("AssemblyAI connect failed: {}", e))?;
    let (mut writer, mut reader) = socket.split();

    // Wait for SessionBegins
    let response = tokio::time::timeout(
        tokio::time::Duration::from_secs(5),
        reader.next(),
    )
    .await
    .map_err(|_| "Timed out waiting for AssemblyAI response".to_string())?;

    match response {
        Some(Ok(Message::Text(text))) => {
            let payload: Value = serde_json::from_str(&text)
                .map_err(|e| format!("invalid response: {}", e))?;
            let msg_type = payload.get("message_type").and_then(Value::as_str).unwrap_or_default();
            if msg_type == "SessionBegins" {
                let terminate = serde_json::json!({"terminate_session": true});
                let _ = writer.send(Message::Text(terminate.to_string().into())).await;
                Ok("AssemblyAI connection test succeeded".to_string())
            } else if msg_type == "Error" || msg_type == "error" {
                let msg = payload.get("error").and_then(Value::as_str).unwrap_or("auth failed");
                Err(msg.to_string())
            } else {
                Ok("AssemblyAI connection test succeeded".to_string())
            }
        }
        Some(Ok(Message::Close(frame))) => {
            let reason = frame.map(|f| f.reason.to_string()).unwrap_or_default();
            Err(format!("Connection closed: {}", reason))
        }
        Some(Ok(_)) => Ok("AssemblyAI connection test succeeded".to_string()),
        Some(Err(e)) => Err(format!("ws error: {}", e)),
        None => Err("Connection closed immediately".to_string()),
    }
}
