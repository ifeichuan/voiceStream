use crate::db;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

const STORE_FILE_NAME: &str = "app-settings.json";
const LEGACY_STORE_FILE_NAME: &str = "credentials.json";
const DEFAULT_STT_PROVIDER: &str = "aliyun-bailian";
const DEFAULT_STT_MODEL: &str = "fun-asr-realtime";
const DEFAULT_STT_API_ENDPOINT: &str = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
const DEFAULT_PI_MODE: &str = "dictation-fast";
const DEFAULT_PROMPT_TEMPLATE_KEY: &str = "default";
pub const DEFAULT_AGENT_SHORTCUT: &str = "Cmd+Shift+A";

static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SttSettingsInput {
    pub provider: String,
    pub api_key: String,
    pub api_endpoint: String,
    pub model: String,
    pub workspace_id: String,
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub extra_config: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SttSettingsView {
    pub provider: String,
    pub api_endpoint: String,
    pub model: String,
    pub workspace_id: String,
    pub language: String,
    pub sample_rate: u32,
    pub extra_config: String,
    pub has_api_key: bool,
    pub api_key_hint: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PiSettingsInput {
    pub mode: String,
    pub provider: String,
    pub model: String,
    pub reuse_process: bool,
    pub prompt_template_key: String,
    pub provider_json: String,
    pub thinking: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettingsInput {
    pub stt: SttSettingsInput,
    pub pi: PiSettingsInput,
    pub shortcuts: ShortcutSettingsInput,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShortcutSettingsInput {
    pub agent_shortcut: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PiSettingsView {
    pub mode: String,
    pub provider: String,
    pub model: String,
    pub reuse_process: bool,
    pub prompt_template_key: String,
    pub provider_json: String,
    pub thinking: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppSettingsView {
    pub stt: SttSettingsView,
    pub pi: PiSettingsView,
    pub shortcuts: ShortcutSettingsView,
    pub local_pi: LocalPiConfigView,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ShortcutSettingsView {
    pub dictation_shortcut: String,
    pub agent_shortcut: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct LocalPiConfigView {
    pub settings_path: String,
    pub models_path: String,
    pub default_provider: String,
    pub default_model: String,
    pub providers: Vec<LocalPiProviderView>,
    pub raw_settings_json: String,
    pub raw_models_json: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalPiProviderView {
    pub id: String,
    pub base_url: String,
    pub api: String,
    pub has_api_key: bool,
    pub models: Vec<LocalPiModelView>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LocalPiModelView {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RuntimePiSettings {
    pub mode: String,
    pub provider: String,
    pub model: String,
    pub reuse_process: bool,
    pub prompt_template_key: String,
    pub system_prompt: String,
    pub provider_json: String,
    pub thinking: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StoredSttSettings {
    #[serde(default = "default_stt_provider_id")]
    provider: String,
    api_key: String,
    api_endpoint: String,
    model: String,
    workspace_id: String,
    #[serde(default)]
    language: String,
    #[serde(default = "default_stt_sample_rate")]
    sample_rate: u32,
    #[serde(default)]
    extra_config: String,
}

fn default_stt_provider_id() -> String {
    DEFAULT_STT_PROVIDER.to_string()
}

fn default_stt_sample_rate() -> u32 {
    16_000
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StoredPiSettings {
    mode: String,
    provider: String,
    model: String,
    reuse_process: bool,
    prompt_template_key: String,
    provider_json: String,
    #[serde(default)]
    thinking: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StoredShortcutSettings {
    agent_shortcut: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct StoredAppSettings {
    version: u32,
    stt: StoredSttSettings,
    pi: StoredPiSettings,
    #[serde(default = "default_shortcuts_settings")]
    shortcuts: StoredShortcutSettings,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct LegacyCredentialFile {
    #[serde(default)]
    vs_stt_bailian: Option<StoredSttSettings>,
}

pub fn set_app_data_dir(dir: PathBuf) {
    let normalized = dir.canonicalize().unwrap_or(dir);
    let _ = APP_DATA_DIR.set(normalized);
}

pub fn load_app_settings_view(app: &AppHandle) -> Result<AppSettingsView, String> {
    let stored = read_or_migrate_settings(app)?;
    Ok(AppSettingsView {
        stt: stt_view_from_stored(&stored.stt),
        pi: pi_view_from_stored(&stored.pi),
        shortcuts: shortcuts_view_from_stored(&stored.shortcuts),
        local_pi: read_local_pi_config(),
    })
}

pub fn save_app_settings(
    app: &AppHandle,
    input: AppSettingsInput,
) -> Result<AppSettingsView, String> {
    let existing = read_or_migrate_settings(app)?;
    let next = StoredAppSettings {
        version: 1,
        stt: merge_stt_settings(Some(existing.stt), input.stt),
        pi: merge_pi_settings(Some(existing.pi), input.pi),
        shortcuts: merge_shortcut_settings(Some(existing.shortcuts), input.shortcuts),
    };
    write_app_settings(app, &next)?;
    load_app_settings_view(app)
}

pub fn load_stt_settings_view(app: &AppHandle) -> Result<SttSettingsView, String> {
    Ok(stt_view_from_stored(&read_or_migrate_settings(app)?.stt))
}

pub fn save_stt_settings(
    app: &AppHandle,
    input: SttSettingsInput,
) -> Result<SttSettingsView, String> {
    let existing = read_or_migrate_settings(app)?;
    let next = StoredAppSettings {
        version: 1,
        stt: merge_stt_settings(Some(existing.stt), input),
        pi: existing.pi,
        shortcuts: existing.shortcuts,
    };
    write_app_settings(app, &next)?;
    Ok(stt_view_from_stored(&next.stt))
}

pub fn runtime_stt_settings(app: &AppHandle) -> Result<SttSettingsInput, String> {
    let stt = read_or_migrate_settings(app)?.stt;
    Ok(SttSettingsInput {
        provider: stt.provider,
        api_key: stt.api_key,
        api_endpoint: stt.api_endpoint,
        model: stt.model,
        workspace_id: stt.workspace_id,
        language: stt.language,
        sample_rate: Some(stt.sample_rate),
        extra_config: stt.extra_config,
    })
}

pub fn runtime_pi_settings() -> RuntimePiSettings {
    let stored = read_runtime_settings_file().unwrap_or_else(|_| default_app_settings());
    let (local_default_provider, local_default_model) = read_local_pi_defaults();

    let env_provider = env::var("VOICESTREAM_PI_PROVIDER")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let env_model = env::var("VOICESTREAM_PI_MODEL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let env_mode = env::var("VOICESTREAM_PI_MODE")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let env_reuse = env::var("VOICESTREAM_PI_REUSE_PROCESS").ok().map(|value| {
        !matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "0" | "false" | "no"
        )
    });

    let provider = env_provider
        .or_else(|| sanitize(&stored.pi.provider))
        .or_else(|| sanitize(&local_default_provider))
        .unwrap_or_default();
    let model = env_model
        .or_else(|| sanitize(&stored.pi.model))
        .or_else(|| sanitize(&local_default_model))
        .unwrap_or_default();
    let mode = env_mode
        .or_else(|| sanitize(&stored.pi.mode))
        .unwrap_or_else(|| DEFAULT_PI_MODE.to_string());
    let reuse_process = env_reuse.unwrap_or(stored.pi.reuse_process);
    let env_thinking = env::var("VOICESTREAM_PI_THINKING")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let thinking = env_thinking
        .or_else(|| {
            let t = stored.pi.thinking.trim().to_string();
            if t.is_empty() { None } else { Some(t) }
        })
        .unwrap_or_default();

    RuntimePiSettings {
        mode,
        provider,
        model,
        reuse_process,
        prompt_template_key: stored.pi.prompt_template_key.clone(),
        system_prompt: db::resolve_prompt_template_content(&stored.pi.prompt_template_key),
        provider_json: stored.pi.provider_json,
        thinking,
    }
}

pub fn runtime_shortcut_settings(app: &AppHandle) -> Result<ShortcutSettingsView, String> {
    let stored = read_or_migrate_settings(app)?;
    Ok(shortcuts_view_from_stored(&stored.shortcuts))
}

pub fn stt_test_merged(
    app: &AppHandle,
    input: SttSettingsInput,
) -> Result<SttSettingsInput, String> {
    let existing = read_or_migrate_settings(app)?;
    let merged = merge_stt_settings(Some(existing.stt), input);
    Ok(SttSettingsInput {
        provider: merged.provider,
        api_key: merged.api_key,
        api_endpoint: merged.api_endpoint,
        model: merged.model,
        workspace_id: merged.workspace_id,
        language: merged.language,
        sample_rate: Some(merged.sample_rate),
        extra_config: merged.extra_config,
    })
}

fn stt_view_from_stored(stored: &StoredSttSettings) -> SttSettingsView {
    SttSettingsView {
        provider: stored.provider.clone(),
        api_endpoint: stored.api_endpoint.clone(),
        model: stored.model.clone(),
        workspace_id: stored.workspace_id.clone(),
        language: stored.language.clone(),
        sample_rate: stored.sample_rate,
        extra_config: stored.extra_config.clone(),
        has_api_key: !stored.api_key.is_empty(),
        api_key_hint: mask_api_key(&stored.api_key),
    }
}

fn pi_view_from_stored(stored: &StoredPiSettings) -> PiSettingsView {
    PiSettingsView {
        mode: stored.mode.clone(),
        provider: stored.provider.clone(),
        model: stored.model.clone(),
        reuse_process: stored.reuse_process,
        prompt_template_key: stored.prompt_template_key.clone(),
        provider_json: stored.provider_json.clone(),
        thinking: stored.thinking.clone(),
    }
}

fn shortcuts_view_from_stored(stored: &StoredShortcutSettings) -> ShortcutSettingsView {
    ShortcutSettingsView {
        dictation_shortcut: crate::DICTATION_SHORTCUT.to_string(),
        agent_shortcut: stored.agent_shortcut.clone(),
    }
}

fn merge_stt_settings(
    existing: Option<StoredSttSettings>,
    input: SttSettingsInput,
) -> StoredSttSettings {
    let existing = existing.unwrap_or_else(default_stt_settings);
    let api_key = sanitize(&input.api_key).unwrap_or(existing.api_key);

    StoredSttSettings {
        provider: sanitize(&input.provider).unwrap_or(existing.provider),
        api_key,
        api_endpoint: sanitize(&input.api_endpoint)
            .unwrap_or(existing.api_endpoint)
            .trim_end_matches('/')
            .to_string(),
        model: sanitize(&input.model).unwrap_or(existing.model),
        workspace_id: sanitize(&input.workspace_id).unwrap_or_default(),
        language: input.language.trim().to_string(),
        sample_rate: input.sample_rate.unwrap_or(existing.sample_rate),
        extra_config: input.extra_config.trim().to_string(),
    }
}

fn merge_pi_settings(
    existing: Option<StoredPiSettings>,
    input: PiSettingsInput,
) -> StoredPiSettings {
    let existing = existing.unwrap_or_else(default_pi_settings);
    StoredPiSettings {
        mode: sanitize(&input.mode).unwrap_or(existing.mode),
        // Allow explicitly clearing provider/model so runtime can fall back to native ~/.pi defaults.
        provider: input.provider.trim().to_string(),
        model: input.model.trim().to_string(),
        reuse_process: input.reuse_process,
        prompt_template_key: sanitize(&input.prompt_template_key)
            .unwrap_or_else(|| DEFAULT_PROMPT_TEMPLATE_KEY.to_string()),
        provider_json: input.provider_json.trim().to_string(),
        thinking: input.thinking.trim().to_string(),
    }
}

fn merge_shortcut_settings(
    existing: Option<StoredShortcutSettings>,
    input: ShortcutSettingsInput,
) -> StoredShortcutSettings {
    let existing = existing.unwrap_or_else(default_shortcuts_settings);
    StoredShortcutSettings {
        agent_shortcut: sanitize(&input.agent_shortcut).unwrap_or(existing.agent_shortcut),
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {}", e))?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create app data dir: {}", e))?;
    Ok(dir.join(STORE_FILE_NAME))
}

fn legacy_settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir unavailable: {}", e))?;
    Ok(dir.join(LEGACY_STORE_FILE_NAME))
}

fn read_or_migrate_settings(app: &AppHandle) -> Result<StoredAppSettings, String> {
    if let Some(settings) = read_app_settings(app)? {
        return Ok(settings);
    }

    if let Some(legacy) = read_legacy_settings(app)? {
        let migrated = StoredAppSettings {
            version: 1,
            stt: legacy,
            pi: default_pi_settings(),
            shortcuts: default_shortcuts_settings(),
        };
        write_app_settings(app, &migrated)?;
        return Ok(migrated);
    }

    Ok(default_app_settings())
}

fn read_app_settings(app: &AppHandle) -> Result<Option<StoredAppSettings>, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("failed to read app settings: {}", e))?;
    let parsed = serde_json::from_str::<StoredAppSettings>(&content)
        .map_err(|e| format!("invalid app settings: {}", e))?;
    Ok(Some(parsed))
}

fn read_runtime_settings_file() -> Result<StoredAppSettings, String> {
    let Some(dir) = APP_DATA_DIR.get() else {
        return Err("app data dir unavailable".to_string());
    };
    let path = dir.join(STORE_FILE_NAME);
    if !path.exists() {
        return Err("app settings file missing".to_string());
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("failed to read app settings: {}", e))?;
    serde_json::from_str::<StoredAppSettings>(&content)
        .map_err(|e| format!("invalid app settings: {}", e))
}

fn write_app_settings(app: &AppHandle, settings: &StoredAppSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("failed to encode app settings: {}", e))?;
    fs::write(&path, content).map_err(|e| format!("failed to write app settings: {}", e))?;
    secure_file(&path)
}

fn read_legacy_settings(app: &AppHandle) -> Result<Option<StoredSttSettings>, String> {
    let path = legacy_settings_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read legacy credentials store: {}", e))?;
    let file: LegacyCredentialFile = serde_json::from_str(&content)
        .map_err(|e| format!("invalid legacy credentials store: {}", e))?;
    Ok(file.vs_stt_bailian)
}

fn secure_file(path: &PathBuf) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("failed to secure settings file: {}", e))?;
    }
    Ok(())
}

fn default_app_settings() -> StoredAppSettings {
    StoredAppSettings {
        version: 1,
        stt: default_stt_settings(),
        pi: default_pi_settings(),
        shortcuts: default_shortcuts_settings(),
    }
}

fn default_stt_settings() -> StoredSttSettings {
    StoredSttSettings {
        provider: DEFAULT_STT_PROVIDER.to_string(),
        api_key: String::new(),
        api_endpoint: DEFAULT_STT_API_ENDPOINT.to_string(),
        model: DEFAULT_STT_MODEL.to_string(),
        workspace_id: String::new(),
        language: String::new(),
        sample_rate: 16_000,
        extra_config: String::new(),
    }
}

fn default_pi_settings() -> StoredPiSettings {
    StoredPiSettings {
        mode: DEFAULT_PI_MODE.to_string(),
        provider: String::new(),
        model: String::new(),
        reuse_process: true,
        prompt_template_key: DEFAULT_PROMPT_TEMPLATE_KEY.to_string(),
        provider_json: String::new(),
        thinking: String::new(),
    }
}

fn default_shortcuts_settings() -> StoredShortcutSettings {
    StoredShortcutSettings {
        agent_shortcut: DEFAULT_AGENT_SHORTCUT.to_string(),
    }
}

fn read_local_pi_config() -> LocalPiConfigView {
    let pi_dir = resolve_pi_agent_dir();
    let settings_path = pi_dir.join("settings.json");
    let models_path = pi_dir.join("models.json");

    let raw_settings_json = fs::read_to_string(&settings_path).unwrap_or_default();
    let raw_models_json = fs::read_to_string(&models_path).unwrap_or_default();

    let settings_json = serde_json::from_str::<Value>(&raw_settings_json).unwrap_or(Value::Null);
    let models_json = serde_json::from_str::<Value>(&raw_models_json).unwrap_or(Value::Null);

    let default_provider = settings_json
        .get("defaultProvider")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let default_model = settings_json
        .get("defaultModel")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let mut providers = Vec::new();
    if let Some(provider_map) = models_json.get("providers").and_then(Value::as_object) {
        for (id, provider) in provider_map {
            let mut models = Vec::new();
            if let Some(list) = provider.get("models").and_then(Value::as_array) {
                for model in list {
                    let model_id = model.get("id").and_then(Value::as_str).unwrap_or_default();
                    if model_id.is_empty() {
                        continue;
                    }
                    models.push(LocalPiModelView {
                        id: model_id.to_string(),
                        name: model
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or(model_id)
                            .to_string(),
                    });
                }
            }

            providers.push(LocalPiProviderView {
                id: id.clone(),
                base_url: provider
                    .get("baseUrl")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                api: provider
                    .get("api")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                has_api_key: provider.get("apiKey").is_some(),
                models,
            });
        }
    }

    merge_cli_models_into_providers(&mut providers);

    for provider in &mut providers {
        provider.models.sort_by(|a, b| a.id.cmp(&b.id));
    }
    providers.sort_by(|a, b| a.id.cmp(&b.id));

    LocalPiConfigView {
        settings_path: settings_path.display().to_string(),
        models_path: models_path.display().to_string(),
        default_provider,
        default_model,
        providers,
        raw_settings_json,
        raw_models_json,
    }
}

fn merge_cli_models_into_providers(providers: &mut Vec<LocalPiProviderView>) {
    let entries = match read_models_from_pi_cli() {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for (provider_id, model_id) in entries {
        if provider_id.is_empty() || model_id.is_empty() {
            continue;
        }

        if let Some(provider) = providers.iter_mut().find(|p| p.id == provider_id) {
            if !provider.models.iter().any(|m| m.id == model_id) {
                provider.models.push(LocalPiModelView {
                    id: model_id.clone(),
                    name: model_id,
                });
            }
            continue;
        }

        providers.push(LocalPiProviderView {
            id: provider_id,
            base_url: String::new(),
            api: String::new(),
            has_api_key: false,
            models: vec![LocalPiModelView {
                id: model_id.clone(),
                name: model_id,
            }],
        });
    }
}

fn read_models_from_pi_cli() -> Result<Vec<(String, String)>, String> {
    let pi_path = resolve_pi_path_for_settings();
    let output = Command::new(&pi_path)
        .arg("--list-models")
        .output()
        .map_err(|e| format!("failed to run {} --list-models: {}", pi_path.display(), e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "pi --list-models failed with status {}: {}",
            output.status,
            stderr.trim()
        ));
    }

    // `pi --list-models` prints table to stderr in current versions.
    let source = if !output.stdout.is_empty() {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        String::from_utf8_lossy(&output.stderr).to_string()
    };

    let mut seen = HashSet::<(String, String)>::new();
    let mut result = Vec::<(String, String)>::new();

    for raw_line in source.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with("provider") {
            continue;
        }

        let mut parts = line.split_whitespace();
        let provider = parts.next().unwrap_or_default().trim();
        let model = parts.next().unwrap_or_default().trim();
        if provider.is_empty() || model.is_empty() {
            continue;
        }

        let key = (provider.to_string(), model.to_string());
        if seen.insert(key.clone()) {
            result.push(key);
        }
    }

    Ok(result)
}

fn resolve_pi_agent_dir() -> PathBuf {
    env::var("PI_CODING_AGENT_DIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            let home = env::var("HOME").unwrap_or_default();
            PathBuf::from(home).join(".pi/agent")
        })
}

fn read_local_pi_defaults() -> (String, String) {
    let settings_path = resolve_pi_agent_dir().join("settings.json");
    let raw_settings_json = fs::read_to_string(settings_path).unwrap_or_default();
    let settings_json = serde_json::from_str::<Value>(&raw_settings_json).unwrap_or(Value::Null);

    let default_provider = settings_json
        .get("defaultProvider")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let default_model = settings_json
        .get("defaultModel")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    (default_provider, default_model)
}

fn resolve_pi_path_for_settings() -> PathBuf {
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

fn sanitize(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn mask_api_key(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let chars: Vec<char> = trimmed.chars().collect();
    let visible = chars.len().min(4);
    let suffix: String = chars[chars.len() - visible..].iter().collect();
    format!("••••{}", suffix)
}
