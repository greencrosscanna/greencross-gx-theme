# greencross-gx-theme

The shared design language for every Green Cross app — one source of truth so the family stays
visually consistent. Extracted from Leaderboard (the most refined app) + GX Core.

Served publicly via GitHub Pages so any app can import it with no build step:

```html
<link rel="stylesheet" href="https://greencrosscanna.github.io/greencross-gx-theme/gx-theme.css">
<img src="https://greencrosscanna.github.io/greencross-gx-theme/gx-logo.png" alt="Green Cross" style="height:26px">
```

## Contents
- `gx-theme.css` — tokens (`--gx-*`: surfaces, text, green + gold, status colors, radii, spacing)
  and primitives (`.gx-btn`, `.gx-input`, `.gx-card`, `.gx-pill`, `.gx-badge-super`, `.gx-avatar`,
  section headers, wordmark). **No store colors** — those are data from GX Core (`?action=stores`)
  so they never drift.
- `gx-logo.png` — the canonical GreenCross logo (same asset used in Inventory & Leaderboard).

## Rollout
Adopt app-by-app: replace each app's hardcoded `:root` and logo with a `<link>` to this theme.
Master Control (GAS-served) inlines the same tokens because of its stricter CSP; keep it in sync
with this file. Edit a token here → every linked app updates.
