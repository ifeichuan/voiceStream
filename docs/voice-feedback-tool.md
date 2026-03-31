# voice_feedback Tool

应用内置扩展：

- `pi-extensions/voice-feedback.ts`

VoiceStream 通过启动 `pi --mode rpc` 时显式传入 `-e <path>` 来加载这个扩展，
不依赖 `.pi/extensions/` 自动发现，也不要求必须从项目根目录启动。

## 作用

注册一个可被 pi 调用的自定义 tool：`voice_feedback`

功能：
- 在 macOS 上通过 `say` 播放一小段提示语
- 用于任务开始时的即时语音反馈

## 参数

```json
{
  "text": "开始整理"
}
```

## 路径解析

默认路径：

- `pi-extensions/voice-feedback.ts`

打包配置中已将以下目录加入 Tauri bundle resources：

- `../pi-extensions/**/*`

可通过环境变量覆盖：

- `VOICESTREAM_PI_VOICE_EXTENSION=/absolute/path/to/voice-feedback.ts`

RPC 启动工作目录也可通过以下环境变量覆盖：

- `VOICESTREAM_APP_ROOT=/absolute/path/to/app-root`

打包后的 Tauri 应用会优先尝试使用 `resource_dir` 作为 app root。
如果其中存在 `pi-extensions/voice-feedback.ts`，则会优先从资源目录加载。
这样可以避免发布后仍依赖开发时的项目目录结构。

## 本地测试建议

显式使用 `-e` 测试：

```bash
pi --mode rpc --no-session -e ./pi-extensions/voice-feedback.ts
```

然后发送 prompt，例如：

- “先调用 voice_feedback 说‘开始整理’，然后再处理我的文本”
- “开始前先用 voice_feedback 播报‘收到’，然后输出结果”

## 说明

- 这是应用自带 extension，不再放在 `.pi/extensions/`
- 当前实现依赖 macOS 自带 `say`
- 该 tool 仍然是给模型一个可调用能力，不保证模型每次都会主动调用
- 如果后续需要更稳定的开始提示，建议在宿主应用侧直接补一个本地开始音或开始播报
