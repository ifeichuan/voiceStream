//! 热词表管理与百炼定制热词 HTTP API 同步。
//!
//! 识别会话开始前调用 `sync_vocabulary`，若配置了热词则确保云端词表存在，
//! 返回 `vocabulary_id` 供 `run-task` 的 `parameters.vocabulary_id` 使用。

use crate::settings::{save_stt_settings, SttSettingsInput};
use serde_json::{json, Value};
use std::sync::OnceLock;
use tauri::AppHandle;

/// 内置常用热词表（网络热词 + 常见中英混合词），权重统一 4。
/// 用户可在设置页编辑或清空；纯中文词 ≤10 字，英文/混合按空格分词 ≤5 词。
pub const DEFAULT_HOT_WORDS_JSON: &str = r#"[
  {"text": "yyds", "weight": 4},
  {"text": "绝绝子", "weight": 4},
  {"text": "破防", "weight": 4},
  {"text": "摆烂", "weight": 4},
  {"text": "内卷", "weight": 4},
  {"text": "躺平", "weight": 4},
  {"text": "emo", "weight": 4},
  {"text": "神马", "weight": 4},
  {"text": "KPI", "weight": 4},
  {"text": "OKR", "weight": 4},
  {"text": "ChatGPT", "weight": 4},
  {"text": "AGI", "weight": 4},
  {"text": "LLM", "weight": 4},
  {"text": "AIGC", "weight": 4},
  {"text": "RAG", "weight": 4},
  {"text": "Prompt", "weight": 4},
  {"text": "Tauri", "weight": 4},
  {"text": "React", "weight": 4},
  {"text": "TypeScript", "weight": 4},
  {"text": "Rust", "weight": 4},
  {"text": "Obsidian", "weight": 4},
  {"text": "WebSocket", "weight": 4},
  {"text": "SQLite", "weight": 4},
  {"text": "GitHub", "weight": 4}
]"#;

/// 内存缓存：热词表内容 → 云端 vocabulary_id，避免每次会话都调 HTTP API。
static VOCAB_CACHE: OnceLock<std::sync::Mutex<Option<(String, String)>>> = OnceLock::new();

fn vocab_cache() -> &'static std::sync::Mutex<Option<(String, String)>> {
    VOCAB_CACHE.get_or_init(|| std::sync::Mutex::new(None))
}

pub fn default_hot_words_json() -> String {
    DEFAULT_HOT_WORDS_JSON.to_string()
}

/// 解析热词 JSON 字符串，返回词条列表。非法 JSON 时返回错误。
pub fn parse_hot_words(raw: &str) -> Result<Vec<Value>, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let parsed: Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("热词表不是合法 JSON：{e}"))?;
    match parsed {
        Value::Array(items) => Ok(items),
        _ => Err("热词表必须是 JSON 数组".to_string()),
    }
}

fn endpoint(workspace_id: &str) -> String {
    if workspace_id.is_empty() {
        "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/customization".to_string()
    } else {
        format!(
            "https://{workspace_id}.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/asr/customization"
        )
    }
}

fn target_model(model: &str) -> String {
    // 热词 API 要求 target_model 与识别模型一致；fun-asr-realtime 系列统一映射为 fun-asr。
    if model.starts_with("fun-asr") {
        "fun-asr".to_string()
    } else {
        model.to_string()
    }
}

/// 同步热词表到百炼，返回 `vocabulary_id`。
///
/// - 无热词 → `Ok(None)`（不启用热词）
/// - 已有缓存/已存 vocabulary_id 且热词未变化 → 复用
/// - 否则创建（无 id）或更新（有 id）云端词表，并写回设置
pub async fn sync_vocabulary(app: &AppHandle, settings: &SttSettingsInput) -> Result<Option<String>, String> {
    if settings.api_key.is_empty() {
        return Ok(None);
    }

    let words = parse_hot_words(&settings.hot_words)?;
    if words.is_empty() {
        return Ok(None);
    }

    let content_hash = format!("{:x}", {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        use std::hash::{Hash, Hasher};
        settings.hot_words.hash(&mut hasher);
        hasher.finish()
    });

    // 内存缓存命中
    if let Ok(guard) = vocab_cache().lock() {
        if let Some((cached_hash, cached_id)) = guard.as_ref() {
            if cached_hash == &content_hash {
                return Ok(Some(cached_id.clone()));
            }
        }
    }

    // 设置里已有 vocabulary_id 且热词未变过（无历史哈希比对，直接复用并更新缓存）
    if !settings.vocabulary_id.is_empty() {
        if let Ok(mut guard) = vocab_cache().lock() {
            *guard = Some((content_hash, settings.vocabulary_id.clone()));
        }
        return Ok(Some(settings.vocabulary_id.clone()));
    }

    // 创建新词表
    let id = create_vocabulary(settings).await?;
    if let Ok(mut guard) = vocab_cache().lock() {
        *guard = Some((content_hash, id.clone()));
    }
    update_stored_vocabulary_id(app, settings, &id)?;
    Ok(Some(id))
}

async fn create_vocabulary(settings: &SttSettingsInput) -> Result<String, String> {
    let body = json!({
        "model": "speech-biasing",
        "input": {
            "action": "create_vocabulary",
            "target_model": target_model(&settings.model),
            "prefix": "spkmore",
            "vocabulary": parse_hot_words(&settings.hot_words)?
        }
    });

    let client = reqwest::Client::new();
    let response = client
        .post(endpoint(&settings.workspace_id))
        .bearer_auth(&settings.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("热词表同步请求失败：{e}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .unwrap_or_else(|_| "empty response".to_string());
    if !status.is_success() {
        return Err(format!("热词表创建失败（HTTP {status}）：{text}"));
    }

    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| format!("热词表创建响应解析失败：{e}"))?;
    parsed
        .get("output")
        .and_then(|o| o.get("vocabulary_id"))
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .ok_or_else(|| format!("热词表创建响应缺少 vocabulary_id：{text}"))
}

fn update_stored_vocabulary_id(app: &AppHandle, settings: &SttSettingsInput, id: &str) -> Result<(), String> {
    let mut next = settings.clone();
    next.vocabulary_id = id.to_string();
    save_stt_settings(app, next)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_default_hot_words_ok() {
        let items = parse_hot_words(DEFAULT_HOT_WORDS_JSON).expect("default hot words valid");
        assert!(items.len() >= 10);
        for item in &items {
            assert!(item.get("text").is_some(), "each item has text");
        }
    }

    #[test]
    fn parse_empty_ok() {
        assert!(parse_hot_words("").unwrap().is_empty());
        assert!(parse_hot_words("   ").unwrap().is_empty());
    }

    #[test]
    fn parse_invalid_err() {
        assert!(parse_hot_words("not json").is_err());
        assert!(parse_hot_words("{}").is_err());
    }

    #[test]
    fn target_model_maps_fun_asr() {
        assert_eq!(target_model("fun-asr-realtime"), "fun-asr");
        assert_eq!(target_model("fun-asr-realtime-2025-11-07"), "fun-asr");
        assert_eq!(target_model("qwen-audio-3.0-asr-flash-streaming"), "qwen-audio-3.0-asr-flash-streaming");
    }
}
