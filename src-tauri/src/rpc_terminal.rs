use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Instant;
use tauri::{AppHandle, Emitter};

use crate::pi_rpc;

static INSTANCE: OnceLock<Mutex<Option<RpcTerminalHandle>>> = OnceLock::new();
static RUN_ID: AtomicU64 = AtomicU64::new(1);

struct RpcTerminalHandle {
    run_id: u64,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    intentional_stop: Arc<AtomicBool>,
    master: Box<dyn MasterPty + Send>,
}

#[derive(Debug, Serialize, Clone)]
pub struct RpcTerminalOutputEvent {
    pub data: Vec<u8>,
}

#[derive(Debug, Serialize, Clone)]
pub struct RpcTerminalStatusEvent {
    pub status: String,
    pub message: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct RpcTimingEvent {
    pub event_type: String,
    pub elapsed_ms: u128,
    pub details: String,
}

#[derive(Debug, Deserialize, Clone)]
pub struct RpcTerminalConfig {
    pub model: Option<String>,
    pub provider: Option<String>,
    pub thinking: Option<String>,
    pub system_prompt: Option<String>,
    pub no_extensions: Option<bool>,
    pub no_skills: Option<bool>,
    pub no_prompt_templates: Option<bool>,
    pub no_themes: Option<bool>,
    pub extensions: Option<Vec<String>>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

pub fn start(app: AppHandle, config: RpcTerminalConfig) -> Result<(), String> {
    stop();

    let run_id = RUN_ID.fetch_add(1, Ordering::Relaxed);
    let cols = config.cols.unwrap_or(120).max(24);
    let rows = config.rows.unwrap_or(30).max(8);

    let pi_path = pi_rpc::resolve_pi_path_public();
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open rpc pty: {}", e))?;

    let mut command = CommandBuilder::new(pi_path.as_os_str());
    command.arg("--mode");
    command.arg("rpc");
    command.arg("--no-session");

    if config.no_extensions.unwrap_or(false) {
        command.arg("--no-extensions");
    }
    if config.no_skills.unwrap_or(true) {
        command.arg("--no-skills");
    }
    if config.no_prompt_templates.unwrap_or(true) {
        command.arg("--no-prompt-templates");
    }
    if config.no_themes.unwrap_or(true) {
        command.arg("--no-themes");
    }
    if let Some(model) = &config.model {
        if !model.trim().is_empty() {
            command.arg("--model");
            command.arg(model.trim());
        }
    }
    if let Some(thinking) = &config.thinking {
        if !thinking.trim().is_empty() {
            command.arg("--thinking");
            command.arg(thinking.trim());
        }
    }
    if let Some(prompt) = &config.system_prompt {
        if !prompt.trim().is_empty() {
            command.arg("--system-prompt");
            command.arg(prompt.trim());
        }
    }
    if let Some(extensions) = &config.extensions {
        for ext in extensions {
            if !ext.trim().is_empty() {
                command.arg("-e");
                command.arg(ext.trim());
            }
        }
    }

    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("LANG", std::env::var("LANG").unwrap_or_else(|_| "en_US.UTF-8".to_string()));

    if let Ok(home) = std::env::var("HOME") {
        command.env("HOME", &home);
        let system_path = std::env::var("PATH").unwrap_or_default();
        let mut extra_paths = vec![
            format!("{}/Library/pnpm", home),
            format!("{}/.local/bin", home),
            format!("{}/.bun/bin", home),
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
        ];
        let fnm_dir = format!("{}/.local/share/fnm/node-versions", home);
        if let Ok(entries) = std::fs::read_dir(&fnm_dir) {
            if let Some(version) = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .max()
            {
                extra_paths.push(format!("{}/installation/bin", version.display()));
            }
        }
        let nvm_dir = format!("{}/.nvm/versions/node", home);
        if let Ok(entries) = std::fs::read_dir(&nvm_dir) {
            if let Some(version) = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .max()
            {
                extra_paths.push(format!("{}/bin", version.display()));
            }
        }
        extra_paths.push(format!("{}/.volta/bin", home));

        let enriched = extra_paths
            .iter()
            .filter(|p| std::path::Path::new(p.as_str()).is_dir())
            .chain(std::iter::once(&system_path))
            .cloned()
            .collect::<Vec<_>>()
            .join(":");
        command.env("PATH", enriched);
    }

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|e| format!("failed to spawn pi rpc terminal: {}", e))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to clone rpc pty reader: {}", e))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("failed to open rpc pty writer: {}", e))?;
    let writer = Arc::new(Mutex::new(writer));
    let killer = Arc::new(Mutex::new(child.clone_killer()));
    let intentional_stop = Arc::new(AtomicBool::new(false));

    let app_for_read = app.clone();
    let app_for_wait = app.clone();
    let stop_for_read = intentional_stop.clone();
    let stop_for_wait = intentional_stop.clone();

    emit_status(&app, "running", "RPC terminal started");

    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        let mut line_buf = Vec::<u8>::new();
        let started_at = Instant::now();
        let mut prompt_sent_at: Option<Instant> = None;
        let mut first_text_delta_at: Option<Instant> = None;

        loop {
            if stop_for_read.load(Ordering::SeqCst) || !is_current(run_id) {
                break;
            }

            let size = match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => n,
                Err(_) => break,
            };

            // Forward raw bytes to terminal immediately
            let _ = app_for_read.emit(
                "rpc-terminal-output",
                RpcTerminalOutputEvent {
                    data: buffer[..size].to_vec(),
                },
            );

            // Accumulate into line buffer for JSON parsing
            for &byte in &buffer[..size] {
                if byte == b'\n' {
                    let line = String::from_utf8_lossy(&line_buf).to_string();
                    line_buf.clear();
                    parse_rpc_line(
                        &line,
                        &app_for_read,
                        started_at,
                        &mut prompt_sent_at,
                        &mut first_text_delta_at,
                    );
                } else {
                    line_buf.push(byte);
                }
            }
        }
    });

    thread::spawn(move || {
        let status = child.wait();
        let was_intentional = stop_for_wait.load(Ordering::SeqCst);
        clear_if_current(run_id);
        if was_intentional {
            return;
        }
        let msg = match status {
            Ok(s) if s.success() => format!("Process exited: {}", s),
            Ok(s) => format!("Process exited abnormally: {}", s),
            Err(e) => format!("Process wait error: {}", e),
        };
        emit_status(&app_for_wait, "closed", &msg);
    });

    let handle = RpcTerminalHandle {
        run_id,
        writer,
        killer,
        intentional_stop,
        master: pair.master,
    };

    instance()
        .lock()
        .map_err(|_| "rpc terminal lock poisoned".to_string())?
        .replace(handle);

    Ok(())
}

pub fn write_data(data: &str) -> Result<(), String> {
    let guard = instance()
        .lock()
        .map_err(|_| "rpc terminal lock poisoned".to_string())?;
    let handle = guard
        .as_ref()
        .ok_or_else(|| "RPC terminal not running".to_string())?;
    let mut writer = handle
        .writer
        .lock()
        .map_err(|_| "rpc terminal writer lock poisoned".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("rpc write failed: {}", e))?;
    writer
        .flush()
        .map_err(|e| format!("rpc flush failed: {}", e))
}

pub fn resize(cols: u16, rows: u16) -> Result<(), String> {
    let guard = instance()
        .lock()
        .map_err(|_| "rpc terminal lock poisoned".to_string())?;
    let handle = guard
        .as_ref()
        .ok_or_else(|| "RPC terminal not running".to_string())?;
    handle
        .master
        .resize(PtySize {
            rows: rows.max(8),
            cols: cols.max(24),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("rpc resize failed: {}", e))
}

pub fn stop() {
    if let Ok(mut guard) = instance().lock() {
        if let Some(handle) = guard.take() {
            handle.intentional_stop.store(true, Ordering::SeqCst);
            if let Ok(mut killer) = handle.killer.lock() {
                let _ = killer.kill();
            }
        }
    }
}

fn instance() -> &'static Mutex<Option<RpcTerminalHandle>> {
    INSTANCE.get_or_init(|| Mutex::new(None))
}

fn is_current(run_id: u64) -> bool {
    instance()
        .lock()
        .ok()
        .and_then(|g| g.as_ref().map(|h| h.run_id == run_id))
        .unwrap_or(false)
}

fn clear_if_current(run_id: u64) {
    if let Ok(mut guard) = instance().lock() {
        if guard.as_ref().map(|h| h.run_id == run_id).unwrap_or(false) {
            *guard = None;
        }
    }
}

fn emit_status(app: &AppHandle, status: &str, message: &str) {
    let _ = app.emit(
        "rpc-terminal-status",
        RpcTerminalStatusEvent {
            status: status.to_string(),
            message: message.to_string(),
        },
    );
}

fn emit_rpc_timing(app: &AppHandle, event_type: &str, elapsed_ms: u128, details: &str) {
    let _ = app.emit(
        "rpc-terminal-timing",
        RpcTimingEvent {
            event_type: event_type.to_string(),
            elapsed_ms,
            details: details.to_string(),
        },
    );
}

fn parse_rpc_line(
    line: &str,
    app: &AppHandle,
    _started_at: Instant,
    prompt_sent_at: &mut Option<Instant>,
    first_text_delta_at: &mut Option<Instant>,
) {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return;
    }
    let Ok(value) = serde_json::from_str::<Value>(trimmed) else {
        return;
    };

    let now = Instant::now();
    let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");

    match event_type {
        "response" => {
            let command = value.get("command").and_then(Value::as_str).unwrap_or("");
            if command == "prompt" {
                *prompt_sent_at = Some(now);
                *first_text_delta_at = None;
                emit_rpc_timing(app, "prompt_ack", 0, "pi accepted prompt");
            }
        }
        "message_update" => {
            let sub_type = value
                .get("assistantMessageEvent")
                .and_then(|e| e.get("type"))
                .and_then(Value::as_str)
                .unwrap_or("");

            if sub_type == "text_delta" && first_text_delta_at.is_none() {
                *first_text_delta_at = Some(now);
                let ttft = prompt_sent_at
                    .map(|t| now.duration_since(t).as_millis())
                    .unwrap_or(0);
                emit_rpc_timing(app, "first_text_delta", ttft, "TTFT");
            }
        }
        "message_end" => {
            let elapsed = prompt_sent_at
                .map(|t| now.duration_since(t).as_millis())
                .unwrap_or(0);
            let usage = value
                .get("message")
                .and_then(|m| m.get("usage"))
                .cloned()
                .unwrap_or(Value::Null);
            let input_tokens = usage.get("input").and_then(Value::as_u64).unwrap_or(0);
            let output_tokens = usage.get("output").and_then(Value::as_u64).unwrap_or(0);
            let cache_read = usage.get("cacheRead").and_then(Value::as_u64).unwrap_or(0);
            emit_rpc_timing(
                app,
                "message_end",
                elapsed,
                &format!("input={} output={} cacheRead={}", input_tokens, output_tokens, cache_read),
            );
        }
        "agent_end" => {
            let elapsed = prompt_sent_at
                .map(|t| now.duration_since(t).as_millis())
                .unwrap_or(0);
            emit_rpc_timing(app, "agent_end", elapsed, "complete");
        }
        _ => {}
    }
}
