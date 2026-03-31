# Voice Activity Detection (VAD)

## Problem Statement

Currently, the app sends **all audio frames** to the STT provider continuously while the user holds the hotkey. This approach:

- Sends silent audio to STT, wasting API quota
- No smart detection of speech boundaries
- Relies on manual hotkey release to stop recording

## What is VAD

VAD (Voice Activity Detection) determines whether an audio chunk contains human speech or is silence/noise.

```
Microphone stream → split into 30ms chunks → VAD classifier → 
  speech detected → start accumulating buffer
  silence > X ms → truncate and send to STT
```

## Solution Options

### Option 1: @ricky0123/vad-web (Browser-side)

- Package: `@ricky0123/vad-web` (wraps Silero ONNX model)
- Size: ~5MB (ONNX model)
- Latency: ~20ms
- Pros: Simple JS API, direct browser integration
- Cons: Runs in WebView, slight overhead

```ts
import { MicVAD } from '@ricky0123/vad-web'

const vad = await MicVAD.new({
  onSpeechStart: () => console.log('speech started'),
  onSpeechEnd: (audio: Float32Array) => sendToSTT(audio),
  positiveSpeechThreshold: 0.8,
  minSpeechFrames: 3,
})
vad.start()
```

### Option 2: silero-vad-rust (Rust backend)

- Crate: `silero-vad-rust` (MIT licensed)
- Size: ~5MB (bundled ONNX model)
- Latency: <1ms
- Pros: Native integration with existing audio pipeline, lowest latency
- Cons: Requires Rust integration work

```rust
use silero_vad::VadIterator;

// In audio callback
fn audio_callback(samples: &[i16]) {
    let float_samples: Vec<f32> = samples.iter()
        .map(|s| *s as f32 / i16::MAX as f32)
        .collect();
    
    if vad.is_speech(&float_samples) {
        // accumulate to speech buffer
    } else {
        // count silence frames, trigger STT on threshold
    }
}
```

### Option 3: TEN-VAD

- Repo: TEN-framework/ten-vad
- Pros: Highest accuracy, commercial-grade
- Cons: Larger bundle, more complex integration

## Recommendation

**Use `silero-vad-rust`** for this project because:

1. Audio processing already lives in Rust (`lib.rs`)
2. Model size is small (~5MB) and loads once
3. Ultra-low latency (<1ms per chunk)
4. MIT license, no commercial restrictions
5. Silero powers Whisper's preprocessing - battle-tested

## Implementation Path

### Step 1: Add dependency

```toml
# Cargo.toml
silero-vad-rust = "0.5"
```

### Step 2: Initialize VAD

```rust
use silero_vad::VadIterator;

let mut vad = VadIterator::new(
    std::path::PathBuf::from("silero_vad.onnx"),
    silero_vad::VadParameters::default()
);
```

### Step 3: Integrate into audio callback

Modify the cpal input callback in `lib.rs`:

```rust
// Current: send every chunk to STT
// New: filter by VAD first

fn audio_callback(data: &[i16]) {
    let float_samples = normalize_to_float(data);
    
    if vad.is_speech(&float_samples) {
        // reset silence counter
        silence_frames = 0;
        // accumulate to buffer
        speech_buffer.extend_from_slice(data);
    } else {
        silence_frames += 1;
        if silence_frames > SILENCE_THRESHOLD && !speech_buffer.is_empty() {
            // trigger STT with accumulated audio
            send_to_stt(&speech_buffer);
            speech_buffer.clear();
        }
    }
}
```

### Step 4: Tune parameters

| Parameter | Recommended | Description |
|-----------|-------------|-------------|
| `min_speech_duration_ms` | 300 | Minimum speech to trigger (prevents false triggers) |
| `min_silence_duration_ms` | 500 | Silence duration to end speech segment |
| `window_size_ms` | 30 | Audio chunk size (matches current 16kHz mono) |

## Current vs Target Flow

### Current (no VAD)

```
User holds hotkey → start recording → stream ALL audio to STT
                    → User releases hotkey → stop recording → paste result
```

### With VAD

```
User holds hotkey → start recording → stream audio to VAD
                    → VAD detects speech → accumulate buffer
                    → VAD detects silence > 500ms → trigger STT early
                    → User releases hotkey → final STT → paste result
```

## Benefits

1. **Cost reduction**: Don't send silence to STT API
2. **Faster results**: STT can start before user releases hotkey
3. **Smarter truncation**: Automatically detect speech end
4. **Better UX**: App responds to actual speech, not just hotkey state

## Related

- [Silero VAD official repo](https://github.com/snakers4/silero-vad)
- [silero-vad-rust crate](https://crates.io/crates/silero-vad-rust)
- [ricky0123/vad-web](https://github.com/ricky0123/vad) (JS wrapper)