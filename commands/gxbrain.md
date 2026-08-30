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

<!-- @include _gxcore.md -->

**Also check the actual integration state**, not just the inbox: this app's `GXCore` library pin, that
bugs forward via `gxIngestBug`, its changelog from `version_history`, and auto-record via `deploy_version`.

<!-- @include _notes-discipline.md -->

*Legacy (until this app is migrated): if the repo still has a `BRAIN_NOTES.md` with a non-empty
`## Pending`, handle those too — that file's coordination role is being retired for the central inbox.*

**Do each pending item.** App-local UI/logic: implement, **verify in the running app**, then deploy.
Config/binding (e.g. the `GXCore` pin): apply, redeploy, follow any auth prompt. Commit — stage only your
own files, never `git add -A`.

**Work your dispatched worker jobs.** The Command Center dispatches Asana to-dos into GX Core's
`dev_queue`; THIS app chat is the worker that builds them (in-repo, where you verify locally). Check for
jobs, claim the oldest, implement + verify, then ship per the ship policy below. See `WORKER.md`.

<!-- @include _ship-policy.md -->

```
curl -sL -G "<GXCORE>" --data-urlencode action=dev_queue --data-urlencode app=<APP> --data-urlencode "secret=$(cat .gx_deploy_secret)"   # list
curl -sL -G "<GXCORE>" --data-urlencode action=dev_claim --data-urlencode app=<APP> --data-urlencode "secret=$(cat .gx_deploy_secret)"   # claim oldest queued → working
curl -sL -G "<GXCORE>" --data-urlencode action=dev_ship   --data-urlencode "secret=$(cat .gx_deploy_secret)" --data-urlencode id=<JOB_or_TASK_GID> --data-urlencode 'notes=…'
# (feature work: dev_update … status=in_review pr_url=<PR>, then dev_ship on merge)
```
Only `core-admin` (the Command Center) dispatches; every other app chat is a worker for its own jobs.

**Always end with a SYNC REPORT:** what's integrated with GX Core, what you did / deployed /
**resolved and with what resolution**, dispatched jobs worked, anything your OUTBOX came back with, and
what's outstanding. If your inbox + job queue are empty and everything's integrated, say **"in sync"**
with the one-line status.

<!-- @include _naming.md -->

<!-- @include _closeout.md -->


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
- Cross-app hand-offs go through a written contract in GX Core: Leaderboard publishes its finished
  goal payload to `goal_publications`, and Sales/Cashflow reads it. Don't change a shared table's
  columns — or a published payload's shape — without updating both sides in the same change. That one
  is covered by a test that runs the real consumer against the real producer's shape
  (`tests/cross_app_goals_contract_test.js` in the hub, wrapped into both spokes' push gates).
  *Corrected 2026-08-22: this bullet used to cite "SPIFF writes `spiff_payouts`; Performance reads it."*
  ***No such tab exists*** *— it is not in `GX_TABS`, nothing writes it, and nothing reads it. SPIFF
  keeps payout data in its own sheet and its only GX Core calls are reads. A documented contract that
  does not exist is worse than an undocumented one: it invites a session to "maintain" it, or to assume
  pay data already flows and build on top of it.*

## Hard rules (learned the hard way — do not relearn them)
- **Dates in sheets are stored as TEXT**, never Date objects (a sheet/script timezone mismatch
  shifts coerced dates by a day and corrupts everything). This rule used to stop there, which is
  why it was possible to obey it and still be wrong — it said how to STORE a date and never how to
  COMPUTE one:

<!-- @include _date-rule.md -->

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
