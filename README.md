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
- `gx-client.js` — **resilient GX Core client.** GX Core's `/exec` is a two-hop redirect and Google's
  `googleusercontent.com` second hop intermittently 404s with a "unable to open the file" HTML page
  (~6% of rapid calls). As JSONP that page never fires the callback *or* `onerror`, so a naive call
  silently blanks the feature for the session. `GXClient` detects the miss and retries with backoff.
  **Route every GX Core call through it** — no more hand-rolled JSONP.
  ```html
  <script src="https://greencrosscanna.github.io/greencross-gx-theme/gx-client.js"></script>
  <script>
    const GX = GXClient('https://script.google.com/macros/s/AKfyc…/exec');
    const hist = await GX.jsonp('version_history', { app: 'inventory' });   // retries transparently
  </script>
  ```
  (Master Control / GAS-served pages with a strict CSP should inline a copy instead of `<script src>`.)

## Spoke dev scaffolding (synced, not just runtime assets)
Beyond runtime CSS/JS, this repo is also the **source of truth for the dev-time boilerplate** every
spoke repo carries, so a cross-cutting change is a one-place edit instead of an N-repo chore:
- `gx-brain-notes.sh` — the SessionStart hook that surfaces GX Core brain-notes (and bugs, which now
  ride the notes rail) for the current app. Retries through GX Core's ~6% two-hop flake.
- `deploy.sh` — records a release in GX Core's `version_history` (version single-sourced from the
  `?v=NN` cache-buster in `index.html`).
- `gx-sync.sh` — the sync tool the spokes run to pull the two files above.

Both templates use an `__APP__` placeholder that `gx-sync.sh` fills from the repo's `.gx_app`.

**Onboard a new spoke (one time):**
```sh
echo pricecards > .gx_app          # this app's GX Core key
curl -fsSL https://greencrosscanna.github.io/greencross-gx-theme/gx-sync.sh > gx-sync.sh && chmod +x gx-sync.sh
./gx-sync.sh                        # pulls the hook + deploy.sh, wires .claude/settings.json
```
**After changing a shared file here:** each spoke re-runs `./gx-sync.sh` to pick it up. Commit
`.gx_app` and `gx-sync.sh` in the spoke; `.gx_deploy_secret` stays untracked. CLAUDE.md is
intentionally **not** synced — it's per-app content, so start it from scratch or copy once by hand.

## Rollout
Adopt app-by-app: replace each app's hardcoded `:root` and logo with a `<link>` to this theme.
Master Control (GAS-served) inlines the same tokens because of its stricter CSP; keep it in sync
with this file. Edit a token here → every linked app updates.
