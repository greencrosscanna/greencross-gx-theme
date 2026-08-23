**Ship policy (refined 2026-08-14 — staff use Leaderboard + Inventory daily, so don't let them watch a
feature bake):** match the flow to the change.

- **Pages-hosted spokes** (`inventory`, `sales`, `performance`, `pricecards`):
  - **Small / instant fix** (rename a tab, copy tweak, a contained bug fix that's correct the moment it
    lands) → **ship DIRECT to `main`**: commit only your changed files, run `deploy.sh` (git push `main` →
    Pages + `clasp deploy` for the proxy + records `deploy_version`), verify live, then **`dev_ship`**.
  - **Feature** (new capability, iterative, changes a workflow, or would look half-done mid-build) →
    develop on a **`feat/…` branch + PR**, iterate there, report `dev_update … status=in_review pr_url=…`,
    and **let Sky merge** — merging is shipping. Staff see it appear once, working. Preview without
    exposing staff via a **`cfg.<feature>` flag** (ship dark, flip on from the cockpit) or a local
    preview; the versioned proxy stages backend without repointing the live one. On merge → **`dev_ship`**.
  - Test: *"Would staff notice it mid-bake / does it change their workflow?"* → branch. Trivial/invisible → direct.
- **Pre-launch apps** (`spiff`, `crew`) work **direct on `main`** for everything, feature or fix —
  they have no real users yet, so there is nobody to protect from a half-built screen and a PR buys
  nothing. Move them onto the rule above the day they reach staff.
- **GX Core / the shared `GXCore` library** (`core-admin`) **keep PR + versioned discipline** — library
  versions are immutable and pinned by every spoke, so a bad one silently breaks all apps. (`core-admin`
  itself deploys directly with Sky watching, but treats library-version cuts as gated.)
- Full rationale + the flag pattern: **DEV_NOTES.md** in the GX Core repo.

**Do not read "spokes open a PR" as "spokes always open a PR."** That is the feature path only. A one-line
fix that is correct the moment it lands ships direct — routing it through a PR just parks a finished fix
behind a review that has nothing to review.
