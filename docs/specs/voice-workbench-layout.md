# VoiceStream Desktop Surface Spec

## Goal

VoiceStream is not a website and not a single full-screen voice editor.

It has two product surfaces:

1. Popup input capsule: the transient dictation surface that appears over whatever app the user is currently using.
2. Management panel: the actively opened desktop panel for status, history, diagnostics, tasks, and configuration.

The management panel should be organized around `Dashboard` and `Settings`, with optional secondary pages for Agent and History if the information volume requires it.

This spec replaces the earlier "web workbench" framing. Any previous reference that treats VoiceStream like a web landing page or a generic AI prompt screen should be treated as weak evidence.

## Evidence Base

Primary project evidence:

- `docs/features/hud-capsule.md`
- `docs/features/macos-menubar-voice-input.md`
- `docs/features/agent-mode-and-toggle-hotkey.md`
- current `src/App.tsx`

Lazyweb evidence:

- `.lazyweb/quick-references/voice-input-layout-2026-05-23/report.md`
- `.lazyweb/quick-references/voice-input-layout-2026-05-23/report.html`

Important caveat:

Lazyweb returned mostly web pages, marketing pages, documentation pages, and web app dashboards. These are useful for general patterns such as split panes, settings rows, status dashboards, and inspector columns. They are not strong direct evidence for the popup capsule. For capsule behavior and visuals, use the local HUD spec as the source of truth. If a claim about native desktop behavior cannot be proven from local docs or runtime, write `uncertain`.

## Product Register

This is product UI for a macOS utility.

The UI should feel:

- quiet
- native-adjacent
- compact
- state-rich
- easy to scan
- low friction

Avoid:

- website hero layout
- landing-page CTAs
- marketing screenshots as product structure
- decorative card grids
- always-visible giant input boxes inside the management panel
- gradient text
- glassmorphism as decoration
- colored side-stripe borders
- nested cards

## Product Model

```text
VoiceStream
├─ Capsule
│  ├─ appears during dictation
│  ├─ shows waveform and live transcript
│  ├─ follows recording / processing / success / error state
│  └─ disappears after paste or terminal error
└─ Management Panel
   ├─ Dashboard
   ├─ Agent
   ├─ History
   └─ Settings
```

The capsule is the user's primary interaction surface.

The management panel is a control room. It should answer:

- Is dictation ready?
- Is STT configured?
- Is Pi configured?
- What shortcut is active?
- What happened recently?
- Are Agent tasks running or completed?
- Where do I change settings?

The management panel should not pretend to be the active dictation surface unless the user explicitly starts a test recording from inside the panel.

## Current Implementation Snapshot

Current `src/App.tsx` uses:

```ts
type NavKey = "overview" | "speech" | "pi" | "agent" | "activity";
```

Current navigation:

- `overview`: status/config overview with manual recording controls
- `speech`: STT settings
- `pi`: Pi routing, prompt, local files, advanced JSON
- `agent`: task list and task detail
- `activity`: transcript, logs, latest audio chunk

Current `src/App.css` defines a `paper-*` visual system:

- warm paper-like background
- underline form controls
- many bottom borders
- rounded pill buttons
- fluid `clamp()` headings

This implementation should be treated as the starting point for migration, not as a fresh greenfield UI.

Observed runtime caveat:

- `pnpm build` passes.
- Opening `127.0.0.1:1420` in ordinary Edge showed a blank page during this review.
- The exact cause is `uncertain`; do not treat that browser view as a successful visual QA of the Tauri management panel.

## Surface 1: Popup Input Capsule

Source of truth: `docs/features/hud-capsule.md`.

### Role

The capsule is the dictation interface. It appears over the user's current app and should feel like a native macOS transient HUD.

### Requirements

- bottom-center placement
- single capsule shape
- no outer rectangular wrapper
- compact waveform area
- live transcript area
- recording, processing, success, and error states
- automatic dismissal after paste
- no tutorial copy
- no settings controls
- no dashboard widgets

### State Model

```text
idle: hidden
recording: waveform + live transcript
processing: compact processing state
pasted: brief success state, then hide
error: concise error state, then user can recover
```

### Visual Contract

Keep the capsule visually separate from the management panel:

- dark HUD material is acceptable for capsule
- management panel may use light or neutral surfaces
- capsule should not inherit dashboard card styles
- dashboard should not mimic the capsule shape everywhere

### Dashboard Relationship

Dashboard can show capsule status, but must not duplicate the full capsule. At most, show a small status preview or last transcript snippet.

## Surface 2: Management Panel

The management panel is actively opened by the user from the app, menu bar, or desktop window. It is not the transient voice input UI.

Recommended navigation:

- Dashboard
- Agent
- History
- Settings

If the app needs to stay extremely small, Agent and History can be sections inside Dashboard, but Settings should remain distinct.

## Dashboard

Dashboard is the default management-panel view.

### Purpose

Dashboard is for monitoring and quick action, not deep configuration.

It should show:

- readiness status
- current recording pipeline
- shortcut state
- latest transcript or paste result
- STT status
- Pi route
- Agent task summary
- recent activity

### Suggested Layout

Desktop panel:

```text
Header: VoiceStream status + quick actions
Main grid:
  Left: Pipeline status and latest dictation
  Right: Readiness checklist and active shortcuts
Lower area:
  Recent activity / Agent summary
```

Alternative compact layout:

```text
Header
Status strip
Latest dictation
Agent tasks
Activity
```

Use side navigation only if there are at least three meaningful top-level pages. If the panel is small, a segmented top nav may be better.

### Dashboard Modules

#### Readiness

Show whether the app is ready to dictate:

- Microphone permission
- Accessibility permission
- STT API key configured
- STT connection status
- Pi provider/model configured
- global shortcuts registered

Do not show long setup prose. Each readiness item should have a state and, when broken, a short action.

#### Pipeline

Show the active path:

```text
Mic -> STT -> Pi refine -> paste
```

Each stage should have a concise status:

- ready
- recording
- waiting
- running
- done
- failed

#### Latest Dictation

Show:

- latest final transcript
- latest refined output if available
- paste status
- latency summary if available

This is a dashboard summary, not the main live dictation editor.

#### Shortcuts

Show:

- `Cmd+Shift+Space` for dictation
- `Cmd+Shift+A` for Agent
- current hotkey purpose
- current state from `hotkeyStatus`

#### Agent Summary

Show:

- running task count
- latest task status
- latest task title
- entry point to Agent page or section

#### Activity

Show last 5 to 8 lines. Full logs can live in History.

## Agent

Agent can remain a top-level page if background tasks are central.

Layout:

```text
Task list | Task detail
```

Requirements:

- status and creation time are visible in the list
- final result is more prominent than raw event logs
- event logs are visually quiet or collapsible
- session path is present but secondary

Agent should not reuse dashboard readiness cards as its main layout.

## History

History is for review and diagnostics.

Initial scope:

- recent transcript lines
- recent paste outcomes
- recent logs
- recent audio chunk summaries
- Agent task entry points

Do not overbuild a full searchable archive unless ordinary dictation persistence exists. If persistence exists only for Agent tasks, ordinary dictation history persistence is `uncertain`.

## Settings

Settings is for configuration only.

Sections:

- STT
- Pi Routing
- Prompt Template
- Local Pi Files
- Advanced JSON

Rules:

- `测试 STT` and `保存设置` belong in Settings.
- Do not show settings save/test as global actions on Dashboard, Agent, or History.
- API key fields must remain clearable.
- raw `~/.pi` JSON remains read-only unless a later spec changes that.
- avoid turning Settings into the default screen.

## Navigation IA

Replace the current nav:

- `overview` -> `dashboard`
- `speech` -> Settings / STT
- `pi` -> Settings / Pi Routing
- `agent` -> Agent
- `activity` -> Dashboard activity summary + History

Recommended labels:

- `Dashboard`
- `Agent`
- `History`
- `Settings`

Chinese labels are also acceptable:

- `仪表盘`
- `Agent`
- `历史`
- `设置`

Pick one language strategy per surface. Mixing is acceptable for product terms such as `Agent`, `STT`, and `Pi`.

## Visual Direction

### Scene

A user is working in another macOS app, uses the capsule for fast dictation, and opens the management panel only to check readiness, inspect recent activity, or change settings.

This supports a restrained desktop utility UI:

- compact
- neutral
- clear sectioning
- explicit states
- minimal decoration

### Color

Use OKLCH tokens.

Recommended strategy: Restrained.

Roles:

- app background: cool or warm tinted neutral
- panel surface: near-neutral, not pure white
- sidebar or top nav surface: second neutral
- border: subtle neutral
- text: tinted near-black, not pure black
- muted text: lower contrast neutral
- accent: one restrained blue-green, teal, or blue for selection and primary action
- error: restrained red
- success: restrained green
- warning: restrained amber

Accent is for state and selection, not decoration.

### Typography

Use system UI font stack.

Prefer stable product UI sizes:

- window title: 1.25rem to 1.5rem
- module title: 0.95rem to 1.05rem
- body: 0.9rem to 0.98rem
- metadata: 0.78rem to 0.84rem
- logs: 0.78rem to 0.86rem mono

Avoid fluid hero typography in the management panel.

### Layout

Use dense desktop layout, not marketing whitespace.

Good patterns:

- status strip
- split rows
- settings rows
- small tables/lists
- inspector-like summaries
- compact section headers

Use cards only for real grouped modules. Do not put cards inside cards.

### Motion

Motion communicates state:

- capsule entry and exit
- recording waveform
- processing transition
- log append or status update

Dashboard motion should be minimal. Respect `prefers-reduced-motion`.

## Component Requirements

### Dashboard Status Items

Each status item needs:

- label
- current state
- short detail
- optional action

States should not rely on color alone.

### Settings Controls

All form controls need consistent:

- default
- hover
- focus-visible
- disabled
- error
- loading where async

### Empty States

Short and direct:

- Dashboard latest dictation: `暂无最近输入。`
- Agent: `按 Cmd+Shift+A 创建后台任务。`
- History: `暂无历史。`
- Activity: `暂无活动。`

No long tutorial copy inside the panel.

## Implementation Plan

### Phase 1: IA Correction

- Rename `overview` to Dashboard.
- Move STT and Pi forms into Settings.
- Move current `activity` content into Dashboard summary and History.
- Keep Agent as top-level if tasks remain prominent.
- Stop using Dictation as a management-panel route name unless it is specifically a test surface.

### Phase 2: Dashboard

- Add readiness/status overview.
- Add pipeline summary.
- Add latest dictation summary.
- Add shortcut summary.
- Add Agent summary.
- Add recent activity summary.

### Phase 3: Settings

- Keep existing STT and Pi save/test behavior.
- Reorganize into Settings sections.
- Keep local Pi raw JSON under Advanced.

### Phase 4: Capsule Alignment

- Ensure panel status names match HUD state names.
- Do not duplicate HUD internals in the panel.
- If panel has a test recording control, clearly label it as a test.

### Phase 5: Visual QA

- verify dashboard first screen is not a landing page
- verify settings are not default
- verify dashboard fits desktop window without awkward scrolling
- verify narrow panel behavior
- verify text does not overlap
- verify Settings save/test flows still work

## Acceptance Criteria

- Opening the management panel shows Dashboard, not Settings.
- Dashboard is visibly a status/control panel, not a web hero page.
- Settings is a separate page or section.
- Capsule remains the real dictation input surface.
- Dashboard shows readiness, shortcut, STT, Pi, latest dictation, Agent summary, and recent activity.
- Global save/test settings actions are not visible on Dashboard.
- Existing Tauri command calls remain intact.
- No decorative side-stripe borders, gradient text, or decorative glassmorphism.
- No nested cards.
- Any unproven desktop behavior is documented as `uncertain`.

## Open Questions

- How exactly is the management panel opened in the final product: menu bar click, shortcut, dockless window, or Tauri window?
- Does ordinary dictation history persist, or only Agent task history?
- Is real RMS/amplitude available to React, or only native HUD and chunk metadata?
- Should Dashboard expose a manual test recording button, or only reflect external capsule activity?

If code, docs, or runtime cannot prove the answer, write `uncertain`.
