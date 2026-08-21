---
description: Load the Green Cross shared brain — apps, data map, owners, and the rules every GX app chat must follow.
---

# Green Cross — shared brain

You are working on one of Green Cross's business apps. Follow this shared context, and if a
request would break a rule below, surface it rather than silently working around it.

## Start here — orient me before building (ask, don't assume)
I won't remember all this setup, so when I invoke `/gxbrain`, DON'T dive in — first pull the
context out of me with a few quick questions. Ask only what you can't already tell from what
I've said, then reflect the setup back in one line and wait for my go-ahead:

1. **Which app or sub-app is this?** — Inventory · Price Cards · SPIFF · Sales/Cashflow ·
   Performance/Leaderboard · Command Center · or something new.
2. **If it's a sub-app:** which parent does it live under, and does it hand data to another
   app? (e.g., SPIFF lives under Inventory but feeds payout data to Performance.)
3. **Which data sheet does it read/write?** — its own app sheet or GX Core. Never GX2.
4. **If it's the Command Center:** which phase are we on? (0 Foundation → 1 Inventory →
   2 Sales & Performance → 3 retire GX2 — one at a time.)
5. **What are we trying to accomplish this session?**

Then confirm it back in one line — e.g. *"Got it: SPIFF sub-app of Inventory (Tawny), writes
payouts to GX Core for Performance to read, goal = X. Sound right?"* — before touching any code.
Keep it light: state what's obvious, only ask what you genuinely need. If I've clearly already
told you all of this, just confirm and go.

## Then sync — reconcile with the Command Center and report (do + confirm)
After orienting (skip the questions above when you already know the app + goal), **reconcile this app with
the brain and report status**. **"brain sync" / "sync brain" are aliases for THIS step alone.**

Cross-app coordination lives in GX Core's central **brain_notes** inbox (not per-repo files). A note
addressed to any app now reaches it. Use this app's key (see its `CLAUDE.md`) as `<APP>`, the shared secret
from `.gx_deploy_secret`, and the GX Core exec URL as
`<GXCORE>` = `https://script.google.com/macros/s/AKfycbx9mjeCBbDpxNYaqBv2hyZaO1hpbGG6PZM9AebFdwl0UwkdtRCGSWrH-8ohEtdF1K_6/exec`

1. **Read your inbox** — pending notes addressed to THIS app (the SessionStart hook also prints these):
   ```
   curl -sL -G "<GXCORE>" --data-urlencode action=notes --data-urlencode "secret=$(cat .gx_deploy_secret)" \
     --data-urlencode app=<APP> --data-urlencode status=pending
   ```
   Also check the actual integration state: `GXCore` library pin, `gxIngestBug`, changelog from
   `version_history`, auto-record via `deploy_version`.
   *Legacy (until this app is migrated): if the repo still has a `BRAIN_NOTES.md` with a non-empty
   `## Pending`, handle those too — that file's coordination role is being retired for the central inbox.*
1b. **Read your open bugs** — reports users filed against THIS app (from GX Core's `bug_reports`, the
   Master Control bug board). Treat these like inbox items: reproduce, fix, verify, deploy.
   ```
   curl -sL -G "<GXCORE>" --data-urlencode action=bugs --data-urlencode "secret=$(cat .gx_deploy_secret)" \
     --data-urlencode app=<APP> --data-urlencode status=open
   ```
   (Omit `status` for the open backlog by default; pass `status=all` to see resolved too.) Surface each
   bug to me before fixing — don't silently start on user-reported issues.
2. **Do each pending item.** App-local UI/logic: implement, **verify in the running app**, then deploy.
   Config/binding (e.g. the `GXCore` pin): apply, redeploy, follow any auth prompt. Commit — stage only your
   own files, never `git add -A`.
3. **Resolve** each done note in GX Core (don't edit a local file):
   ```
   curl -sL -G "<GXCORE>" --data-urlencode action=resolve_note --data-urlencode "secret=$(cat .gx_deploy_secret)" \
     --data-urlencode id=<NOTE_ID> --data-urlencode by=<APP>
   ```
   And **close each fixed bug** (status → resolved, with a one-line resolution):
   ```
   curl -sL -G "<GXCORE>" --data-urlencode action=bug_update --data-urlencode "secret=$(cat .gx_deploy_secret)" \
     --data-urlencode id=<BUG_ID> --data-urlencode status=resolved --data-urlencode 'resolution=…'
   ```
4. **Write note-backs to ANY app** — this is the whole point; they now reach their destination:
   ```
   curl -sL -G "<GXCORE>" --data-urlencode action=add_note --data-urlencode "secret=$(cat .gx_deploy_secret)" \
     --data-urlencode from_app=<APP> --data-urlencode to_app=<TARGET> \
     --data-urlencode 'title=…' --data-urlencode 'body=…'
   ```
   `<TARGET>` is another app's key: `inventory`, `performance`, `sales`, `pricecards`, or `core-admin`
   (the Command Center). Tell me what you sent and to whom.
5. **Work your dispatched worker jobs.** The Command Center dispatches Asana to-dos into GX Core's
   `dev_queue`; THIS app chat is the worker that builds them (in-repo, where you verify locally). Check for
   jobs, claim the oldest, implement + verify, then ship per the **ship policy below**. See `WORKER.md`.

   **Ship policy (refined 2026-08-14 — staff use Leaderboard + Inventory daily, so don't let them watch a
   feature bake):** match the flow to the change.
   - **Pages-hosted spokes** (`inventory`, `sales`, `performance`, `pricecards`):
     - **Small / instant fix** (rename a tab, copy tweak, a contained bug fix that's correct the moment it
       lands) → **ship DIRECT to `main`**: commit only your changed files, run `deploy.sh` (git push `main` →
       Pages + `clasp deploy` for the proxy + records `deploy_version`), verify live, then **`dev_ship`**.
     - **Feature** (new capability, iterative, changes a workflow, or would look half-done mid-build) →
       develop on a **`feat/…` branch + PR**, iterate there, **merge only when done + verified** (staff see it
       appear once, working). Preview without exposing staff via a **`cfg.<feature>` flag** (ship dark, flip on
       from the cockpit) or a local preview; the versioned proxy stages backend without repointing the live one.
     - Test: *"Would staff notice it mid-bake / does it change their workflow?"* → branch. Trivial/invisible → direct.
   - **GX Core / the shared `GXCore` library** (`core-admin`) **keep PR + versioned discipline** — library
     versions are immutable and pinned by every spoke, so a bad one silently breaks all apps. (`core-admin`
     itself deploys directly with Sky watching, but treats library-version cuts as gated.)
   - Full rationale + the flag pattern: **DEV_NOTES.md** in the GX Core repo.
   ```
   curl -sL -G "<GXCORE>" --data-urlencode action=dev_queue --data-urlencode app=<APP> --data-urlencode "secret=$(cat .gx_deploy_secret)"   # list
   curl -sL -G "<GXCORE>" --data-urlencode action=dev_claim --data-urlencode app=<APP> --data-urlencode "secret=$(cat .gx_deploy_secret)"   # claim oldest queued → working
   curl -sL -G "<GXCORE>" --data-urlencode action=dev_ship   --data-urlencode "secret=$(cat .gx_deploy_secret)" --data-urlencode id=<JOB_or_TASK_GID> --data-urlencode 'notes=…'   # spoke: shipped direct
   # (GX Core / library work only: dev_update … status=in_review pr_url=<PR>, then dev_ship on merge)
   ```
   Only `core-admin` (the Command Center) dispatches; every other app chat is a worker for its own jobs.
6. **Always end with a SYNC REPORT:** what's integrated with GX Core, what you did / deployed / resolved /
   sent, dispatched jobs worked, and what's outstanding. If your inbox + job queue are empty and everything's
   integrated, say **"in sync"** with the one-line status.

   **NAME THINGS BY WHAT THEY ARE, NOT BY THEIR ID.** `note_mt23v37p_ag8r` means nothing to me — it's a
   database key, and reading a report full of them is work I have to do to figure out what you're even
   talking about. Same for `job_mswisetb_6dmr`, `bug_…`, and Asana gids. Refer to an item by its SUBJECT:
   *"the v161 re-pin note"*, *"the SPIFF re-enable hold"*, *"Tawny's duplicate-SKU bug"*. If I need to act
   on one myself, put the id in parentheses after the name — once — or in a trailing column. Never as the
   thing I'm expected to recognize.

   Bad:  `Resolved note_mt0uumdh_6cgl, note_mt24no67_7si; note_mt23v37p_ag8r still pending.`
   Good: `Resolved two: the SPIFF re-enable hold (shipped in v2.97) and the avatar-seed correction
          (nothing for us to do). Still open: core-admin's yes on the libversion snippet — it wants me
          to hand it to the other spokes.`

   The same rule applies to versions and hashes: *"pinned v153, Core is at v168"* is useful; a bare sha or
   a deployment id is not, unless I asked for it or need to paste it somewhere.

(The SessionStart hook `.claude/gx-brain-notes.sh` reads this same inbox + open bugs — the passive
heads-up; `/gxbrain` is the active reconcile.)

## The business
Green Cross — 6-store cannabis retailer: Bend, Center, Commercial, Hillsboro, Portland Rd, River Rd.
River Rd is also the distribution hub (DC). Each app is a Google Apps Script backend + an HTML
frontend on GitHub Pages, integrating Dutchie (POS), QuickBooks (finance), and LeafLink.

## The apps & who owns them
- **Inventory** (includes the **Price Cards** dashboard + **SPIFF**) — Tawny
- **Sales / Cashflow** — Shawn
- **Performance / Leaderboard** — Mike
- **Everything + sole backend/Google/code access** — Sky

Access is controlled centrally: a user gets into an app by being granted it in the shared user
list — no code change needed. Roles are enforced at the app login, not the data layer.

## Where the data lives (one sheet per app — NOT one giant sheet)
- **NEVER read or write the legacy "2026 GX2 Dashboard" sheet.** We are retiring it. If a task
  seems to need it, stop and flag it.
- Inventory data = its own dedicated Google Sheet ("Green Cross — Inventory Data"), already
  decoupled. Other apps get their own sheets the same way.
- **GX Core** (shared sheet) is the single source of truth for cross-app data: users/roles &
  access grants, stores, employees, product/SKU dictionary, price-tag config. One writer, many readers.
- Cross-app hand-offs go through a written contract in GX Core (e.g., SPIFF writes `spiff_payouts`;
  Performance reads it). Don't change a shared table's columns without updating both sides.

## Hard rules (learned the hard way — do not relearn them)
- **Dates in sheets are stored as TEXT**, never Date objects (a sheet/script timezone mismatch
  shifts coerced dates by a day and corrupts everything).
- **One sheet per app + retention caps** on any append-only/history table — a Google Sheet dies
  at 10,000,000 cells. Never let a history table grow unbounded.
- **Serialize writes** to a shared cursor/table — concurrent runs race and skip data.
- **GAS limits:** 6-min execution (chunk heavy jobs); 200 versions per script (only cut a new
  version when backend code actually changed); run a node-execute check before deploy to catch
  runtime errors that a syntax check misses.
- After deploying, clear the preview's localStorage and hard-reload so changes show.
- **Commit to git whenever you deploy** — deploying (clasp/Pages) is NOT committing, and they
  drift apart fast (you end up with live-but-uncommitted code). Stage only the files you changed;
  never `git add -A`, which can sweep up another chat's uncommitted work-in-progress.
- **Version notes for the team, not for every keystroke.** Add a changelog / What's New entry
  for meaningful fixes and features the team should see; bundle related changes under one version.
  Skip trivial tweaks (a copy fix, an internal refactor). Move the "latest" highlight to the new
  version and demote the old one.

## How the apps stay consistent ("one brain")
- Every app chat starts from THIS document — that's the connection. Keep them consistent.
- **Sub-apps** (like Price Cards or SPIFF under Inventory) live in the parent app's folder with
  their own short instructions, and inherit everything here. Work them in their own chat.
- Shared logic (login, sheet helpers, connectors, formatting, retention) should be written once
  and reused, not re-implemented per app.

## Command Center roadmap (do ONE phase at a time — don't jump ahead)
- **Phase 0 — Foundation:** build GX Core (users/roles + access grants, stores, employees,
  product/SKU dictionary, price-tag config) + a shared-conventions doc + a shared sign-on plan.
- **Phase 1 — Migrate Inventory** onto GX Core (shared login + shared reference data). Proves the pattern.
- **Phase 2 — Sales & Performance** onto the same core.
- **Phase 3 — Retire the legacy "2026 GX2 Dashboard" sheet** once nothing reads it.

Finish and review a phase before starting the next. If unsure which phase we're in, ask.

## Reminder
Always run the "orient me" step at the top first — don't start building until the setup is
confirmed. And flag any request that would break a rule above before proceeding.
