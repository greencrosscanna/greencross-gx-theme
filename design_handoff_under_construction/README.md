# Handoff: GX "Under Construction" / maintenance page

## Overview
A single full-viewport maintenance screen that any Green Cross spoke app can switch on when it goes
haywire. It replaces the app's normal shell with a branded, deliberately funny "we're out back" page:
a giant 4:20 clock, drifting grayscale smoke over the whole UI, a live down-timer, and a rotating
status console. Same page for every spoke — only the app name and (optionally) the console lines change.

## About the Design Files
The files in this bundle are **design references created in HTML** — a prototype showing intended
look and behavior, not production code to lift verbatim. The task is to **recreate this design in the
target codebase's existing environment** (in the GX suite's case: a plain static HTML page loading
`gx-theme.css` from Pages; elsewhere React/Vue/etc. using that project's established patterns).
If no environment exists yet, pick the appropriate one and implement there.

Two notes specific to the GX suite:
- `Under Construction.dc.html` is authored in a component runtime (`support.js`) that will not exist
  in the spoke repos. Ship it as a plain `maintenance.html` with a small inline `<script>` for the
  two timers, or as the framework component equivalent.
- **All colors here are GX theme tokens.** In a real spoke, do not hardcode the hex values below —
  `<link rel="stylesheet" href="https://greencrosscanna.github.io/greencross-gx-theme/gx-theme.css">`
  and use `var(--gx-*)`. The hex values are inlined in the prototype only because the prototype
  cannot depend on that stylesheet. Do not add new rules to `gx-theme.css` for this page; per the
  theme repo README, `core-admin` owns that file.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, copy, and animation timings. Recreate
pixel-perfectly using the shared theme tokens.

## Screens / Views

### Maintenance screen (only view)

**Purpose:** tell a store user, in Green Cross's voice, that the app is intentionally down, that
nothing they did broke it, and give them one way to retry and one way to escalate.

**Layout**
- Root: `position:relative; min-height:100vh; overflow:hidden; display:flex; align-items:center;
  justify-content:center; padding:40px 24px`.
- Root background: `#0a0e0d` + `radial-gradient(1100px 620px at 50% -10%, rgba(74,222,128,.09), transparent 62%)`
  (the same ambient glow as `.gx-login`).
- Content column: `position:relative; width:100%; max-width:620px;` flex column,
  `align-items:center; text-align:center; gap:26px`.
- Two absolutely-positioned decorative layers (see **Interactions & Behavior**): a grid mesh *behind*
  the content and the smoke *above* it (`z-index:20; pointer-events:none`).

**Components, top to bottom**

1. **Logo** — `gx-logo.png` (the shared GX asset), `display:block; width:212px; height:auto`.
2. **Meta line** — flex row, `gap:9px`, directly under the logo (parent group `gap:10px`):
   - App name: 10px / 700 / `letter-spacing:1.4px` / uppercase / `#5e6864` (`--gx-text-mute`).
     Content: the app's name, e.g. "Sales Dashboard".
   - Separator dot: 3×3px circle, `#2e3733` (`--gx-border-strong`).
   - Status: "Out back" — 10px / 700 / 1.4px / uppercase / `#d4a847` (`--gx-gold`), preceded by a
     6×6px gold dot with `box-shadow:0 0 6px #d4a847` pulsing on `gx-pulse 1.8s ease-in-out infinite`.
3. **Clock** — flex row, `align-items:baseline`, `gap:2px`.
   - `4`, `:`, `20`: `ui-monospace,SFMono-Regular,Menlo,monospace`, `font-weight:800`,
     `font-size:108px`, `line-height:.9`, `letter-spacing:-2px`, color `#4ade80` (`--gx-green`),
     `text-shadow:0 0 46px rgba(74,222,128,.35)`.
   - The colon blinks: `gx-blink 1.1s steps(1,end) infinite`.
   - `PM`: 24px, `letter-spacing:1px`, `#2f8a52` (`--gx-green-dim`), `margin-left:10px`.
   - It is a static 4:20 by design — not the real time.
4. **Headline + body** — flex column, `gap:14px`, `max-width:520px`.
   - `<h1>`: 34px / 800 / `line-height:1.15` / `letter-spacing:-.5px` / `#e6ece9` (`--gx-text`),
     `text-wrap:pretty`, `margin:0`.
     Exact copy: `It must be 4:20 — the Tech Team is out back smokin' a Fatty.`
     (Note the em dash and the **capital F in Fatty** — Fatty is a product name.)
   - `<p>`: 15px / `line-height:1.6` / `#8a958f` (`--gx-text-dim`), `text-wrap:pretty`, `margin:0`.
     Exact copy: `Something went sideways, so we took it apart. It'll be back up before the munchies
     hit. Nothing you did caused this and nothing you typed was lost.`
5. **Status card** — `width:100%; max-width:520px; background:#121715` (`--gx-surface`);
   `border:1px solid #232a27` (`--gx-border`); `border-radius:12px` (`--gx-radius-xl`);
   `overflow:hidden`; `box-shadow:0 28px 70px rgba(0,0,0,.5)` (`--gx-shadow-lg`); `text-align:left`.
   Matches `.gx-login-card` construction.
   - Top hairline: 2px tall, `linear-gradient(90deg,transparent,#4ade80,transparent)`, `opacity:.75`
     (same device as `.gx-login-card::before`).
   - Header row: `padding:12px 16px`, `border-bottom:1px solid #232a27`, flex `gap:10px`:
     pulsing 6×6px green dot (`box-shadow:0 0 6px #4ade80`, `gx-pulse 1.8s`), the label `STATUS`
     (10px / 700 / 1.4px / uppercase / `#5e6864`), and right-aligned (`margin-left:auto`) elapsed
     text in mono 11px `#5e6864`, format `down MM:SS`.
   - Body: `padding:14px 16px 16px`, flex column `gap:8px`:
     - Console line: mono 12.5px, `line-height:1.6`, `#8a958f`, `min-height:20px`. Prefix `> `
       in `#2f8a52`, then the current message, then a `▍` caret in `#4ade80` blinking
       `gx-blink 1s steps(1,end) infinite`.
     - Indeterminate bar: track 3px tall, `border-radius:999px`, `background:#1a221f`
       (`--gx-surface-3`), `overflow:hidden`; fill is 45% wide,
       `linear-gradient(90deg,transparent,#4ade80,transparent)`, animated
       `gx-sweep 2.4s ease-in-out infinite` (`translateX(-100%)` → `translateX(220%)`).
6. **Actions** — flex row, `flex-wrap:wrap`, centered, `gap:10px`.
   - Primary button (`.gx-btn.gx-btn-green` equivalent): background & border `#4ade80`,
     `border-radius:6px`, color `#06210f` (`--gx-green-ink`), `font:700 13.5px/1 inherit`,
     `padding:11px 20px`, `cursor:pointer`, `transition:background .15s`.
     Hover: background & border `#5ee68f` (`--gx-green-bright`).
     Label: `Check if they're back`. Action: reload the page.
   - Secondary link (`.gx-btn` equivalent): transparent background, `color:#8a958f`,
     `border:1px solid #2e3733`, `border-radius:6px`, `padding:11px 16px`, `font-size:12.5px`,
     `transition:color .15s,border-color .15s`. Hover: `color:#e6ece9`, `border-color:#4ade80`.
     Label: `Poke the tech team`. Action: `mailto:tech@greencrosscanna.com?subject=Still%20down`
     — **confirm the correct destination address before shipping.**
7. **Sign-off** — 11px, `letter-spacing:.6px`, `#5e6864`. Copy: `BRB. — Green Cross Tech`.

## Interactions & Behavior

**Grid mesh (behind content)**
`position:absolute; inset:0; pointer-events:none; opacity:.45`, two 1px
`rgba(74,222,128,.05)` linear gradients at `background-size:64px 64px`, masked with
`radial-gradient(700px 520px at 50% 40%, #000, transparent 78%)` (set both `mask-image` and
`-webkit-mask-image`). Static, no animation.

**Smoke (above content)**
`position:absolute; inset:0; z-index:20; pointer-events:none; overflow:hidden; filter:blur(40px)`.
It sits **over** the UI on purpose — grayscale and low-alpha so text stays readable.
- 8 circles, all anchored `left:50%; top:50%` and centered with `translate(-50%,-50%)`, so every
  plume originates at the center of the UI and radiates outward.
- Sizes in order: 520, 700, 600, 820, 660, 760, 580, 720 px (square, `border-radius:50%`).
- Fill: `radial-gradient(circle, <gray> <alpha>, <gray> 0 66%)`. Grays cycle
  `rgba(236,241,238)`, `rgba(206,214,210)`, `rgba(176,186,182)`, `rgba(220,228,224)` with alphas
  `0.115`, `0.098`, `0.082`, `0.066` respectively. **No green or gold in the smoke** — grayscale only.
- 8 keyframe tracks `gx-rad1…8`, one per compass direction, each:
  `0% { translate(-50%,-50%) translate3d(0,0,0) scale(.35); opacity:0 }`,
  `18% { opacity:.85 }`, `62% { opacity:.6 }`,
  `100% { translate(-50%,-50%) translate3d(dx,dy,0) scale(2.6); opacity:0 }`
  where (dx,dy) is: `(0,-760)`, `(532,-532)`, `(760,0)`, `(532,532)`, `(0,760)`, `(-532,532)`,
  `(-760,0)`, `(-532,-532)` px.
- Durations 17.0 / 19.9 / 22.8 / 25.7 / 28.6 / 17.5 / 20.4 / 23.3 s, `linear infinite`, with negative
  delays `0 / -3.4 / -6.8 / -10.2 / -13.6 / -17.0 / -20.4 / -23.8 s` so the field is already mid-cycle
  on first paint.

**Shared keyframes**
- `gx-blink`: `0%,45% {opacity:1} 55%,100% {opacity:.15}`.
- `gx-pulse`: `0%,100% {opacity:1; box-shadow:0 0 6px #4ade80} 50% {opacity:.3; box-shadow:0 0 0 #4ade80}`
  (gold dot uses the gold color in place of green).
- `gx-sweep`: `translateX(-100%)` → `translateX(220%)`.

**Timers**
- Down-timer: increments once per second from 0 on mount; rendered `down MM:SS`, zero-padded.
  If the page should survive a refresh, seed it from a server-provided outage start instead.
- Console rotation: advances every 3400 ms, cycling the message list.

**Responsive**
Single centered column; it already reflows. At small widths reduce the clock (`font-size:108px` →
~64px) and the `<h1>` (34px → ~26px); the actions row already wraps.

**Accessibility**
Add `@media (prefers-reduced-motion: reduce)` to disable the smoke, blink, pulse and sweep
animations. Give the status region `aria-live="polite"` if the rotating line should be announced;
otherwise mark the smoke and grid layers `aria-hidden="true"`.

## State Management
- `secs: number` — seconds since mount, drives the `down MM:SS` label. `setInterval` 1000 ms.
- `i: number` — index into the console lines, `% lines.length`. `setInterval` 3400 ms.
- Clear both intervals on unmount.
- No data fetching. Optional future hook: poll a health endpoint and reveal a "we're back" state
  instead of relying on the manual reload button.

**Configuration (per spoke)**
- `appName` (string, default `"Sales Dashboard"`) — the uppercase meta label.
- `lines` (string[], optional) — override the console messages. Defaults:
  `rolling back the last deploy…` /
  `server took a hit, coughing it out…` /
  `re-hydrating the database…` /
  `someone said 'it works on my machine'…` /
  `tech team located. sandwich in hand.` /
  `almost there. do not refresh 40 times.`

## Design Tokens
All from `gx-theme.css` — use the token, not the hex.

| Token | Value | Used for |
| --- | --- | --- |
| `--gx-bg` | `#0a0e0d` | page canvas |
| `--gx-surface` | `#121715` | status card |
| `--gx-surface-3` | `#1a221f` | progress track |
| `--gx-border` | `#232a27` | card border, header rule |
| `--gx-border-strong` | `#2e3733` | separator dot, secondary button border |
| `--gx-text` | `#e6ece9` | headline, secondary button hover |
| `--gx-text-dim` | `#8a958f` | body copy, console line, secondary button |
| `--gx-text-mute` | `#5e6864` | meta labels, elapsed, sign-off |
| `--gx-green` | `#4ade80` | clock, dots, hairline, primary button |
| `--gx-green-bright` | `#5ee68f` | primary button hover |
| `--gx-green-dim` | `#2f8a52` | `PM`, console prompt |
| `--gx-green-ink` | `#06210f` | text on the green button |
| `--gx-glow` | `rgba(74,222,128,.07)` | ambient page glow (prototype uses `.09`) |
| `--gx-gold` | `#d4a847` | "Out back" status |
| `--gx-radius` | `6px` | buttons |
| `--gx-radius-xl` | `12px` | status card |
| `--gx-radius-pill` | `999px` | progress bar |
| `--gx-shadow-lg` | `0 28px 70px rgba(0,0,0,.5)` | status card |
| `--gx-font` | `-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,sans-serif` | all text |

Spacing used, from the GX scale: `gap-sm 6px`, `gap 8px`, `gap-md 10px`, `gap-lg 14px`,
`gap-2xl 24px`, plus 26px between the column's major blocks and 40px/24px root padding.
Mono stack for clock/console/elapsed: `ui-monospace,SFMono-Regular,Menlo,monospace`.

## Assets
- `gx-logo.png` — the canonical GX wordmark, copied from `greencross-gx-theme/gx-logo.png`. In a
  spoke, reference it from Pages rather than committing a copy:
  `https://greencrosscanna.github.io/greencross-gx-theme/gx-logo.png`.
- `gc-icon.png` — favicon, same repo, same rule (keep its alpha; do not use it as a touch icon).
- No other imagery. The smoke and grid are pure CSS; nothing needs to be exported.

## Files
- `Under Construction.dc.html` — the design prototype (component-runtime authored; needs `support.js`
  to run as-is, so treat it as reference and read the markup/styles out of it).
- `screenshot-under-construction.png` — full-page render for reference.
- `gx-logo.png`, `gc-icon.png` — the two assets, as used by the prototype.
