use crate::{agent_tasks, pi_rpc};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter};

static TERMINALS: OnceLock<Mutex<HashMap<String, AgentTerminalHandle>>> = OnceLock::new();
static NEXT_TERMINAL_RUN_ID: AtomicU64 = AtomicU64::new(1);

struct AgentTerminalHandle {
    run_id: u64,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    intentional_stop: Arc<AtomicBool>,
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
    let run_id = NEXT_TERMINAL_RUN_ID.fetch_add(1, Ordering::Relaxed);

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
    // Allow the speakmore-notify extension to speak summaries in agent terminal mode too.
    command.env("SPEAKMORE_NOTIFY_AUTO_SAY", "1");
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
            format!("{}/bin", home),
            "/usr/local/bin".to_string(),
            "/opt/homebrew/bin".to_string(),
        ];

        // Resolve fnm/nvm/volta node paths
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

        let volta_node = format!("{}/.volta/bin", home);
        extra_paths.push(volta_node);

        let enriched_path = extra_paths
            .iter()
            .filter(|p| std::path::Path::new(p.as_str()).is_dir())
            .chain(std::iter::once(&system_path))
            .cloned()
            .collect::<Vec<_>>()
            .join(":");
        command.env("PATH", enriched_path);
    }

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
    let intentional_stop = Arc::new(AtomicBool::new(false));

    let task_id_for_read = task_id.to_string();
    let task_id_for_wait = task_id.to_string();
    let app_for_read = app.clone();
    let app_for_wait = app.clone();
    let intentional_stop_for_read = intentional_stop.clone();
    let intentional_stop_for_wait = intentional_stop.clone();

    emit_status(&app, task_id, "running", "PTY 已连接。");

    thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    if intentional_stop_for_read.load(Ordering::SeqCst)
                        || !is_current(&task_id_for_read, run_id)
                    {
                        break;
                    }
                    let _ = app_for_read.emit(
                        "agent-terminal-output",
                        AgentTerminalOutputEvent {
                            task_id: task_id_for_read.clone(),
                            data: buffer[..size].to_vec(),
                        },
                    );
                }
                Err(error) => {
                    if intentional_stop_for_read.load(Ordering::SeqCst)
                        || !is_current(&task_id_for_read, run_id)
                    {
                        break;
                    }
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
        let was_intentional_stop = intentional_stop_for_wait.load(Ordering::SeqCst);
        remove_if_current(&task_id_for_wait, run_id);
        if was_intentional_stop {
            return;
        }
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
        run_id,
        writer,
        killer,
        intentional_stop,
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
        handle.intentional_stop.store(true, Ordering::SeqCst);
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

fn is_current(task_id: &str, run_id: u64) -> bool {
    terminals()
        .lock()
        .ok()
        .and_then(|terminals| terminals.get(task_id).map(|terminal| terminal.run_id == run_id))
        .unwrap_or(false)
}

fn remove_if_current(task_id: &str, run_id: u64) -> Option<AgentTerminalHandle> {
    let mut terminals = terminals().lock().ok()?;
    if terminals
        .get(task_id)
        .map(|terminal| terminal.run_id == run_id)
        .unwrap_or(false)
    {
        terminals.remove(task_id)
    } else {
        None
    }
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
