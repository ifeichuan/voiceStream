# SpeakMore Current UI + Desktop Surface Report

日期：2026-05-23  
范围：当前 `src/App.tsx`、`src/App.css`、本地 Vite 预览、Lazyweb 间接参考

## 先看当前项目

这次报告先以当前代码和样式为基准，再谈参考。

我检查了：

- `src/App.tsx`
- `src/App.css`
- `src/main.tsx`
- `vite.config.ts`
- 当前运行中的 `127.0.0.1:1420`
- `pnpm build`

结果：

- `pnpm build` 通过。
- `127.0.0.1:1420` 在普通 Edge 浏览器里打开后没有正常显示 React 管理面板，只看到空白区域和浏览器翻译浮层。
- 因此，当前“真实视觉渲染”在普通浏览器里不能完整证明，原因可能和 Tauri API / 普通浏览器环境 / 扩展干扰有关，具体原因 `uncertain`。
- 下面对当前 UI 的判断主要来自代码结构和 CSS token，而不是一次完整 Tauri 窗口视觉验收。

## 当前代码里的产品结构

当前 `NavKey` 是：

```ts
type NavKey = "overview" | "speech" | "pi" | "agent" | "activity";
```

对应导航：

- `overview`: 概览
- `speech`: 语音识别
- `pi`: Pi
- `agent`: Agent
- `activity`: 活动

这说明当前 app 实际是“设置/诊断控制台”，不是 Dashboard + Settings，也不是双表面桌面工具的最终 IA。

## 当前页面结构观察

### Shell

当前 shell 是：

```text
248px sidebar | scrollable main
```

特点：

- 左侧有 macOS traffic-light 圆点装饰。
- 左侧标题是 `SpeakMore / 语音设置`。
- 侧栏底部显示当前快捷键和 hotkey 状态。
- 主区域顶部 sticky header 永远显示 `测试 STT` 和 `保存设置`。

问题：

- 顶部和侧栏都在告诉用户“这是设置页”。
- 保存/测试这种低频配置动作被全局抬高。
- Dashboard 的主任务不清楚。
- 胶囊作为真正输入表面没有在信息架构里被明确区分。

### Overview

当前 Overview 做了三件事：

- 显示“语音输入设置”
- 提供 `开始录音 / 播放最新录音`
- 展示状态、音频包、Pi 路由、当前配置

这是一个 Dashboard 的雏形，但文案和层级仍然像设置概览。

更准确的方向：

- `overview` 应改成 `dashboard`
- 标题不应是“语音输入设置”
- 内容应变成 readiness + pipeline + latest dictation + shortcuts + activity
- 开始录音如果保留，要标成测试或手动检查，不要暗示管理面板是主输入界面

### Speech

`speech` 是 STT 设置页：

- API Key
- API Endpoint
- 模型
- Workspace ID

它应该进入 Settings / STT，而不是 top-level。

### Pi

`pi` 是很长的配置页：

- mode
- reuse process
- provider/model
- 本机 Pi 映射
- prompt template
- provider JSON override
- raw settings/models JSON

它也应该进入 Settings，拆成：

- Pi Routing
- Prompt Template
- Local Pi Files
- Advanced JSON

### Agent

Agent 页当前方向比较接近可保留形态：

```text
task list | task detail
```

需要调整的是层级：

- final result 应比 event logs 更重要
- session path 应更次要
- events 可以折叠或降低视觉重量

### Activity

Activity 当前包含：

- transcript
- logs
- latest audio chunk

它应该拆开：

- Dashboard 显示 recent activity summary 和 latest dictation summary
- History 显示完整 logs/transcript/audio chunk

## 当前视觉语言

`App.css` 定义的是 `paper-*` token：

```css
--color-paper-bg
--color-paper-surface
--color-paper-surface-soft
--color-paper-ink
--color-paper-muted
--color-paper-line
--color-paper-accent
```

视觉特征：

- 温暖纸面感
- 大量 border-bottom 分割
- 表单是下划线输入
- 按钮是圆 pill
- 标题使用 `clamp()` 和较强 letter-spacing
- 基本没有传统 card，但有很多文档式 section

这套风格不难看，但更像“配置文档/纸面控制台”。对于 SpeakMore 管理面板，更合适的方向是“桌面工具控制台”：

- 更紧凑
- 更像 macOS utility/preferences
- 更强的状态模块
- 少一点纸面 editorial 感
- 多一点 readiness / pipeline / diagnostics 结构

## 产品模型纠偏

SpeakMore 应按两个表面组织：

```text
SpeakMore
├─ Popup Capsule
│  ├─ waveform
│  ├─ live transcript
│  ├─ processing
│  └─ success / error
└─ Management Panel
   ├─ Dashboard
   ├─ Agent
   ├─ History
   └─ Settings
```

关键点：

- 胶囊是真正输入界面。
- 管理面板是状态、诊断、历史、任务和设置。
- 管理面板不应该变成网页式语音工作台。
- Dashboard 默认打开。
- Settings 独立。

## Lazyweb 参考有效性

这次 Lazyweb 搜到的大多数是网页、landing page、文档页和 Web dashboard。

它们只能作为间接参考，用来借：

- dashboard 状态组织
- settings rows
- task list/detail
- split pane
- recent activity
- readiness checklist

不能直接当作 SpeakMore 的桌面形态。尤其是弹出输入胶囊，应以本地文档 `docs/features/hud-capsule.md` 为准。Lazyweb 对这个胶囊形态的直接证据不足，具体桌面胶囊参考 `uncertain`。

## Dashboard 应该长什么样

基于当前 state 和事件，Dashboard 可以直接复用现有数据：

- `isRecording`
- `hotkeyStatus`
- `sttStatus`
- `chunkCount`
- `lastChunkInfo`
- `sttSettings`
- `piSettings`
- `localPi`
- `agentTasks`
- `logs`
- `finalTranscript`
- `partialTranscript`
- `settingsStatus`

建议 Dashboard 模块：

```text
Dashboard
├─ Status Strip
│  ├─ Ready / Recording / Processing / Error
│  ├─ Dictation shortcut
│  └─ Agent shortcut
├─ Readiness
│  ├─ STT key
│  ├─ STT model
│  ├─ Pi provider/model
│  └─ process reuse
├─ Pipeline
│  └─ Mic -> STT -> Pi -> Paste
├─ Latest Dictation
│  ├─ final transcript
│  ├─ partial transcript
│  └─ latest audio chunk
├─ Agent Summary
│  ├─ latest task
│  └─ running/completed/failed count
└─ Recent Activity
   └─ last 5-8 logs
```

注意：

- Dashboard 可以有“开始录音”测试按钮，但文案要避免把它当主入口。
- 保存设置、测试 STT 不应该在 Dashboard 全局 header。
- Dashboard 只展示设置状态，不直接编辑设置。

## Settings 应该怎么迁移

当前 `speech` 和 `pi` 不需要消失，只需要降级到 Settings 内部。

推荐：

```text
Settings
├─ STT
├─ Pi Routing
├─ Prompt Template
├─ Local Pi Files
└─ Advanced JSON
```

这里保留当前所有输入逻辑：

- `saveSettings`
- `testSettings`
- `applyLocalPiDefaults`
- `applyProviderFromLocal`
- `useNativePiConfig`

也保留 API key 可清空、本机 Pi raw JSON 只读等行为。

## Agent / History

Agent：

- 保留双栏。
- task list/detail 是对的。
- 重新排优先级：结果 > 错误 > transcript > events > session path。

History：

- 从 current `activity` 拆出来。
- 展示 transcript/logs/audio chunk。
- 普通 dictation 是否持久化，目前 `uncertain`。

## 当前报告修正后的落地方向

不要先做“网页工作台版”。

应该做：

1. 把 `overview` 改成 `Dashboard`。
2. 把 `speech` 和 `pi` 移到 `Settings`。
3. 把 `activity` 拆成 Dashboard 摘要 + History。
4. 保留 `Agent` top-level。
5. 把 header 的全局 `测试 STT / 保存设置` 移到 Settings。
6. 调整视觉 token，从 `paper` 文档气质转向 desktop utility dashboard。
7. 胶囊继续按 `docs/features/hud-capsule.md` 约束，不被 Dashboard 重画。

## 视觉优先级建议

第一轮不要大改颜色和动效，先改信息架构。

推荐先做：

- Dashboard IA
- Settings 合并
- Header action 迁移
- Activity 拆分
- 文案改名

第二轮再做视觉：

- 换 `paper-*` 为更 neutral 的 `panel-*` / `utility-*`
- 减少 `clamp()` 大标题
- 降低 pill 按钮滥用
- 增加 compact status row
- 引入清晰 focus state

## 当前不确定点

- 普通浏览器白屏的具体原因 `uncertain`，但 build 通过。
- Tauri 窗口里的完整视觉状态这次没有成功截图验证，`uncertain`。
- 普通 dictation history 是否持久化 `uncertain`。
- React 端是否能拿到真实 RMS/amplitude `uncertain`，当前看到的是 audio chunk metadata。
