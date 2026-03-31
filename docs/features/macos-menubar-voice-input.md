# macOS Menu-Bar Voice Input Reference

## Purpose

This document captures the target product shape we are aligning toward.

It is based on the native macOS reference spec and should be treated as the north-star behavior, even if the current implementation reaches it incrementally.

## Product Model

- macOS-only
- menu-bar app
- `LSUIElement` app
- no Dock icon
- voice-to-text dictation workflow
- optimized for Chinese by default

## Primary Interaction

- Hold `Fn` to record
- Release `Fn` to stop recording
- Inject final transcribed text into the currently focused input field
- `Fn` must be globally monitored with `CGEvent tap`
- `Fn` event should be suppressed so the emoji picker is not triggered

## Recognition

- Preferred transcription mode: streaming recognition
- Preferred engine: Apple Speech Recognition framework
- Default language: `zh-CN`
- Menu bar must provide language switching:
  - English
  - Simplified Chinese
  - Traditional Chinese
  - Japanese
  - Korean
- Selected language is stored in `UserDefaults`

## Floating Capsule HUD

- Appears while recording
- Bottom center of the screen
- Frameless
- No titlebar
- No traffic lights
- Native reference:
  - `NSPanel`
  - `nonactivatingPanel`
  - `NSVisualEffectView`
  - `.hudWindow` material

### Capsule Visual Contract

- Height: `56px`
- Corner radius: `28px`
- Reads as a single capsule only
- No outer rectangular wrapper
- No debug chrome

### Waveform

- 5 vertical bars
- Visual block size: `44×32px`
- Driven by real-time audio RMS
- No fake hardcoded animation
- Louder speech produces larger bars
- Quiet speech still produces subtle movement
- Bar weights:
  - `[0.5, 0.8, 1.0, 0.75, 0.55]`
- Envelope smoothing:
  - attack `40%`
  - release `15%`
- Add `±4%` random jitter per bar for a more organic feel

### Transcript Area

- Real-time transcript shown on the right
- Elastic width range: `160px` to `560px`
- Capsule width should grow with transcript length

### Motion

- Entry spring animation: `0.35s`
- Text width transition: `0.25s`
- Exit scale animation: `0.22s`

## Text Injection

- Use clipboard + simulated `Cmd+V`
- Before paste:
  - inspect current input source
  - if current input method is CJK, temporarily switch to ASCII input source
  - preferred ASCII source: `ABC` or `US`
- After paste:
  - restore previous input source
  - restore previous clipboard contents

## LLM Refinement

- Optional post-ASR refinement step
- Used mainly for mixed Chinese-English correction
- API shape: OpenAI-compatible
- Configurable fields:
  - API Base URL
  - API Key
  - Model

### Refinement Policy

- Corrections must be conservative
- Only fix obvious ASR mistakes
- Preserve already-correct content as-is
- Never rewrite for style
- Never polish
- Never remove content that appears valid

### Example corrections

- `配森` -> `Python`
- `杰森` -> `JSON`

## Menu Bar Controls

- Language submenu
- LLM Refinement submenu
- LLM enable/disable toggle
- Settings entry

## Settings Window

- API Base URL field
- API Key field
- Model field
- `Test` button
- `Save` button
- API Key field must support being fully cleared

## Recording Completion Flow

- Release `Fn`
- Stop recording
- If LLM refinement is enabled and configured:
  - show `Refining...`
  - wait for refined text
  - inject refined text
- Otherwise:
  - inject transcript directly

## Packaging

- Built with Swift Package Manager
- Provide `Makefile`
- Required targets:
  - `build`
  - `run`
  - `install`
  - `clean`
- Output should be a signed `.app` bundle

## Gap Note

The current repository is a Tauri prototype, not the final native Swift/AppKit app.

This document defines the target behavior we can reference while:

- refining the current prototype
- extracting UX constraints
- or later rebuilding the app natively on macOS
