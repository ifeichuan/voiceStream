//! macOS VoiceProcessing I/O capture (acoustic echo cancellation).
//!
//! Uses AVAudioEngine's voice-processing path so audio played from the
//! output device is subtracted from the microphone before it reaches STT.

use std::ptr::NonNull;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2_avf_audio::{
    AVAudioEngine, AVAudioPCMBuffer, AVAudioTime,
    AVAudioVoiceProcessingOtherAudioDuckingConfiguration,
    AVAudioVoiceProcessingOtherAudioDuckingLevel,
};
use objc2_foundation::NSError;
use tauri::AppHandle;

use crate::audio::normalize_f32_sample;

static mut SESSION: Option<Retained<AVAudioEngine>> = None;

pub fn start(app: AppHandle) -> Result<(u32, u16, String), String> {
    stop();

    let engine = unsafe { AVAudioEngine::new() };
    let input = unsafe { engine.inputNode() };
    let _output = unsafe { engine.outputNode() };

    unsafe {
        input
            .setVoiceProcessingEnabled_error(true)
            .map_err(|error| format_nserror("enable voice processing", &error))?;
        input.setVoiceProcessingOtherAudioDuckingConfiguration(
            AVAudioVoiceProcessingOtherAudioDuckingConfiguration {
                enableAdvancedDucking: Bool::from(false),
                duckingLevel: AVAudioVoiceProcessingOtherAudioDuckingLevel::Min,
            },
        );
    }

    let format = unsafe { input.outputFormatForBus(0) };
    let sample_rate = unsafe { format.sampleRate() }.round() as u32;
    let channels = unsafe { format.channelCount() } as u16;
    if sample_rate == 0 || channels == 0 {
        return Err("Voice processing returned an invalid audio format".to_string());
    }

    let file_path = crate::setup_recording_session(&app, sample_rate, channels)?;
    let file_path_for_tap = file_path.clone();

    let tap = RcBlock::new(move |buffer: NonNull<AVAudioPCMBuffer>, _: NonNull<AVAudioTime>| {
        let Some(chunk) = (unsafe { pcm_buffer_to_i16(buffer.as_ref()) }) else {
            return;
        };
        crate::process_recording_chunk(&app, &file_path_for_tap, sample_rate, channels, chunk);
    });

    unsafe {
        input.installTapOnBus_bufferSize_format_block(
            0,
            4096,
            Some(&format),
            RcBlock::as_ptr(&tap) as *mut _,
        );
        engine.prepare();
    }
    drop(tap);

    if let Err(error) = unsafe { engine.startAndReturnError() } {
        unsafe {
            input.removeTapOnBus(0);
            engine.stop();
        }
        crate::abort_recording_session();
        return Err(format_nserror("start voice-processing engine", &error));
    }

    replace_session(Some(engine));
    Ok((sample_rate, channels, file_path))
}

pub fn stop() {
    replace_session(None);
}

fn replace_session(next: Option<Retained<AVAudioEngine>>) {
    let _guard = crate::STREAM_SLOT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let previous = unsafe { std::ptr::replace(std::ptr::addr_of_mut!(SESSION), next) };
    if let Some(engine) = previous {
        teardown(engine);
    }
}

fn teardown(engine: Retained<AVAudioEngine>) {
    let input = unsafe { engine.inputNode() };
    unsafe {
        input.removeTapOnBus(0);
        engine.stop();
    }
}

fn format_nserror(context: &str, error: &NSError) -> String {
    format!("{context}: {}", error.localizedDescription())
}

unsafe fn pcm_buffer_to_i16(buffer: &AVAudioPCMBuffer) -> Option<Vec<i16>> {
    let format = buffer.format();
    let frames = buffer.frameLength() as usize;
    let channels = format.channelCount() as usize;
    if frames == 0 || channels == 0 {
        return None;
    }

    let stride = buffer.stride();
    let float_channels = buffer.floatChannelData();
    if !float_channels.is_null() {
        let channel_ptrs = std::slice::from_raw_parts(float_channels, channels);
        let mut out = Vec::with_capacity(frames * channels);
        for frame in 0..frames {
            for channel in 0..channels {
                let sample = *channel_ptrs[channel].as_ptr().add(frame * stride);
                out.push(normalize_f32_sample(sample));
            }
        }
        return Some(out);
    }

    let int16_channels = buffer.int16ChannelData();
    if !int16_channels.is_null() {
        let channel_ptrs = std::slice::from_raw_parts(int16_channels, channels);
        let mut out = Vec::with_capacity(frames * channels);
        for frame in 0..frames {
            for channel in 0..channels {
                out.push(*channel_ptrs[channel].as_ptr().add(frame * stride));
            }
        }
        return Some(out);
    }

    None
}
