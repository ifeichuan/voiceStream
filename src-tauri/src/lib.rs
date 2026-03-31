mod audio;
mod native_hud;
mod pi_rpc;
mod stt;

use audio::{normalize_f32_sample, normalize_u16_sample, remix_channels, resample_interleaved};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::io::{Seek, SeekFrom, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use stt::SttProvider;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

const HOTKEY_SHORTCUT: &str = "Cmd+Shift+Space";
const HOTKEY_PASTE_WAIT_MS: u64 = 2500;

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

fn emit_hotkey_state(app: &AppHandle, state: &str, message: &str) {
    let _ = app.emit(
        "hotkey-session",
        HotkeySessionEvent {
            state: state.to_string(),
            message: message.to_string(),
            shortcut: HOTKEY_SHORTCUT.to_string(),
        },
    );
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

fn write_clipboard_text(text: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to launch pbcopy: {}", e))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(text.as_bytes())
            .map_err(|e| format!("Failed to write clipboard content: {}", e))?;
    }

    let status = child
        .wait()
        .map_err(|e| format!("pbcopy wait failed: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err("pbcopy returned non-zero exit status".to_string())
    }
}

fn read_clipboard_text() -> Option<String> {
    let output = Command::new("pbpaste").output().ok()?;
    if !output.status.success() {
        return None;
    }

    String::from_utf8(output.stdout).ok()
}

fn trigger_cmd_v() -> Result<(), String> {
    let status = Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events" to keystroke "v" using command down"#)
        .status()
        .map_err(|e| format!("Failed to launch osascript: {}", e))?;

    if status.success() {
        Ok(())
    } else {
        Err("Paste keystroke failed. Grant Accessibility access if needed.".to_string())
    }
}

fn paste_text_to_cursor(text: &str) -> Result<(), String> {
    let previous_clipboard = read_clipboard_text();
    write_clipboard_text(text)?;
    std::thread::sleep(std::time::Duration::from_millis(120));
    let paste_result = trigger_cmd_v();
    std::thread::sleep(std::time::Duration::from_millis(120));

    match previous_clipboard {
        Some(previous) => {
            let _ = write_clipboard_text(&previous);
        }
        None => {
            let _ = write_clipboard_text("");
        }
    }

    paste_result
}

fn handle_hotkey_pressed(app: &AppHandle) {
    if HOTKEY_RECORDING.swap(true, Ordering::SeqCst) {
        return;
    }

    match start_recording_internal(app.clone()) {
        Ok(_) => {
            native_hud::show_recording(app);
            emit_hotkey_state(app, "recording", "Listening...");
        }
        Err(error) => {
            HOTKEY_RECORDING.store(false, Ordering::SeqCst);
            native_hud::show_error(app, &error);
            emit_hotkey_state(app, "error", &error);
        }
    }
}

fn schedule_hide_hud(app: &AppHandle, delay_ms: u64) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(tokio::time::Duration::from_millis(delay_ms)).await;
        native_hud::hide(&app);
    });
}

async fn optimize_transcript_with_pi(text: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || pi_rpc::refine_text(&text))
        .await
        .map_err(|error| format!("pi rpc task join failed: {}", error))?
}

fn handle_hotkey_released(app: &AppHandle) {
    if !HOTKEY_RECORDING.swap(false, Ordering::SeqCst) {
        return;
    }

    if let Err(error) = stop_recording_internal() {
        native_hud::show_error(app, &error);
        schedule_hide_hud(app, 900);
        emit_hotkey_state(app, "error", &error);
        return;
    }

    native_hud::show_processing(app);
    emit_hotkey_state(app, "processing", "Transcribing...");

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match stt::wait_for_final_text(tokio::time::Duration::from_millis(HOTKEY_PASTE_WAIT_MS))
            .await
        {
            Ok(text) if !text.trim().is_empty() => {
                native_hud::show_processing_text(&app, "Optimizing...");
                emit_hotkey_state(&app, "processing", "Optimizing...");

                let (final_text, pasted_message) =
                    match optimize_transcript_with_pi(text.clone()).await {
                        Ok(refined) if !refined.trim().is_empty() => {
                            (refined, "Pasted optimized text".to_string())
                        }
                        Ok(_) => (text, "Pasted raw transcript".to_string()),
                        Err(error) => {
                            eprintln!("pi optimization failed: {}", error);
                            (text, format!("Pi optimize failed, pasted raw transcript"))
                        }
                    };

                match paste_text_to_cursor(&final_text) {
                    Ok(()) => {
                        native_hud::show_success(&app, &final_text);
                        schedule_hide_hud(&app, 850);
                        emit_hotkey_state(&app, "pasted", &pasted_message);
                    }
                    Err(error) => {
                        native_hud::show_error(&app, &error);
                        schedule_hide_hud(&app, 1100);
                        emit_hotkey_state(&app, "error", &error);
                    }
                }
            }
            Ok(_) => {
                native_hud::show_error(&app, "No transcript");
                schedule_hide_hud(&app, 900);
                emit_hotkey_state(&app, "error", "No transcript captured");
            }
            Err(error) => {
                native_hud::show_error(&app, &error);
                schedule_hide_hud(&app, 1100);
                emit_hotkey_state(&app, "error", &error);
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                native_hud::initialize(&app.handle());
                let hold_to_talk_shortcut =
                    Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_shortcut(hold_to_talk_shortcut.clone())?
                        .with_handler(move |app, shortcut, event| {
                            if shortcut == &hold_to_talk_shortcut {
                                match event.state() {
                                    ShortcutState::Pressed => handle_hotkey_pressed(app),
                                    ShortcutState::Released => handle_hotkey_released(app),
                                }
                            }
                        })
                        .build(),
                )?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_stt_settings,
            save_stt_settings,
            test_stt_settings,
            start_recording,
            stop_recording,
            play_recorded,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
