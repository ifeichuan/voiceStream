# SpeakMore 前端重设计 PRD

## 概述

对 SpeakMore 设置界面进行视觉和交互体验重设计。目标是从"AI 工具 dashboard"转变为"极简沉浸式工具"，让用户感到零理解成本、舒适、没有 AI 味。

**不包含范围**：胶囊（Capsule）组件的整体重设计（但波形动画需要提取为可复用模块供胶囊使用）。

---

## 设计方向

### 气质定位

**极简沉浸感** — 像 iA Writer、Things 3 那样，大量留白，极少元素，信息按需出现。

### 品牌个性

**轻盈、流畅、隐形**

用户打开设置界面的频率很低，打开时应该感觉一切井然有序、一目了然，而不是面对一堆需要理解的字段。

### 反面参考（不要像这些）

- AI dashboard（统计卡片 + 日志流）
- 重 chrome 的 Electron 应用
- 所有选项同等权重平铺的设置页
- 渐变光晕、毛玻璃、紫色 AI 光效

### 正面参考

- iA Writer — 留白、聚焦、字体驱动层级
- Things 3 — 安静的任务管理、渐进式展开
- Raycast 设置 — 干净的工具感
- macOS 系统偏好设置 — 行式表单布局

---

## 设计规范

### 字体

| 角色 | 字体 | 用途 |
|------|------|------|
| 标题/标签/状态 | Geist Mono / JetBrains Mono | 机器声音：section 标题、表单 label、状态文字、代码 |
| 正文/描述 | SF Pro / PingFang SC | 人类声音：说明文字、表单值、对话内容 |

### 配色

支持 light / dark 双模式，跟随 `prefers-color-scheme` 自动切换。

**Light mode:**
- canvas: `#fdfcfc`（暖白）
- surface-soft: `#f8f7f7`
- ink: `#201d1d`
- body: `#424245`
- mute: `#646262`
- hairline: `rgba(15, 0, 0, 0.12)`
- accent: `#007aff`（仅交互态）

**Dark mode:**
- canvas: `#201d1d`（暖黑）
- surface-soft: `#302c2c`
- ink: `#fdfcfc`
- body: `#c8c6c6`
- mute: `#9a9898`
- hairline: `rgba(253, 252, 252, 0.12)`
- accent: `#007aff`

### 圆角

- 交互元素（按钮、输入框）：4px
- 容器/区块：0px
- 无阴影、无渐变

### 间距

用留白代替分割线。Section 之间 64px（桌面）/ 48px（紧凑），内部元素 16-24px。

---

## 布局结构

### 整体框架

**去掉 248px 重侧边栏**，替换为极窄导航（纯图标或单字，贴左边缘或做底部 tab）。内容区域居中，大量留白。

```
┌──────────────────────────────────────────┐
│ [nav]  │         Content Area            │
│  ·概览  │                                 │
│  ·设置  │    居中内容，max-width 约束      │
│  ·Agent │    大量留白包围                  │
│  ·活动  │                                 │
└──────────────────────────────────────────┘
```

导航项：图标或单字，active 态用 ink 色，inactive 用 mute 色，无背景色。

### 表单布局

**统一左右布局**（label 左，input/select/toggle 右），类似 macOS 系统偏好设置的行式排列：

```
┌─────────────────────────────────────┐
│  API Endpoint     [________________]│
│  模型             [________________]│
│  复用进程          [  toggle  ]     │
│  Provider         [  select  ▾]    │
└─────────────────────────────────────┘
```

不再使用上下布局（label 上 + input 下）。

---

## 页面设计

### 概览页

**不做 dashboard。** 做成安静的状态指示 + 动态视觉。

- 页面中心：大的动态视觉元素
  - 安静时：微微呼吸的圆/环
  - 录音时：响应声波的有机形态（复用波形动画）
- 下方：最近 3-5 条语音输入的简要记录，一行一条
- 快捷键提示：极淡地存在于底部

**移除的内容**（移到 debug/活动页）：
- 音频包计数
- STT 状态文字
- 统计卡片

### 设置页（语音识别 / Pi / 快捷键）

- 每页只聚焦一件事
- 核心字段可见（2-3 个），高级选项折叠在"更多"里
- 左右行式布局
- 无 section border，用间距区分

### Agent 页

- 任务列表：轻量卡片，像 Apple Reminders / Linear issue
- 终端区域：slide 展开，不是默认全屏
- 详情弹窗：简化，无 overlay dimming，scale(0.98)→1 进入

### 活动页

- 开发调试信息的归属地
- 转写结果 + 日志流
- 可以保留当前信息密度，但视觉上更克制

---

## 动效方案

### 技术栈

引入 `framer-motion`。

### 路由过渡

- `AnimatePresence` + `layoutId` 做页面切换 FLIP 动画
- 导航项点击：当前页淡出，新页从对应方向滑入
- 共享元素（页面标题等）做 FLIP 位移

### 微交互

- 概览页动态视觉：Canvas/SVG + framer-motion，响应录音状态
- 任务列表重排：`layout` 动画
- 表单保存：subtle scale pulse 反馈
- 终端展开/收起：slide + opacity

### 动效参数

```
fast:    150ms, ease-out
normal:  250ms, cubic-bezier(0.25, 0.1, 0.25, 1)
slow:    400ms, cubic-bezier(0.25, 0.1, 0.25, 1)
spring:  cubic-bezier(0.34, 1.56, 0.64, 1)
```

### 无障碍

`prefers-reduced-motion: reduce` 时禁用所有 transform/opacity 动画，状态变化保持即时。

---

## 硬性约束

1. **文字不溢出** — 全面使用 flex + `min-width: 0` + `overflow: hidden` / `text-overflow: ellipsis`。容器尺寸用 rem + `clamp()` 做弹性约束，不用固定 px 导致窄窗口撑破。

2. **波形动画可复用** — 提取为独立组件/CSS 模块，设置界面的 loading 态和胶囊共享同一套波形动画。

3. **表单左右布局** — 所有设置项统一 label 左 + 控件右的行式排列。

4. **无 AI 味** — 不暴露技术术语（Provider、JSONL、PTY 等）给普通视图，技术细节折叠或移到 debug 入口。

5. **双主题** — light/dark 跟随系统，两套配色同时维护。

6. **样式归 CSS，不留 TS** — 不在 TypeScript 里定义 class name 字符串常量（如 `primaryButtonClass`、`kickerClass`）。可复用的样式组合统一用 `@layer components` + `@apply` 写在 CSS 中，组件直接引用 class name。

---

## 界面质感规范

以下原则确保新版界面在细节层面感觉精致、不廉价：

| 原则 | 规则 |
|------|------|
| Concentric border radius | 嵌套圆角：outer = inner + padding，禁止内外同值 |
| Scale on press | 所有按钮 `active:scale-[0.96]`，不低于 0.95 |
| Tabular numbers | 动态数字一律 `font-variant-numeric: tabular-nums` |
| Text wrap | 标题 `text-wrap: balance`，正文 `text-wrap: pretty` |
| Transition 指定属性 | 禁止 `transition: all`，只写具体属性如 `transition-[transform,opacity]` |
| Enter 动画拆分 | 页面内容拆语义块，stagger ~100ms |
| Exit 动画克制 | 小幅 translateY + opacity 淡出，不做全高度滑出 |
| AnimatePresence | 加 `initial={false}` 防止首次渲染播放入场动画 |
| Hit area | 交互元素最小 40×40px，小控件用伪元素扩展 |
| Icon 切换动画 | scale 0.25→1, opacity 0→1, blur 4px→0, spring bounce=0 |
| will-change | 仅在首帧卡顿时添加，只用于 transform/opacity/filter |
| Font smoothing | 根元素 `antialiased`（已有，保持） |

---

## 技术依赖

| 新增依赖 | 用途 |
|----------|------|
| `framer-motion` | 页面过渡、FLIP 动画、微交互 |
| `Geist Mono` 或 `JetBrains Mono` | 等宽字体（标题/标签） |

现有依赖保留：React 19、Zustand、Tailwind CSS 4、react-router-dom、@wterm/react。

---

## 实施顺序建议

1. **基础设施** — 配色 tokens 重定义（支持 dark mode）、字体引入、全局 reset
2. **布局框架** — 新导航结构、内容区居中约束、路由接入 react-router-dom
3. **概览页** — 动态视觉 + 最近记录 + 快捷键提示
4. **设置页** — 左右行式表单、折叠高级选项
5. **Agent 页** — 任务卡片、终端 slide
6. **动效层** — Framer Motion 路由过渡、微交互
7. **波形提取** — 独立组件，供胶囊复用
