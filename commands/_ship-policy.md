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
- **Pre-launch apps** — `spiff` only — work **direct on `main`** for everything, feature or fix: no
  real users yet, so there is nobody to protect from a half-built screen and a PR buys nothing. Move an
  app onto the rule above the day it reaches staff.
- **`crew` is LIVE and runs payroll**, so it follows the Pages-hosted rule above: features go `feat/…` +
  PR with **Sky merging**, small fixes ship direct. *Corrected 2026-09-15* — this clause named `crew`
  pre-launch for three weeks after it stopped being true (Mike's Monday digest has had a real recipient
  since the week of 2026-08-25). A rule that names a VERSION rots visibly when somebody re-pins; a rule
  that names a STATE rots silently, because nothing evaluates the state.
- **GX Core / the shared `GXCore` library** (`core-admin`) **keep PR + versioned discipline** — library
  versions are immutable and pinned by every spoke, so a bad one silently breaks all apps. (`core-admin`
  itself deploys directly with Sky watching, but treats library-version cuts as gated.)
- Full rationale + the flag pattern: **DEV_NOTES.md** in the GX Core repo.

**Do not read "spokes open a PR" as "spokes always open a PR."** That is the feature path only. A one-line
fix that is correct the moment it lands ships direct — routing it through a PR just parks a finished fix
behind a review that has nothing to review.
