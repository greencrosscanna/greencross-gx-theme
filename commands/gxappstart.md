---
description: Bootstrap a new Green Cross suite app — scope interview, repo scaffold, gx-theme sync, brain registration
argument-hint: [app name, e.g. SPIFF]
---

You are bootstrapping a **new Green Cross (GX) suite app** in the CURRENT folder, end to end.
Optional app-name hint from the user: "$ARGUMENTS".

## What the GX suite is (so you scaffold correctly)
- Every app is **its own repo + its own GitHub Pages site**, coordinated through **GX Core** (the
  "brain": shared sign-on, stores registry, brain-notes inbox, bug routing, dev_queue, version_history).
- **Repo boundary = deploy boundary.** A "sub-app" (e.g. sub of Inventory) is a *runtime + coordination*
  relationship — an iframe embed in the parent + a GX Core routing entry — **not** a merged codebase.
- Shared runtime assets come from **gx-theme** by URL (`gx-theme.css`, `gx-client.js`). Shared dev files
  (SessionStart hook, `deploy.sh`) are pulled from gx-theme via **`gx-sync.sh`**, filled from `.gx_app`.
- GX Core URL:
  <!-- @include _gxcore.md -->
- gx-theme Pages base: `https://greencrosscanna.github.io/greencross-gx-theme`

## Ground rules
- **Confirm before outward/irreversible actions:** creating the GitHub repo, pushing, opening PRs,
  sending coordination notes. Read-only steps (Asana, brain notes) need no confirmation.
- **Don't fake core-admin steps.** Minting the app key / sign-on lives in the Command Center; you
  *request* it via a brain note and hand it off — you don't pretend it's done.
- Keep the user in a simple loop: interview → confirm a scope brief → execute → hand off.

---

## Step 1 — Orient (read-only)
- The current working directory is the intended repo root. If it already contains a git repo or files,
  STOP and ask whether to proceed here or point at a fresh empty folder.
- Check tooling: `gh auth status` (GitHub CLI). The shared `.gx_deploy_secret` lives in
  `../greencross-command-center/.gx_deploy_secret` (the canonical source). If it or `gh` is missing,
  tell the user how to fix it before continuing.

## Step 2 — Scope interview (use AskUserQuestion)
**First question, always:** "Is this app already on your Asana board?" — options **"Yes — read it"** /
**"No — fresh start"**.
- **If YES:** use the connected Asana MCP tools (load via ToolSearch if deferred — e.g. `get_my_tasks`,
  `search_tasks`, `get_task`). Search the app name/keywords; read matching tasks, descriptions, and
  subtasks. Also read GX Core for anything pre-seeded: `curl -sL -G "$GXCORE" --data-urlencode
  action=notes --data-urlencode secret=$(cat .gx_deploy_secret) --data-urlencode app=<key>` and
  `action=dev_queue`. Summarize what you found and **pre-fill** the rest of the interview from it.
  - If Asana isn't connected/authed, say so (they can connect via `/mcp`) and continue manually.

Then gather (AskUserQuestion for discrete choices; otherwise just ask):
- **App name + GX key** (lowercase slug — e.g. SPIFF → `spiff`).
- **Vision:** one paragraph — what it does and who uses it.
- **Parent:** standalone, or sub-of-`<app>` embedded as a tab (default here: **sub of Inventory**).
- **Backend:** needs its own Apps Script engine (Dutchie / Google Sheets data) or frontend-only?
- **Data sources:** Dutchie POS? GX Core stores? a Google Sheet? none?
- **Primary surface:** staff kiosk, manager dashboard, embedded tab, etc.

## Step 3 — Scope brief + confirm
Write a short brief (key · vision · parent/embed · backend y/n · data sources · users · first
milestones) and get a thumbs-up before building. Revise per feedback.

## Step 4 — Execute the bootstrap
Let `KEY`=slug, `REPO`=greencross-$KEY, `PAGES`=https://greencrosscanna.github.io/$REPO/.

a. **Create the repo (CONFIRM first).** `gh repo create greencrosscanna/$REPO --public` (remote only),
   then in this folder: `git init`, add the origin remote. Don't push yet.
b. **Scaffold the frontend — load the WHOLE shared layer, and do NOT hand-roll chrome.**

   Every app in the suite has been migrated onto shared nav, avatars, session and store helpers. A new
   app that only links `gx-theme.css` + `gx-client.js` starts out *already needing that migration*, so
   scaffold all of it up front. Load order matters — the two inline blocks must sit where shown.

   ```html
   <link rel="stylesheet" href="https://greencrosscanna.github.io/greencross-gx-theme/gx-theme.css">

   <!-- BEFORE gx-dev.js: every GX Core action this app reads. An action NOT in this list is BLOCKED on
        localhost, and GXDev.check throws SYNCHRONOUSLY from inside jsonp — a sync throw sails past
        .catch(), so if the call sits in boot it aborts everything after it. It is also a RACE: on a cold
        load the call can go out before gx-dev arms, so it fails only sometimes. -->
   <script>window.GX_DEV_READS = ['login', 'stores', 'version_history'];   // add every read you use</script>

   <!-- BEFORE gx-topnav.js: declares "I am the top-level app, not a widget nested in a host." -->
   <script>window.GX_EMBED = false;</script>

   <script src="https://greencrosscanna.github.io/greencross-gx-theme/gx-client.js"></script>
   <script src="https://greencrosscanna.github.io/greencross-gx-theme/gx-stores.js"></script>
   <script src="https://greencrosscanna.github.io/greencross-gx-theme/gx-avatar.js"></script>
   <script src="https://greencrosscanna.github.io/greencross-gx-theme/gx-session.js"></script>
   <script src="https://greencrosscanna.github.io/greencross-gx-theme/gx-topnav.js"></script>
   <script src="https://greencrosscanna.github.io/greencross-gx-theme/gx-dev.js"></script>

   <!-- AFTER gx-topnav.js, and not optional. Pages caches shared scripts for ~10 minutes, so right after
        a theme change the browser may still be running a copy that has never heard of GX_EMBED. Setting
        the flag alone did NOT fix this when it happened — verified, not assumed. Clear the class too. -->
   <script>
   (function () {
     try { if (window.GX_EMBED === false) document.documentElement.classList.remove('gx-embedded'); }
     catch (e) {}
   })();
   </script>
   ```

   - `index.html`: `<title>`, the block above, then `<header class="gx-topnav">` — **use the shared nav,
     do not build a topbar**. Tabs are `<button class="tab gx-topnav-tab" data-tab="…">`; a secondary row
     is `.gx-subnav`. Login uses `.gx-login` / `.gx-login-card` / `.gx-input` / `.gx-btn-green`.
     Load the app JS with a **`?v=1`** cache-buster — that single number is the source of truth
     `deploy.sh` reads for the version.
   - **Never restyle a shared component locally.** A local override of `.gx-btn-green` or `.gx-input`
     wins for this app and silently diverges from the other six — which is how the suite ended up with
     six different login screens. Need a change? Send core-admin a note; only core-admin edits gx-theme.
   - `<key>.js`: a `"use strict"` IIFE stub wired to gx-client for GX Core calls.
   - If **backend**: an `apps-script/` dir with `appsscript.json` + `Code.gs` (a doGet/doPost router in
     the GX Core style), and set up clasp (`clasp create --type webapp --rootDir apps-script`).
c. **Adopt the shared scaffolding:**
   ```sh
   echo $KEY > .gx_app
   curl -fsSL https://greencrosscanna.github.io/greencross-gx-theme/gx-sync.sh > gx-sync.sh && chmod +x gx-sync.sh
   ./gx-sync.sh                                   # pulls the SessionStart hook + deploy.sh, wires settings.json
   cp ../greencross-command-center/.gx_deploy_secret .   # shared secret (canonical source: command-center)
   # If this app has an Apps Script BACKEND, the Script Property MUST be named GX_DEPLOY_SECRET.
   # GC_DEPLOY_SECRET is the legacy name and Core only still reads it as a migration fallback. The two
   # names drifting apart failed SILENTLY once — a guard rejected everything, QuickBooks quietly fell
   # back to a legacy token, and the UI kept rendering correct numbers the whole time.
   printf '.gx_deploy_secret\n' >> .gitignore
   ```
d. **Generate `CLAUDE.md`** from the scope brief — mirror the GX spoke conventions: the app-key line,
   what it is + its parent, the frontend/backend file layout, the "Sync with the brain / `/gxbrain`"
   section, `/gxwhatsnext`, the "close the loop when done" policy, and the gx-theme/gx-client linkage.
   Keep it app-specific (CLAUDE.md is intentionally NOT synced).
e. **Register in the brain (CONFIRM before sending).** Send core-admin a brain note requesting: app key
   `$KEY` registration (sign-on / app_access / version_history) and bug-routing `inventory:$KEY → $KEY`
   so the app's tab bugs reach this chat. `curl` `action=add_note from_app=$KEY to_app=core-admin …`.
   State clearly that the sign-on mint is core-admin's to complete.
f. **Parent embed (if sub-of-Inventory).** Prepare the tab + iframe change on `greencross-inventory`
   (that repo is PR-gated) as a branch + PR pointing at `$PAGES?embed=1`. **Mirror the `spiff` tab, not
   `pricetags`** — spiff is the current pattern and pricetags is a stale slug. Copy three things:
   the `<button class="tab gx-topnav-tab" data-tab="$KEY" id="tab…" style="display:none">`, the
   `<div class="panel" id="panel-$KEY">` + iframe, and the chrome branches that hide `.date-controls`
   and `ctrlBar` when that tab is active.
   **Gate the tab on access.** Do not render it for everyone: ask GX Core `action=grants` with the
   session token and show it only when the user holds `$KEY` — honouring `isSuperadmin`, because a
   superadmin has NO per-app grant row and gating on the grant list alone hides the tab from the one
   person entitled to every app. Fail CLOSED (Core unreachable → stay hidden), and cache the last
   answer so the tab does not pop in seconds late.
   Don't merge; hand the PR link to the user.
g. **Ship v1.** Commit, **push (CONFIRM)**, enable Pages (main / root), then `./deploy.sh` to record
   the version in GX Core, and verify `$PAGES` serves live.

## Step 5 — Hand off
Summarize: repo + Pages URL, what's scaffolded, what's pending on **core-admin** (key mint), and any
**Inventory PR** link. Tell the user to run **`/gxwhatsnext`** in this chat (once registered) to start
building the milestones from the brief.
