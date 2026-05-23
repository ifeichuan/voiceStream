# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Realtime STT

The app now includes a minimal realtime STT provider backed by Aliyun Bailian WebSocket ASR.

Configure it from the in-app Settings panel:

- API Key
- API Endpoint
- Model
- Workspace ID (optional)

The settings are stored locally in the app support directory as `credentials.json`.
On Unix-like systems the file is written with `0600` permissions.

Current behavior:

- recording still uses the native Tauri audio pipeline
- `Cmd+Shift+Space` supports a hybrid interaction:
  - hold to talk, then release to stop
  - or tap once to latch recording, then press and release again to stop
- `Cmd+Shift+A` uses the same hybrid interaction to create an Agent background task instead of pasting into the focused app
- Agent tasks are shown in the in-app Agent page, persisted locally, and executed with one Pi session per task
- audio chunks are downmixed to mono, resampled to 16 kHz PCM, and streamed to Bailian during recording
- when transcription finishes, the app pastes the final text into the currently focused app through the macOS clipboard + `Cmd+V` flow
- the end-to-end pipeline emits timing logs with per-session IDs for recording, STT wait, optimize, paste, and total latency

Notes:

- automatic paste uses `osascript`, so macOS Accessibility permission may be required the first time

Related design docs:

- `docs/features/agent-mode-and-toggle-hotkey.md`
- `docs/features/macos-menubar-voice-input.md`

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
