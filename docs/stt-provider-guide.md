# STT Provider 适配指南与验证矩阵

本文档记录 SpeakMore 实时 STT provider 的适配规范，供维护者新增 provider 时参考。

## 已支持 Provider 概览

| Provider | 鉴权方式 | 会话启动 | 音频格式 | 采样率 | 结果事件 | Final 语义 | 结束方式 |
|----------|----------|----------|----------|--------|----------|------------|----------|
| 阿里云百炼 | Bearer token (header) | WebSocket + run-task JSON | binary PCM16 | 16kHz | `result-generated` | `sentence_end: true` | `finish-task` JSON |
| Deepgram | Token header | WebSocket (URL params) | binary PCM16 | 16kHz | `Results` JSON | `is_final: true` | `CloseStream` JSON |
| AssemblyAI | Authorization header | WebSocket (URL params) | binary PCM16 | 16kHz | `PartialTranscript` / `FinalTranscript` | `message_type: FinalTranscript` | `terminate_session` JSON |
| Soniox | Bearer token (header) | WebSocket + start JSON | binary PCM16 | 16kHz | `result` / `transcript` JSON | `is_final: true` (token-level) | `stop` JSON |
| Gladia | X-Gladia-Key (REST init) | REST POST → WebSocket URL | base64 JSON chunk | 16kHz | `transcript` JSON | `is_final: true` in data | `stop_recording` JSON |
| OpenAI Realtime | Bearer token + OpenAI-Beta header | WebSocket + session update JSON | base64 PCM16 JSON | 24kHz | `delta` / `completed` events | `*.completed` event type | `input_audio_buffer.commit` JSON |

## 新增 Provider 最小 Checklist

### 1. 设置字段

- [ ] 在 `src-tauri/src/stt.rs` 中添加 `PROVIDER_*` 常量
- [ ] 在 `provider_meta_list()` 中添加 `SttProviderMeta` 条目（标注需要哪些字段）
- [ ] 确认 `settings.rs` 的通用字段（provider, api_key, api_endpoint, model, language, sample_rate, extra_config）是否足够，不够时使用 `extra_config` JSON

### 2. Provider 实现

- [ ] 在 `src-tauri/src/stt_providers/` 下创建 `{provider}.rs`
- [ ] 在 `stt_providers/mod.rs` 中注册 `pub mod {provider};`
- [ ] 实现 `SttProvider` trait（`push_chunk`, `finish`）
- [ ] 实现 `pub fn new(...)` 构造函数，启动异步 session
- [ ] 实现 `pub async fn test_connection(...)` 用于设置页测试

### 3. 连接测试

- [ ] 在 `stt.rs` 的 `test_settings()` match 中添加分支
- [ ] 测试覆盖：无 API key → 明确错误、错误 key → 鉴权失败、正确 key → 成功消息

### 4. 音频编码

- [ ] 确认目标采样率和声道数（大多数 16kHz mono，OpenAI 24kHz mono）
- [ ] 使用 `convert_chunk_to_pcm16()` 做重采样和声道转换
- [ ] 如果 provider 需要 base64 编码，在发送前编码

### 5. 结果解析

- [ ] 解析 partial/interim 结果 → 更新 `partial` 字段
- [ ] 解析 final/completed 结果 → 追加到 `finals` 列表，清空 `partial`
- [ ] 调用 `emit_transcript()` 更新 HUD 和前端事件

### 6. 错误处理

- [ ] 连接失败 → `mark_runtime_error` + `emit_status`
- [ ] 鉴权失败 → 解析错误消息，上报到前端
- [ ] 运行时错误 → 解析 error 事件，终止 session

### 7. Factory 注册

- [ ] 在 `stt.rs` 的 `create_stt_provider()` match 中添加分支
- [ ] 确认 `test_settings()` 中也有对应分支

### 8. HUD/粘贴链路验证

- [ ] 确认 `emit_transcript` 正确调用 `native_hud::update_transcript`
- [ ] 确认 `mark_runtime_finished()` 在 session 结束时调用
- [ ] 确认 `wait_for_final_text()` 能正确收集 finals + partial

## 手动验证矩阵

| 场景 | 预期行为 | 验证方式 |
|------|----------|----------|
| 无 API key | 前端显示 "disabled: save API key..." | 启动录音，观察 stt-status 事件 |
| 鉴权失败（错误 key） | 设置测试显示明确错误消息 | 点击测试按钮 |
| 连接失败（错误 endpoint） | 设置测试显示连接错误 | 修改 endpoint 后测试 |
| Partial 更新 | HUD 实时显示 partial 文本 | 录音时观察 HUD |
| Final 归并 | 多句 final 正确拼接 | 说多句话后停止 |
| Finish 后最终文本 | 停止录音后获得完整文本 | 正常录音流程 |
| 窄宽界面设置展示 | Provider 选择器和字段正确显示 | 调整窗口宽度 |
| Provider 切换 | 切换后 endpoint/model 自动填充默认值 | 在设置页切换 provider |

## 代码验证 vs Uncertain 行为

### 已通过代码验证

- ✅ 阿里云百炼：完整端到端验证（连接、音频发送、partial/final 解析、finish、HUD 更新、粘贴）
- ✅ 所有 provider：`pnpm build` + `cargo check` 编译通过
- ✅ 所有 provider：设置保存/加载/清空流程
- ✅ 所有 provider：provider 切换时默认值填充
- ✅ 音频转换：`convert_chunk_to_pcm16` 重采样逻辑

### Uncertain（需真实账号验证）

- ⚠️ Deepgram：WebSocket 协议细节（URL 参数格式、CloseStream 消息格式）
- ⚠️ AssemblyAI：Universal Streaming v2 是否接受 raw binary（vs base64 JSON）
- ⚠️ Soniox：start 配置消息的确切 schema、token-level 结果的拼接逻辑
- ⚠️ Gladia：Live v2 REST init 的确切请求/响应格式
- ⚠️ OpenAI Realtime：transcription session update schema、delta 事件的确切 type 字符串
- ⚠️ 所有非百炼 provider：实际音频流的端到端转写质量

## 架构说明

```
src-tauri/src/
├── stt.rs                    # 通用 STT 运行时：trait、状态管理、factory、Aliyun 实现
├── stt_providers/
│   ├── mod.rs                # 共享 helper（emit_transcript, emit_status）
│   ├── deepgram.rs           # Deepgram WebSocket binary
│   ├── assemblyai.rs         # AssemblyAI Universal Streaming
│   ├── soniox.rs             # Soniox WebSocket binary
│   ├── gladia.rs             # Gladia Live v2 (REST init + base64 WS)
│   └── openai.rs             # OpenAI Realtime Transcription (base64 WS)
└── settings.rs               # 统一设置模型（provider, api_key, endpoint, model, language, sample_rate, extra_config）
```

### 统一语义映射

SpeakMore 内部使用以下统一语义：

- **partial**: 当前正在识别的中间文本，随时可能被替换
- **final**: 已确认的最终文本片段，不会再变
- **finished**: 整个 session 结束，可以收集最终结果
- **error**: 不可恢复的错误，session 终止

各 provider 的原始事件通过 adapter 映射到这些统一语义。
