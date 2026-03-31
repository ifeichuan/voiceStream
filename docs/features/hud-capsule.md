# HUD Capsule Feature

## Goal

Define the visual and behavior contract for the floating dictation capsule so implementation can be tightened without guessing.

This document now serves two purposes:

- preserve the native macOS reference spec
- record the current implementation rules that were validated in the Tauri prototype

## Core Intent

The HUD should feel like a lightweight macOS dictation capsule:

- small
- quiet
- precise
- bottom-centered
- transient

It must never read like a debug overlay or a separate window frame.

## Visual Requirements

### Overall Shape

- The HUD is a single capsule only.
- No outer rectangular container.
- No visible window frame.
- No extra padding zone around the capsule.
- Corner radius should fully read as a pill shape.

### Size

- Target capsule height: `56px`.
- Target corner radius: `28px`.
- Target transcript text size: approximately `14px`.
- The whole component should still read as compact and dense, even with the 56px outer height.
- Horizontal padding should be tight enough that the capsule feels precise, not roomy.

### Typography

- Main transcript text is the visual focus.
- Transcript text size target: `14px`.
- No visible shortcut hint inside the capsule in normal operation.
- No secondary instructional copy such as “Hold Cmd+Shift+Space”.
- Status text should only appear when needed, and should be minimal.

### Background and Surface

- Background should be a refined translucent dark HUD material.
- No heavy border treatment.
- Shadow should be soft and restrained.
- The capsule should feel integrated with macOS, not like a web card.
- Native reference material is `.hudWindow`.

## Layout Requirements

### Position

- The capsule must appear at the bottom center of the primary display.
- It should sit close to the bottom edge, with a small safe margin.
- It must not appear in the middle or upper half of the screen.

### Content Structure

- Left: compact waveform block sized approximately `44×32px`.
- Right: transcript text.
- The waveform and text should be tightly aligned vertically.
- The text region should expand elastically as needed.
- The transcript width range should stay roughly within `160px` to `560px`.

## Waveform Requirements

- The waveform must always feel alive during recording.
- It must not look frozen.
- It should use multiple narrow vertical bars rather than a few thick bars.
- The center bars should read taller than the outer bars.
- Motion should remain subtle when input is quiet.
- Speaking should visibly increase amplitude.
- Animation should feel smooth and organic, not mechanical.
- Bars must be driven by real RMS input, not purely decorative animation.
- Peak amplitude should be able to visually reach roughly `80%` of the capsule height.

Envelope targets:

- attack `40%`
- release `15%`

Organic variance:

- add `±4%` jitter per bar

Recommended relative weighting:

- `[0.5, 0.8, 1.0, 0.75, 0.55]`

Current prototype note:

- the current native HUD uses a denser multi-bar treatment instead of the original 5-bar sketch because it reads more like a macOS dictation meter at small sizes

## Behavior Requirements

### During Recording

- Show immediately when recording starts.
- Display live transcript updates when available.
- Display animated waveform continuously while recording.
- Entry animation target: `0.35s` spring.

Transcript display contract during recording:

- The HUD should not replace the full line with every new streaming hypothesis.
- Instead it should display `finalized + partial`.
- `finalized` means committed transcript text.
- `partial` means the actively changing tail.
- `finalized` should be visually distinguished with a subtle underline.
- `partial` should remain unlined so the user can tell it is still provisional.

Stability rules:

- During recording, HUD width may grow with text but should not immediately shrink on shorter intermediate hypotheses.
- After release, the HUD must not re-enter the recording visual state because of late STT chunks.
- If the STT provider delays final sentence boundaries, the HUD may promote a stable common prefix of repeated partials into the visually confirmed segment.
- This early confirmation is visual-only and must not change the final pasted transcript logic.

### After Recording Ends

- If transcription is still being finalized, the capsule may briefly remain visible.
- Once final text is pasted successfully, the capsule should auto-dismiss.
- Dismissal should happen automatically without user action.
- Post-paste linger should be short.
- Exit animation target: `0.22s` scale-out.

### While Text Changes

- Capsule width should adapt smoothly as text grows.
- Width transition target: `0.25s`.
- Width should not jitter because of partial transcript rewrites.

### Error State

- Error presentation should still use the same capsule shell.
- Error state should not expand into a large alert-like panel.
- Error message should remain concise.

## Non-Goals

- Showing shortcut help in the capsule.
- Large onboarding copy inside the HUD.
- Debug-style status chrome.
- Oversized spacing for “breathing room”.

## Immediate Follow-up Tasks

- Reduce capsule height and internal padding.
- Remove shortcut hint from HUD body.
- Lock positioning to bottom center of primary display.
- Ensure the waveform animates continuously while recording.
- Auto-hide after successful paste.

## Current Implementation Notes

The current Rust/AppKit HUD implementation in the prototype follows these additional rules:

- Use a native macOS panel-based HUD, not a Tauri webview overlay.
- Keep the capsule anchored to the bottom center of the main display.
- Reuse the same visible HUD instance across recording, processing, success, and error states.
- Do not replay the full entry animation when only the state changes.
- Hide the underline completely when there is no confirmed text, to avoid stray white line artifacts.
- After successful paste, show the success state briefly and then auto-dismiss.
