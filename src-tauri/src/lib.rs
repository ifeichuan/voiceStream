mod agent_tasks;
mod agent_terminal;
mod audio;
mod db;
mod native_hud;
mod pi_rpc;
mod settings;
mod stt;
mod stt_providers;

use audio::{normalize_f32_sample, normalize_u16_sample, remix_channels, resample_interleaved};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::io::{Seek, SeekFrom, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use std::{env, thread};
use stt::SttProvider;
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_global_shortcut::{
    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};

pub(crate) const DICTATION_SHORTCUT: &str = "Cmd+Shift+Space";
const HOTKEY_PASTE_WAIT_MS: u64 = 2500;
const HOTKEY_TAP_THRESHOLD_MS: u128 = 220;
const DISABLE_GLOBAL_SHORTCUTS_ENV: &str = "VOICESTREAM_DISABLE_GLOBAL_SHORTCUTS";

#[derive(Debug, Serialize, Clone)]
pub struct AudioChunk {
    pub data: Vec<u8>,
    pub timestamp: u64,
    pub sample_rate: u32,
    pub channels: u16,
    pub size: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct AudioLevelEvent {
    pub level: f32,
}

#[derive(Debug, Serialize, Clone)]
pub struct HotkeySessionEvent {
    pub state: String,
    pub message: String,
    pub shortcut: String,
    pub purpose: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct TimingEvent {
    pub session_id: u64,
    pub stage: String,
    pub elapsed_ms: u128,
    pub details: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct AgentNotificationEvent {
    pub task_id: String,
    pub title: String,
    pub status: String,
    pub summary: String,
    pub display_text: String,
    pub spoken_text: String,
    pub channel: String,
    pub timestamp_ms: u128,
}

#[derive(Clone)]
struct ActiveRecording {
    file_path: String,
    sample_rate: u32,
    channels: u16,
}

struct DecodedAudio {
    sample_rate: u32,
    channels: u16,
    samples: Vec<f32>,
}

static STREAM_RUNNING: AtomicBool = AtomicBool::new(false);
static mut RECORDING_STREAM: Option<cpal::Stream> = None;
static mut PLAYBACK_STREAM: Option<cpal::Stream> = None;
static STREAM_SLOT_LOCK: Mutex<()> = Mutex::new(());
static ACTIVE_RECORDING: Mutex<Option<ActiveRecording>> = Mutex::new(None);
static ACTIVE_STT_PROVIDER: Mutex<Option<Box<dyn SttProvider>>> = Mutex::new(None);
static HOTKEY_RECORDING: AtomicBool = AtomicBool::new(false);
static DICTATION_HOTKEY_ARMED: AtomicBool = AtomicBool::new(true);
static AGENT_HOTKEY_ARMED: AtomicBool = AtomicBool::new(true);
static HOTKEY_SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);
static HOTKEY_TIMING: Mutex<Option<HotkeyTiming>> = Mutex::new(None);
static HOTKEY_MODE: Mutex<HotkeyMode> = Mutex::new(HotkeyMode::Idle);
static AGENT_SHORTCUT_SLOT: Mutex<Option<Shortcut>> = Mutex::new(None);
static AGENT_SHORTCUT_LABEL: Mutex<Option<String>> = Mutex::new(None);
static HUD_HIDE_TOKEN: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RecordingPurpose {
    Dictation,
    Agent,
}

impl RecordingPurpose {
    fn shortcut(self) -> String {
        match self {
            RecordingPurpose::Dictation => DICTATION_SHORTCUT.to_string(),
            RecordingPurpose::Agent => current_agent_shortcut_label(),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            RecordingPurpose::Dictation => "dictation",
            RecordingPurpose::Agent => "agent",
        }
    }

    fn listening_message(self) -> &'static str {
        match self {
            RecordingPurpose::Dictation => "Listening...",
            RecordingPurpose::Agent => "Listening for Agent task...",
        }
    }
}

struct HotkeyTiming {
    session_id: u64,
    started_at: Instant,
    stopped_at: Option<Instant>,
    purpose: RecordingPurpose,
}

enum HotkeyMode {
    Idle,
    RecordingPendingDecision {
        pressed_at: Instant,
        purpose: RecordingPurpose,
    },
    RecordingLatched {
        purpose: RecordingPurpose,
    },
    RecordingStoppingOnRelease {
        purpose: RecordingPurpose,
    },
}

#[tauri::command]
fn get_stt_providers() -> Vec<stt::SttProviderMeta> {
    stt::provider_meta_list()
}

#[tauri::command]
fn get_stt_settings(app: AppHandle) -> Result<stt::SttSettingsView, String> {
    stt::load_settings_view(&app)
}

#[tauri::command]
fn save_stt_settings(
    app: AppHandle,
    settings: stt::SttSettingsInput,
) -> Result<stt::SttSettingsView, String> {
    stt::save_settings(&app, settings)
}

#[tauri::command]
async fn test_stt_settings(
    app: AppHandle,
    settings: stt::SttSettingsInput,
) -> Result<String, String> {
    stt::test_settings(&app, settings).await
}

#[tauri::command]
fn get_agent_tasks() -> Result<Vec<agent_tasks::AgentTask>, String> {
    agent_tasks::list_tasks()
}

#[tauri::command]
fn get_agent_session(task_id: String) -> Result<agent_tasks::AgentSessionView, String> {
    agent_tasks::get_session_view(&task_id)
}

#[tauri::command]
fn start_agent_terminal(
    app: AppHandle,
    task_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<(), String> {
    agent_terminal::start(app, &task_id, cols.unwrap_or(100), rows.unwrap_or(30))
}

#[tauri::command]
fn write_agent_terminal(task_id: String, data: String) -> Result<(), String> {
    agent_terminal::write(&task_id, &data)
}

#[tauri::command]
fn resize_agent_terminal(task_id: String, cols: u16, rows: u16) -> Result<(), String> {
    agent_terminal::resize(&task_id, cols, rows)
}

#[tauri::command]
fn stop_agent_terminal(task_id: String) {
    agent_terminal::stop(&task_id);
}

#[tauri::command]
async fn continue_agent_task(
    app: AppHandle,
    task_id: String,
    message: String,
) -> Result<String, String> {
    let task = agent_tasks::get_task(&task_id)?;
    let message = message.trim().to_string();
    if message.is_empty() {
        return Err("继续内容不能为空。".to_string());
    }
    if task.status == agent_tasks::AgentTaskStatus::Running {
        return Err("这个 Agent 任务仍在执行中，先等当前轮结束。".to_string());
    }

    let _ = agent_tasks::mark_continuing(&app, &task_id, &message)?;
    let task_for_runner = agent_tasks::get_task(&task_id)?;
    let session_path = std::path::PathBuf::from(task_for_runner.session_path.clone());
    let app_for_events = app.clone();
    let task_id_for_events = task_id.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        pi_rpc::continue_agent_task(&message, &session_path, |kind, message| {
            let _ = agent_tasks::append_event(&app_for_events, &task_id_for_events, kind, message);
        })
    })
    .await
    .map_err(|error| format!("pi agent continue task join failed: {}", error))?;

    match result {
        Ok(final_text) => {
            let _ = agent_tasks::mark_completed(&app, &task_id, &final_text);
            Ok(final_text)
        }
        Err(error) => {
            let _ = agent_tasks::mark_failed(&app, &task_id, &error);
            Err(error)
        }
    }
}

#[tauri::command]
fn get_app_settings(app: AppHandle) -> Result<settings::AppSettingsView, String> {
    settings::load_app_settings_view(&app)
}

#[tauri::command]
fn save_app_settings(
    app: AppHandle,
    settings: settings::AppSettingsInput,
) -> Result<settings::AppSettingsView, String> {
    let previous_shortcuts = settings::runtime_shortcut_settings(&app)?;
    let next_agent_shortcut = settings.shortcuts.agent_shortcut.trim();
    let next_agent_shortcut = if next_agent_shortcut.is_empty() {
        previous_shortcuts.agent_shortcut.clone()
    } else {
        next_agent_shortcut.to_string()
    };

    register_agent_shortcut(&app, &next_agent_shortcut)?;
    let saved = match crate::settings::save_app_settings(&app, settings) {
        Ok(saved) => saved,
        Err(error) => {
            let _ = register_agent_shortcut(&app, &previous_shortcuts.agent_shortcut);
            return Err(error);
        }
    };

    // Pi dictation fast mode may reuse a long-lived rpc process.
    // Restart it after settings changes so provider/model updates apply immediately.
    pi_rpc::shutdown_reusable_process();
    pi_rpc::warmup();

    Ok(saved)
}

fn create_wav_header(
    sample_rate: u32,
    channels: u16,
    bits_per_sample: u16,
    data_size: u32,
) -> Vec<u8> {
    let byte_rate = sample_rate * channels as u32 * (bits_per_sample as u32 / 8);
    let block_align = channels * (bits_per_sample / 8);
    let file_size = 36 + data_size;

    let mut header = Vec::with_capacity(44);
    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&file_size.to_le_bytes());
    header.extend_from_slice(b"WAVE");
    header.extend_from_slice(b"fmt ");
    header.extend_from_slice(&16u32.to_le_bytes());
    header.extend_from_slice(&1u16.to_le_bytes());
    header.extend_from_slice(&channels.to_le_bytes());
    header.extend_from_slice(&sample_rate.to_le_bytes());
    header.extend_from_slice(&byte_rate.to_le_bytes());
    header.extend_from_slice(&block_align.to_le_bytes());
    header.extend_from_slice(&bits_per_sample.to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&data_size.to_le_bytes());
    header
}

fn parse_wav_file(file_path: &std::path::Path) -> Result<DecodedAudio, String> {
    let data = std::fs::read(file_path).map_err(|e| format!("Read error: {}", e))?;

    if data.len() < 12 || &data[0..4] != b"RIFF" || &data[8..12] != b"WAVE" {
        return Err("Unsupported WAV container".to_string());
    }

    let mut offset = 12usize;
    let mut audio_format: Option<u16> = None;
    let mut channels: Option<u16> = None;
    let mut sample_rate: Option<u32> = None;
    let mut bits_per_sample: Option<u16> = None;
    let mut payload: Option<&[u8]> = None;

    while offset + 8 <= data.len() {
        let chunk_id = &data[offset..offset + 4];
        let chunk_size = u32::from_le_bytes([
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
        ]) as usize;
        let chunk_start = offset + 8;
        let chunk_end = chunk_start.saturating_add(chunk_size);

        if chunk_end > data.len() {
            return Err("Corrupted WAV chunk".to_string());
        }

        if chunk_id == b"fmt " {
            if chunk_size < 16 {
                return Err("Invalid WAV fmt chunk".to_string());
            }

            audio_format = Some(u16::from_le_bytes([
                data[chunk_start],
                data[chunk_start + 1],
            ]));
            channels = Some(u16::from_le_bytes([
                data[chunk_start + 2],
                data[chunk_start + 3],
            ]));
            sample_rate = Some(u32::from_le_bytes([
                data[chunk_start + 4],
                data[chunk_start + 5],
                data[chunk_start + 6],
                data[chunk_start + 7],
            ]));
            bits_per_sample = Some(u16::from_le_bytes([
                data[chunk_start + 14],
                data[chunk_start + 15],
            ]));
        } else if chunk_id == b"data" {
            payload = Some(&data[chunk_start..chunk_end]);
        }

        offset = chunk_end + (chunk_size % 2);
    }

    let audio_format = audio_format.ok_or("Missing WAV fmt chunk")?;
    let channels = channels.ok_or("Missing channel count")?;
    let sample_rate = sample_rate.ok_or("Missing sample rate")?;
    let bits_per_sample = bits_per_sample.ok_or("Missing bit depth")?;
    let payload = payload.ok_or("Missing WAV data chunk")?;

    let samples = match (audio_format, bits_per_sample) {
        (1, 16) => payload
            .chunks_exact(2)
            .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / i16::MAX as f32)
            .collect(),
        (1, 32) | (3, 32) => payload
            .chunks_exact(4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect(),
        _ => {
            return Err(format!(
                "Unsupported WAV format: format={} bits={}",
                audio_format, bits_per_sample
            ))
        }
    };

    Ok(DecodedAudio {
        sample_rate,
        channels,
        samples,
    })
}

fn prepare_playback_samples(
    decoded: DecodedAudio,
    target_sample_rate: u32,
    target_channels: u16,
) -> Vec<f32> {
    let remixed = remix_channels(&decoded.samples, decoded.channels, target_channels);
    resample_interleaved(
        &remixed,
        target_channels,
        decoded.sample_rate,
        target_sample_rate,
    )
}

fn finalize_recording_file(recording: &ActiveRecording) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&recording.file_path)
        .map_err(|e| format!("Open recording error: {}", e))?;

    let data_len = file
        .metadata()
        .map_err(|e| format!("Recording metadata error: {}", e))?
        .len()
        .saturating_sub(44) as u32;
    let header = create_wav_header(recording.sample_rate, recording.channels, 16, data_len);

    file.seek(SeekFrom::Start(0))
        .map_err(|e| format!("Seek error: {}", e))?;
    file.write_all(&header)
        .map_err(|e| format!("Finalize header error: {}", e))?;

    Ok(())
}

fn write_pcm_chunk(file_path: &str, samples: &[i16]) {
    if let Ok(mut file) = std::fs::OpenOptions::new().append(true).open(file_path) {
        let bytes: Vec<u8> = samples
            .iter()
            .flat_map(|sample| sample.to_le_bytes())
            .collect();
        let _ = file.write_all(&bytes);
    }
}

fn emit_chunk(app: &AppHandle, sample_rate: u32, channels: u16, size: usize) {
    let chunk = AudioChunk {
        data: vec![],
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0),
        sample_rate,
        channels,
        size,
    };

    let _ = app.emit("audio-chunk", chunk);
}

fn emit_audio_level(app: &AppHandle, samples: &[i16]) {
    if samples.is_empty() {
        return;
    }

    let mean_square = samples
        .iter()
        .map(|sample| {
            let normalized = *sample as f32 / i16::MAX as f32;
            normalized * normalized
        })
        .sum::<f32>()
        / samples.len() as f32;
    let level = (mean_square.sqrt() * 9.0).clamp(0.0, 1.0);
    native_hud::update_level(app, level);
    let _ = app.emit("audio-level", AudioLevelEvent { level });
}

fn emit_hotkey_state(app: &AppHandle, purpose: RecordingPurpose, state: &str, message: &str) {
    let _ = app.emit(
        "hotkey-session",
        HotkeySessionEvent {
            state: state.to_string(),
            message: message.to_string(),
            shortcut: purpose.shortcut(),
            purpose: purpose.as_str().to_string(),
        },
    );
}

fn current_agent_shortcut_label() -> String {
    AGENT_SHORTCUT_LABEL
        .lock()
        .ok()
        .and_then(|label| label.clone())
        .unwrap_or_else(|| settings::DEFAULT_AGENT_SHORTCUT.to_string())
}

fn is_current_agent_shortcut(shortcut: &Shortcut) -> bool {
    AGENT_SHORTCUT_SLOT
        .lock()
        .map(|slot| slot.as_ref() == Some(shortcut))
        .unwrap_or(false)
}

#[cfg(desktop)]
fn handle_global_shortcut(
    dictation_shortcut: &Shortcut,
    app: &AppHandle,
    shortcut: &Shortcut,
    event: ShortcutEvent,
) {
    let shortcut_purpose = if shortcut == dictation_shortcut {
        Some(RecordingPurpose::Dictation)
    } else if is_current_agent_shortcut(shortcut) {
        Some(RecordingPurpose::Agent)
    } else {
        None
    };

    let Some(purpose) = shortcut_purpose else {
        return;
    };

    let armed = match purpose {
        RecordingPurpose::Dictation => &DICTATION_HOTKEY_ARMED,
        RecordingPurpose::Agent => &AGENT_HOTKEY_ARMED,
    };

    match event.state() {
        ShortcutState::Pressed => {
            if armed.swap(false, Ordering::SeqCst) {
                handle_hotkey_pressed(app, purpose);
            }
        }
        ShortcutState::Released => {
            armed.store(true, Ordering::SeqCst);
            handle_hotkey_released(app, purpose);
        }
    }
}

fn parse_shortcut_text(value: &str) -> Result<Shortcut, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err("Agent 快捷键不能为空。".to_string());
    }

    trimmed
        .parse::<Shortcut>()
        .map_err(|error| format!("Agent 快捷键格式无效：{}。", error))
}

#[cfg(desktop)]
fn register_agent_shortcut(app: &AppHandle, shortcut_text: &str) -> Result<(), String> {
    let next_shortcut = parse_shortcut_text(shortcut_text)?;
    let dictation_shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);

    if next_shortcut == dictation_shortcut {
        return Err("Agent 快捷键不能和听写快捷键相同。".to_string());
    }

    let previous_shortcut = AGENT_SHORTCUT_SLOT
        .lock()
        .map_err(|_| "Agent shortcut lock poisoned".to_string())?
        .to_owned();

    if previous_shortcut == Some(next_shortcut) {
        if let Ok(mut label) = AGENT_SHORTCUT_LABEL.lock() {
            *label = Some(shortcut_text.trim().to_string());
        }
        return Ok(());
    }

    if let Some(previous) = previous_shortcut {
        let _ = app.global_shortcut().unregister(previous);
    }

    if let Err(error) = app.global_shortcut().register(next_shortcut) {
        if let Some(previous) = previous_shortcut {
            let _ = app.global_shortcut().register(previous);
        }
        return Err(format!("注册 Agent 快捷键失败：{}", error));
    }

    *AGENT_SHORTCUT_SLOT
        .lock()
        .map_err(|_| "Agent shortcut lock poisoned".to_string())? = Some(next_shortcut);
    *AGENT_SHORTCUT_LABEL
        .lock()
        .map_err(|_| "Agent shortcut label lock poisoned".to_string())? =
        Some(shortcut_text.trim().to_string());

    Ok(())
}

#[cfg(not(desktop))]
fn register_agent_shortcut(_app: &AppHandle, _shortcut_text: &str) -> Result<(), String> {
    Ok(())
}

fn replace_recording_stream(stream: Option<cpal::Stream>) {
    let _guard = STREAM_SLOT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    unsafe {
        RECORDING_STREAM = stream;
    }
}

fn replace_playback_stream(stream: Option<cpal::Stream>) {
    let _guard = STREAM_SLOT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    unsafe {
        PLAYBACK_STREAM = stream;
    }
}

fn log_timing(
    app: Option<&AppHandle>,
    session_id: u64,
    stage: &str,
    elapsed_ms: u128,
    details: &str,
) {
    if details.is_empty() {
        eprintln!(
            "[voicestream][timing][session:{}] {}: {} ms",
            session_id, stage, elapsed_ms
        );
    } else {
        eprintln!(
            "[voicestream][timing][session:{}] {}: {} ms ({})",
            session_id, stage, elapsed_ms, details
        );
    }

    if let Some(app) = app {
        let _ = app.emit(
            "timing-log",
            TimingEvent {
                session_id,
                stage: stage.to_string(),
                elapsed_ms,
                details: details.to_string(),
            },
        );
    }
}

fn process_recording_chunk(
    app: &AppHandle,
    file_path: &str,
    sample_rate: u32,
    channels: u16,
    chunk: Vec<i16>,
) {
    let size = chunk.len() * std::mem::size_of::<i16>();
    emit_chunk(app, sample_rate, channels, size);
    emit_audio_level(app, &chunk);

    if let Ok(provider) = ACTIVE_STT_PROVIDER.lock() {
        if let Some(provider) = provider.as_ref() {
            let _ = provider.push_chunk(chunk.clone(), sample_rate, channels);
        }
    }

    write_pcm_chunk(file_path, &chunk);
}

fn start_recording_internal(app: AppHandle) -> Result<String, String> {
    if STREAM_RUNNING.load(Ordering::SeqCst) {
        return Err("Already recording".to_string());
    }

    let host = cpal::default_host();
    let device = host.default_input_device().ok_or("No input device")?;
    let config = device
        .default_input_config()
        .map_err(|e| format!("Config error: {}", e))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let file_path = format!("/tmp/voicestream_{}.wav", timestamp);

    std::fs::write(&file_path, create_wav_header(sample_rate, channels, 16, 0))
        .map_err(|e| format!("Write header error: {}", e))?;

    stt::reset_runtime_state();
    let provider = stt::create_default_stt_provider(app.clone())?;
    *ACTIVE_STT_PROVIDER
        .lock()
        .map_err(|_| "STT provider lock poisoned".to_string())? = provider;

    let file_path_clone = file_path.clone();
    let err_fn = |err| eprintln!("Record error: {}", err);

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let app = app.clone();
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let chunk: Vec<i16> = data.iter().copied().map(normalize_f32_sample).collect();
                    process_recording_chunk(&app, &file_path_clone, sample_rate, channels, chunk);
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let app = app.clone();
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    process_recording_chunk(
                        &app,
                        &file_path_clone,
                        sample_rate,
                        channels,
                        data.to_vec(),
                    );
                },
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let app = app.clone();
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[u16], _: &cpal::InputCallbackInfo| {
                    let chunk: Vec<i16> = data.iter().copied().map(normalize_u16_sample).collect();
                    process_recording_chunk(&app, &file_path_clone, sample_rate, channels, chunk);
                },
                err_fn,
                None,
            )
        }
        _ => return Err("Unsupported format".to_string()),
    }
    .map_err(|e| format!("Build error: {}", e))?;

    stream.play().map_err(|e| format!("Play error: {}", e))?;
    STREAM_RUNNING.store(true, Ordering::SeqCst);
    replace_recording_stream(Some(stream));

    *ACTIVE_RECORDING
        .lock()
        .map_err(|_| "Recording lock poisoned".to_string())? = Some(ActiveRecording {
        file_path: file_path.clone(),
        sample_rate,
        channels,
    });

    Ok(format!(
        "Recording: {}Hz {}ch → {}",
        sample_rate, channels, file_path
    ))
}

fn stop_recording_internal() -> Result<String, String> {
    if !STREAM_RUNNING.load(Ordering::SeqCst) {
        return Err("Not recording".to_string());
    }

    let finished_recording = ACTIVE_RECORDING
        .lock()
        .map_err(|_| "Recording lock poisoned".to_string())?
        .take();

    replace_recording_stream(None);

    STREAM_RUNNING.store(false, Ordering::SeqCst);

    if let Some(recording) = finished_recording.as_ref() {
        finalize_recording_file(recording)?;
    }

    if let Some(provider) = ACTIVE_STT_PROVIDER
        .lock()
        .map_err(|_| "STT provider lock poisoned".to_string())?
        .take()
    {
        let _ = provider.finish();
    } else {
        stt::mark_runtime_finished();
    }

    Ok("Recording stopped".to_string())
}

#[tauri::command]
fn start_recording(app: AppHandle) -> Result<String, String> {
    start_recording_internal(app)
}

#[tauri::command]
fn stop_recording() -> Result<String, String> {
    stop_recording_internal()
}

#[tauri::command]
fn play_recorded() -> Result<String, String> {
    let file_path = std::fs::read_dir("/tmp")
        .ok()
        .and_then(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with("voicestream_")
                })
                .max_by_key(|entry| {
                    entry
                        .metadata()
                        .ok()
                        .and_then(|metadata| metadata.modified().ok())
                })
        })
        .map(|entry| entry.path())
        .ok_or("No recording found")?;

    let host = cpal::default_host();
    let device = host.default_output_device().ok_or("No output device")?;
    let config = device
        .default_output_config()
        .map_err(|e| format!("Config error: {}", e))?;
    let output_config: cpal::StreamConfig = config.clone().into();
    let decoded = parse_wav_file(&file_path)?;
    let samples = prepare_playback_samples(decoded, config.sample_rate().0, config.channels());

    let total_samples = samples.len();
    let samples = std::sync::Arc::new(samples);
    let index = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let playing = std::sync::Arc::new(AtomicBool::new(true));

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let samples = samples.clone();
            let index = index.clone();
            let playing = playing.clone();
            device.build_output_stream(
                &output_config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    if !playing.load(Ordering::SeqCst) {
                        data.fill(0.0);
                        return;
                    }

                    let start = index.fetch_add(data.len(), Ordering::SeqCst);
                    for (offset, sample) in data.iter_mut().enumerate() {
                        *sample = if start + offset < samples.len() {
                            samples[start + offset]
                        } else {
                            playing.store(false, Ordering::SeqCst);
                            0.0
                        };
                    }
                },
                |err| eprintln!("Playback error: {}", err),
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let samples = samples.clone();
            let index = index.clone();
            let playing = playing.clone();
            device.build_output_stream(
                &output_config,
                move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                    if !playing.load(Ordering::SeqCst) {
                        data.fill(0);
                        return;
                    }

                    let start = index.fetch_add(data.len(), Ordering::SeqCst);
                    for (offset, sample) in data.iter_mut().enumerate() {
                        *sample = if start + offset < samples.len() {
                            normalize_f32_sample(samples[start + offset])
                        } else {
                            playing.store(false, Ordering::SeqCst);
                            0
                        };
                    }
                },
                |err| eprintln!("Playback error: {}", err),
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let samples = samples.clone();
            let index = index.clone();
            let playing = playing.clone();
            device.build_output_stream(
                &output_config,
                move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                    if !playing.load(Ordering::SeqCst) {
                        data.fill(u16::MAX / 2);
                        return;
                    }

                    let start = index.fetch_add(data.len(), Ordering::SeqCst);
                    for (offset, sample) in data.iter_mut().enumerate() {
                        *sample = if start + offset < samples.len() {
                            ((samples[start + offset].clamp(-1.0, 1.0) + 1.0)
                                * 0.5
                                * u16::MAX as f32)
                                .round() as u16
                        } else {
                            playing.store(false, Ordering::SeqCst);
                            u16::MAX / 2
                        };
                    }
                },
                |err| eprintln!("Playback error: {}", err),
                None,
            )
        }
        _ => return Err("Unsupported output sample format".to_string()),
    }
    .map_err(|e| format!("Build error: {}", e))?;

    stream.play().map_err(|e| format!("Play error: {}", e))?;
    replace_playback_stream(Some(stream));

    Ok(format!(
        "Playing: {} samples from {}",
        total_samples,
        file_path.display()
    ))
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    write_clipboard_text(&text)
}

#[derive(Debug, Serialize, Clone)]
struct PermissionStatus {
    accessibility: bool,
}

#[tauri::command]
fn check_permissions() -> PermissionStatus {
    let accessibility = unsafe {
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        AXIsProcessTrusted()
    };

    PermissionStatus { accessibility }
}

#[tauri::command]
fn open_accessibility_settings() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
        .status()
        .map_err(|e| format!("Failed to open settings: {}", e))?;
    Ok(())
}

#[tauri::command]
fn request_microphone_permission() -> Result<(), String> {
    // Trigger the permission dialog by briefly attempting to use the microphone
    std::process::Command::new("/usr/bin/osascript")
        .arg("-e")
        .arg("tell application \"System Events\" to return")
        .output()
        .map_err(|e| format!("Failed: {}", e))?;
    Ok(())
}

fn write_clipboard_text(text: &str) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new()
        .map_err(|e| format!("Failed to open clipboard: {}", e))?;
    clipboard
        .set_text(text)
        .map_err(|e| format!("Failed to write to clipboard: {}", e))
}


fn trigger_cmd_v() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    // Check accessibility trust
    let trusted = unsafe {
        extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        AXIsProcessTrusted()
    };
    if !trusted {
        return Err("App is not trusted for Accessibility. Add VoiceStream in System Settings > Privacy & Security > Accessibility.".to_string());
    }

    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "Failed to create CGEventSource.")?;

    // key code 9 = 'v'
    let key_down = CGEvent::new_keyboard_event(source.clone(), 9, true)
        .map_err(|_| "Failed to create key down event")?;
    let key_up = CGEvent::new_keyboard_event(source, 9, false)
        .map_err(|_| "Failed to create key up event")?;

    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);

    key_down.post(CGEventTapLocation::HID);
    std::thread::sleep(std::time::Duration::from_millis(30));
    key_up.post(CGEventTapLocation::HID);

    Ok(())
}

fn paste_text_to_cursor(text: &str) -> Result<(), String> {
    write_clipboard_text(text)?;
    std::thread::sleep(std::time::Duration::from_millis(120));
    trigger_cmd_v()
}

fn handle_hotkey_pressed(app: &AppHandle, purpose: RecordingPurpose) {
    let mut mode = HOTKEY_MODE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    match &*mode {
        HotkeyMode::Idle => {
            HOTKEY_RECORDING.store(true, Ordering::SeqCst);

            match start_recording_internal(app.clone()) {
                Ok(_) => {
                    let now = Instant::now();
                    let session_id = HOTKEY_SESSION_COUNTER.fetch_add(1, Ordering::SeqCst) + 1;
                    if let Ok(mut timing) = HOTKEY_TIMING.lock() {
                        *timing = Some(HotkeyTiming {
                            session_id,
                            started_at: now,
                            stopped_at: None,
                            purpose,
                        });
                    }
                    *mode = HotkeyMode::RecordingPendingDecision {
                        pressed_at: now,
                        purpose,
                    };
                    log_timing(
                        Some(app),
                        session_id,
                        "session_started",
                        0,
                        &format!("{} hotkey recording started", purpose.as_str()),
                    );
                    native_hud::show_recording(app);
                    emit_hotkey_state(app, purpose, "recording", purpose.listening_message());
                }
                Err(error) => {
                    HOTKEY_RECORDING.store(false, Ordering::SeqCst);
                    *mode = HotkeyMode::Idle;
                    native_hud::show_error(app, &error);
                    emit_hotkey_state(app, purpose, "error", &error);
                }
            }
        }
        HotkeyMode::RecordingLatched {
            purpose: active_purpose,
        } if *active_purpose == purpose => {
            *mode = HotkeyMode::RecordingStoppingOnRelease { purpose };
            emit_hotkey_state(app, purpose, "recording", "Release to stop.");
        }
        HotkeyMode::RecordingPendingDecision { .. }
        | HotkeyMode::RecordingLatched { .. }
        | HotkeyMode::RecordingStoppingOnRelease { .. } => {}
    }
}

fn schedule_hide_hud(app: &AppHandle, delay_ms: u64) {
    let app = app.clone();
    let token = HUD_HIDE_TOKEN.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
        if HUD_HIDE_TOKEN.load(Ordering::SeqCst) == token {
            native_hud::hide(&app);
        }
    });
}

async fn optimize_transcript_with_pi(text: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || pi_rpc::refine_text(&text))
        .await
        .map_err(|error| format!("pi rpc task join failed: {}", error))?
}

async fn run_agent_task_with_pi(
    app: AppHandle,
    task: agent_tasks::AgentTask,
) -> Result<String, String> {
    let task_id = task.id.clone();
    let transcript = task.transcript.clone();
    let title = task.title.clone();
    let session_path = std::path::PathBuf::from(task.session_path.clone());
    tauri::async_runtime::spawn_blocking(move || {
        pi_rpc::run_agent_task(&transcript, &title, &session_path, |kind, message| {
            let _ = agent_tasks::append_event(&app, &task_id, kind, message);
        })
    })
    .await
    .map_err(|error| format!("pi agent task join failed: {}", error))?
}

fn notify_agent_task_completed(app: &AppHandle, task: &agent_tasks::AgentTask, final_text: &str) {
    let summary = summarize_notification_text(final_text)
        .filter(|value| !value.eq_ignore_ascii_case("ok"))
        .unwrap_or_else(|| task.title.clone());
    let display_text = format!("完成 · {}", truncate_chars(&summary, 86));

    emit_agent_notification(
        app,
        task,
        "completed",
        &summary,
        &display_text,
        "", // spoken_text handled by extension's agent_end
    );
    native_hud::show_success(app, &display_text);
    schedule_hide_hud(app, 4200);
}

fn notify_agent_task_failed(app: &AppHandle, task: &agent_tasks::AgentTask, error: &str) {
    let summary = summarize_notification_text(error).unwrap_or_else(|| task.title.clone());
    let display_text = format!("失败 · {}", truncate_chars(&task.title, 86));
    let spoken_text = format!("Agent 任务失败：{}", truncate_chars(&summary, 92));

    emit_agent_notification(app, task, "failed", &summary, &display_text, &spoken_text);
    native_hud::show_error(app, &display_text);
    schedule_hide_hud(app, 4600);
    speak_notification(&spoken_text);
}

fn emit_agent_notification(
    app: &AppHandle,
    task: &agent_tasks::AgentTask,
    status: &str,
    summary: &str,
    display_text: &str,
    spoken_text: &str,
) {
    let _ = app.emit(
        "agent-notification",
        AgentNotificationEvent {
            task_id: task.id.clone(),
            title: task.title.clone(),
            status: status.to_string(),
            summary: summary.to_string(),
            display_text: display_text.to_string(),
            spoken_text: spoken_text.to_string(),
            channel: "say+hud".to_string(),
            timestamp_ms: now_unix_ms(),
        },
    );
}

fn speak_notification(text: &str) {
    let text = text.trim();
    if text.is_empty() {
        return;
    }

    let text = text.to_string();
    thread::spawn(move || {
        let _ = Command::new("killall")
            .arg("say")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();

        match Command::new("say")
            .arg(&text)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
        {
            Ok(_) => {}
            Err(error) => eprintln!("[notify] failed to launch say: {}", error),
        }
    });
}

fn summarize_notification_text(text: &str) -> Option<String> {
    let normalized = collapse_whitespace(text);
    let trimmed = normalized.trim();
    if trimmed.is_empty() {
        return None;
    }

    let sentence_end = trimmed.char_indices().find_map(|(index, ch)| {
        matches!(ch, '。' | '！' | '？' | '.' | '!' | '?').then_some(index + ch.len_utf8())
    });

    let summary = match sentence_end {
        Some(end) if end >= 8 => &trimmed[..end],
        _ => trimmed,
    };

    Some(truncate_chars(summary, 140))
}

fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
    let mut chars = text.chars();
    let mut output: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        output.push('…');
    }
    output
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn env_flag_enabled(name: &str) -> bool {
    env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn maybe_run_pi_startup_self_test() {
    if !env_flag_enabled("VOICESTREAM_PI_STARTUP_TEST") {
        return;
    }

    thread::spawn(|| {
        eprintln!("[voicestream][startup-test] starting pi self-test");
        let started_at = Instant::now();
        let sample = "好的好的，我们现在测试一下普通语音整理链路。";
        match pi_rpc::refine_text(sample) {
            Ok(result) => {
                eprintln!(
                    "[voicestream][startup-test] success in {} ms result={}",
                    started_at.elapsed().as_millis(),
                    serde_json::to_string(&result)
                        .unwrap_or_else(|_| "\"<encode-failed>\"".to_string())
                );
            }
            Err(error) => {
                eprintln!(
                    "[voicestream][startup-test] failed in {} ms error={}",
                    started_at.elapsed().as_millis(),
                    error
                );
            }
        }
    });
}

fn finish_hotkey_recording(app: &AppHandle, purpose: RecordingPurpose) {
    if !HOTKEY_RECORDING.swap(false, Ordering::SeqCst) {
        return;
    }

    let mut timing_snapshot = HOTKEY_TIMING
        .lock()
        .ok()
        .and_then(|mut timing| timing.take())
        .unwrap_or(HotkeyTiming {
            session_id: 0,
            started_at: Instant::now(),
            stopped_at: None,
            purpose,
        });
    timing_snapshot.stopped_at = Some(Instant::now());
    let purpose = timing_snapshot.purpose;

    if let Some(stopped_at) = timing_snapshot.stopped_at {
        log_timing(
            Some(app),
            timing_snapshot.session_id,
            "recording",
            stopped_at
                .duration_since(timing_snapshot.started_at)
                .as_millis(),
            "capture duration until stop",
        );
    }

    if let Err(error) = stop_recording_internal() {
        native_hud::show_error(app, &error);
        schedule_hide_hud(app, 900);
        emit_hotkey_state(app, purpose, "error", &error);
        return;
    }

    native_hud::show_processing(app);
    emit_hotkey_state(app, purpose, "processing", "Transcribing...");

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let stt_wait_started_at = Instant::now();
        match stt::wait_for_final_text(tokio::time::Duration::from_millis(HOTKEY_PASTE_WAIT_MS))
            .await
        {
            Ok(text) if !text.trim().is_empty() => {
                log_timing(
                    Some(&app),
                    timing_snapshot.session_id,
                    "stt_wait",
                    stt_wait_started_at.elapsed().as_millis(),
                    &format!("chars={}", text.chars().count()),
                );
                log_timing(
                    Some(&app),
                    timing_snapshot.session_id,
                    "recording_to_stt_final",
                    timing_snapshot.started_at.elapsed().as_millis(),
                    "from recording start to final transcript",
                );

                match purpose {
                    RecordingPurpose::Dictation => {
                        finish_dictation_transcript(&app, &timing_snapshot, text).await;
                    }
                    RecordingPurpose::Agent => {
                        finish_agent_transcript(&app, &timing_snapshot, text).await;
                    }
                }
            }
            Ok(_) => {
                log_timing(
                    Some(&app),
                    timing_snapshot.session_id,
                    "stt_wait_empty",
                    stt_wait_started_at.elapsed().as_millis(),
                    "no transcript captured",
                );
                native_hud::show_error(&app, "No transcript");
                schedule_hide_hud(&app, 900);
                emit_hotkey_state(&app, purpose, "error", "No transcript captured");
            }
            Err(error) => {
                log_timing(
                    Some(&app),
                    timing_snapshot.session_id,
                    "stt_wait_failed",
                    stt_wait_started_at.elapsed().as_millis(),
                    &error,
                );
                native_hud::show_error(&app, &error);
                schedule_hide_hud(&app, 1100);
                emit_hotkey_state(&app, purpose, "error", &error);
            }
        }
    });
}

async fn finish_dictation_transcript(
    app: &AppHandle,
    timing_snapshot: &HotkeyTiming,
    text: String,
) {
    native_hud::show_processing_text(app, "Optimizing...");
    emit_hotkey_state(
        app,
        RecordingPurpose::Dictation,
        "processing",
        "Optimizing...",
    );

    let optimize_started_at = Instant::now();
    let (final_text, pasted_message) = match optimize_transcript_with_pi(text.clone()).await {
        Ok(refined) if !refined.trim().is_empty() => {
            log_timing(
                Some(app),
                timing_snapshot.session_id,
                "optimize",
                optimize_started_at.elapsed().as_millis(),
                &format!(
                    "input_chars={}, output_chars={}, optimized=true",
                    text.chars().count(),
                    refined.chars().count()
                ),
            );
            (refined, "Pasted optimized text".to_string())
        }
        Ok(_) => {
            log_timing(
                Some(app),
                timing_snapshot.session_id,
                "optimize",
                optimize_started_at.elapsed().as_millis(),
                &format!(
                    "input_chars={}, output_chars=0, optimized=false-empty",
                    text.chars().count()
                ),
            );
            (text, "Pasted raw transcript".to_string())
        }
        Err(error) => {
            log_timing(
                Some(app),
                timing_snapshot.session_id,
                "optimize_failed",
                optimize_started_at.elapsed().as_millis(),
                &error,
            );
            eprintln!("pi optimization failed: {}", error);
            (
                text,
                "Pi optimize failed, pasted raw transcript".to_string(),
            )
        }
    };

    let paste_started_at = Instant::now();
    match paste_text_to_cursor(&final_text) {
        Ok(()) => {
            log_timing(
                Some(app),
                timing_snapshot.session_id,
                "paste",
                paste_started_at.elapsed().as_millis(),
                &format!("chars={}", final_text.chars().count()),
            );
            log_timing(
                Some(app),
                timing_snapshot.session_id,
                "end_to_end",
                timing_snapshot.started_at.elapsed().as_millis(),
                "from recording start to paste complete",
            );
            native_hud::show_success(app, &final_text);
            schedule_hide_hud(app, 850);
            emit_hotkey_state(app, RecordingPurpose::Dictation, "pasted", &pasted_message);
        }
        Err(error) => {
            log_timing(
                Some(app),
                timing_snapshot.session_id,
                "paste_failed",
                paste_started_at.elapsed().as_millis(),
                &error,
            );
            native_hud::show_error(app, &error);
            schedule_hide_hud(app, 1100);
            emit_hotkey_state(app, RecordingPurpose::Dictation, "error", &error);
        }
    }
}

async fn finish_agent_transcript(app: &AppHandle, timing_snapshot: &HotkeyTiming, text: String) {
    native_hud::show_processing_text(app, "Agent started...");
    emit_hotkey_state(
        app,
        RecordingPurpose::Agent,
        "processing",
        "Agent started...",
    );

    let task = match agent_tasks::create_task(app, &text) {
        Ok(task) => task,
        Err(error) => {
            native_hud::show_error(app, &error);
            schedule_hide_hud(app, 1100);
            emit_hotkey_state(app, RecordingPurpose::Agent, "error", &error);
            return;
        }
    };

    let _ = agent_tasks::mark_running(app, &task.id);
    native_hud::show_success(app, "Agent task started");
    schedule_hide_hud(app, 850);

    let agent_started_at = Instant::now();
    match run_agent_task_with_pi(app.clone(), task.clone()).await {
        Ok(final_text) => {
            log_timing(
                Some(app),
                timing_snapshot.session_id,
                "agent_task",
                agent_started_at.elapsed().as_millis(),
                &format!(
                    "task_id={}, output_chars={}",
                    task.id,
                    final_text.chars().count()
                ),
            );
            let _ = agent_tasks::mark_completed(app, &task.id, &final_text);
            notify_agent_task_completed(app, &task, &final_text);
            emit_hotkey_state(
                app,
                RecordingPurpose::Agent,
                "completed",
                "Agent task completed",
            );
        }
        Err(error) => {
            log_timing(
                Some(app),
                timing_snapshot.session_id,
                "agent_task_failed",
                agent_started_at.elapsed().as_millis(),
                &error,
            );
            let _ = agent_tasks::mark_failed(app, &task.id, &error);
            notify_agent_task_failed(app, &task, &error);
            emit_hotkey_state(app, RecordingPurpose::Agent, "error", &error);
        }
    }
}

fn handle_hotkey_released(app: &AppHandle, purpose: RecordingPurpose) {
    let mut mode = HOTKEY_MODE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());

    match &*mode {
        HotkeyMode::Idle => {}
        HotkeyMode::RecordingPendingDecision {
            pressed_at,
            purpose: active_purpose,
        } if *active_purpose == purpose => {
            let held_ms = pressed_at.elapsed().as_millis();
            if held_ms >= HOTKEY_TAP_THRESHOLD_MS {
                *mode = HotkeyMode::Idle;
                drop(mode);
                finish_hotkey_recording(app, purpose);
            } else {
                *mode = HotkeyMode::RecordingLatched { purpose };
                emit_hotkey_state(
                    app,
                    purpose,
                    "recording",
                    "Listening... Press again to stop.",
                );
            }
        }
        HotkeyMode::RecordingStoppingOnRelease {
            purpose: active_purpose,
        } if *active_purpose == purpose => {
            *mode = HotkeyMode::Idle;
            drop(mode);
            finish_hotkey_recording(app, purpose);
        }
        HotkeyMode::RecordingPendingDecision { .. }
        | HotkeyMode::RecordingLatched { .. }
        | HotkeyMode::RecordingStoppingOnRelease { .. } => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Ok(app_data_dir) = app.path().app_data_dir() {
                settings::set_app_data_dir(app_data_dir.clone());
                if let Err(e) = db::initialize(&app_data_dir) {
                    eprintln!("[voicestream] db initialization failed: {}", e);
                }
            }

            pi_rpc::set_app_handle(app.handle().clone());

            if let Ok(resource_dir) = app.path().resource_dir() {
                let candidate = resource_dir.join("pi-extensions");
                if candidate.exists() {
                    pi_rpc::set_app_root(resource_dir);
                }
            }

            agent_tasks::initialize(&app.handle())?;

            #[cfg(desktop)]
            {
                if env_flag_enabled(DISABLE_GLOBAL_SHORTCUTS_ENV) {
                    eprintln!(
                        "[voicestream] global shortcuts disabled by {}",
                        DISABLE_GLOBAL_SHORTCUTS_ENV
                    );
                } else {
                    native_hud::initialize(&app.handle());
                    let dictation_shortcut =
                        Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);

                    app.handle().plugin(
                        tauri_plugin_global_shortcut::Builder::new()
                            .with_shortcut(dictation_shortcut.clone())?
                            .with_handler(move |app, shortcut, event| {
                                handle_global_shortcut(&dictation_shortcut, app, shortcut, event);
                            })
                            .build(),
                    )?;

                    let shortcuts = settings::runtime_shortcut_settings(&app.handle())?;
                    if let Err(error) =
                        register_agent_shortcut(&app.handle(), &shortcuts.agent_shortcut)
                    {
                        eprintln!("[voicestream] failed to register agent shortcut: {}", error);
                    }
                }
            }

            pi_rpc::warmup();
            maybe_run_pi_startup_self_test();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_stt_settings,
            get_stt_providers,
            get_agent_tasks,
            get_agent_session,
            start_agent_terminal,
            write_agent_terminal,
            resize_agent_terminal,
            stop_agent_terminal,
            continue_agent_task,
            save_stt_settings,
            test_stt_settings,
            get_app_settings,
            save_app_settings,
            start_recording,
            stop_recording,
            play_recorded,
            copy_to_clipboard,
            check_permissions,
            open_accessibility_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if matches!(event, RunEvent::Exit) {
                agent_terminal::shutdown_all();
                pi_rpc::shutdown_reusable_process()
            }
        });
}
