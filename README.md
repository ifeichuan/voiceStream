# VoiceStream

**Speak into any app. Delegate when needed.**

[简体中文](./README.zh-CN.md)

VoiceStream is a macOS-focused voice input prototype. Press a global shortcut,
speak, and the app turns your speech into clean text for the currently focused
app. When your words are a task, use Agent mode to hand it off to a background
Pi session and get notified when it finishes.

> Status: active prototype. The current implementation targets macOS and local
> development, not a packaged public release.

## Why VoiceStream

Most voice tools ask you to open a separate app, dictate there, then copy the
result back. VoiceStream keeps the interaction where your cursor already is.

It is built around two paths:

- **Dictation**: speech becomes refined text and is pasted into the focused app.
- **Agent**: speech becomes a background task that runs in a local Pi session.

## References

VoiceStream takes inspiration from these voice input products and projects:

- [Typeless](https://www.typeless.com/)
- [Type4Me](https://github.com/joewongjc/type4me)

## Features

- Global dictation shortcut: `Cmd+Shift+Space`
- Separate Agent shortcut: `Cmd+Shift+A`
- Hold-to-talk and tap-to-latch recording
- Native audio capture through Rust/Tauri
- Streaming STT through Aliyun Bailian
- Native macOS HUD capsule for recording, processing, success, and error states
- Pi-based text refinement before paste
- Automatic paste through clipboard + `Cmd+V`
- Local Agent task history
- Embedded terminal for Agent sessions
- macOS notifications for Agent completion and failure
- Local settings with clearable API keys

## How It Works

```mermaid
flowchart LR
  A[Global shortcut] --> B[Native audio capture]
  B --> C[Streaming STT]
  C --> D{Mode}
  D -->|Dictation| E[Pi text refinement]
  E --> F[Paste into focused app]
  D -->|Agent| G[Create local Agent task]
  G --> H[Run Pi session]
  H --> I[Notify when done]
```

## Quick Start

### Prerequisites

- macOS
- Node.js and `pnpm`
- Rust toolchain
- Tauri prerequisites
- Aliyun Bailian realtime STT credentials
- Local Pi CLI for text refinement and Agent mode
- macOS Accessibility permission for automatic paste

Behavior outside macOS is `uncertain`; this prototype depends on macOS audio,
global shortcuts, HUD, clipboard, paste, and notification flows.

### Install

```bash
pnpm install
```

### Run

```bash
pnpm tauri dev
```

### Configure

Open the app settings panel and configure:

- Aliyun Bailian API key
- STT endpoint
- STT model
- optional workspace ID
- Pi provider/model overrides if needed

The app stores settings in `app-settings.json` under the app support directory.
Older `credentials.json` files are migrated when possible. On Unix-like systems,
the settings file is written with `0600` permissions.

## Usage

| Shortcut | Mode | What happens |
| --- | --- | --- |
| `Cmd+Shift+Space` | Dictation | Record speech, stream STT, refine text, paste into the focused app |
| `Cmd+Shift+A` | Agent | Record a spoken task, create a background Agent session, notify on completion |

Both shortcuts support two recording styles:

- Hold the shortcut to record, release to stop.
- Tap once to latch recording, then press/release again to stop.

The dictation shortcut is fixed in the current UI. The Agent shortcut can be
changed from the Shortcuts page and saved locally.

## Configuration

| Area | What it controls |
| --- | --- |
| STT | API key, endpoint, model, workspace ID |
| Pi | mode, provider, model, process reuse, prompt template, provider override JSON |
| Shortcuts | Agent shortcut |
| Local Pi reference | read-only `~/.pi/agent/settings.json` and `~/.pi/agent/models.json` |

The raw local Pi files are displayed as reference data only. VoiceStream does
not directly edit them.

## Development

```bash
pnpm build
scripts/voicestream-dev.sh dev-fast
scripts/voicestream-dev.sh dev-agent
scripts/voicestream-dev.sh cargo-check
scripts/voicestream-dev.sh test-pi-rpc
```

The helper script defaults to:

- `VOICESTREAM_PI_PROVIDER=aliyun-bailian`
- `VOICESTREAM_PI_MODEL=qwen3.5-flash`
- `VOICESTREAM_PI_MODE=dictation-fast`

These values can be overridden with environment variables.

## Project Structure

```text
src/
  App.tsx                 React management panel
  App.css                 global styling and Tailwind tokens
src-tauri/src/
  lib.rs                  Tauri commands, shortcuts, recording lifecycle
  audio.rs                native audio capture
  stt.rs                  Aliyun Bailian streaming STT
  native_hud.rs           native macOS HUD capsule
  pi_rpc.rs               Pi RPC integration
  agent_tasks.rs          local Agent task store and session parsing
  agent_terminal.rs       embedded Agent PTY bridge
  settings.rs             app settings and Pi config mapping
pi-extensions/            bundled Pi extensions
scripts/                  development helpers
docs/                     product, feature, and technical notes
```

## Documentation

- [macOS menu-bar voice input](./docs/features/macos-menubar-voice-input.md)
- [Agent mode and toggle hotkey](./docs/features/agent-mode-and-toggle-hotkey.md)
- [HUD capsule](./docs/features/hud-capsule.md)
- [Prompt design](./docs/prompt-design.md)
- [VAD notes](./docs/tech/vad.md)
- [Desktop surface spec](./docs/specs/voice-workbench-layout.md)

## Known Limitations

- The app is a prototype and is not yet documented as a packaged public release.
- The primary supported platform is macOS.
- Automatic paste may require Accessibility permission.
- STT requires Aliyun Bailian configuration.
- Pi refinement and Agent mode require a working local Pi CLI.
- Real frontend amplitude behavior should not be assumed unless verified from
  runtime events; if unavailable, amplitude behavior is `uncertain`.

## License

No license file is currently present in this repository.
