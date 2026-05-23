use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const TASKS_FILE_NAME: &str = "agent-tasks.json";
const SESSIONS_DIR_NAME: &str = "agent-sessions";

static STORE: OnceLock<Mutex<AgentTaskStore>> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AgentTaskStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Interrupted,
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentTaskEvent {
    pub timestamp_ms: u128,
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentTask {
    pub id: String,
    pub title: String,
    pub transcript: String,
    pub status: AgentTaskStatus,
    pub created_at_ms: u128,
    pub updated_at_ms: u128,
    pub session_path: String,
    pub events: Vec<AgentTaskEvent>,
    pub final_text: String,
    pub error_text: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct AgentTaskUpdatedEvent {
    pub task: AgentTask,
}

#[derive(Debug, Serialize, Clone)]
pub struct AgentSessionView {
    pub task_id: String,
    pub session_path: String,
    pub resume_command: String,
    pub entries: Vec<AgentSessionEntry>,
    pub parse_errors: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct AgentSessionEntry {
    pub line: usize,
    pub timestamp: String,
    pub entry_type: String,
    pub role: String,
    pub title: String,
    pub text: String,
    pub tool_name: String,
    pub is_error: bool,
    pub raw: String,
}

struct AgentTaskStore {
    tasks_path: PathBuf,
    sessions_dir: PathBuf,
    tasks: Vec<AgentTask>,
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {}", e))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("failed to create app data dir: {}", e))?;

    let tasks_path = app_data_dir.join(TASKS_FILE_NAME);
    let sessions_dir = app_data_dir.join(SESSIONS_DIR_NAME);
    fs::create_dir_all(&sessions_dir)
        .map_err(|e| format!("failed to create agent sessions dir: {}", e))?;

    let mut tasks = read_tasks_from_path(&tasks_path)?;
    let mut changed = false;
    for task in &mut tasks {
        if matches!(
            task.status,
            AgentTaskStatus::Pending | AgentTaskStatus::Running
        ) {
            task.status = AgentTaskStatus::Interrupted;
            task.updated_at_ms = now_ms();
            task.events.push(AgentTaskEvent {
                timestamp_ms: now_ms(),
                kind: "interrupted".to_string(),
                message: "应用重启后将未完成任务标记为已中断。".to_string(),
            });
            changed = true;
        }
    }

    if changed {
        write_tasks_to_path(&tasks_path, &tasks)?;
    }

    let store = AgentTaskStore {
        tasks_path,
        sessions_dir,
        tasks,
    };

    if STORE.set(Mutex::new(store)).is_err() {
        return Ok(());
    }

    Ok(())
}

pub fn list_tasks() -> Result<Vec<AgentTask>, String> {
    let store = lock_store()?;
    let mut tasks = store.tasks.clone();
    tasks.sort_by(|left, right| right.created_at_ms.cmp(&left.created_at_ms));
    Ok(tasks)
}

pub fn create_task(app: &AppHandle, transcript: &str) -> Result<AgentTask, String> {
    let transcript = transcript.trim();
    if transcript.is_empty() {
        return Err("Agent task transcript is empty".to_string());
    }

    let mut store = lock_store()?;
    let created_at_ms = now_ms();
    let id = format!("agent-{}", created_at_ms);
    let title = derive_title(transcript);
    let session_path = store.sessions_dir.join(format!("{}.jsonl", id));
    if let Some(parent) = session_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create task session dir: {}", e))?;
    }

    let task = AgentTask {
        id: id.clone(),
        title,
        transcript: transcript.to_string(),
        status: AgentTaskStatus::Pending,
        created_at_ms,
        updated_at_ms: created_at_ms,
        session_path: session_path.display().to_string(),
        events: vec![AgentTaskEvent {
            timestamp_ms: created_at_ms,
            kind: "created".to_string(),
            message: "已创建 Agent 后台任务。".to_string(),
        }],
        final_text: String::new(),
        error_text: String::new(),
    };

    store.tasks.push(task.clone());
    store.persist()?;
    drop(store);
    emit_task(app, &task);
    Ok(task)
}

pub fn mark_running(app: &AppHandle, task_id: &str) -> Result<AgentTask, String> {
    update_task(app, task_id, |task| {
        task.status = AgentTaskStatus::Running;
        task.error_text.clear();
        task.events.push(AgentTaskEvent {
            timestamp_ms: now_ms(),
            kind: "running".to_string(),
            message: "Agent 已开始执行任务。".to_string(),
        });
    })
}

pub fn append_event(
    app: &AppHandle,
    task_id: &str,
    kind: &str,
    message: &str,
) -> Result<AgentTask, String> {
    let kind = kind.trim();
    let message = message.trim();
    if kind.is_empty() || message.is_empty() {
        return get_task(task_id);
    }

    update_task(app, task_id, |task| {
        task.events.push(AgentTaskEvent {
            timestamp_ms: now_ms(),
            kind: kind.to_string(),
            message: message.to_string(),
        });
    })
}

pub fn mark_continuing(app: &AppHandle, task_id: &str, message: &str) -> Result<AgentTask, String> {
    let summary = derive_title(message);
    update_task(app, task_id, |task| {
        task.status = AgentTaskStatus::Running;
        task.error_text.clear();
        task.events.push(AgentTaskEvent {
            timestamp_ms: now_ms(),
            kind: "continue".to_string(),
            message: format!("继续会话：{}", summary),
        });
    })
}

pub fn mark_completed(
    app: &AppHandle,
    task_id: &str,
    final_text: &str,
) -> Result<AgentTask, String> {
    update_task(app, task_id, |task| {
        task.status = AgentTaskStatus::Completed;
        task.final_text = final_text.trim().to_string();
        task.error_text.clear();
        task.events.push(AgentTaskEvent {
            timestamp_ms: now_ms(),
            kind: "completed".to_string(),
            message: "Agent 任务已完成。".to_string(),
        });
    })
}

pub fn mark_failed(app: &AppHandle, task_id: &str, error: &str) -> Result<AgentTask, String> {
    update_task(app, task_id, |task| {
        task.status = AgentTaskStatus::Failed;
        task.error_text = error.trim().to_string();
        task.events.push(AgentTaskEvent {
            timestamp_ms: now_ms(),
            kind: "failed".to_string(),
            message: error.trim().to_string(),
        });
    })
}

pub fn get_task(task_id: &str) -> Result<AgentTask, String> {
    let store = lock_store()?;
    store
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .cloned()
        .ok_or_else(|| format!("agent task not found: {}", task_id))
}

pub fn get_session_view(task_id: &str) -> Result<AgentSessionView, String> {
    let task = get_task(task_id)?;
    let session_path = PathBuf::from(&task.session_path);
    let resume_command = format!("pi --session {}", shell_quote(&task.session_path));

    if !session_path.exists() {
        return Ok(AgentSessionView {
            task_id: task.id,
            session_path: task.session_path,
            resume_command,
            entries: Vec::new(),
            parse_errors: Vec::new(),
        });
    }

    let content = fs::read_to_string(&session_path).map_err(|e| {
        format!(
            "failed to read agent session {}: {}",
            session_path.display(),
            e
        )
    })?;

    let mut entries = Vec::new();
    let mut parse_errors = Vec::new();
    for (index, line) in content.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        match serde_json::from_str::<Value>(trimmed) {
            Ok(value) => entries.push(render_session_entry(index + 1, &value, trimmed)),
            Err(error) => parse_errors.push(format!("line {}: {}", index + 1, error)),
        }
    }

    Ok(AgentSessionView {
        task_id: task.id,
        session_path: task.session_path,
        resume_command,
        entries,
        parse_errors,
    })
}

fn update_task(
    app: &AppHandle,
    task_id: &str,
    update: impl FnOnce(&mut AgentTask),
) -> Result<AgentTask, String> {
    let mut store = lock_store()?;
    let Some(index) = store.tasks.iter().position(|task| task.id == task_id) else {
        return Err(format!("agent task not found: {}", task_id));
    };

    update(&mut store.tasks[index]);
    store.tasks[index].updated_at_ms = now_ms();
    let task = store.tasks[index].clone();
    store.persist()?;
    drop(store);
    emit_task(app, &task);
    Ok(task)
}

impl AgentTaskStore {
    fn persist(&self) -> Result<(), String> {
        write_tasks_to_path(&self.tasks_path, &self.tasks)
    }
}

fn lock_store() -> Result<std::sync::MutexGuard<'static, AgentTaskStore>, String> {
    STORE
        .get()
        .ok_or_else(|| "agent task store is not initialized".to_string())?
        .lock()
        .map_err(|_| "agent task store lock poisoned".to_string())
}

fn read_tasks_from_path(path: &PathBuf) -> Result<Vec<AgentTask>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }

    let content =
        fs::read_to_string(path).map_err(|e| format!("failed to read agent tasks: {}", e))?;
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }

    serde_json::from_str::<Vec<AgentTask>>(&content)
        .map_err(|e| format!("invalid agent tasks file: {}", e))
}

fn write_tasks_to_path(path: &PathBuf, tasks: &[AgentTask]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(tasks)
        .map_err(|e| format!("failed to encode agent tasks: {}", e))?;
    fs::write(path, content).map_err(|e| format!("failed to write agent tasks: {}", e))?;
    secure_file(path)
}

fn secure_file(path: &PathBuf) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("failed to secure agent tasks file: {}", e))?;
    }
    Ok(())
}

fn emit_task(app: &AppHandle, task: &AgentTask) {
    let _ = app.emit(
        "agent-task-updated",
        AgentTaskUpdatedEvent { task: task.clone() },
    );
}

fn render_session_entry(line: usize, value: &Value, raw: &str) -> AgentSessionEntry {
    let entry_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();
    let timestamp = value
        .get("timestamp")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .or_else(|| {
            value
                .pointer("/message/timestamp")
                .and_then(Value::as_i64)
                .map(|timestamp| timestamp.to_string())
        })
        .unwrap_or_default();

    let mut entry = AgentSessionEntry {
        line,
        timestamp,
        entry_type: entry_type.clone(),
        role: "system".to_string(),
        title: entry_type.clone(),
        text: String::new(),
        tool_name: String::new(),
        is_error: false,
        raw: raw.to_string(),
    };

    match entry_type.as_str() {
        "session" => {
            entry.title = "Session".to_string();
            entry.text = format!(
                "{}\n{}",
                value.get("id").and_then(Value::as_str).unwrap_or("unknown"),
                value.get("cwd").and_then(Value::as_str).unwrap_or("")
            )
            .trim()
            .to_string();
        }
        "session_info" => {
            entry.title = "会话信息".to_string();
            entry.text = value
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
        }
        "model_change" => {
            entry.title = "模型".to_string();
            let provider = value.get("provider").and_then(Value::as_str).unwrap_or("");
            let model = value.get("modelId").and_then(Value::as_str).unwrap_or("");
            entry.text = [provider, model]
                .iter()
                .filter(|part| !part.is_empty())
                .copied()
                .collect::<Vec<_>>()
                .join(" / ");
        }
        "thinking_level_change" => {
            entry.title = "思考等级".to_string();
            entry.text = value
                .get("thinkingLevel")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
        }
        "custom" => {
            let custom_type = value
                .get("customType")
                .and_then(Value::as_str)
                .unwrap_or("custom");
            entry.title = format!("扩展：{}", custom_type);
            entry.text = pretty_json(value.get("data").unwrap_or(&Value::Null));
        }
        "message" => render_message_entry(&mut entry, value),
        _ => {
            entry.text = pretty_json(value);
        }
    }

    if entry.text.trim().is_empty() {
        entry.text = "uncertain".to_string();
    }
    entry
}

fn render_message_entry(entry: &mut AgentSessionEntry, value: &Value) {
    let Some(message) = value.get("message") else {
        entry.text = pretty_json(value);
        return;
    };

    let role = message
        .get("role")
        .and_then(Value::as_str)
        .unwrap_or("message");
    entry.role = role.to_string();
    entry.title = match role {
        "user" => "用户".to_string(),
        "assistant" => "Agent".to_string(),
        "toolResult" => "工具结果".to_string(),
        other => other.to_string(),
    };

    if let Some(tool_name) = message.get("toolName").and_then(Value::as_str) {
        entry.tool_name = tool_name.to_string();
        entry.title = format!("工具结果：{}", tool_name);
    }
    entry.is_error = message
        .get("isError")
        .and_then(Value::as_bool)
        .unwrap_or(false);

    let content = message
        .get("content")
        .and_then(Value::as_array)
        .map(|items| render_content_items(items, &mut entry.tool_name))
        .unwrap_or_default();
    entry.text = if content.trim().is_empty() {
        pretty_json(message)
    } else {
        content
    };
}

fn render_content_items(items: &[Value], tool_name: &mut String) -> String {
    let mut parts = Vec::new();

    for item in items {
        match item.get("type").and_then(Value::as_str) {
            Some("text") => {
                if let Some(text) = item.get("text").and_then(Value::as_str) {
                    parts.push(text.to_string());
                }
            }
            Some("thinking") => {
                // Keep chain-of-thought out of the rendered UI. The session keeps the
                // raw event for debugging, but the product surface should stay concise.
            }
            Some("toolCall") => {
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                *tool_name = name.to_string();
                let args = item
                    .get("arguments")
                    .or_else(|| item.get("args"))
                    .or_else(|| item.get("input"))
                    .unwrap_or(&Value::Null);
                parts.push(format!("调用工具：{}\n{}", name, pretty_json(args)));
            }
            Some(other) => parts.push(format!("{}：\n{}", other, pretty_json(item))),
            None => parts.push(pretty_json(item)),
        }
    }

    parts
        .into_iter()
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn pretty_json(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| "uncertain".to_string())
}

fn shell_quote(value: &str) -> String {
    if value
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '/' | '.' | '_' | '-'))
    {
        value.to_string()
    } else {
        format!("'{}'", value.replace('\'', "'\"'\"'"))
    }
}

fn derive_title(transcript: &str) -> String {
    let compact = transcript.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut title: String = compact.chars().take(28).collect();
    if compact.chars().count() > 28 {
        title.push('…');
    }
    if title.trim().is_empty() {
        "未命名 Agent 任务".to_string()
    } else {
        title
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::derive_title;

    #[test]
    fn derives_short_title_from_transcript() {
        assert_eq!(
            derive_title("检查这个项目为什么 optimize 很慢"),
            "检查这个项目为什么 optimize 很慢"
        );
    }

    #[test]
    fn truncates_long_title() {
        let title =
            derive_title("请帮我检查这个项目里面所有和语音输入 Agent 模式相关的问题并给出结果");
        assert!(title.ends_with('…'));
        assert!(title.chars().count() <= 29);
    }
}
