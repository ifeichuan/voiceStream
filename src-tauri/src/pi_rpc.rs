use crate::settings;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const NEEDS_ATTENTION_ERROR_PREFIX: &str = "voicestream_needs_attention:";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct AskPromptPayload {
    pub questions: Vec<AskPromptQuestion>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct AskPromptQuestion {
    pub question: String,
    pub header: String,
    pub options: Vec<AskPromptOption>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct AskPromptOption {
    pub label: String,
    pub description: String,
}

pub(crate) fn parse_needs_attention_error(error: &str) -> Option<AskPromptPayload> {
    let encoded = error.strip_prefix(NEEDS_ATTENTION_ERROR_PREFIX)?.trim();
    serde_json::from_str(encoded).ok()
}
use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const PROMPT_TIMEOUT: Duration = Duration::from_secs(60);
const AGENT_PROMPT_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Copy, Debug)]
enum PiRpcLaunchMode {
    DictationFast,
    AgentSession,
}

#[derive(Debug)]
struct PiRpcLaunchConfig {
    mode: PiRpcLaunchMode,
    use_session: bool,
    session_path: Option<PathBuf>,
    disable_tools: bool,
    disable_extensions: bool,
    disable_skills: bool,
    disable_prompt_templates: bool,
    disable_themes: bool,
    extension_paths: Vec<PathBuf>,
    system_prompt: Option<String>,
}

impl PiRpcLaunchConfig {
    fn for_mode(mode: PiRpcLaunchMode, app_root: &Path) -> Result<Self, String> {
        let runtime = settings::runtime_pi_settings();
        match mode {
            PiRpcLaunchMode::DictationFast => Ok(Self {
                mode,
                use_session: false,
                session_path: None,
                disable_tools: true,
                disable_extensions: true,
                disable_skills: true,
                disable_prompt_templates: true,
                disable_themes: true,
                extension_paths: vec![],
                system_prompt: Some(runtime.system_prompt.clone()),
            }),
            PiRpcLaunchMode::AgentSession => {
                let session_path = app_root.join(".pi/sessions/voice-dictation.jsonl");
                let mut extension_paths = Vec::new();
                if let Some(extension) = resolve_voicestream_notify_extension(app_root)? {
                    extension_paths.push(extension);
                }

                Ok(Self {
                    mode,
                    use_session: true,
                    session_path: Some(session_path),
                    disable_tools: false,
                    disable_extensions: false,
                    disable_skills: false,
                    disable_prompt_templates: false,
                    disable_themes: false,
                    extension_paths,
                    system_prompt: None,
                })
            }
        }
    }
}

struct RpcLine {
    value: Value,
}

struct PiRpcProcess {
    child: Child,
    stdin: ChildStdin,
    rx: mpsc::Receiver<RpcLine>,
    stderr_buffer: Arc<Mutex<String>>,
}

static REUSABLE_PI_RPC: OnceLock<Mutex<Option<PiRpcProcess>>> = OnceLock::new();
static APP_ROOT: OnceLock<PathBuf> = OnceLock::new();
static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

fn emit_timing(stage: &str, elapsed_ms: u128, details: &str) {
    eprintln!(
        "[pi-rpc][timing] {}: {} ms | {}",
        stage, elapsed_ms, details
    );
    if let Some(app) = APP_HANDLE.get() {
        let _ = app.emit(
            "timing-log",
            crate::TimingEvent {
                session_id: 0,
                stage: format!("pi-rpc:{}", stage),
                elapsed_ms,
                details: details.to_string(),
            },
        );
    }
}

pub fn set_app_handle(handle: AppHandle) {
    let _ = APP_HANDLE.set(handle);
}

struct PiRpcTrace {
    started_at: Instant,
    last_mark: Instant,
}

impl PiRpcTrace {
    fn new() -> Self {
        let now = Instant::now();
        Self {
            started_at: now,
            last_mark: now,
        }
    }

    fn mark(&mut self, stage: &str, details: &str) {
        let now = Instant::now();
        let stage_ms = now.duration_since(self.last_mark).as_millis();
        let total_ms = now.duration_since(self.started_at).as_millis();
        if details.is_empty() {
            eprintln!(
                "[pi-rpc] {}: +{} ms (total {} ms)",
                stage, stage_ms, total_ms
            );
        } else {
            eprintln!(
                "[pi-rpc] {}: +{} ms (total {} ms) {}",
                stage, stage_ms, total_ms, details
            );
        }
        self.last_mark = now;
    }
}

pub fn refine_text(text: &str) -> Result<String, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }

    let runtime = settings::runtime_pi_settings();
    emit_timing(
        "refine_start",
        0,
        &format!(
            "mode={} template_key={} reuse={} input_chars={} system_prompt_chars={}",
            runtime.mode,
            runtime.prompt_template_key,
            runtime.reuse_process,
            trimmed.chars().count(),
            runtime.system_prompt.chars().count()
        ),
    );

    let launch_mode = current_launch_mode();
    if matches!(launch_mode, PiRpcLaunchMode::DictationFast) && should_reuse_process() {
        return refine_text_with_reusable_process(trimmed);
    }

    refine_text_with_fresh_process(trimmed)
}

pub fn run_agent_task(
    transcript: &str,
    title: &str,
    session_path: &Path,
    mut on_event: impl FnMut(&str, &str),
) -> Result<String, String> {
    let transcript = transcript.trim();
    if transcript.is_empty() {
        return Err("agent task transcript is empty".to_string());
    }

    let mut trace = PiRpcTrace::new();
    let (mut child, mut stdin, rx, stderr_buffer) = spawn_pi_rpc_for_agent_session(session_path)?;
    trace.mark("spawn_agent_pi_rpc", "process started");

    write_command(
        &mut stdin,
        &json!({
            "id": "agent-session-name-1",
            "type": "set_session_name",
            "name": title,
        }),
    )?;
    trace.mark("write_set_session_name", title);
    wait_for_response(
        &rx,
        &mut child,
        &stderr_buffer,
        "agent-session-name-1",
        DEFAULT_TIMEOUT,
    )?;
    trace.mark("set_session_name_ack", "response received");

    let prompt = build_agent_task_prompt(transcript);
    let result = run_agent_prompt_cycle(
        &mut child,
        &mut stdin,
        &rx,
        &stderr_buffer,
        &mut trace,
        "agent-prompt-1",
        &prompt,
        "write_agent_prompt",
        &format!("input_chars={}", transcript.chars().count()),
        "agent_prompt_ack",
        &mut on_event,
    );

    shutdown_child(&mut child);
    trace.mark("shutdown_agent_child", "agent process closed");
    result
}

pub fn continue_agent_task(
    message: &str,
    session_path: &Path,
    mut on_event: impl FnMut(&str, &str),
) -> Result<String, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("continue message is empty".to_string());
    }

    let mut trace = PiRpcTrace::new();
    let (mut child, mut stdin, rx, stderr_buffer) = spawn_pi_rpc_for_agent_session(session_path)?;
    trace.mark("spawn_agent_pi_rpc_continue", "process started");

    let result = run_agent_prompt_cycle(
        &mut child,
        &mut stdin,
        &rx,
        &stderr_buffer,
        &mut trace,
        "agent-continue-1",
        message,
        "write_agent_continue_prompt",
        &format!("input_chars={}", message.chars().count()),
        "agent_continue_prompt_ack",
        &mut on_event,
    );

    shutdown_child(&mut child);
    trace.mark("shutdown_agent_continue_child", "agent process closed");
    result
}

pub fn warmup() {
    if !matches!(current_launch_mode(), PiRpcLaunchMode::DictationFast) || !should_reuse_process() {
        return;
    }

    let slot = REUSABLE_PI_RPC.get_or_init(|| Mutex::new(None));
    let mut guard = match slot.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    if guard.is_some() {
        return;
    }

    match spawn_pi_rpc() {
        Ok((child, stdin, rx, stderr_buffer)) => {
            eprintln!("[pi-rpc] warmup ready");
            *guard = Some(PiRpcProcess {
                child,
                stdin,
                rx,
                stderr_buffer,
            });
        }
        Err(error) => {
            eprintln!("[pi-rpc] warmup failed: {}", error);
        }
    }
}

pub fn shutdown_reusable_process() {
    let Some(slot) = REUSABLE_PI_RPC.get() else {
        return;
    };

    let mut guard = match slot.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    let Some(mut process) = guard.take() else {
        return;
    };

    eprintln!("[pi-rpc] shutting down reusable process");
    shutdown_child(&mut process.child);
}

pub fn set_app_root(path: PathBuf) {
    let normalized = path.canonicalize().unwrap_or(path);
    let _ = APP_ROOT.set(normalized.clone());
    eprintln!("[pi-rpc] app root set to {}", normalized.display());
}

fn refine_text_with_fresh_process(trimmed: &str) -> Result<String, String> {
    let mut trace = PiRpcTrace::new();
    let (mut child, mut stdin, rx, stderr_buffer) = spawn_pi_rpc()?;
    trace.mark("spawn_pi_rpc", "process started");

    let result = complete_prompt_cycle(
        trimmed,
        &mut child,
        &mut stdin,
        &rx,
        &stderr_buffer,
        &mut trace,
        false,
    );

    shutdown_child(&mut child);
    trace.mark("shutdown_child", "fresh process closed");
    result
}

fn refine_text_with_reusable_process(trimmed: &str) -> Result<String, String> {
    let mut trace = PiRpcTrace::new();
    let slot = REUSABLE_PI_RPC.get_or_init(|| Mutex::new(None));
    let mut guard = match slot.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };

    if guard.is_none() {
        let (child, stdin, rx, stderr_buffer) = spawn_pi_rpc()?;
        trace.mark("spawn_pi_rpc", "process started");
        *guard = Some(PiRpcProcess {
            child,
            stdin,
            rx,
            stderr_buffer,
        });
    } else {
        trace.mark("spawn_pi_rpc", "reused warm process");
    }

    let process = guard
        .as_mut()
        .ok_or("reusable pi process missing".to_string())?;

    let result = complete_prompt_cycle(
        trimmed,
        &mut process.child,
        &mut process.stdin,
        &process.rx,
        &process.stderr_buffer,
        &mut trace,
        false,
    );

    if result.is_err() {
        shutdown_child(&mut process.child);
        trace.mark("shutdown_child", "reusable process reset after error");
        *guard = None;
    }

    result
}

fn spawn_pi_rpc() -> Result<
    (
        Child,
        ChildStdin,
        mpsc::Receiver<RpcLine>,
        Arc<Mutex<String>>,
    ),
    String,
> {
    let pi_path = resolve_pi_path();
    let app_root = resolve_app_root()?;
    let runtime = settings::runtime_pi_settings();
    let launch_mode = current_launch_mode();
    let config = PiRpcLaunchConfig::for_mode(launch_mode, &app_root)?;
    let mut command = Command::new(&pi_path);

    command.current_dir(&app_root).arg("--mode").arg("rpc");

    if config.use_session {
        let session_path = config
            .session_path
            .as_ref()
            .ok_or("missing session path for session mode".to_string())?;
        if let Some(parent) = session_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "failed to create pi session dir {}: {}",
                    parent.display(),
                    e
                )
            })?;
        }
        eprintln!("[pi-rpc] session path={}", session_path.display());
        command.arg("--session").arg(session_path);
    } else {
        command.arg("--no-session");
    }

    apply_launch_flags(&mut command, &config);
    apply_provider_flags(&mut command, &runtime, false);

    log_launch(&pi_path, &app_root, &config, &runtime);

    // Dictation path: suppress voice feedback. Agent path overrides this in
    // spawn_pi_rpc_for_agent_session.
    command.env("VOICESTREAM_NOTIFY_AUTO_SAY", "0");

    spawn_command(command)
}

fn spawn_pi_rpc_for_agent_session(
    session_path: &Path,
) -> Result<
    (
        Child,
        ChildStdin,
        mpsc::Receiver<RpcLine>,
        Arc<Mutex<String>>,
    ),
    String,
> {
    let pi_path = resolve_pi_path();
    let app_root = resolve_app_root()?;
    let runtime = settings::runtime_agent_settings();
    let config = PiRpcLaunchConfig::for_mode(PiRpcLaunchMode::AgentSession, &app_root)?;
    let mut command = Command::new(&pi_path);

    if let Some(parent) = session_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "failed to create agent pi session dir {}: {}",
                parent.display(),
                e
            )
        })?;
    }

    command
        .current_dir(&app_root)
        .arg("--mode")
        .arg("rpc")
        .arg("--session")
        .arg(session_path);

    apply_launch_flags(&mut command, &config);
    apply_provider_flags(&mut command, &runtime, true);

    eprintln!(
        "[pi-rpc] agent task session path={}",
        session_path.display()
    );
    log_launch(&pi_path, &app_root, &config, &runtime);

    // Allow the voicestream-notify extension to speak AI-generated summaries
    // via the agent_end event, so users hear a real summary instead of raw text.
    command.env("VOICESTREAM_NOTIFY_AUTO_SAY", "1");

    spawn_command(command)
}

pub(crate) fn agent_terminal_command_parts(
    session_path: &Path,
) -> Result<(PathBuf, PathBuf, Vec<String>), String> {
    let pi_path = resolve_pi_path();
    let app_root = resolve_app_root()?;
    let runtime = settings::runtime_agent_settings();
    let config = PiRpcLaunchConfig::for_mode(PiRpcLaunchMode::AgentSession, &app_root)?;
    let mut args = vec!["--session".to_string(), session_path.display().to_string()];

    push_launch_args(&mut args, &config);
    push_provider_args(&mut args, &runtime, true);
    eprintln!(
        "[pi-terminal] cwd={} session={} pi={} extensions={} provider={} model={}",
        app_root.display(),
        session_path.display(),
        pi_path.display(),
        if config.extension_paths.is_empty() {
            "<none>".to_string()
        } else {
            config
                .extension_paths
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(",")
        },
        if runtime.provider.trim().is_empty() {
            "<default>"
        } else {
            runtime.provider.as_str()
        },
        if runtime.model.trim().is_empty() {
            "<default>"
        } else {
            runtime.model.as_str()
        }
    );

    Ok((pi_path, app_root, args))
}

fn apply_launch_flags(command: &mut Command, config: &PiRpcLaunchConfig) {
    if config.disable_tools {
        command.arg("--no-tools");
    }
    if config.disable_extensions {
        command.arg("--no-extensions");
    }
    if config.disable_skills {
        command.arg("--no-skills");
    }
    if config.disable_prompt_templates {
        command.arg("--no-prompt-templates");
    }
    if config.disable_themes {
        command.arg("--no-themes");
    }
    if matches!(config.mode, PiRpcLaunchMode::DictationFast) {
        command.arg("--thinking").arg("off");
    }
    for extension in &config.extension_paths {
        command.arg("-e").arg(extension);
    }
    if let Some(prompt) = &config.system_prompt {
        if !prompt.is_empty() {
            command.arg("--system-prompt").arg(prompt);
        }
    }
}

fn push_launch_args(args: &mut Vec<String>, config: &PiRpcLaunchConfig) {
    if config.disable_tools {
        args.push("--no-tools".to_string());
    }
    if config.disable_extensions {
        args.push("--no-extensions".to_string());
    }
    if config.disable_skills {
        args.push("--no-skills".to_string());
    }
    if config.disable_prompt_templates {
        args.push("--no-prompt-templates".to_string());
    }
    if config.disable_themes {
        args.push("--no-themes".to_string());
    }
    if matches!(config.mode, PiRpcLaunchMode::DictationFast) {
        args.push("--thinking".to_string());
        args.push("off".to_string());
    }
    for extension in &config.extension_paths {
        args.push("-e".to_string());
        args.push(extension.display().to_string());
    }
    if let Some(prompt) = &config.system_prompt {
        if !prompt.is_empty() {
            args.push("--system-prompt".to_string());
            args.push(prompt.clone());
        }
    }
}

fn apply_provider_flags(
    command: &mut Command,
    runtime: &settings::RuntimePiSettings,
    include_thinking: bool,
) {
    if !runtime.provider.trim().is_empty() {
        command.arg("--provider").arg(&runtime.provider);
    }

    if !runtime.model.trim().is_empty() {
        command.arg("--model").arg(&runtime.model);
    }

    if include_thinking && !runtime.thinking.trim().is_empty() {
        command.arg("--thinking").arg(&runtime.thinking);
    }
}

fn push_provider_args(
    args: &mut Vec<String>,
    runtime: &settings::RuntimePiSettings,
    include_thinking: bool,
) {
    if !runtime.provider.trim().is_empty() {
        args.push("--provider".to_string());
        args.push(runtime.provider.clone());
    }

    if !runtime.model.trim().is_empty() {
        args.push("--model".to_string());
        args.push(runtime.model.clone());
    }

    if include_thinking && !runtime.thinking.trim().is_empty() {
        args.push("--thinking".to_string());
        args.push(runtime.thinking.clone());
    }
}

fn log_launch(
    pi_path: &Path,
    app_root: &Path,
    config: &PiRpcLaunchConfig,
    runtime: &settings::RuntimePiSettings,
) {
    let extension_log = if config.extension_paths.is_empty() {
        "<none>".to_string()
    } else {
        config
            .extension_paths
            .iter()
            .map(|path| path.display().to_string())
            .collect::<Vec<_>>()
            .join(",")
    };

    eprintln!(
        "[pi-rpc] launch mode={:?} cwd={} extensions={} no_tools={} no_extensions={} no_skills={} no_prompt_templates={} no_themes={} pi={}",
        config.mode,
        app_root.display(),
        extension_log,
        config.disable_tools,
        config.disable_extensions,
        config.disable_skills,
        config.disable_prompt_templates,
        config.disable_themes,
        pi_path.display()
    );

    if !runtime.provider_json.trim().is_empty() {
        eprintln!("[pi-rpc] provider_json override configured in app settings");
    }

    eprintln!(
        "[pi-rpc] provider={} model={}",
        if runtime.provider.trim().is_empty() {
            "<default>"
        } else {
            runtime.provider.as_str()
        },
        if runtime.model.trim().is_empty() {
            "<default>"
        } else {
            runtime.model.as_str()
        }
    );
}

fn spawn_command(
    mut command: Command,
) -> Result<
    (
        Child,
        ChildStdin,
        mpsc::Receiver<RpcLine>,
        Arc<Mutex<String>>,
    ),
    String,
> {
    command.env("TERM", "xterm-256color");

    if let Ok(home) = std::env::var("HOME") {
        let system_path = std::env::var("PATH").unwrap_or_default();
        let mut extra: Vec<String> = vec![
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
                extra.push(format!("{}/installation/bin", version.display()));
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
                extra.push(format!("{}/bin", version.display()));
            }
        }
        extra.push(format!("{}/.volta/bin", home));

        let enriched = extra
            .iter()
            .filter(|p| std::path::Path::new(p.as_str()).is_dir())
            .chain(std::iter::once(&system_path))
            .cloned()
            .collect::<Vec<_>>()
            .join(":");
        command.env("PATH", enriched);
    }

    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to launch pi rpc process: {}", e))?;

    let stdin = child
        .stdin
        .take()
        .ok_or("failed to capture pi stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or("failed to capture pi stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or("failed to capture pi stderr".to_string())?;

    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_target = stderr_buffer.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stderr);
        let mut output = String::new();
        let _ = reader.read_to_string(&mut output);
        if let Ok(mut buffer) = stderr_target.lock() {
            *buffer = output;
        }
    });

    let (tx, rx) = mpsc::channel::<RpcLine>();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let trimmed = line.trim_end_matches(['\r', '\n']);
                    if trimmed.is_empty() {
                        continue;
                    }

                    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
                        let _ = tx.send(RpcLine { value });
                    }
                }
                Err(_) => break,
            }
        }
    });

    Ok((child, stdin, rx, stderr_buffer))
}

fn current_launch_mode() -> PiRpcLaunchMode {
    PiRpcLaunchMode::DictationFast
}

fn should_reuse_process() -> bool {
    settings::runtime_pi_settings().reuse_process
}

fn resolve_app_root() -> Result<PathBuf, String> {
    if let Some(path) = env::var("VOICESTREAM_APP_ROOT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        let normalized = path.canonicalize().unwrap_or(path);
        return Ok(normalized);
    }

    if let Some(path) = APP_ROOT.get() {
        return Ok(path.clone());
    }

    let mut candidates = Vec::new();

    if let Ok(current_exe) = env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            candidates.push(parent.to_path_buf());
            if let Some(grandparent) = parent.parent() {
                // .app/Contents/Resources — where Tauri puts bundled resources
                candidates.push(grandparent.join("Resources"));
                candidates.push(grandparent.to_path_buf());
                // Also check one level up from .app (dev scenario)
                if let Some(great_grandparent) = grandparent.parent() {
                    candidates.push(great_grandparent.to_path_buf());
                }
            }
        }
    }

    let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    candidates.push(cwd.clone());
    candidates.push(cwd.join(".."));

    eprintln!("[resolve_app_root] candidates: {:?}", candidates);

    for candidate in &candidates {
        let normalized = candidate.canonicalize().unwrap_or(candidate.clone());
        if normalized.join("pi-extensions").exists()
            || normalized.join("src-tauri/tauri.conf.json").exists()
            || normalized.join("package.json").exists()
        {
            eprintln!("[resolve_app_root] resolved: {}", normalized.display());
            return Ok(normalized);
        }
    }

    // Last resort: if we're in a .app bundle, Resources is the most likely location
    if let Ok(current_exe) = env::current_exe() {
        let resources = current_exe
            .parent()
            .and_then(|p| p.parent())
            .map(|p| p.join("Resources"));
        if let Some(res) = resources {
            eprintln!("[resolve_app_root] fallback to Resources: {}", res.display());
            return Ok(res);
        }
    }

    eprintln!("[resolve_app_root] fallback to cwd: {}", cwd.display());
    Ok(cwd)
}

fn resolve_voicestream_notify_extension(app_root: &Path) -> Result<Option<PathBuf>, String> {
    if let Some(path) = env::var("VOICESTREAM_PI_NOTIFY_EXTENSION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        let normalized = path.canonicalize().unwrap_or(path.clone());
        if normalized.exists() {
            return Ok(Some(normalized));
        }

        return Err(format!(
            "notify extension from VOICESTREAM_PI_NOTIFY_EXTENSION not found at {}",
            path.display()
        ));
    }

    let extension = app_root.join("pi-extensions/voicestream-notify.ts");
    if extension.exists() {
        Ok(Some(extension))
    } else {
        eprintln!(
            "[pi-rpc] notify extension skipped; not found at {}",
            extension.display()
        );
        Ok(None)
    }
}

pub fn resolve_pi_path_public() -> PathBuf {
    resolve_pi_path()
}

fn resolve_pi_path() -> PathBuf {
    if let Ok(path) = env::var("VOICESTREAM_PI_PATH") {
        let path = PathBuf::from(path);
        if path.exists() {
            return path;
        }
    }

    if let Ok(home) = env::var("HOME") {
        let candidates = [
            PathBuf::from(&home).join("Library/pnpm/pi"),
            PathBuf::from(&home).join(".local/bin/pi"),
            PathBuf::from(&home).join(".bun/bin/pi"),
        ];
        for candidate in candidates {
            if candidate.exists() {
                return candidate;
            }
        }
    }

    PathBuf::from("pi")
}

fn write_command(stdin: &mut ChildStdin, value: &Value) -> Result<(), String> {
    let payload = serde_json::to_string(value).map_err(|e| format!("rpc encode failed: {}", e))?;
    stdin
        .write_all(payload.as_bytes())
        .map_err(|e| format!("rpc stdin write failed: {}", e))?;
    stdin
        .write_all(b"\n")
        .map_err(|e| format!("rpc stdin newline failed: {}", e))?;
    stdin
        .flush()
        .map_err(|e| format!("rpc stdin flush failed: {}", e))
}

fn wait_for_response(
    rx: &mpsc::Receiver<RpcLine>,
    child: &mut Child,
    stderr: &Arc<Mutex<String>>,
    response_id: &str,
    timeout: Duration,
) -> Result<Value, String> {
    let deadline = Instant::now() + timeout;
    loop {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            shutdown_child(child);
            return Err(format!(
                "timed out waiting for pi rpc response {}{}",
                response_id,
                format_stderr(stderr)
            ));
        };

        match rx.recv_timeout(remaining) {
            Ok(line) => {
                if line.value.get("type").and_then(Value::as_str) == Some("response")
                    && line.value.get("id").and_then(Value::as_str) == Some(response_id)
                {
                    let success = line
                        .value
                        .get("success")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    if success {
                        return Ok(line.value);
                    }

                    let error = line
                        .value
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown rpc error");
                    shutdown_child(child);
                    return Err(format!(
                        "pi rpc command failed: {}{}",
                        error,
                        format_stderr(stderr)
                    ));
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                shutdown_child(child);
                return Err(format!(
                    "timed out waiting for pi rpc response {}{}",
                    response_id,
                    format_stderr(stderr)
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                shutdown_child(child);
                return Err(format!(
                    "pi rpc stdout closed before response {}{}",
                    response_id,
                    format_stderr(stderr)
                ));
            }
        }
    }
}

fn wait_for_prompt_completion(
    rx: &mpsc::Receiver<RpcLine>,
    child: &mut Child,
    stderr: &Arc<Mutex<String>>,
    timeout: Duration,
    mut trace: Option<&mut PiRpcTrace>,
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    let mut streamed_text = String::new();
    let mut last_assistant_error: Option<String> = None;
    let mut saw_first_text_delta = false;

    loop {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            shutdown_child(child);
            return Err(format!(
                "timed out waiting for pi agent_end{}",
                format_stderr(stderr)
            ));
        };

        match rx.recv_timeout(remaining) {
            Ok(line) => {
                if let Some(error) = extract_assistant_error_from_event(&line.value) {
                    last_assistant_error = Some(error);
                }

                match line.value.get("type").and_then(Value::as_str) {
                    Some("message_update") => {
                        let event_type = line
                            .value
                            .get("assistantMessageEvent")
                            .and_then(|event| event.get("type"))
                            .and_then(Value::as_str);

                        if event_type == Some("text_delta") {
                            if !saw_first_text_delta {
                                saw_first_text_delta = true;
                                if let Some(trace) = trace.as_deref_mut() {
                                    trace.mark(
                                        "first_text_delta",
                                        "assistant started streaming text",
                                    );
                                    emit_timing(
                                        "first_text_delta",
                                        trace.last_mark.duration_since(trace.started_at).as_millis(),
                                        "TTFT - time from start to first token from LLM",
                                    );
                                }
                            }

                            if let Some(delta) = line
                                .value
                                .get("assistantMessageEvent")
                                .and_then(|event| event.get("delta"))
                                .and_then(Value::as_str)
                            {
                                streamed_text.push_str(delta);
                            }
                        }
                    }
                    Some("message_end") => {
                        if let Some(text) = extract_text_from_message_value(&line.value, "message")
                        {
                            streamed_text = text;
                        }
                    }
                    Some("agent_end") => {
                        if let Some(trace) = trace.as_deref_mut() {
                            trace.mark("agent_end", "stream complete");
                        }

                        if let Some(error) = last_assistant_error {
                            if streamed_text.trim().is_empty() {
                                shutdown_child(child);
                                return Err(format!(
                                    "pi rpc assistant error: {}{}",
                                    error,
                                    format_stderr(stderr)
                                ));
                            }
                        }

                        return Ok(streamed_text);
                    }
                    _ => {}
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                shutdown_child(child);
                return Err(format!(
                    "timed out waiting for pi agent_end{}",
                    format_stderr(stderr)
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                shutdown_child(child);
                return Err(format!(
                    "pi rpc stdout closed before agent_end{}",
                    format_stderr(stderr)
                ));
            }
        }
    }
}

fn wait_for_agent_task_completion(
    rx: &mpsc::Receiver<RpcLine>,
    child: &mut Child,
    stderr: &Arc<Mutex<String>>,
    timeout: Duration,
    trace: &mut PiRpcTrace,
    on_event: &mut impl FnMut(&str, &str),
) -> Result<String, String> {
    let deadline = Instant::now() + timeout;
    let mut streamed_text = String::new();
    let mut last_assistant_error: Option<String> = None;
    let mut saw_first_text_delta = false;

    loop {
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            shutdown_child(child);
            return Err(format!(
                "timed out waiting for pi agent_end{}",
                format_stderr(stderr)
            ));
        };

        match rx.recv_timeout(remaining) {
            Ok(line) => {
                if let Some(error) = extract_assistant_error_from_event(&line.value) {
                    last_assistant_error = Some(error.clone());
                    on_event("assistant-error", &error);
                }

                match line.value.get("type").and_then(Value::as_str) {
                    Some("message_update") => {
                        let event_type = line
                            .value
                            .get("assistantMessageEvent")
                            .and_then(|event| event.get("type"))
                            .and_then(Value::as_str);

                        match event_type {
                            Some("text_delta") => {
                                if !saw_first_text_delta {
                                    saw_first_text_delta = true;
                                    trace.mark(
                                        "agent_first_text_delta",
                                        "assistant started streaming text",
                                    );
                                    on_event("text-start", "Agent 开始输出结果。");
                                }

                                if let Some(delta) = line
                                    .value
                                    .get("assistantMessageEvent")
                                    .and_then(|event| event.get("delta"))
                                    .and_then(Value::as_str)
                                {
                                    streamed_text.push_str(delta);
                                    on_event("text-delta", delta);
                                }
                            }
                            Some("toolcall_start") => {
                                let tool_name = line
                                    .value
                                    .get("assistantMessageEvent")
                                    .and_then(|event| event.get("partial"))
                                    .and_then(|partial| partial.get("content"))
                                    .and_then(Value::as_array)
                                    .and_then(|content| content.first())
                                    .and_then(|item| item.get("name"))
                                    .and_then(Value::as_str)
                                    .unwrap_or("unknown");
                                trace.mark("agent_toolcall_start", &format!("tool={}", tool_name));
                                on_event("toolcall-start", &format!("准备调用工具：{}", tool_name));
                            }
                            Some("toolcall_end") => {
                                on_event("toolcall-end", "工具调用请求已生成。");
                            }
                            _ => {}
                        }
                    }
                    Some("tool_execution_start") => {
                        let tool_name = line
                            .value
                            .get("toolName")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown");
                        trace.mark("agent_tool_execution_start", &format!("tool={}", tool_name));

                        if let Some(prompt) = extract_question_tool_prompt_from_event(&line.value) {
                            let summary = prompt.questions.first().map(|q| q.question.as_str()).unwrap_or("Agent 需要用户回应才能继续。");
                            on_event("needs-attention", summary);
                            shutdown_child(child);
                            let encoded = serde_json::to_string(&prompt).unwrap_or_else(|_| "{}".to_string());
                            return Err(format!("{} {}", NEEDS_ATTENTION_ERROR_PREFIX, encoded));
                        }

                        on_event("tool-start", &format!("正在执行工具：{}", tool_name));
                    }
                    Some("tool_execution_update") => {
                        let tool_name = line
                            .value
                            .get("toolName")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown");
                        on_event("tool-update", &format!("工具执行中：{}", tool_name));
                    }
                    Some("tool_execution_end") => {
                        let tool_name = line
                            .value
                            .get("toolName")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown");
                        let is_error = line
                            .value
                            .get("isError")
                            .and_then(Value::as_bool)
                            .unwrap_or(false);
                        trace.mark(
                            "agent_tool_execution_end",
                            &format!("tool={}, is_error={}", tool_name, is_error),
                        );
                        on_event(
                            if is_error { "tool-error" } else { "tool-end" },
                            &format!("工具执行结束：{}", tool_name),
                        );
                    }
                    Some("message_end") => {
                        if let Some(text) = extract_text_from_message_value(&line.value, "message")
                        {
                            streamed_text = text;
                        }
                    }
                    Some("agent_end") => {
                        trace.mark("agent_task_agent_end", "stream complete");
                        if streamed_text.trim().is_empty() {
                            if let Some(text) =
                                extract_last_assistant_text_from_agent_end(&line.value)
                            {
                                streamed_text = text;
                            }
                        }

                        if let Some(error) = last_assistant_error {
                            if streamed_text.trim().is_empty() {
                                shutdown_child(child);
                                return Err(format!(
                                    "pi rpc assistant error: {}{}",
                                    error,
                                    format_stderr(stderr)
                                ));
                            }
                        }

                        return Ok(streamed_text.trim().to_string());
                    }
                    _ => {}
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                shutdown_child(child);
                return Err(format!(
                    "timed out waiting for pi agent_end{}",
                    format_stderr(stderr)
                ));
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                shutdown_child(child);
                return Err(format!(
                    "pi rpc stdout closed before agent_end{}",
                    format_stderr(stderr)
                ));
            }
        }
    }
}

fn run_agent_prompt_cycle(
    child: &mut Child,
    stdin: &mut ChildStdin,
    rx: &mpsc::Receiver<RpcLine>,
    stderr_buffer: &Arc<Mutex<String>>,
    trace: &mut PiRpcTrace,
    prompt_id: &str,
    message: &str,
    write_stage: &str,
    write_details: &str,
    ack_stage: &str,
    on_event: &mut impl FnMut(&str, &str),
) -> Result<String, String> {
    write_command(
        stdin,
        &json!({
            "id": prompt_id,
            "type": "prompt",
            "message": message,
        }),
    )?;
    trace.mark(write_stage, write_details);
    on_event("prompt", "Agent 已收到输入。");

    wait_for_response(rx, child, stderr_buffer, prompt_id, DEFAULT_TIMEOUT)?;
    trace.mark(ack_stage, "response received");

    wait_for_agent_task_completion(
        rx,
        child,
        stderr_buffer,
        AGENT_PROMPT_TIMEOUT,
        trace,
        on_event,
    )
}

fn build_agent_task_prompt(transcript: &str) -> String {
    format!(
        "你是 VoiceStream 的后台 Agent。用户刚通过语音明确发起了一个本地后台任务。\n\n执行要求：\n1. 把 <task> 中的内容当作真实任务执行，而不是当作要整理或粘贴的文字。\n2. 可以使用当前 Pi 环境可用的工具来读取、分析、修改或验证本地项目。\n3. 开始后直接行动；除非缺少关键安全信息，否则不要反问。\n4. 输出要包含简洁进展和最终结果。\n5. 如果任务失败，说明失败原因和已完成的部分。\n\n<task>\n{}\n</task>",
        transcript.trim()
    )
}

fn complete_prompt_cycle(
    trimmed: &str,
    child: &mut Child,
    stdin: &mut ChildStdin,
    rx: &mpsc::Receiver<RpcLine>,
    stderr_buffer: &Arc<Mutex<String>>,
    trace: &mut PiRpcTrace,
    reset_session: bool,
) -> Result<String, String> {
    if reset_session {
        write_command(
            stdin,
            &json!({
                "id": "new-session-1",
                "type": "new_session",
            }),
        )?;
        trace.mark("write_new_session", "request sent");
        wait_for_response(rx, child, stderr_buffer, "new-session-1", DEFAULT_TIMEOUT)?;
        trace.mark("new_session_ack", "session reset confirmed");
    }

    write_command(
        stdin,
        &json!({
            "id": "prompt-1",
            "type": "prompt",
            "message": trimmed,
        }),
    )?;
    trace.mark(
        "write_prompt",
        &format!("input_chars={}", trimmed.chars().count()),
    );

    wait_for_response(rx, child, stderr_buffer, "prompt-1", DEFAULT_TIMEOUT)?;
    trace.mark("prompt_ack", "response received");
    emit_timing(
        "prompt_ack",
        trace.last_mark.duration_since(trace.started_at).as_millis(),
        "pi accepted prompt, waiting for LLM response",
    );

    let streamed_text =
        wait_for_prompt_completion(rx, child, stderr_buffer, PROMPT_TIMEOUT, Some(trace))?;
    let text = streamed_text.trim();
    let output_chars = text.chars().count();
    trace.mark(
        "prompt_stream_complete",
        &format!("streamed_chars={}", output_chars),
    );

    if text.is_empty() {
        emit_timing(
            "result",
            trace.last_mark.duration_since(trace.started_at).as_millis(),
            &format!(
                "path=original_fallback output_chars={} reason=empty_model_output",
                trimmed.chars().count()
            ),
        );
        return Ok(trimmed.to_string());
    }

    emit_timing(
        "result",
        trace.last_mark.duration_since(trace.started_at).as_millis(),
        &format!("path=streamed output_chars={}", output_chars),
    );

    Ok(text.to_string())
}

fn shutdown_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn format_stderr(stderr: &Arc<Mutex<String>>) -> String {
    let output = stderr
        .lock()
        .map(|value| value.trim().to_string())
        .unwrap_or_default();

    if output.is_empty() {
        String::new()
    } else {
        format!(" | stderr: {}", output)
    }
}

fn extract_question_tool_prompt_from_event(event: &Value) -> Option<AskPromptPayload> {
    let tool_name = event
        .get("toolName")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    if !is_question_tool_name(&tool_name) {
        return None;
    }

    let args = event
        .get("args")
        .or_else(|| event.get("arguments"))
        .or_else(|| event.get("input"))
        .unwrap_or(&Value::Null);
    let questions = extract_questions(args);
    Some(AskPromptPayload {
        questions: if questions.is_empty() {
            vec![AskPromptQuestion {
                question: "Agent 需要用户回应才能继续。".to_string(),
                header: "问题".to_string(),
                options: Vec::new(),
            }]
        } else {
            questions
        },
    })
}

fn is_question_tool_name(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "ask_user_question" | "ask_user" | "question" | "ask" | "confirm" | "approval" | "permission"
    )
}

fn extract_questions(value: &Value) -> Vec<AskPromptQuestion> {
    if let Some(questions) = value.get("questions").and_then(Value::as_array) {
        return questions.iter().filter_map(extract_question).collect();
    }

    extract_question(value).into_iter().collect()
}

fn extract_question(value: &Value) -> Option<AskPromptQuestion> {
    let question = extract_question_prompt(value)?;
    let header = value
        .get("header")
        .and_then(Value::as_str)
        .unwrap_or("问题")
        .trim()
        .to_string();
    let options = value
        .get("options")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(extract_question_option).collect())
        .unwrap_or_default();
    Some(AskPromptQuestion {
        question,
        header: if header.is_empty() { "问题".to_string() } else { header },
        options,
    })
}

fn extract_question_option(value: &Value) -> Option<AskPromptOption> {
    if let Some(label) = value.as_str() {
        let label = label.trim();
        if label.is_empty() {
            return None;
        }
        return Some(AskPromptOption {
            label: label.to_string(),
            description: String::new(),
        });
    }

    let label = value
        .get("label")
        .or_else(|| value.get("title"))
        .and_then(Value::as_str)?
        .trim()
        .to_string();
    if label.is_empty() {
        return None;
    }
    let description = value
        .get("description")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    Some(AskPromptOption { label, description })
}

fn extract_question_prompt(value: &Value) -> Option<String> {
    for key in ["question", "prompt", "message", "text", "title"] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            let text = text.trim();
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }

    None
}

fn extract_last_assistant_text_from_agent_end(event: &Value) -> Option<String> {
    let messages = event.get("messages")?.as_array()?;

    for message in messages.iter().rev() {
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }

        if let Some(text) = extract_text_from_message(message) {
            return Some(text);
        }
    }

    None
}

fn extract_text_from_message_value(event: &Value, key: &str) -> Option<String> {
    let message = event.get(key)?;
    extract_text_from_message(message)
}

fn extract_text_from_message(message: &Value) -> Option<String> {
    let content = message.get("content")?.as_array()?;
    let mut text = String::new();

    for item in content {
        if item.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(part) = item.get("text").and_then(Value::as_str) {
                text.push_str(part);
            }
        }
    }

    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn extract_assistant_error_from_event(event: &Value) -> Option<String> {
    extract_assistant_error(event.get("message")?)
}

fn extract_assistant_error(message: &Value) -> Option<String> {
    if let Some(error) = message.get("errorMessage").and_then(Value::as_str) {
        let error = error.trim();
        if !error.is_empty() {
            return Some(error.to_string());
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::{extract_question_tool_prompt_from_event, parse_needs_attention_error, refine_text, warmup};
    use serde_json::json;
    use std::time::Instant;

    #[test]
    fn detects_rpiv_ask_user_question_tool_start() {
        let event = json!({
            "type": "tool_execution_start",
            "toolName": "ask_user_question",
            "args": {
                "questions": [{
                    "question": "这次测试要走哪条路径？",
                    "header": "测试路径",
                    "options": [{"label": "最小验证", "description": "只检查通知"}]
                }]
            }
        });

        let prompt = extract_question_tool_prompt_from_event(&event).expect("prompt");
        assert_eq!(prompt.questions[0].question, "这次测试要走哪条路径？");
        assert_eq!(prompt.questions[0].header, "测试路径");
        assert_eq!(prompt.questions[0].options[0].label, "最小验证");
        assert_eq!(prompt.questions[0].options[0].description, "只检查通知");
    }

    #[test]
    fn detects_pi_ask_user_tool_start() {
        let event = json!({
            "type": "tool_execution_start",
            "toolName": "ask_user",
            "args": { "question": "Which option should we use?" }
        });

        let prompt = extract_question_tool_prompt_from_event(&event).expect("prompt");
        assert_eq!(prompt.questions[0].question, "Which option should we use?");
    }

    #[test]
    fn parses_needs_attention_error() {
        let error = r#"voicestream_needs_attention: {"questions":[{"question":"继续吗？","header":"确认","options":[]}]}"#;
        let prompt = parse_needs_attention_error(error).expect("prompt");
        assert_eq!(prompt.questions[0].question, "继续吗？");
    }

    #[test]
    #[ignore = "real rpc benchmark; run manually with cargo test pi_rpc_repeated_refine_same_text -- --ignored --nocapture"]
    fn pi_rpc_repeated_refine_same_text() {
        let sample = "让我们来测试一下，在同样文本下连续调用时，这条链路到底有多快。";
        let rounds = std::env::var("VOICESTREAM_PI_BENCH_ROUNDS")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .filter(|value| *value > 0)
            .unwrap_or(5);

        eprintln!(
            "[pi-rpc][bench] starting repeated refine benchmark rounds={} reuse_process={} text={}",
            rounds,
            super::should_reuse_process(),
            serde_json::to_string(sample).unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
        );

        let warmup_started_at = Instant::now();
        warmup();
        eprintln!(
            "[pi-rpc][bench] warmup_called elapsed_ms={}",
            warmup_started_at.elapsed().as_millis()
        );

        let total_started_at = Instant::now();
        for round in 1..=rounds {
            let started_at = Instant::now();
            let result = refine_text(sample).expect("refine_text should succeed in benchmark");
            let elapsed_ms = started_at.elapsed().as_millis();
            eprintln!(
                "[pi-rpc][bench] round={} elapsed_ms={} output={}",
                round,
                elapsed_ms,
                serde_json::to_string(&result)
                    .unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
            );
        }

        eprintln!(
            "[pi-rpc][bench] total_elapsed_ms={}",
            total_started_at.elapsed().as_millis()
        );
    }
}
