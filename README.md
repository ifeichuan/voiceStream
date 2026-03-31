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
- audio chunks are downmixed to mono, resampled to 16 kHz PCM, and streamed to Bailian during recording
- partial and final transcripts are pushed back to the UI in realtime

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
