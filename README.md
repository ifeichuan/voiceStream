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
- hold `Cmd+Shift+Space` to start recording, release to stop
- audio chunks are downmixed to mono, resampled to 16 kHz PCM, and streamed to Bailian during recording
- when transcription finishes, the app pastes the final text into the currently focused app through the macOS clipboard + `Cmd+V` flow

Notes:

- automatic paste uses `osascript`, so macOS Accessibility permission may be required the first time

Related design docs:

- `docs/features/agent-mode-and-toggle-hotkey.md`
- `docs/features/macos-menubar-voice-input.md`

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
