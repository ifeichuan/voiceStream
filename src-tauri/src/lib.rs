use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use serde::Serialize;
use std::io::{Seek, SeekFrom, Write};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize, Clone)]
pub struct AudioChunk {
    pub data: Vec<u8>,
    pub timestamp: u64,
    pub sample_rate: u32,
    pub channels: u16,
    pub size: usize,
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

#[derive(Clone)]
struct RecordedAudio {
    file_path: String,
    sample_rate: u32,
    channels: u16,
    chunks: Vec<Vec<i16>>,
}

static STREAM_RUNNING: AtomicBool = AtomicBool::new(false);
static mut RECORDING_STREAM: Option<cpal::Stream> = None;
static mut PLAYBACK_STREAM: Option<cpal::Stream> = None;
static STREAM_MUTEX: Mutex<()> = Mutex::new(());
static ACTIVE_RECORDING: Mutex<Option<ActiveRecording>> = Mutex::new(None);
static RECORDING_CHUNKS: Mutex<Vec<Vec<i16>>> = Mutex::new(Vec::new());
static LATEST_RECORDING: Mutex<Option<RecordedAudio>> = Mutex::new(None);

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

fn normalize_f32_sample(sample: f32) -> i16 {
    (sample.clamp(-1.0, 1.0) * i16::MAX as f32).round() as i16
}

fn normalize_u16_sample(sample: u16) -> i16 {
    (sample as i32 - 32_768) as i16
}

fn pcm_i16_to_f32(sample: i16) -> f32 {
    sample as f32 / i16::MAX as f32
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

            audio_format = Some(u16::from_le_bytes([data[chunk_start], data[chunk_start + 1]]));
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

fn remix_channels(samples: &[f32], source_channels: u16, target_channels: u16) -> Vec<f32> {
    if source_channels == target_channels {
        return samples.to_vec();
    }

    let source_channels = source_channels as usize;
    let target_channels = target_channels as usize;

    if source_channels == 0 || target_channels == 0 {
        return Vec::new();
    }

    let mut remixed = Vec::with_capacity(samples.len() / source_channels * target_channels);

    for frame in samples.chunks_exact(source_channels) {
        if target_channels == 1 {
            remixed.push(frame.iter().copied().sum::<f32>() / source_channels as f32);
            continue;
        }

        if source_channels == 1 {
            remixed.extend(std::iter::repeat_n(frame[0], target_channels));
            continue;
        }

        for channel in 0..target_channels {
            remixed.push(frame[channel.min(source_channels - 1)]);
        }
    }

    remixed
}

fn resample_interleaved(
    samples: &[f32],
    channels: u16,
    source_rate: u32,
    target_rate: u32,
) -> Vec<f32> {
    if source_rate == target_rate || samples.is_empty() {
        return samples.to_vec();
    }

    let channels = channels as usize;
    if channels == 0 {
        return Vec::new();
    }

    let source_frames = samples.len() / channels;
    if source_frames <= 1 {
        return samples.to_vec();
    }

    let target_frames =
        ((source_frames as f64 * target_rate as f64) / source_rate as f64).round() as usize;
    let last_frame = source_frames - 1;
    let mut resampled = Vec::with_capacity(target_frames * channels);

    for target_index in 0..target_frames {
        let source_position = target_index as f64 * source_rate as f64 / target_rate as f64;
        let base_index = source_position.floor() as usize;
        let next_index = (base_index + 1).min(last_frame);
        let fraction = (source_position - base_index as f64) as f32;

        for channel in 0..channels {
            let base_sample = samples[base_index * channels + channel];
            let next_sample = samples[next_index * channels + channel];
            resampled.push(base_sample + (next_sample - base_sample) * fraction);
        }
    }

    resampled
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

fn prepare_playback_from_chunks(
    chunks: &[Vec<i16>],
    source_sample_rate: u32,
    source_channels: u16,
    target_sample_rate: u32,
    target_channels: u16,
) -> Vec<f32> {
    let normalized: Vec<f32> = chunks
        .iter()
        .flat_map(|chunk| chunk.iter().copied())
        .map(pcm_i16_to_f32)
        .collect();
    let remixed = remix_channels(&normalized, source_channels, target_channels);
    resample_interleaved(
        &remixed,
        target_channels,
        source_sample_rate,
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
        let bytes: Vec<u8> = samples.iter().flat_map(|sample| sample.to_le_bytes()).collect();
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

#[tauri::command]
fn start_recording(app: AppHandle) -> Result<String, String> {
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
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let file_path = format!("/tmp/voicestream_{}.wav", timestamp);

    std::fs::write(&file_path, create_wav_header(sample_rate, channels, 16, 0))
        .map_err(|e| format!("Write header error: {}", e))?;

    RECORDING_CHUNKS
        .lock()
        .map_err(|_| "Recording chunk lock poisoned".to_string())?
        .clear();

    let file_path_clone = file_path.clone();
    let err_fn = |err| eprintln!("Record error: {}", err);

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let app = app.clone();
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let chunk: Vec<i16> = data
                        .iter()
                        .copied()
                        .map(normalize_f32_sample)
                        .collect();
                    let size = chunk.len() * std::mem::size_of::<i16>();
                    emit_chunk(&app, sample_rate, channels, size);
                    if let Ok(mut chunks) = RECORDING_CHUNKS.lock() {
                        chunks.push(chunk.clone());
                    }
                    write_pcm_chunk(&file_path_clone, &chunk);
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
                    let chunk = data.to_vec();
                    let size = chunk.len() * std::mem::size_of::<i16>();
                    emit_chunk(&app, sample_rate, channels, size);
                    if let Ok(mut chunks) = RECORDING_CHUNKS.lock() {
                        chunks.push(chunk.clone());
                    }
                    write_pcm_chunk(&file_path_clone, &chunk);
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
                    let chunk: Vec<i16> = data
                        .iter()
                        .copied()
                        .map(normalize_u16_sample)
                        .collect();
                    let size = chunk.len() * std::mem::size_of::<i16>();
                    emit_chunk(&app, sample_rate, channels, size);
                    if let Ok(mut chunks) = RECORDING_CHUNKS.lock() {
                        chunks.push(chunk.clone());
                    }
                    write_pcm_chunk(&file_path_clone, &chunk);
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

    unsafe {
        let _lock = STREAM_MUTEX.lock();
        RECORDING_STREAM = Some(stream);
    }

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

#[tauri::command]
fn stop_recording() -> Result<String, String> {
    if !STREAM_RUNNING.load(Ordering::SeqCst) {
        return Err("Not recording".to_string());
    }

    let finished_recording = ACTIVE_RECORDING
        .lock()
        .map_err(|_| "Recording lock poisoned".to_string())?
        .take();

    unsafe {
        let _lock = STREAM_MUTEX.lock();
        RECORDING_STREAM = None;
    }

    STREAM_RUNNING.store(false, Ordering::SeqCst);

    if let Some(recording) = finished_recording.as_ref() {
        finalize_recording_file(recording)?;
    }

    if let Some(recording) = finished_recording {
        let chunks = RECORDING_CHUNKS
            .lock()
            .map_err(|_| "Recording chunk lock poisoned".to_string())?
            .clone();

        *LATEST_RECORDING
            .lock()
            .map_err(|_| "Latest recording lock poisoned".to_string())? = Some(RecordedAudio {
            file_path: recording.file_path,
            sample_rate: recording.sample_rate,
            channels: recording.channels,
            chunks,
        });
    }

    Ok("Recording stopped".to_string())
}

#[tauri::command]
fn play_recorded() -> Result<String, String> {
    let file_path = std::fs::read_dir("/tmp")
        .ok()
        .and_then(|entries| {
            entries
                .filter_map(|entry| entry.ok())
                .filter(|entry| entry.file_name().to_string_lossy().starts_with("voicestream_"))
                .max_by_key(|entry| entry.metadata().ok().and_then(|metadata| metadata.modified().ok()))
        })
        .map(|entry| entry.path())
        .ok_or("No recording found")?;

    let host = cpal::default_host();
    let device = host.default_output_device().ok_or("No output device")?;
    let config = device
        .default_output_config()
        .map_err(|e| format!("Config error: {}", e))?;
    let output_config: cpal::StreamConfig = config.clone().into();

    let samples = if let Some(recording) = LATEST_RECORDING
        .lock()
        .map_err(|_| "Latest recording lock poisoned".to_string())?
        .clone()
    {
        if recording.file_path == file_path.to_string_lossy() {
            prepare_playback_from_chunks(
                &recording.chunks,
                recording.sample_rate,
                recording.channels,
                config.sample_rate().0,
                config.channels(),
            )
        } else {
            let decoded = parse_wav_file(&file_path)?;
            prepare_playback_samples(decoded, config.sample_rate().0, config.channels())
        }
    } else {
        let decoded = parse_wav_file(&file_path)?;
        prepare_playback_samples(decoded, config.sample_rate().0, config.channels())
    };

    let total_samples = samples.len();
    let samples = Arc::new(samples);
    let index = Arc::new(AtomicUsize::new(0));
    let playing = Arc::new(AtomicBool::new(true));

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

    unsafe {
        let _lock = STREAM_MUTEX.lock();
        PLAYBACK_STREAM = Some(stream);
    }

    Ok(format!(
        "Playing: {} samples from {}",
        total_samples,
        file_path.display()
    ))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            play_recorded,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
