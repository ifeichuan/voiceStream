use crate::{agent_tasks, pi_rpc};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};

static TERMINALS: OnceLock<Mutex<HashMap<String, AgentTerminalHandle>>> = OnceLock::new();

struct AgentTerminalHandle {
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    master: Box<dyn MasterPty + Send>,
}

#[derive(Debug, Serialize, Clone)]
pub struct AgentTerminalOutputEvent {
    pub task_id: String,
    pub data: Vec<u8>,
}

#[derive(Debug, Serialize, Clone)]
pub struct AgentTerminalStatusEvent {
    pub task_id: String,
    pub status: String,
    pub message: String,
}

pub fn start(app: AppHandle, task_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let task = agent_tasks::get_task(task_id)?;
    let session_path = PathBuf::from(&task.session_path);
    if let Some(parent) = session_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create agent session dir {}: {}",
                parent.display(),
                error
            )
        })?;
    }

    stop(task_id);

    let (pi_path, app_root, args) = pi_rpc::agent_terminal_command_parts(&session_path)?;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(8),
            cols: cols.max(24),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to open agent pty: {}", error))?;

    let mut command = CommandBuilder::new(pi_path.as_os_str());
    command.cwd(app_root.as_os_str());
    command.env("VOICESTREAM_NOTIFY_AUTO_SAY", "0");
    for arg in args {
        command.arg(arg);
    }

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("failed to spawn pi terminal: {}", error))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to clone pty reader: {}", error))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("failed to open pty writer: {}", error))?;
    let writer = Arc::new(Mutex::new(writer));
    let killer = Arc::new(Mutex::new(child.clone_killer()));

    let task_id_for_read = task_id.to_string();
    let task_id_for_wait = task_id.to_string();
    let app_for_read = app.clone();
    let app_for_wait = app.clone();

    emit_status(&app, task_id, "running", "PTY 已连接。");

    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let _ = app_for_read.emit(
                        "agent-terminal-output",
                        AgentTerminalOutputEvent {
                            task_id: task_id_for_read.clone(),
                            data: buffer[..size].to_vec(),
                        },
                    );
                }
                Err(error) => {
                    let _ = app_for_read.emit(
                        "agent-terminal-status",
                        AgentTerminalStatusEvent {
                            task_id: task_id_for_read.clone(),
                            status: "error".to_string(),
                            message: format!("PTY 读取失败：{}", error),
                        },
                    );
                    break;
                }
            }
        }
    });

    thread::spawn(move || {
        let status = child.wait();
        remove(&task_id_for_wait);
        let (status_text, message) = match status {
            Ok(status) if status.success() => {
                ("closed".to_string(), format!("PTY 已退出：{}", status))
            }
            Ok(status) => ("failed".to_string(), format!("PTY 异常退出：{}", status)),
            Err(error) => ("failed".to_string(), format!("PTY 等待失败：{}", error)),
        };
        emit_status(&app_for_wait, &task_id_for_wait, &status_text, &message);
    });

    let handle = AgentTerminalHandle {
        writer,
        killer,
        master: pair.master,
    };

    terminals()
        .lock()
        .map_err(|_| "agent terminal lock poisoned".to_string())?
        .insert(task_id.to_string(), handle);

    Ok(())
}

pub fn write(task_id: &str, data: &str) -> Result<(), String> {
    let writer = {
        let terminals = terminals()
            .lock()
            .map_err(|_| "agent terminal lock poisoned".to_string())?;
        terminals
            .get(task_id)
            .map(|terminal| terminal.writer.clone())
            .ok_or_else(|| "Agent terminal is not running.".to_string())?
    };

    let mut writer = writer
        .lock()
        .map_err(|_| "agent terminal writer lock poisoned".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("failed to write to pty: {}", error))?;
    writer
        .flush()
        .map_err(|error| format!("failed to flush pty: {}", error))
}

pub fn resize(task_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    let terminals = terminals()
        .lock()
        .map_err(|_| "agent terminal lock poisoned".to_string())?;
    let terminal = terminals
        .get(task_id)
        .ok_or_else(|| "Agent terminal is not running.".to_string())?;

    terminal
        .master
        .resize(PtySize {
            rows: rows.max(8),
            cols: cols.max(24),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to resize pty: {}", error))
}

pub fn stop(task_id: &str) {
    if let Some(handle) = remove(task_id) {
        if let Ok(mut killer) = handle.killer.lock() {
            let _ = killer.kill();
        }
    }
}

pub fn shutdown_all() {
    let task_ids = terminals()
        .lock()
        .map(|terminals| terminals.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    for task_id in task_ids {
        stop(&task_id);
    }
}

fn terminals() -> &'static Mutex<HashMap<String, AgentTerminalHandle>> {
    TERMINALS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn remove(task_id: &str) -> Option<AgentTerminalHandle> {
    terminals().lock().ok()?.remove(task_id)
}

fn emit_status(app: &AppHandle, task_id: &str, status: &str, message: &str) {
    let _ = app.emit(
        "agent-terminal-status",
        AgentTerminalStatusEvent {
            task_id: task_id.to_string(),
            status: status.to_string(),
            message: message.to_string(),
        },
    );
}
