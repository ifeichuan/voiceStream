# 快速开始

本指南帮助你在 5 分钟内跑起 SpeakMore。

## 前置条件

- macOS 13+
- Node.js 18+ 和 pnpm
- Rust 工具链（`rustup`）
- 一个 STT 服务商的 API Key（推荐阿里云百炼，中文效果最好）
- Pi CLI（用于文本润色和 Agent 模式）

## 一键安装

```bash
# 克隆仓库
git clone https://github.com/anthropics/speakmore.git
cd speakmore

# 安装前端依赖
pnpm install

# 开发模式启动
pnpm tauri dev
```

> 首次编译 Rust 依赖可能需要几分钟，后续启动会很快。

## 安装 Pi CLI

SpeakMore 依赖本机的 Pi CLI 做文本润色和 Agent 任务执行。

```bash
# 通过 pnpm 全局安装
pnpm install -g @anthropics/pi

# 或通过 bun
bun install -g @anthropics/pi
```

安装后运行 `pi --version` 确认可用。

## 配置 STT 服务商

启动应用后，点击左下角「设置」→「语音识别」：

1. **选择服务商**：推荐阿里云百炼（中文优化）或 Deepgram（多语言）
2. **填入 API Key**
3. **点击「测试 STT」** 验证连接

<p align="center">
  <img src="docs/setting_stt.png" width="600" alt="STT 设置" />
</p>

## 配置 Pi 模型

点击设置 →「Pi」：

1. **选择服务商和模型**：推荐 DeepSeek V4 Flash（快速、便宜、中文好）
2. **推理等级设为「关闭」**：No Thinking 模式下响应最快，1–2 秒内返回
3. **保存**

<p align="center">
  <img src="docs/setting_pi.png" width="600" alt="Pi 设置" />
</p>

> **为什么推荐 DeepSeek？** 经实测，DeepSeek V4 Flash + No Thinking 模式做短文本润色，平均延迟 1–2 秒。国产模型在中文语境下的纠错和标点补全表现优异，且成本极低。

## 授予系统权限

SpeakMore 需要两个系统权限：

### 麦克风权限
首次录音时系统会自动弹窗请求，允许即可。

### 辅助功能权限（重要）
用于模拟 `Cmd+V` 粘贴。如果未授权，应用左下角会显示黄色警告。

前往：**系统设置 → 隐私与安全性 → 辅助功能** → 勾选 SpeakMore。

## 开始使用

| 操作 | 快捷键 | 效果 |
|------|--------|------|
| 听写 | `Cmd+Shift+Space` | 说话 → 转录 → 润色 → 粘贴到光标 |
| Agent | `Cmd+Shift+A` | 说话 → 转录 → 后台执行任务 → 语音播报结果 |

### 听写模式

两种交互方式：
- **长按说话**：按住快捷键说话，松手自动停止并粘贴
- **短按锁定**：快速按一下开始录音，再按一下停止

### Agent 模式

对着麦克风说出任务指令（如"帮我检查这个项目能不能构建"），SpeakMore 会：
1. 创建 Agent 任务
2. 启动 Pi agent session 在后台执行
3. 完成后通过语音播报结果

在应用的「Agent」页面可以查看任务列表和实时终端输出。

## 推荐配置组合

| 用途 | STT 服务商 | Pi 模型 | Thinking |
|------|-----------|---------|----------|
| 日常中文听写 | 阿里云百炼 | DeepSeek V4 Flash | 关闭 |
| 多语言听写 | Deepgram nova-2 | DeepSeek V4 Flash | 关闭 |
| Agent 任务 | 阿里云百炼 | GPT-5.4 / Claude | 中等 |

## 常见问题

### 粘贴不生效？
检查辅助功能权限是否已授予。系统设置 → 隐私与安全性 → 辅助功能。

### STT 连接失败？
在设置中点击「测试 STT」查看具体错误。常见原因：API Key 过期、网络不通、服务商端点错误。

### Pi 润色没有响应？
确认 `pi --version` 可以正常运行。如果 Pi 未安装或路径不在 PATH 中，可通过环境变量 `SPEAKMORE_PI_PATH` 指定。

### 延迟太高？
- 确认 Pi 设置中「复用进程」已开启
- 使用 DeepSeek V4 Flash + No Thinking 模式
- 检查 STT 服务商的网络延迟（活动页面的日志会显示 `stt_wait` 耗时）
