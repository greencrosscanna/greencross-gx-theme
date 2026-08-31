---
description: /gxwhatsnext — what to build next in THIS app, per the Command Center
argument-hint: [optional: a focus area, e.g. bugs]
---

# /gxwhatsnext — what to build next in THIS app, per the Command Center

Runs a quick **housekeeping pass** (close out done to-dos / notes / jobs) and then pulls this app's prioritized
next work from GX Core (the Command Center's AI digest + build order) — so you start each project from a clean
board, right here, without switching to the Command Center. The order is Claude's dependency-aware build
sequence, kept fresh in the CC.

<!-- @include _gxcore.md -->

## Do this
1. **Identify THIS app's key** from its `CLAUDE.md` (the app key it uses with the brain): one of
   `inventory`, `sales`, `performance`, `pricecards`, `spiff`, `crew`, `core-admin`. That is the
   complete list — each spoke also states its own key in `.gx_app`, which is the tiebreaker. If you
   can't tell, ask which app this is before continuing.
2. **Housekeeping FIRST — reset the board.** The goal: go into "what's next" with everything we've worked on
   purged and the Command Center fresh. Close out what's genuinely done; surface (don't force-close) the rest.
   **Track the counts as you go** — you'll report a summary at the end.
   **Every housekeeping call below is secret-gated** — `dev_queue`, `dev_delete`, `dev_ship`, `notes`,
   `resolve_note`, `bugs`, `bug_update`, `purge_notes`. Send
   `--data-urlencode "secret=$(cat .gx_deploy_secret)"` on all of them. Omit it and you get
   `{"ok":false,"error":"bad deploy secret"}`, which reads like a WRONG secret rather than a missing one.
   - **Lingering done jobs** (`action=dev_queue`, filter to this app): a `done` job still in the queue →
     `dev_delete&id=…` to clear it; an `in_review` job whose PR is merged → `dev_ship&id=…`. Never leave
     finished work sitting `working`. *(Count cleared/shipped.)*
     ```
     curl -sL --http1.1 -G "<GXCORE>" --data-urlencode action=dev_queue \
       --data-urlencode "secret=$(cat .gx_deploy_secret)"
     ```
   - **Pending notes** + **open bugs** — list them, and give each one of THREE dispositions. The third
     is the one that keeps the board honest:
       1. **verifiably handled** → `resolve_note&id=…` / `bug_update&id=…&status=resolved`
       2. **still actionable by an agent** → leave pending and surface it (don't auto-close on a guess)
       3. **real, read, and only a HUMAN can advance it** → `block_note&id=…&blocked_on=<who/what it
          waits on>`. Not a resolve (nothing was done) and not a silent leave (it is real). The note
          stays in the inbox but renders as "⏸ BLOCKED on a human" instead of as fresh work, so it stops
          re-surfacing verbatim every session. `blocked_on` is REQUIRED — parking with no reason is a
          silent drop with extra steps. `unblock_note&id=…` puts it back to pending when Sky answers.
     Use `status=open` to list pending AND blocked in one call; `status=pending` for fresh only.
     *(Count closed / blocked / left.)*
     ```
     curl -sL --http1.1 -G "<GXCORE>" --data-urlencode action=notes --data-urlencode app=<APP> \
       --data-urlencode status=pending --data-urlencode "secret=$(cat .gx_deploy_secret)"
     curl -sL --http1.1 -G "<GXCORE>" --data-urlencode action=bugs --data-urlencode app=<APP> \
       --data-urlencode "secret=$(cat .gx_deploy_secret)"
     ```
   - **Purge resolved clutter** (`action=purge_notes`) — safe: only deletes already-resolved notes, pending
     untouched. Resolved notes sit in a 7-day grace window first, so `deleted:0` with a large
     `kept_in_grace` is a healthy answer, not a failure. *(Count purged.)*
     ```
     curl -sL --http1.1 -G "<GXCORE>" --data-urlencode action=purge_notes \
       --data-urlencode "secret=$(cat .gx_deploy_secret)"
     ```
   - **Do NOT regenerate the digest.** Never call `action=ai_strategy` here — it's slow (~60s+) and expensive,
     and Sky regenerates it himself in the Command Center cockpit. Just read whatever digest is current.
   - **Report a housekeeping summary** before moving on — a compact "🧹 Cleaned up" block:
     `N done jobs cleared · M notes purged · K bugs closed`, then **one line per item you actually closed,
     naming it and ending the line with a ✅** (job shipped/cleared, note resolved, bug closed) — so the
     done work is scannable at a glance instead of hiding inside a count. Purged resolved notes stay a
     count only; they were already closed. Then list **anything still pending that needs Sky, NUMBERED
     starting at [1]** (each surviving pending note / open bug on its own numbered line, **no ✅** — the
     checkmark means done, never "seen"). Mark anything you parked with `block_note` as **⏸ blocked on
     Sky** and say what it waits on, so "I need a decision from you" is visibly different from "this is
     unstarted work". This is the proof the board is fresh, and it seeds the running
     item numbers for step 4.

     ```
     🧹 Cleaned up — 2 done jobs cleared · 3 notes purged · 1 bug closed
        Send to Managers button (job 412, merged) ✅
        Note: employees tab needs an email column ✅
        Bug #57 store filter drops Baseline ✅
     Still pending:
        [1] Note from `sales`: confirm the new goal payload shape
     ```
3. **Fetch this app's next work:**
   ```
   curl -sL --http1.1 -G "<GXCORE>" --data-urlencode action=whats_next \
     --data-urlencode "secret=$(cat .gx_deploy_secret)" --data-urlencode app=<APP>
   ```
   (If the reply is empty/HTML — a transient GX Core glitch — just retry a couple times.)
4. **Present it, in this order. NUMBER EVERY ACTIONABLE ITEM `[1] [2] [3]…` in ONE continuous running list**
   so Sky can act by number ("do 3", "note 1", "start 2"). The count CONTINUES from the housekeeping
   still-pending items (so if 2 notes are pending, the first In-flight/next item is `[3]`). Put the number
   at the front of each line; keep it stable within the reply.
   - **In flight** (`inFlight`: queued / working / in_review jobs) — surface these first and **do NOT
     re-dispatch or rebuild them**. If one is `in_review` with a PR, the next move is to review/merge it.
   - **What's next** (`buildOrder`) — the recommended build order for this app, and the answer to "what's
     next". Lead with the top item and its wave.

     **Dispatched work comes first and is already marked.** An entry with `dispatched: true` is one Sky
     queued from the Command Center — a decision someone made by clicking, which outranks the digest's
     schedule-generated sequence. GX Core puts these at the head of `buildOrder` and removes them from
     `backlog`, so **never present a dispatched item as backlog**. Each carries `job_id` and `status`;
     one whose wave reads *"Dispatched from the Command Center"* was never sequenced by the digest at all.
     These are the same jobs as `inFlight` — that overlap is deliberate, the two answer different
     questions ("what is running" vs "what do I build next") — so **give each one number, not two**:
     list it under In flight, and when you reach What's next say the top item is that same `[n]` rather
     than renumbering it.

     If `buildOrder` is empty (no digest yet, nothing dispatched, and none of this app's items are
     sequenced), fall back to the app's open **`backlog`** (Asana order) and say so.
   - **Cross-app priorities** (`priorities`) that touch this app — mention briefly if present.
   - **Flag a stale digest.** Since we no longer regenerate it, check `digest_at` in the response: if it's more
     than a day old (or `has_digest` is false), say so in one line — "digest is from <date>; regen in the
     cockpit if the order looks off" — so Sky knows the sequence may not reflect recently-closed work.
5. **Offer to start the top item right here.** If Sky says go:
   - **Rename this chat to the task, immediately** — do this first, before any other tool call, so the session
     is identifiable in the session list from the moment work starts. Call `set_session_title` with
     `session_id: "self"` and a **short** title derived from the selected item: 3–6 words, ~40 chars max,
     Title Case-ish, no app prefix, no ticket ids, no trailing punctuation — the *thing being built*, not the
     full to-do text. Do it silently (no narration beyond a brief "renamed this chat to …" if it's natural).
     Examples: "Send to Managers button" → `Send to Managers Button`; "Add email column to employees tab so
     apps can notify staff" → `Employee Email Column`; "Fix daily-target drift between LB and Sales" →
     `Daily Target Drift Fix`. If Sky picks a *different* task later in the same chat, rename again to the new
     one. Don't rename for housekeeping items, questions, or anything he didn't actually start.
   - **Then register it as in-progress** so the Command Center reflects it (this is the whole point — work
     started in-app must show on the CC board). `dev_start` marks it `working` — creating a linked job, or
     flipping an existing one. Use the item's `task_gid` from the fetch (build-order and backlog items have one):
     ```
     curl -sL --http1.1 -G "<GXCORE>" --data-urlencode action=dev_start \
       --data-urlencode "secret=$(cat .gx_deploy_secret)" --data-urlencode app=<APP> \
       --data-urlencode task=<TASK_GID> --data-urlencode 'title=<the to-do text>'
     ```
   - **Implement** it in this repo, follow the app's own `CLAUDE.md` + the shared `/gxbrain` rules, verify in
     the running app.
   - **Ship** per the ship policy — which depends on the SIZE of the change, not just the app:

     <!-- @include _ship-policy.md -->

     `dev_ship` (or `dev_update … status=done`) closes the loop and auto-completes the Asana to-do.

Keep it tight: a one-line housekeeping result, then a short "in flight / next up / then" readout, then offer to
build the top one. The point is to keep momentum inside the app chat.

## Closing out

<!-- @include _closeout.md -->
