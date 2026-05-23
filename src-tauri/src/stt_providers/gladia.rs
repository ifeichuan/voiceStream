use crate::audio::convert_chunk_to_pcm16;
use crate::stt::{
    mark_runtime_error, mark_runtime_finished, push_final_transcript,
    update_partial_transcript, SttProvider, PROVIDER_GLADIA,
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

pub struct GladiaSttProvider {
    sender: mpsc::UnboundedSender<Cmd>,
}

impl SttProvider for GladiaSttProvider {
    fn push_chunk(&self, pcm: Vec<i16>, sample_rate: u32, channels: u16) -> Result<(), String> {
        self.sender
            .send(Cmd::Audio { pcm, sample_rate, channels })
            .map_err(|_| "Gladia session closed".to_string())
    }

    fn finish(&self) -> Result<(), String> {
        self.sender
            .send(Cmd::Finish)
            .map_err(|_| "Gladia session closed".to_string())
    }
}

impl GladiaSttProvider {
    pub fn new(app: AppHandle, api_key: String, endpoint: String, language: String) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();

        tauri::async_runtime::spawn(async move {
            if let Err(error) = run_session(app.clone(), api_key, endpoint, language, receiver).await {
                mark_runtime_error(&error);
                emit_status(&app, PROVIDER_GLADIA, &format!("error: {}", error));
            }
        });

        Self { sender }
    }
}

/// Gladia Live v2: POST to init endpoint to get a WebSocket URL, then connect.
async fn init_live_session(api_key: &str, endpoint: &str, language: &str) -> Result<String, String> {
    // Gladia Live v2 init: POST /v2/live with config, get back { id, url }
    let init_url = endpoint.trim_end_matches('/').to_string();

    let body = json!({
        "encoding": "wav/pcm",
        "sample_rate": TARGET_SAMPLE_RATE,
        "bit_depth": 16,
        "channels": TARGET_CHANNELS,
        "language_config": {
            "languages": if language.is_empty() { vec!["en".to_string()] } else { vec![language.to_string()] },
        },
    });

    // Use a simple HTTP client via tokio-tungstenite's underlying http crate
    // For simplicity, we'll use a minimal reqwest-free approach with raw TCP
    // Actually, let's construct the request manually using hyper-like approach
    // Since we don't have reqwest, we'll parse the URL and do a manual HTTPS POST
    // via native-tls + tokio.

    let url: url::Url = init_url
        .parse()
        .map_err(|e| format!("invalid Gladia endpoint: {}", e))?;

    let host = url.host_str().ok_or("no host in Gladia endpoint")?;
    let port = url.port_or_known_default().unwrap_or(443);
    let path = url.path();

    let body_str = body.to_string();
    let request_str = format!(
        "POST {} HTTP/1.1\r\n\
         Host: {}\r\n\
         Content-Type: application/json\r\n\
         X-Gladia-Key: {}\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\
         \r\n\
         {}",
        path, host, api_key, body_str.len(), body_str
    );

    let addr = format!("{}:{}", host, port);
    let tcp = tokio::net::TcpStream::connect(&addr)
        .await
        .map_err(|e| format!("Gladia TCP connect failed: {}", e))?;

    let connector = native_tls::TlsConnector::new()
        .map_err(|e| format!("TLS init failed: {}", e))?;
    let connector = tokio_native_tls::TlsConnector::from(connector);
    let mut tls = connector
        .connect(host, tcp)
        .await
        .map_err(|e| format!("Gladia TLS connect failed: {}", e))?;

    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    tls.write_all(request_str.as_bytes())
        .await
        .map_err(|e| format!("Gladia request write failed: {}", e))?;

    let mut response = Vec::new();
    tls.read_to_end(&mut response)
        .await
        .map_err(|e| format!("Gladia response read failed: {}", e))?;

    let response_str = String::from_utf8_lossy(&response);

    // Parse HTTP response - find the JSON body after \r\n\r\n
    let body_start = response_str
        .find("\r\n\r\n")
        .map(|i| i + 4)
        .ok_or("invalid HTTP response from Gladia")?;
    let response_body = &response_str[body_start..];

    let json_response: Value = serde_json::from_str(response_body)
        .map_err(|e| format!("invalid Gladia init response: {} body: {}", e, response_body))?;

    // Check for error
    if let Some(error) = json_response.get("error").and_then(Value::as_str) {
        return Err(format!("Gladia init failed: {}", error));
    }

    // Get WebSocket URL
    json_response
        .get("url")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .ok_or_else(|| "Gladia init response missing 'url' field".to_string())
}

async fn run_session(
    app: AppHandle,
    api_key: String,
    endpoint: String,
    language: String,
    mut receiver: mpsc::UnboundedReceiver<Cmd>,
) -> Result<(), String> {
    emit_status(&app, PROVIDER_GLADIA, "connecting");

    // Step 1: Init live session via REST to get WebSocket URL
    let ws_url = init_live_session(&api_key, &endpoint, &language).await?;

    // Step 2: Connect to the WebSocket URL
    let request = ws_url
        .into_client_request()
        .map_err(|e| format!("invalid Gladia WS URL: {}", e))?;

    let (socket, _) = connect_async(request)
        .await
        .map_err(|e| format!("Gladia WS connect failed: {}", e))?;
    let (mut writer, mut reader) = socket.split();

    emit_status(&app, PROVIDER_GLADIA, "listening");
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
                            // Gladia Live v2: send base64-encoded audio in JSON
                            use base64::Engine;
                            let b64 = base64::engine::general_purpose::STANDARD.encode(&payload);
                            let msg = json!({
                                "type": "audio_chunk",
                                "data": {
                                    "chunk": b64
                                }
                            });
                            writer.send(Message::Text(msg.to_string().into()))
                                .await
                                .map_err(|e| format!("audio send failed: {}", e))?;
                        }
                    }
                    Cmd::Finish => {
                        let stop = json!({"type": "stop_recording"});
                        writer.send(Message::Text(stop.to_string().into()))
                            .await
                            .map_err(|e| format!("stop failed: {}", e))?;
                        finish_sent = true;
                        emit_status(&app, PROVIDER_GLADIA, "finishing");
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
    emit_status(&app, PROVIDER_GLADIA, "closed");
    Ok(())
}

/// Handle a Gladia message. Returns true if session should end.
fn handle_message(app: &AppHandle, text: &str) -> bool {
    let payload: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(_) => return false,
    };

    let msg_type = payload.get("type").and_then(Value::as_str).unwrap_or_default();

    match msg_type {
        "transcript" => {
            let is_final = payload
                .get("data")
                .and_then(|d| d.get("is_final"))
                .and_then(Value::as_bool)
                .unwrap_or(false);

            let transcript = payload
                .get("data")
                .and_then(|d| d.get("utterance"))
                .or_else(|| payload.get("data").and_then(|d| d.get("transcript")))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_string();

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
        "final_transcript" => {
            let transcript = payload
                .get("data")
                .and_then(|d| d.get("utterance"))
                .or_else(|| payload.get("data").and_then(|d| d.get("transcript")))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_string();

            if !transcript.is_empty() {
                push_final_transcript(&transcript);
                emit_transcript(app, &transcript, true);
            }
            return true;
        }
        "error" => {
            let msg = payload
                .get("data")
                .and_then(|d| d.get("message"))
                .or_else(|| payload.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("unknown error");
            mark_runtime_error(msg);
            emit_status(app, PROVIDER_GLADIA, &format!("error: {}", msg));
            return true;
        }
        _ => {}
    }

    false
}

/// Test Gladia connection by attempting session init.
pub async fn test_connection(api_key: &str, endpoint: &str) -> Result<String, String> {
    if api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    // Try to init a session - if it succeeds, auth is valid
    let _ws_url = init_live_session(api_key, endpoint, "").await?;
    Ok("Gladia connection test succeeded".to_string())
}
