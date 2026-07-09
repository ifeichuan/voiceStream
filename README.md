<div align="center">

<picture>
  <img alt="SpeakMore" src="src-tauri/icons/icon.png" width="128" height="128">
</picture>

### SpeakMore: 用语音驱动一切

**Just Speak. Get Things Done.**

在 Mac 上，用语音输入文字、润色内容、或在后台执行 Agent 任务。

<a href="./quick-start.md">快速开始</a> · <a href="./ARCHITECTURE.md">架构文档</a> · <a href="https://github.com/anthropics/speakmore/issues">Issues</a> · <a href="./docs">文档</a>

[![](https://img.shields.io/badge/platform-macOS-black?style=flat-square&logo=apple&logoColor=white)](https://github.com/anthropics/speakmore)
[![](https://img.shields.io/badge/license-MIT-white?labelColor=black&style=flat-square)](./LICENSE)
[![](https://img.shields.io/badge/tauri-2.0-369eff?labelColor=black&style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)
[![](https://img.shields.io/badge/rust-2021-c4f042?labelColor=black&style=flat-square&logo=rust&logoColor=white)](https://www.rust-lang.org)

灵感来源：<a href="https://www.typeless.com/">Typeless</a> · <a href="https://github.com/joewongjc/type4me">Type4Me</a>

[English](./README.en.md) / 中文

</div>

***

## 宣传视频

<div align="center">

[![SpeakMore 宣传视频](https://img.shields.io/badge/▶_观看宣传视频-Bilibili-00A1D6?style=for-the-badge&logo=bilibili&logoColor=white)](https://www.bilibili.com/video/BV1wYGo6cEic/?vd_source=c0c5db05014578f493b993d4b1d3e6fc)

</div>

***

## 项目说明

<details>
<summary><strong>Q: 关于 Commit 时间</strong></summary>

活动要求仓库的所有 Commit 时间在 2026 年 5 月 22 日至 5 月 25 日之间。本仓库复用的为22号前的提交 so。
</details>

<details>
<summary><strong>Q: 项目背景</strong></summary>

SpeakMore 是一个原先就存在的 repo，在本次活动的三天时间内（5.22–5.25）对其进行了功能完善和文档整理。
</details>

<details>
<summary><strong>Q: 代码复用情况</strong></summary>

复用的代码片段为活动前已有的整个仓库基础代码。此外，首页 ShaderOrb 动画参考了 [Reacticx Siri Orb](https://www.reacticx.com/docs/components/siri-orb) 组件的实现思路。
</details>

<details>
<summary><strong>Q: 引用的第三方库和框架</strong></summary>

**前端（package.json）：**
- [React 19](https://react.dev) + [React DOM](https://react.dev)
- [TanStack Router](https://tanstack.com/router) — 路由
- [Zustand](https://zustand.docs.pmnd.rs) — 状态管理
- [Motion](https://motion.dev) — 动画
- [xterm.js](https://xtermjs.org) — 终端渲染
- [Tailwind CSS 4](https://tailwindcss.com) — 样式
- [Vite 7](https://vite.dev) — 构建工具
- [@tauri-apps/api](https://tauri.app) — Tauri 前端 API
- [Geist Mono](https://vercel.com/font) — 字体

**后端（Cargo.toml）：**
- [Tauri 2](https://tauri.app) — 桌面框架
- [cpal](https://github.com/RustAudio/cpal) — 音频采集
- [tokio-tungstenite](https://github.com/snapview/tokio-tungstenite) — WebSocket
- [portable-pty](https://github.com/nickelc/portable-pty) — 伪终端
- [rusqlite](https://github.com/rusqlite/rusqlite) — SQLite
- [arboard](https://github.com/1Password/arboard) — 剪贴板
- [objc2](https://github.com/madsmtm/objc2) — macOS 原生 UI
</details>

***

## 概述

受 [Typeless](https://www.typeless.com/)、OpenTypeless 和 [Type4Me](https://github.com/joewongjc/type4me) 启发——SpeakMore 更进一步：既然语音可以润色文本，为什么不能用语音来执行任务？

基于不重复造轮子的理念，SpeakMore 复用本机现有的 Coding CLI 作为 AI 后端。目前以 Pi 作为第一方支持，因为它提供了最完整的扩展体系（工具调用、会话持久化、扩展加载）。

> **推荐配置：** 经实测，使用 DeepSeek V4 Flash + No Thinking 模式做文本润色，平均响应时间在 1–2 秒以内，非常适合高频短文本听写场景。国产模型在中文语境下表现尤为出色。

## 工作方式

| 模式 | 触发 | 效果 |
|------|------|------|
| **听写** | `Cmd+Shift+Space` | 语音 → 识别 → AI 润色 → 粘贴到光标位置 |
| **Agent** | `Cmd+Shift+A` | 语音 → 识别 → Pi agent 会话（带工具调用）→ 完成后通知 |

两种模式都会显示原生浮动 HUD，实时展示转录文本和波形动画。

---

## 首页

<p align="center">
  <img src="docs/index.png" width="720" alt="SpeakMore 首页" />
</p>

首页中央是一个 WebGL2 shader 动画球体，响应麦克风音量实时律动。下方展示最近的语音转录记录。底部显示当前快捷键配置——按下即可开始说话，无需任何额外操作。

---

## Agent 任务

<p align="center">
  <img src="docs/agent.png" width="720" alt="Agent 任务页面" />
</p>

用语音下达指令后，SpeakMore 会创建一个 Agent 任务并在后台执行。左侧是任务列表（含状态和时间戳），右侧是实时终端输出——你可以看到 Pi agent 正在执行什么操作、调用了哪些工具、产生了什么结果。任务完成后会通过 macOS `say` 语音播报摘要。

---

## 设置：语音识别

<p align="center">
  <img src="docs/setting_stt.png" width="720" alt="语音识别设置" />
</p>

支持 6 家实时语音识别服务商（阿里云百炼、Deepgram、AssemblyAI、Soniox、Gladia、OpenAI Realtime）。选择服务商后自动填充默认端点和模型，只需填入 API Key 即可使用。点击「测试 STT」可验证连接是否正常。

---

## 设置：Pi 模型

<p align="center">
  <img src="docs/setting_pi.png" width="720" alt="Pi 模型设置" />
</p>

Pi 设置分为两部分：

- **整理模式**：用于听写后的文本润色。可选择服务商、模型和推理等级。图中使用 DeepSeek V4 Flash 做快速整理。
- **Agent 模式**：用于语音 Agent 任务。可独立配置更强的模型（如 GPT-5.4），留空则跟随整理模式的配置。

SpeakMore 会自动读取本机 `~/.pi/agent/` 下的 `settings.json` 和 `models.json`，已配置的服务商和模型会直接出现在下拉列表中。

---

## 活动日志

<p align="center">
  <img src="docs/activity.png" width="720" alt="活动页面" />
</p>

活动页面分三个区域：

- **通知**：Agent 任务完成/失败的语音通知记录
- **转写**：所有语音转录的原始结果，可以看到 STT 识别出的完整文本
- **日志**：系统运行日志，包含 STT 连接状态、耗时统计（如 `stt_wait: 167ms`、`recording_to_stt_final: 29059ms`）等性能数据

---

## RPC 调试终端

<p align="center">
  <img src="docs/rpc-debug.png" width="720" alt="RPC 调试终端" />
</p>

开发者工具。直接与 Pi RPC 进程交互，可配置模型、推理等级、system prompt，发送 JSON-RPC 命令并查看原始响应流。底部显示性能指标：`prompt_ack`（Pi 接受 prompt）、`first_text_delta`（TTFT 首 token 延迟）、`message_end`（总耗时和 token 用量）。

---

## 功能特性

- **全局快捷键** — 在任何应用中触发，无需切换窗口
- **实时语音识别** — WebSocket 流式转录，支持 6 家服务商
- **AI 文本润色** — 纠正识别错误、补充标点、保留语气
- **Agent 任务** — 用语音指挥完整的 coding agent 在后台执行
- **原生 HUD** — macOS 毛玻璃浮动面板，实时显示转录内容
- **语音通知** — Agent 完成后通过 macOS `say` 朗读结果
- **多种 Prompt 模板** — 默认、轻量、结构化、官方精简、列表友好
- **自定义快捷键** — Agent 快捷键可自由捕获修改

## 系统要求

- macOS（原生 HUD 和辅助功能依赖）
- 本机安装 [Pi CLI](https://github.com/anthropics/pi)
- 至少一个 STT 服务商的 API Key
- 辅助功能权限（用于模拟粘贴）
- 麦克风权限

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发模式运行
pnpm tauri dev

# 构建生产版本
pnpm tauri build
```

首次启动：
1. 授予辅助功能权限
2. 打开设置 → 语音识别 → 配置 STT 服务商和 API Key
3. 打开设置 → Pi → 选择模型服务商
4. 按下 `Cmd+Shift+Space` 开始说话

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Tauri 2 (Rust) |
| 前端 | React 19、TypeScript、Vite 7 |
| 路由 | TanStack Router |
| 状态管理 | Zustand |
| 样式 | Tailwind CSS 4 |
| 音频采集 | cpal |
| AI 后端 | Pi CLI (JSON-RPC) |
| 数据库 | SQLite |
| 原生 UI | macOS AppKit (objc2) |

## 项目结构

```
src-tauri/src/
├── lib.rs              # 入口，录音、快捷键、粘贴
├── audio.rs            # PCM 重采样、声道转换
├── stt.rs              # STT 统一接口 + 阿里云百炼实现
├── stt_providers/      # Deepgram、AssemblyAI、Soniox、Gladia、OpenAI
├── pi_rpc.rs           # Pi JSON-RPC 通信
├── agent_tasks.rs      # Agent 任务管理
├── agent_terminal.rs   # Agent PTY 终端
├── native_hud.rs       # macOS 原生浮动 HUD
├── settings.rs         # 设置读写与迁移
└── db.rs               # SQLite schema 与迁移

src/
├── pages/              # 页面组件
├── stores/             # Zustand 状态仓库
├── components/         # ShaderOrb、SettingsDialog 等
└── hooks/              # Tauri 事件订阅

pi-extensions/
└── speakmore-notify.ts  # Pi 扩展：AI 摘要 + 语音播报
```

## 配置

设置文件位于 `~/Library/Application Support/com.speakmore.app/app-settings.json`（权限 0600）。

环境变量覆盖：
- `SPEAKMORE_PI_PROVIDER` — 强制指定 Pi 服务商
- `SPEAKMORE_PI_MODEL` — 强制指定 Pi 模型
- `SPEAKMORE_PI_MODE` — 强制指定 Pi 模式
- `SPEAKMORE_PI_REUSE_PROCESS` — 是否复用进程
- `SPEAKMORE_PI_PATH` — 自定义 Pi 二进制路径
- `SPEAKMORE_PI_THINKING` — 推理等级覆盖

## 许可证

MIT
