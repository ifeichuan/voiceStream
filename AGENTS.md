# AGENTS.md

## Must

- Reply to the user in Chinese by default.
- Say `uncertain` when something cannot be clearly explained or proven from code, docs, runtime behavior, or current evidence.
- Preserve user changes. Do not revert unrelated work unless the user explicitly asks.
- Prefer `rg` / `rg --files` for search.
- Use `apply_patch` for manual file edits.
- Keep frontend changes consistent with the current React + Tauri + Tailwind setup.

## Product Context

VoiceStream is a macOS-focused voice input prototype built with Tauri, React, TypeScript, and Rust.

Current product capabilities include:

- global dictation shortcut: `Cmd+Shift+Space`
- Agent shortcut: `Cmd+Shift+A`
- native audio capture
- streaming STT through Aliyun Bailian
- Pi-based text refinement / task execution
- native macOS HUD capsule
- automatic paste into the focused app through clipboard + `Cmd+V`

Relevant docs:

- `README.md`
- `docs/features/macos-menubar-voice-input.md`
- `docs/features/agent-mode-and-toggle-hotkey.md`
- `docs/features/hud-capsule.md`
- `docs/prompt-design.md`
- `docs/tech/vad.md`
- `docs/specs/voice-workbench-layout.md`

## Frontend Direction

Treat the app UI as product UI, not a landing page.

VoiceStream has two product surfaces:

- popup input capsule: the transient dictation UI over the user's current app
- management panel: the active desktop panel for dashboard, history, Agent tasks, and settings

The management panel should default to Dashboard, not Settings and not a web-style dictation workspace.

The target management-panel direction:

- Dashboard first
- Settings as a distinct configuration area
- Agent and History as top-level pages only if their information volume justifies it
- Dashboard shows readiness, shortcuts, STT, Pi, latest dictation, Agent summary, and recent activity
- Capsule remains the real live dictation surface

Use `docs/specs/voice-workbench-layout.md` as the primary layout spec.

Lazyweb reference report:

- `.lazyweb/quick-references/voice-input-layout-2026-05-23/report.md`
- `.lazyweb/quick-references/voice-input-layout-2026-05-23/report.html`

## Design Rules

- Keep the UI quiet, precise, and scannable.
- Use familiar desktop product patterns: dashboard status strips, settings rows, compact lists, split task/detail panes.
- Use system UI fonts.
- Prefer fixed product UI type scales over fluid hero typography.
- Use OKLCH colors for new tokens.
- Use restrained accent color only for current selection, primary action, focus, and state.
- Do not use gradient text.
- Do not use decorative glassmorphism.
- Do not use colored side-stripe borders.
- Do not put cards inside cards.
- Do not make the first screen a marketing or explanatory page.
- Do not keep low-frequency settings actions globally visible on every mode.
- Do not model the management panel after a website, landing page, or generic web chat input.
- Do not duplicate the full HUD capsule inside Dashboard; show only status or a small summary.
- Motion should communicate state only and respect `prefers-reduced-motion`.

## Implementation Notes

- Main React UI is in `src/App.tsx`.
- Global styling and Tailwind theme tokens are in `src/App.css`.
- Tauri/Rust commands and events are under `src-tauri/src/`.
- Existing command/event names should not be changed without updating Rust and React together.
- API keys and settings behavior must remain local and clearable.
- Raw local Pi config views should stay read-only unless a spec explicitly changes that.
- If real audio amplitude is not available in frontend events, do not fake amplitude; represent chunk activity or mark amplitude behavior as `uncertain`.
- For capsule behavior and visuals, prefer `docs/features/hud-capsule.md` over Lazyweb references.
- Treat Lazyweb web-page references as indirect layout evidence only.

## Verification

For frontend/layout changes:

- run `pnpm build` when feasible
- start the dev server if needed for visual QA
- verify desktop and narrow widths
- check that text does not overlap
- check that Dashboard opens as the primary management-panel view when implementing the layout spec
- verify Settings still supports test/save flows

If a verification step cannot run, report it explicitly.
