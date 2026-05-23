use crate::settings;
use serde_json::{json, Value};
use std::env;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const PROMPT_TIMEOUT: Duration = Duration::from_secs(60);
const AGENT_PROMPT_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Copy, Debug)]
enum PiRpcLaunchMode {
    DictationFast,
    DictationWithVoiceFeedback,
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
}

impl PiRpcLaunchConfig {
    fn for_mode(
        mode: PiRpcLaunchMode,
        app_root: &Path,
        enable_tooluse_output: bool,
    ) -> Result<Self, String> {
        match mode {
            PiRpcLaunchMode::DictationFast => Ok(Self {
                mode,
                use_session: false,
                session_path: None,
                // Some providers reject requests when tools field is an empty array.
                // Keep tools enabled.
                disable_tools: false,
                disable_extensions: !enable_tooluse_output,
                disable_skills: true,
                disable_prompt_templates: true,
                disable_themes: true,
                extension_paths: if enable_tooluse_output {
                    vec![resolve_dictation_emit_extension(app_root)?]
                } else {
                    vec![]
                },
            }),
            PiRpcLaunchMode::DictationWithVoiceFeedback => Ok(Self {
                mode,
                use_session: false,
                session_path: None,
                disable_tools: false,
                disable_extensions: false,
                disable_skills: false,
                disable_prompt_templates: false,
                disable_themes: false,
                extension_paths: vec![resolve_voice_feedback_extension(app_root)?],
            }),
            PiRpcLaunchMode::AgentSession => {
                let session_path = app_root.join(".pi/sessions/voice-dictation.jsonl");
                let mut extension_paths = vec![resolve_voice_feedback_extension(app_root)?];
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
        true,
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
    let enable_tooluse_output = runtime
        .prompt_template_key
        .trim()
        .eq_ignore_ascii_case("tooluse-structured");
    let config = PiRpcLaunchConfig::for_mode(launch_mode, &app_root, enable_tooluse_output)?;
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
    apply_provider_flags(&mut command, &runtime);

    log_launch(&pi_path, &app_root, &config, &runtime);

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
    let runtime = settings::runtime_pi_settings();
    let config = PiRpcLaunchConfig::for_mode(PiRpcLaunchMode::AgentSession, &app_root, false)?;
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
    apply_provider_flags(&mut command, &runtime);

    eprintln!(
        "[pi-rpc] agent task session path={}",
        session_path.display()
    );
    log_launch(&pi_path, &app_root, &config, &runtime);

    spawn_command(command)
}

pub(crate) fn agent_terminal_command_parts(
    session_path: &Path,
) -> Result<(PathBuf, PathBuf, Vec<String>), String> {
    let pi_path = resolve_pi_path();
    let app_root = resolve_app_root()?;
    let runtime = settings::runtime_pi_settings();
    let config = PiRpcLaunchConfig::for_mode(PiRpcLaunchMode::AgentSession, &app_root, false)?;
    let mut args = vec!["--session".to_string(), session_path.display().to_string()];

    push_launch_args(&mut args, &config);
    push_provider_args(&mut args, &runtime);
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
    for extension in &config.extension_paths {
        command.arg("-e").arg(extension);
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
    for extension in &config.extension_paths {
        args.push("-e".to_string());
        args.push(extension.display().to_string());
    }
}

fn apply_provider_flags(command: &mut Command, runtime: &settings::RuntimePiSettings) {
    if !runtime.provider.trim().is_empty() {
        command.arg("--provider").arg(&runtime.provider);
    }

    if !runtime.model.trim().is_empty() {
        command.arg("--model").arg(&runtime.model);
    }
}

fn push_provider_args(args: &mut Vec<String>, runtime: &settings::RuntimePiSettings) {
    if !runtime.provider.trim().is_empty() {
        args.push("--provider".to_string());
        args.push(runtime.provider.clone());
    }

    if !runtime.model.trim().is_empty() {
        args.push("--model".to_string());
        args.push(runtime.model.clone());
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
    command.env("VOICESTREAM_NOTIFY_AUTO_SAY", "0");
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
    match settings::runtime_pi_settings()
        .mode
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "dictation-voice" => PiRpcLaunchMode::DictationWithVoiceFeedback,
        _ => PiRpcLaunchMode::DictationFast,
    }
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
                candidates.push(grandparent.to_path_buf());
            }
        }
    }

    let cwd = env::current_dir().map_err(|e| format!("failed to resolve current dir: {}", e))?;
    candidates.push(cwd.clone());
    candidates.push(cwd.join(".."));

    for candidate in candidates {
        let normalized = candidate.canonicalize().unwrap_or(candidate.clone());
        if normalized.join("pi-extensions").exists()
            || normalized.join("src-tauri/tauri.conf.json").exists()
            || normalized.join("package.json").exists()
        {
            return Ok(normalized);
        }
    }

    Ok(cwd)
}

fn resolve_voice_feedback_extension(app_root: &Path) -> Result<PathBuf, String> {
    if let Some(path) = env::var("VOICESTREAM_PI_VOICE_EXTENSION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        let normalized = path.canonicalize().unwrap_or(path.clone());
        if normalized.exists() {
            return Ok(normalized);
        }

        return Err(format!(
            "voice feedback extension from VOICESTREAM_PI_VOICE_EXTENSION not found at {}",
            path.display()
        ));
    }

    let extension = app_root.join("pi-extensions/voice-feedback.ts");
    if extension.exists() {
        Ok(extension)
    } else {
        Err(format!(
            "voice feedback extension not found at {}",
            extension.display()
        ))
    }
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

    let extension = app_root.join(".pi/extensions/voicestream-notify/index.ts");
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

fn resolve_dictation_emit_extension(app_root: &Path) -> Result<PathBuf, String> {
    if let Some(path) = env::var("VOICESTREAM_PI_DICTATION_TOOLUSE_EXTENSION")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
    {
        let normalized = path.canonicalize().unwrap_or(path.clone());
        if normalized.exists() {
            return Ok(normalized);
        }

        return Err(format!(
            "dictation tooluse extension from VOICESTREAM_PI_DICTATION_TOOLUSE_EXTENSION not found at {}",
            path.display()
        ));
    }

    let extension = app_root.join("pi-extensions/dictation-emit.ts");
    if extension.exists() {
        Ok(extension)
    } else {
        Err(format!(
            "dictation emit extension not found at {}",
            extension.display()
        ))
    }
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
    let mut saw_toolcall_start = false;
    let mut saw_tool_execution_start = false;
    let mut tooluse_optimized: Option<String> = None;

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

                        match event_type {
                            Some("toolcall_start") if !saw_toolcall_start => {
                                saw_toolcall_start = true;
                                if let Some(trace) = trace.as_deref_mut() {
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
                                    trace.mark(
                                        "first_toolcall_start",
                                        &format!("tool={}", tool_name),
                                    );
                                }
                            }
                            Some("text_delta") => {
                                if !saw_first_text_delta {
                                    saw_first_text_delta = true;
                                    if let Some(trace) = trace.as_deref_mut() {
                                        trace.mark(
                                            "first_text_delta",
                                            "assistant started streaming text",
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
                            Some("toolcall_end") => {
                                if let Some(value) =
                                    extract_optimized_from_toolcall_event(&line.value)
                                {
                                    tooluse_optimized = Some(value);
                                }
                            }
                            _ => {}
                        }
                    }
                    Some("tool_execution_start") if !saw_tool_execution_start => {
                        saw_tool_execution_start = true;
                        if let Some(trace) = trace.as_deref_mut() {
                            let tool_name = line
                                .value
                                .get("toolName")
                                .and_then(Value::as_str)
                                .unwrap_or("unknown");
                            trace
                                .mark("first_tool_execution_start", &format!("tool={}", tool_name));
                        }
                    }
                    Some("tool_execution_end") => {
                        if let Some(trace) = trace.as_deref_mut() {
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
                                "tool_execution_end",
                                &format!("tool={}, is_error={}", tool_name, is_error),
                            );
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

                        if streamed_text.trim().is_empty() {
                            if let Some(text) = tooluse_optimized.clone() {
                                streamed_text = text;
                            }
                        }

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
    reset_session_before_prompt: bool,
) -> Result<String, String> {
    if reset_session_before_prompt {
        write_command(
            stdin,
            &json!({
                "id": "new-session-1",
                "type": "new_session",
            }),
        )?;
        trace.mark("write_new_session", "request sent");
        wait_for_response(rx, child, stderr_buffer, "new-session-1", DEFAULT_TIMEOUT)?;
        trace.mark("new_session_ack", "response received");
    }

    write_command(
        stdin,
        &json!({
            "id": "prompt-1",
            "type": "prompt",
            "message": settings::runtime_pi_settings().prompt_template.replace("{text}", trimmed),
        }),
    )?;
    trace.mark(
        "write_prompt",
        &format!("input_chars={}", trimmed.chars().count()),
    );

    wait_for_response(rx, child, stderr_buffer, "prompt-1", DEFAULT_TIMEOUT)?;
    trace.mark("prompt_ack", "response received");
    let streamed_text =
        wait_for_prompt_completion(rx, child, stderr_buffer, PROMPT_TIMEOUT, Some(trace))?;
    trace.mark(
        "prompt_stream_complete",
        &format!("streamed_chars={}", streamed_text.chars().count()),
    );

    if let Some(text) = sanitize_streamed_result(&streamed_text, trimmed) {
        trace.mark(
            "sanitize_streamed_result_hit",
            &format!("output_chars={}", text.chars().count()),
        );
        return Ok(text);
    }
    eprintln!(
        "[pi-rpc][debug] sanitize_streamed_result_miss raw_streamed={}",
        serde_json::to_string(&streamed_text).unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
    );
    trace.mark(
        "sanitize_streamed_result_miss",
        "falling back to get_last_assistant_text",
    );

    write_command(
        stdin,
        &json!({
            "id": "last-1",
            "type": "get_last_assistant_text",
        }),
    )?;
    trace.mark("write_get_last_assistant_text", "request sent");

    let response = wait_for_response(rx, child, stderr_buffer, "last-1", DEFAULT_TIMEOUT)?;
    trace.mark("get_last_assistant_text_ack", "response received");
    let raw_last_text = response
        .get("data")
        .and_then(|data| data.get("text"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string();
    eprintln!(
        "[pi-rpc][debug] get_last_assistant_text raw={}",
        serde_json::to_string(&raw_last_text).unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
    );

    let text = sanitize_result(&raw_last_text, trimmed);
    trace.mark(
        "sanitize_get_last_assistant_text",
        &format!("output_chars={}", text.chars().count()),
    );
    if !text.is_empty() {
        return Ok(text);
    }

    write_command(
        stdin,
        &json!({
            "id": "messages-1",
            "type": "get_messages",
        }),
    )?;
    trace.mark("write_get_messages", "request sent");

    let messages = wait_for_response(rx, child, stderr_buffer, "messages-1", DEFAULT_TIMEOUT)?;
    trace.mark("get_messages_ack", "response received");

    if let Some(raw_message_text) = extract_last_assistant_text(&messages) {
        eprintln!(
            "[pi-rpc][debug] get_messages last_assistant_text raw={}",
            serde_json::to_string(&raw_message_text)
                .unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
        );
        let text = sanitize_result(&raw_message_text, trimmed);
        if !text.is_empty() {
            trace.mark(
                "extract_last_assistant_text_hit",
                &format!("output_chars={}", text.chars().count()),
            );
            return Ok(text);
        }
    }

    if let Some(error) = extract_last_assistant_error(&messages) {
        trace.mark("extract_last_assistant_error", &error);
        return Err(format!(
            "pi rpc assistant error: {}{}",
            error,
            format_stderr(stderr_buffer)
        ));
    }

    trace.mark("empty_result", "all extraction paths returned empty");
    Err(format!(
        "pi rpc returned empty text{}",
        format_stderr(stderr_buffer)
    ))
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

fn extract_last_assistant_text(response: &Value) -> Option<String> {
    let messages = response.get("data")?.get("messages")?.as_array()?;

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

fn extract_last_assistant_error(response: &Value) -> Option<String> {
    let messages = response.get("data")?.get("messages")?.as_array()?;

    for message in messages.iter().rev() {
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }

        if let Some(error) = extract_assistant_error(message) {
            return Some(error);
        }
    }

    None
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

fn extract_optimized_from_toolcall_event(event: &Value) -> Option<String> {
    let assistant_event = event.get("assistantMessageEvent")?;

    let candidates = [
        assistant_event.pointer("/partial/content/0/arguments"),
        assistant_event.pointer("/partial/content/0/args"),
        assistant_event.pointer("/partial/content/0/input"),
        assistant_event.pointer("/partial/content/0/parameters"),
        assistant_event.pointer("/partial/content/0/params"),
        assistant_event.pointer("/delta"),
    ];

    for candidate in candidates.into_iter().flatten() {
        if let Some(result) = extract_optimized_from_value(candidate) {
            return Some(result);
        }
    }

    None
}

fn extract_optimized_from_value(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }

        if let Ok(parsed) = serde_json::from_str::<Value>(trimmed) {
            return extract_optimized_from_value(&parsed);
        }

        return None;
    }

    if let Some(obj) = value.as_object() {
        if let Some(optimized) = obj.get("optimized").and_then(Value::as_str) {
            let optimized = optimized.trim();
            if !optimized.is_empty() {
                return Some(optimized.to_string());
            }
        }
    }

    None
}

fn sanitize_result(result: &str, original_text: &str) -> String {
    let normalized = normalize_result_text(result);
    if normalized.is_empty() {
        eprintln!("[pi-rpc][sanitize] normalized is empty");
        return String::new();
    }

    if let Some(json_optimized) = extract_json_optimized(&normalized) {
        eprintln!(
            "[pi-rpc][sanitize] extracted_json_result={}",
            serde_json::to_string(&json_optimized)
                .unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
        );
        let validated = validate_candidate(&json_optimized, original_text).unwrap_or_default();
        eprintln!(
            "[pi-rpc][sanitize] validated_json_result={}",
            serde_json::to_string(&validated).unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
        );
        return validated;
    }

    let prompt_echo = looks_like_prompt_echo(&normalized, original_text);
    if prompt_echo {
        eprintln!(
            "[pi-rpc][sanitize] looks_like_prompt_echo normalized={}",
            serde_json::to_string(&normalized)
                .unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
        );
        if let Some(recovered) = recover_from_echo(&normalized, original_text) {
            eprintln!(
                "[pi-rpc][sanitize] recovered_from_echo={}",
                serde_json::to_string(&recovered)
                    .unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
            );
            return recovered;
        }
        return String::new();
    }

    if let Some(extracted) = extract_tagged_result(&normalized) {
        eprintln!(
            "[pi-rpc][sanitize] extracted_tagged_result={}",
            serde_json::to_string(&extracted).unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
        );
        let validated = validate_candidate(&extracted, original_text).unwrap_or_default();
        eprintln!(
            "[pi-rpc][sanitize] validated_tagged_result={}",
            serde_json::to_string(&validated).unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
        );
        return validated;
    }

    eprintln!(
        "[pi-rpc][sanitize] normalized_without_tags={}",
        serde_json::to_string(&normalized).unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
    );
    let validated = validate_candidate(&normalized, original_text).unwrap_or_default();
    eprintln!(
        "[pi-rpc][sanitize] validated_plain_result={}",
        serde_json::to_string(&validated).unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
    );
    validated
}

fn sanitize_streamed_result(result: &str, original_text: &str) -> Option<String> {
    let sanitized = sanitize_result(result, original_text);
    if sanitized.is_empty() {
        None
    } else {
        Some(sanitized)
    }
}

fn extract_tagged_result(text: &str) -> Option<String> {
    let start = text.rfind("<optimized>")?;
    let end = text.rfind("</optimized>")?;
    if end <= start {
        return None;
    }

    let content = &text[start + "<optimized>".len()..end];
    let trimmed = content.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn extract_json_optimized(text: &str) -> Option<String> {
    let trimmed = text.trim();

    // Accept plain JSON object response.
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return value
            .get("optimized")
            .and_then(Value::as_str)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());
    }

    // Accept fenced JSON blocks.
    if trimmed.starts_with("```") && trimmed.ends_with("```") {
        let unwrapped = trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```JSON")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        if let Ok(value) = serde_json::from_str::<Value>(unwrapped) {
            return value
                .get("optimized")
                .and_then(Value::as_str)
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
        }
    }

    None
}

fn normalize_result_text(result: &str) -> String {
    let mut cleaned = result
        .trim()
        .replace("<think>", "")
        .replace("</think>", "")
        .trim()
        .to_string();

    if cleaned.starts_with("```") && cleaned.ends_with("```") {
        cleaned = cleaned
            .trim_start_matches("```xml")
            .trim_start_matches("```text")
            .trim_start_matches("```markdown")
            .trim_start_matches("```md")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim()
            .to_string();
    }

    cleaned
}

fn validate_candidate(candidate: &str, original_text: &str) -> Option<String> {
    let trimmed = candidate.trim();
    if trimmed.is_empty() {
        return None;
    }

    if looks_like_prompt_echo(trimmed, original_text) {
        return recover_from_echo(trimmed, original_text);
    }

    Some(trimmed.to_string())
}

fn looks_like_prompt_echo(text: &str, _original_text: &str) -> bool {
    let trimmed = text.trim();
    trimmed.contains("你是Prompt 优化工具。")
        || trimmed.contains("核心规则：")
        || trimmed.contains("输出规则：")
        || trimmed.contains("请只处理下面 <raw> 标签中的内容：")
        || trimmed.contains("<raw>")
        || trimmed.contains("</raw>")
        || trimmed.contains("以下是原始内容，请优化为高质量Prompt：")
}

fn recover_from_echo(text: &str, original_text: &str) -> Option<String> {
    let trimmed = text.trim();

    if let Some(raw_end) = trimmed.rfind("</raw>") {
        let candidate = trimmed[raw_end + "</raw>".len()..].trim();
        if let Some(valid) = validate_candidate_without_recovery(candidate, original_text) {
            return Some(valid);
        }
    }

    if let Some(marker) = trimmed.rfind("以下是原始内容，请优化为高质量Prompt：") {
        let candidate = trimmed[marker + "以下是原始内容，请优化为高质量Prompt：".len()..].trim();
        if let Some(valid) = validate_candidate_without_recovery(candidate, original_text) {
            return Some(valid);
        }
    }

    None
}

fn validate_candidate_without_recovery(candidate: &str, _original_text: &str) -> Option<String> {
    let trimmed = candidate
        .trim()
        .trim_start_matches("<optimized>")
        .trim_end_matches("</optimized>")
        .trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.contains("你是Prompt 优化工具。")
        || trimmed.contains("核心规则：")
        || trimmed.contains("输出规则：")
        || trimmed.contains("<optimized>")
        || trimmed.contains("</optimized>")
        || trimmed.contains("<raw>")
        || trimmed.contains("</raw>")
        || trimmed.contains("以下是原始内容，请优化为高质量Prompt：")
    {
        return None;
    }

    Some(trimmed.to_string())
}

#[cfg(test)]
mod tests {
    use super::{refine_text, sanitize_result, warmup};
    use std::time::Instant;

    #[test]
    fn extracts_last_tagged_payload() {
        let result = "ignored <optimized>first</optimized>\n<optimized>final prompt</optimized>";
        assert_eq!(sanitize_result(result, "raw"), "final prompt");
    }

    #[test]
    fn rejects_prompt_echo_inside_tag() {
        let result = "<optimized>你是Prompt 优化工具。\n输出规则：\n<raw>\nraw\n</raw></optimized>";
        assert!(sanitize_result(result, "raw").is_empty());
    }

    #[test]
    fn accepts_plain_original_text_when_it_is_valid() {
        assert_eq!(sanitize_result("raw", "raw"), "raw");
    }

    #[test]
    fn accepts_clean_tagged_output() {
        let result = "<optimized>请将以下需求实现为一个简洁的 macOS 菜单栏应用，并保证默认支持中文输入。</optimized>";
        assert_eq!(
            sanitize_result(result, "做一个 mac 菜单栏语音输入"),
            "请将以下需求实现为一个简洁的 macOS 菜单栏应用，并保证默认支持中文输入。"
        );
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
