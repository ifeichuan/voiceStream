use crate::audio::convert_chunk_to_pcm16;
use crate::stt::{
    mark_runtime_error, mark_runtime_finished, push_final_transcript,
    update_partial_transcript, SttProvider, PROVIDER_LOCAL_ZIPFORMER,
};
use crate::stt_providers::{emit_status, emit_transcript};
use std::thread;
use tauri::AppHandle;
use tokio::sync::mpsc as tokio_mpsc;

const TARGET_SAMPLE_RATE: u32 = 16_000;
const TARGET_CHANNELS: u16 = 1;

enum Cmd {
    Audio { pcm: Vec<i16>, sample_rate: u32, channels: u16 },
    Finish,
}

pub struct LocalZipformerSttProvider {
    sender: tokio_mpsc::UnboundedSender<Cmd>,
}

impl SttProvider for LocalZipformerSttProvider {
    fn push_chunk(&self, pcm: Vec<i16>, sample_rate: u32, channels: u16) -> Result<(), String> {
        self.sender
            .send(Cmd::Audio { pcm, sample_rate, channels })
            .map_err(|_| "Local Zipformer session closed".to_string())
    }

    fn finish(&self) -> Result<(), String> {
        self.sender
            .send(Cmd::Finish)
            .map_err(|_| "Local Zipformer session closed".to_string())
    }
}

impl LocalZipformerSttProvider {
    pub fn new(app: AppHandle, model_dir: String) -> Result<Self, String> {
        let (sender, receiver) = tokio_mpsc::unbounded_channel();

        // Validate model files exist
        let model_path = std::path::PathBuf::from(&model_dir);
        if !model_path.exists() {
            return Err(format!("Model directory not found: {}", model_dir));
        }

        let encoder = find_model_file(&model_path, "encoder")?;
        let decoder = find_model_file(&model_path, "decoder")?;
        let joiner = find_model_file(&model_path, "joiner")?;
        let tokens = model_path.join("tokens.txt");
        if !tokens.exists() {
            return Err("tokens.txt not found in model directory".to_string());
        }

        emit_status(&app, PROVIDER_LOCAL_ZIPFORMER, "loading model");

        // Spawn a dedicated thread for sherpa-onnx (it's not async-safe)
        let app_clone = app.clone();
        thread::spawn(move || {
            run_recognition(
                app_clone,
                receiver,
                encoder.to_string_lossy().to_string(),
                decoder.to_string_lossy().to_string(),
                joiner.to_string_lossy().to_string(),
                tokens.to_string_lossy().to_string(),
            );
        });

        Ok(Self { sender })
    }
}

/// Find a model file matching a prefix (e.g. "encoder") in the model directory.
fn find_model_file(dir: &std::path::Path, prefix: &str) -> Result<std::path::PathBuf, String> {
    // Prefer int8 quantized version
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Cannot read model dir: {}", e))?;

    let mut candidates: Vec<std::path::PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().unwrap_or_default().to_string_lossy();
            name.starts_with(prefix) && name.ends_with(".onnx")
        })
        .collect();

    // Sort to prefer int8 versions
    candidates.sort_by(|a, b| {
        let a_int8 = a.to_string_lossy().contains("int8");
        let b_int8 = b.to_string_lossy().contains("int8");
        b_int8.cmp(&a_int8)
    });

    candidates
        .into_iter()
        .next()
        .ok_or_else(|| format!("No {}.*.onnx file found in model directory", prefix))
}

/// Run the recognition loop on a dedicated thread.
fn run_recognition(
    app: AppHandle,
    mut receiver: tokio_mpsc::UnboundedReceiver<Cmd>,
    encoder: String,
    decoder: String,
    joiner: String,
    tokens: String,
) {
    use sherpa_onnx::{OnlineRecognizer, OnlineRecognizerConfig};

    let mut config = OnlineRecognizerConfig::default();
    config.model_config.transducer.encoder = Some(encoder);
    config.model_config.transducer.decoder = Some(decoder);
    config.model_config.transducer.joiner = Some(joiner);
    config.model_config.tokens = Some(tokens);
    config.model_config.provider = Some("cpu".to_string());
    config.model_config.num_threads = 2;
    config.model_config.debug = false;
    config.enable_endpoint = true;
    config.decoding_method = Some("greedy_search".to_string());
    // Endpoint detection rules
    config.rule1_min_trailing_silence = 2.4; // seconds of silence to end utterance
    config.rule2_min_trailing_silence = 1.2; // seconds after partial result
    config.rule3_min_utterance_length = 20.0; // max utterance length

    let recognizer = match OnlineRecognizer::create(&config) {
        Some(r) => r,
        None => {
            mark_runtime_error("Failed to create local recognizer. Check model files.");
            emit_status(&app, PROVIDER_LOCAL_ZIPFORMER, "error: model load failed");
            return;
        }
    };

    let stream = recognizer.create_stream();
    emit_status(&app, PROVIDER_LOCAL_ZIPFORMER, "listening");

    let mut last_text = String::new();

    loop {
        // Block on receiving the next command
        let cmd = match receiver.blocking_recv() {
            Some(cmd) => cmd,
            None => break, // channel closed
        };

        match cmd {
            Cmd::Audio { pcm, sample_rate, channels } => {
                let pcm_bytes = convert_chunk_to_pcm16(
                    &pcm, sample_rate, channels,
                    TARGET_SAMPLE_RATE, TARGET_CHANNELS,
                );
                if pcm_bytes.is_empty() {
                    continue;
                }

                // Convert bytes back to f32 samples for sherpa-onnx
                let samples: Vec<f32> = pcm_bytes
                    .chunks_exact(2)
                    .map(|chunk| {
                        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
                        sample as f32 / i16::MAX as f32
                    })
                    .collect();

                stream.accept_waveform(TARGET_SAMPLE_RATE as i32, &samples);

                // Decode as much as possible
                while recognizer.is_ready(&stream) {
                    recognizer.decode(&stream);
                }

                // Check for partial results
                if let Some(result) = recognizer.get_result(&stream) {
                    let text = result.text.trim().to_string();
                    if !text.is_empty() && text != last_text {
                        last_text = text.clone();
                        update_partial_transcript(&text);
                        emit_transcript(&app, &text, false);
                    }
                }

                // Check for endpoint (utterance boundary)
                if recognizer.is_endpoint(&stream) {
                    if let Some(result) = recognizer.get_result(&stream) {
                        let text = result.text.trim().to_string();
                        if !text.is_empty() {
                            push_final_transcript(&text);
                            emit_transcript(&app, &text, true);
                        }
                    }
                    last_text.clear();
                    recognizer.reset(&stream);
                }
            }
            Cmd::Finish => {
                // Feed tail padding for final decode
                let tail_padding = vec![0.0f32; (TARGET_SAMPLE_RATE as f32 * 0.3) as usize];
                stream.accept_waveform(TARGET_SAMPLE_RATE as i32, &tail_padding);
                stream.input_finished();

                while recognizer.is_ready(&stream) {
                    recognizer.decode(&stream);
                }

                if let Some(result) = recognizer.get_result(&stream) {
                    let text = result.text.trim().to_string();
                    if !text.is_empty() {
                        push_final_transcript(&text);
                        emit_transcript(&app, &text, true);
                    }
                }

                break;
            }
        }
    }

    mark_runtime_finished();
    emit_status(&app, PROVIDER_LOCAL_ZIPFORMER, "closed");
}

/// Test that model files exist and can be loaded.
pub fn test_model(model_dir: &str) -> Result<String, String> {
    let model_path = std::path::PathBuf::from(model_dir);
    if !model_path.exists() {
        return Err(format!("Model directory not found: {}", model_dir));
    }

    let _encoder = find_model_file(&model_path, "encoder")?;
    let _decoder = find_model_file(&model_path, "decoder")?;
    let _joiner = find_model_file(&model_path, "joiner")?;

    let tokens = model_path.join("tokens.txt");
    if !tokens.exists() {
        return Err("tokens.txt not found in model directory".to_string());
    }

    Ok("Local model files verified".to_string())
}
