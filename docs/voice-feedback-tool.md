# voice_feedback Tool

项目本地扩展：

- `.pi/extensions/voice-feedback.ts`

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

## 本地测试建议

先确认当前项目目录启动的 pi 能发现项目级扩展：

```bash
pi --mode rpc --no-session
```

然后发送 prompt，例如：

- “先调用 voice_feedback 说‘开始整理’，然后再处理我的文本”
- “开始前先用 voice_feedback 播报‘收到’，然后输出结果”

## 说明

- 这是项目级 extension，位于 `.pi/extensions/`
- 依赖 pi 的 extension 自动发现机制
- 当前实现依赖 macOS 自带 `say`
- 当前主 prompt 已补充：如果 `voice_feedback` 可用，优先在开始处理时调用一次
- 该 tool 仍然是给模型一个可调用能力，不保证模型每次都会主动调用

如果后续需要更稳定的开始提示，建议在宿主应用侧直接补一个本地开始音或开始播报。 
