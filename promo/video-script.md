# VoiceStream 宣传视频脚本记录

## 记录原则

注意只记录我明确要求写进去的。

## 已确定想法

我们可以采用从慢到快的节奏来展示文字整理前后的对比。

1. 第一波展示：
   展示一个完整的处理流程。
2. 后续展示：
   加快展示速度，大概每次停留 0.5 到 0.7 秒左右。

## 参考视频

### 七牛云

原始链接：

https://www.bilibili.com/video/BV1wYGo6cEic/?vd_source=c0c5db05014578f493b993d4b1d3e6fc

嵌入代码：

```html
<iframe src="//player.bilibili.com/player.html?isOutside=true&aid=116635474073316&bvid=BV1wYGo6cEic&cid=38607522404&p=3" scrolling="no" border="0" frameborder="no" framespacing="0" allowfullscreen="true"></iframe>
```

## 常驻 ORB

ORB 在整个视频中始终保持在屏幕当中，作为常驻视觉元素。

开场过渡：进入界面时 ORB 从小到大放大呈现。

## 主旨句

VoiceStream 先是语音输入法，然后才是 Agent 的入口。

观众先相信"它能帮我输入"，再接受"它还能帮我办事"。

## 60 秒时间线

- 不要痛点开场。
- 不要片尾 QA。
- 主旨句和三句口号收尾。

| 时间 | 段落 | 内容 |
| --- | --- | --- |
| 0–4s | ORB 登场 | ORB 从一个点放大到中央，cream / 暖近黑画布 |
| 4–18s | 慢速完整流程 | 真实 App + HUD + 真人口语 → 整理成品。上下分屏：原始转写 vs 整理后文本。角落计时器跳到 1.2s。字幕：Speak → Transcribe → Polish → Paste |
| 18–28s | 快闪三组 | 0.7s 一组卡片，左原始右整理。其中一组用"口语 → conventional commit"做爆点。节奏从慢到快加速 |
| 28–38s | Your way | 设置面板，模板 / Provider / 字典切换实时预览。字幕：你的模板 · 你的模型 · 你的语气 |
| 38–52s | Agent + 回响 | Cmd+Shift+A，ORB 变琥珀色。说一句任务后跳剪用户切回工作。Agent 完成时 ORB 飞回中央变绿，通知滑入 + AI TTS 播报。字幕：有些话不只是输入 |
| 52–58s | 主旨 + 三句口号 | 字幕逐行：先是输入法 / 然后是 Agent 入口 / 说一句。它跑。它讲。 |
| 58–60s | Logo | VoiceStream |

## ORB 在视频里的语法

- 蓝色：听写模式（用户正在说话）
- 琥珀色：Agent 启动 / 在跑
- 绿色：Agent 完成 / 在回话
- 大小：spotlight 时居中放大，工作时缩到角落
- 跳动：只跟随用户人声 + AI TTS 播报，不跟旁白、不跟背景音乐

## 声音设计

- 用户演示口语：真人录制
- AI 回响：TTS 合成（具体音色待定，作为品牌资产沉淀）
- 全片不要旁白，只用字幕 + 用户人声 + AI TTS + 极简环境音
- Remotion 中 ORB 由一条主音轨驱动，跨段不能断

## 待补录素材

1. 干净的口语样本（3–5 段，每段 5–10s，够"乱"够口语化）—— 慢速段 + 快闪段用
2. 设置面板的模板切换画面 —— Your way 段用
3. Agent 完成的真实通知 + AI TTS 播报 —— Agent 高潮段用，全片最关键 2 秒，需高保真
4. HUD 在蓝 / 琥珀 / 绿三态的特写 —— 配合 ORB 状态切换
