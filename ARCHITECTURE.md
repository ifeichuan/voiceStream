# VoiceStream Architecture

> **Just Speak. Get Things Done.**
> VoiceStream turns your voice into text, refined output, or background agent tasks on your Mac.

## Project Vision

VoiceStream 受到 [Typeless](https://typeless.so)、OpenTypeless 和 type4me 的启发。这些项目证明了语音可以用来润色文本输入——我们进一步思考：既然语音可以润色，为什么不能用语音来执行任务？

基于不重复造轮子的理念，VoiceStream 复用本机现有的 Coding CLI 作为 AI 后端。目前以 Pi 作为第一方支持，因为它提供了最完整的扩展体系（工具调用、会话持久化、扩展加载）。

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Tauri 2 (Rust) |
| Frontend | React 19 + TypeScript + Vite 7 |
| Routing | TanStack Router |
| State | Zustand |
| Styling | Tailwind CSS 4 |
| Terminal | xterm.js |
| Audio | cpal (Rust) |
| PTY | portable-pty |
| Database | SQLite (rusqlite) |
| AI Backend | Pi CLI (JSON-RPC) |
| Native UI | macOS AppKit (objc2) |

## Core Modes

### 1. Dictation Mode

全局快捷键触发的语音听写，转录后经 AI 润色直接粘贴到光标位置。

```
Cmd+Shift+Space → Mic capture → WebSocket STT → Pi refine → Clipboard → Cmd+V paste
```

**交互模式：**
- 短按（< 220ms）：锁定录音，再按停止
- 长按：松手即停止

**Pi 配置（dictation-fast）：** 禁用工具/扩展/技能，纯 system prompt 文本整理，最低延迟。

### 2. Agent Mode

用语音下达任务指令，Pi 以完整 agent session 执行。

```
Cmd+Shift+A → Mic capture → STT → Create AgentTask → Pi agent session (with tools) → Notify
```

**特性：**
- 完整工具调用能力
- 会话持久化（.jsonl）
- voicestream-notify 扩展：任务完成后 AI 生成摘要 + macOS `say` 语音播报
- 前端终端实时查看 agent 输出

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    macOS Global Shortcuts                 │
│              (tauri-plugin-global-shortcut)               │
└──────────────┬────────────────────────┬──────────────────┘
               │                        │
       Cmd+Shift+Space           Cmd+Shift+A
               │                        │
               ▼                        ▼
┌──────────────────────┐   ┌──────────────────────────────┐
│   Dictation Flow     │   │       Agent Flow              │
│                      │   │                               │
│  ┌────────────────┐  │   │  ┌────────────────────────┐  │
│  │  cpal capture  │  │   │  │     cpal capture       │  │
│  └───────┬────────┘  │   │  └───────────┬────────────┘  │
│          │           │   │              │                │
│          ▼           │   │              ▼                │
│  ┌────────────────┐  │   │  ┌────────────────────────┐  │
│  │ Resample 16kHz │  │   │  │   Resample 16kHz       │  │
│  └───────┬────────┘  │   │  └───────────┬────────────┘  │
│          │           │   │              │                │
│          ▼           │   │              ▼                │
│  ┌────────────────┐  │   │  ┌────────────────────────┐  │
│  │  STT Provider  │  │   │  │     STT Provider       │  │
│  │  (WebSocket)   │  │   │  │     (WebSocket)        │  │
│  └───────┬────────┘  │   │  └───────────┬────────────┘  │
│          │           │   │              │                │
│          ▼           │   │              ▼                │
│  ┌────────────────┐  │   │  ┌────────────────────────┐  │
│  │ Pi RPC (fast)  │  │   │  │  Pi Agent Session      │  │
│  │ Text refine    │  │   │  │  (tools + extensions)  │  │
│  └───────┬────────┘  │   │  └───────────┬────────────┘  │
│          │           │   │              │                │
│          ▼           │   │              ▼                │
│  ┌────────────────┐  │   │  ┌────────────────────────┐  │
│  │ Clipboard +    │  │   │  │  Notify (say + HUD)    │  │
│  │ Cmd+V paste    │  │   │  │  + voicestream-notify  │  │
│  └────────────────┘  │   │  └────────────────────────┘  │
└──────────────────────┘   └──────────────────────────────┘
               │                        │
               ▼                        ▼
┌─────────────────────────────────────────────────────────┐
│              Native HUD (NSPanel + GlassEffect)          │
│         Real-time transcript + waveform animation        │
└─────────────────────────────────────────────────────────┘
```

## STT Providers

支持 6 家实时语音识别服务，统一 `SttProvider` trait 接口：

| Provider | Protocol | Default Sample Rate | Notes |
|----------|----------|-------------------|-------|
| 阿里云百炼 | WebSocket (custom JSON) | 16kHz | 默认提供商，中文优化 |
| Deepgram | WebSocket | 16kHz | nova-2 模型 |
| AssemblyAI | WebSocket | 16kHz | |
| Soniox | WebSocket | 16kHz | |
| Gladia | HTTPS → WebSocket | 16kHz | 需要先 HTTP 握手获取 WS URL |
| OpenAI Realtime | WebSocket | 24kHz | whisper-1 |

## Native HUD (macOS)

浮动毛玻璃状态面板，使用 macOS 原生 API：

- `NSPanel` + `NSGlassEffectView` 实现毛玻璃效果
- `NSStatusWindowLevel` 悬浮在所有窗口之上
- 7 根波形柱状动画，响应麦克风音量电平
- 实时显示转录文本（已确认 + 临时部分）
- 四种状态：Recording（蓝）、Processing（黄）、Success（绿）、Error（红）
- 动态宽度，弹出/收起动画

## Pi Integration

通过 JSON-RPC 协议与本地 `pi` CLI 通信：

**DictationFast 模式：**
- 启动 pi 进程（支持复用）
- 发送 prompt（转录文本 + system prompt）
- 等待响应 → 返回润色文本
- 超时：60s

**AgentSession 模式：**
- 完整 agent 会话，带工具调用
- 会话持久化到 `.pi/sessions/` 目录
- 加载 voicestream-notify 扩展
- 超时：30 分钟

**配置优先级：** 环境变量 > app-settings.json > ~/.pi/agent/settings.json

## Data Persistence

### SQLite (`voicestream.db`)

```sql
templates       -- 5 个内置 prompt 模板（default/light/structured/official-lite/list-friendly）
dictations      -- 听写历史
agent_sessions  -- Agent 任务记录（从旧版 JSON 自动迁移）
schema_version  -- 迁移版本追踪
```

### JSON (`app-settings.json`)

存储 STT/Pi/Agent/快捷键设置，文件权限 0600 保护 API key。

## Frontend Pages

| Page | Purpose |
|------|---------|
| Overview | 主界面，WebGL2 shader orb 动画 + 最近转录 |
| Agent | 任务列表 + xterm.js 终端 + session 详情 |
| RPC Terminal | Pi RPC 调试工具（TTFT/token 计量） |
| Activity | 通知、转录历史、系统日志 |
| Settings Dialog | 语音识别 / Pi / 快捷键 三个 tab |

## Key Design Decisions

1. **复用而非重建：** 不自建 AI agent，复用本机 Pi CLI 的完整能力
2. **原生体验：** macOS 原生 HUD 而非 web overlay，全局快捷键而非窗口内操作
3. **流式优先：** STT 全部走 WebSocket 流式，实时反馈
4. **多提供商：** STT 支持 6 家，Pi 支持任意 LLM provider
5. **最小延迟：** dictation-fast 模式禁用一切非必要功能
6. **语音闭环：** 任务完成后通过 macOS `say` 语音播报，无需看屏幕

## File Structure

```
src-tauri/src/
├── lib.rs              # Tauri 入口，录音/快捷键/粘贴核心逻辑
├── audio.rs            # PCM 重采样/声道转换
├── stt.rs              # STT 统一接口 + 阿里云百炼实现
├── stt_providers/      # Deepgram/AssemblyAI/Soniox/Gladia/OpenAI
├── pi_rpc.rs           # Pi JSON-RPC 通信
├── agent_tasks.rs      # Agent 任务管理
├── agent_terminal.rs   # Agent PTY 终端
├── rpc_terminal.rs     # RPC 调试终端
├── native_hud.rs       # macOS 原生浮动 HUD
├── settings.rs         # 设置读写/迁移
└── db.rs               # SQLite schema/迁移/模板

src/
├── pages/              # Overview, Agent, RpcTerminal, Activity, Speech, Pi, Shortcuts
├── stores/             # Zustand stores (recording, settings, agent, logs)
├── components/         # ShaderOrb, SettingsDialog, WaveformAnimation, Icons
├── hooks/              # useTauriEvents (全局事件订阅)
├── lib/                # constants, utils, agentTerminalBridge
└── routes/             # TanStack Router 路由定义

pi-extensions/
└── voicestream-notify.ts  # Pi 扩展：AI 摘要 + 语音播报
```
