## Design Context

### Users

Developers on macOS who want voice input without leaving their workflow. They press a global shortcut, speak, and text appears where their cursor is. When the voice is a task, it hands off to a background Agent. Users open the settings UI rarely — only to configure providers or check on Agent tasks. The interface should respect that: fast in, fast out, zero cognitive load.

### Brand Personality

**Light, Fluid, Invisible** (轻盈、流畅、隐形)

SpeakMore should feel like air — present when needed, gone when not. It is not a dashboard, not a control panel, not an AI product. It is a utility that earns trust by staying out of the way. The UI should evoke the calm of iA Writer or Things: generous whitespace, minimal elements, information that appears on demand rather than all at once.

### Aesthetic Direction

**Minimalist immersive** — inspired by iA Writer, Things, and the terminal-native philosophy of OpenCode's DESIGN.md.

- **Typography**: Monospaced (JetBrains Mono or Geist Mono) for headings, labels, status text, and code. Sans-serif (SF Pro / PingFang SC) for body copy, descriptions, and form values — preserving CJK readability.
- **Color**: Warm cream canvas in light mode, near-black in dark mode. Both follow the DESIGN.md's warm undertone philosophy (never pure white, never pure black). Minimal accent usage — only for active/interactive states.
- **Shape**: 4px radius on interactive elements, 0px on containers. No shadows, no gradients, no decorative borders. Depth via typography weight and spacing, not elevation.
- **Layout**: Content floats in generous whitespace. No heavy sidebars. Navigation is minimal — icons or single words, not labeled panels.
- **Motion**: Framer Motion for page transitions (FLIP/layoutId), micro-interactions on state changes, and a dynamic breathing visual on the overview page. Reduced motion respected via `prefers-reduced-motion`.
- **Theme**: Light and dark modes, following `prefers-color-scheme`. Light uses warm cream canvas (`#fdfcfc`); dark uses warm near-black (`#201d1d`). Both share the same spacing and typography scales.

**Anti-references** (what this should NOT look like):
- AI dashboards with stats cards and streaming logs
- Electron apps with heavy chrome and nested panels
- Settings pages that expose every option equally
- Anything with gradient blobs, glassmorphism, or "modern AI" purple glow

**References**:
- iA Writer — whitespace, focus, typography-driven hierarchy
- Things 3 — calm task management, progressive disclosure
- Raycast settings — clean utility, nothing wasted
- OpenCode marketing site (DESIGN.md) — warm cream, monospace identity, ASCII restraint

### Design Principles

1. **Hide complexity, reveal on demand.** Default to showing less. Advanced settings fold away. Debug info lives behind a separate entry point. The first screen a user sees should answer one question: "Is everything working?"

2. **Silence is the design.** Whitespace is not empty — it is the primary UI element. Sections are separated by space, not lines. Hierarchy comes from typography weight and size, not borders or backgrounds.

3. **Motion with purpose.** Every animation communicates state change — a page entering, a task completing, the app listening. No decorative motion. No loading spinners where a skeleton or fade would suffice. Respect `prefers-reduced-motion`.

4. **One typeface decision per role.** Mono for system/machine voice (labels, status, code). Sans for human voice (descriptions, instructions, body). Never mix within a single text block.

5. **Warm neutrals, cold restraint.** The palette is warm (cream, not white; charcoal, not black) but the application of color is cold and deliberate. Accent color appears only on interactive elements in their active state — never as decoration.

### Color Tokens (Target)

```
Light mode:
  canvas:        #fdfcfc (warm cream)
  surface-soft:  #f8f7f7
  surface-card:  #f1eeee
  ink:           #201d1d
  body:          #424245
  mute:          #646262
  ash:           #9a9898
  hairline:      rgba(15, 0, 0, 0.12)
  accent:        #007aff (only interactive states)

Dark mode:
  canvas:        #201d1d (warm near-black)
  surface-soft:  #302c2c
  surface-card:  #3a3636
  ink:           #fdfcfc
  body:          #c8c6c6
  mute:          #9a9898
  ash:           #646262
  hairline:      rgba(253, 252, 252, 0.12)
  accent:        #007aff
```

### Typography Scale

```
display:    Geist Mono / JetBrains Mono, 32px, 700, 1.2
heading:    Geist Mono / JetBrains Mono, 16px, 600, 1.5
label:      Geist Mono / JetBrains Mono, 13px, 500, 1.5
body:       SF Pro / PingFang SC, 15px, 400, 1.6
caption:    SF Pro / PingFang SC, 13px, 400, 1.5
```

### Spacing

```
xs:   4px
sm:   8px
md:   12px
lg:   16px
xl:   24px
2xl:  32px
3xl:  48px
section: 64px (desktop) / 48px (compact)
```

### Component Guidelines

- **Buttons**: 4px radius, 36px height, mono font. Primary: ink fill + canvas text. Ghost: transparent + hairline border. No shadows.
- **Inputs**: 4px radius, 40px height, surface-soft background. Focus: canvas background + ink border. No glow.
- **Sections**: No border. Separated by `spacing.section` vertical gap. Title in mono heading weight.
- **Navigation**: Minimal — icon or single word per item. Active state: ink color. Inactive: mute color. No backgrounds on nav items.
- **Modals/Dialogs**: No overlay dimming beyond subtle transparency. Sharp corners. Hairline border. Enter via scale(0.98) → scale(1) fade.
- **Terminal**: Flush, no rounded corners, hairline border. Monospace throughout. Warm-tinted ANSI palette.

### Animation Tokens

```
duration-fast:    150ms
duration-normal:  250ms
duration-slow:    400ms
easing-default:   cubic-bezier(0.25, 0.1, 0.25, 1)
easing-spring:    cubic-bezier(0.34, 1.56, 0.64, 1)
easing-exit:      cubic-bezier(0.4, 0, 1, 1)
```

### Accessibility

- WCAG AA contrast minimum on all text
- `prefers-reduced-motion: reduce` disables all transform/opacity animations; state changes remain instant
- `prefers-color-scheme` drives theme switching automatically
- Touch targets minimum 36px
- Focus-visible outlines: 2px solid accent, 2px offset
