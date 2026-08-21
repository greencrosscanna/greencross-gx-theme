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
   `inventory`, `sales`, `performance`, `pricecards`, `core-admin` (plus future: `spiff`, `incentive`,
   `review`, `heatmap`). If you can't tell, ask which app this is before continuing.
2. **Housekeeping FIRST — reset the board.** The goal: go into "what's next" with everything we've worked on
   purged and the Command Center fresh. Close out what's genuinely done; surface (don't force-close) the rest.
   **Track the counts as you go** — you'll report a summary at the end.
   - **Lingering done jobs** (`action=dev_queue`, filter to this app): a `done` job still in the queue →
     `dev_delete&id=…` to clear it; an `in_review` job whose PR is merged → `dev_ship&id=…`. Never leave
     finished work sitting `working`. *(Count cleared/shipped.)*
   - **Pending notes** (`action=notes&app=<APP>&status=pending`) + **open bugs** (`action=bugs&app=<APP>`):
     list them. Anything **verifiably handled** → `resolve_note&id=…` / `bug_update&id=…&status=resolved`.
     Anything still needing action → surface it for Sky (don't auto-close on a guess). *(Count closed / left.)*
   - **Purge resolved clutter** (`action=purge_notes`) — safe: only deletes already-resolved notes, pending
     untouched. *(Count purged.)*
   - **Do NOT regenerate the digest.** Never call `action=ai_strategy` here — it's slow (~60s+) and expensive,
     and Sky regenerates it himself in the Command Center cockpit. Just read whatever digest is current.
   - **Report a housekeeping summary** before moving on — a compact "🧹 Cleaned up" block:
     `N done jobs cleared · M notes purged · K bugs closed`. Then list **anything still
     pending that needs Sky, NUMBERED starting at [1]** (each surviving pending note / open bug on its own
     numbered line). This is the proof the board is fresh, and it seeds the running item numbers for step 4.
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
   - **What's next** (`buildOrder`) — the recommended build order for this app: the CC's dependency waves
     filtered to this app, in sequence. This is the answer to "what's next" — lead with the top item and its
     wave. If `buildOrder` is empty (no digest yet, or none of this app's items are sequenced), fall back to
     the app's open **`backlog`** (Asana order) and say so.
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
