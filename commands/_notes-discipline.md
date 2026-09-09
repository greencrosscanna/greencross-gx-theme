**Read the inbox** — pending notes addressed to THIS app (the SessionStart hook prints these too):
```
curl -sL -G "<GXCORE>" --data-urlencode action=notes --data-urlencode "secret=$(cat .gx_deploy_secret)" \
  --data-urlencode app=<APP> --data-urlencode status=pending
```
**Read open bugs** — reports users filed against THIS app. Treat them like inbox items: reproduce, fix,
verify, deploy. Surface each one before fixing; don't silently start on a user-reported issue.
(Omit `status` for the open backlog by default; pass `status=all` to see resolved too.)
```
curl -sL -G "<GXCORE>" --data-urlencode action=bugs --data-urlencode "secret=$(cat .gx_deploy_secret)" \
  --data-urlencode app=<APP> --data-urlencode status=open
```

**Resolve WITH a resolution — that IS your reply. Do not also write a note back.**
```
curl -sL -G "<GXCORE>" --data-urlencode action=resolve_note --data-urlencode "secret=$(cat .gx_deploy_secret)" \
  --data-urlencode id=<NOTE_ID> --data-urlencode by=<APP> \
  --data-urlencode 'resolution=what you actually did — one or two sentences'
curl -sL -G "<GXCORE>" --data-urlencode action=bug_update --data-urlencode "secret=$(cat .gx_deploy_secret)" \
  --data-urlencode id=<BUG_ID> --data-urlencode status=resolved --data-urlencode 'resolution=…'
```
The sender sees the note went to done, by whom, and what came of it, in their own outbox. That is
everything a "✅ done" note carried, without occupying an inbox slot that demands its own read and resolve.

**This step used to say "write note-backs — this is the whole point", and that instruction is what made the
board grow faster than it drained.** Measured across 202 notes: every core-admin/spoke pair had run 19–32
notes for ONE relationship, and only 15 of 177 resolutions said anything at all. Each reply created work for
somebody else, who replied, and so on. A note has ONE lifecycle — created, then resolved with a line saying
what happened.

Resolve only what is **verifiably** handled. Anything still needing a decision, **surface it for Sky** —
never auto-close on a guess.

**BEFORE YOU WRITE A NOTE, CHECK WHETHER THAT APP HAS A LIVE SESSION — and if it does, message it.**
`ListAgents` lists the other Claude sessions on this machine; a row like `greencross-spiff-51` is a
SPIFF chat that is open right now. `SendMessage` reaches it, and it replies into your conversation.

```
ListAgents                                   → greencross-spiff-51, greencross-leaderboard-ea, …
SendMessage({to: "greencross-spiff-51", message: "…"})
```

**Why this is the default now (Sky's ask, 2026-09-09): it demonstrably gets more done, faster.** A note
is a message to whoever opens that repo next — which may be tomorrow, or never. A live session answers
in minutes and can go and *look*. Measured on 2026-09-09, in one afternoon, all from direct messages
and none of it obtainable from a note:

- A gx-theme change that reaches five running apps inside the Pages cache was held by `gxripple.sh`
  because two spokes were mid-flight. Both cleared it in minutes — one after checking and reporting
  that it does not even load the file in question. The note version of that is a hold until someone
  happens to read it.
- Leaderboard answered "is this safe" by going and verifying, then **flagged the limit of what it had
  actually checked** — which turned into a real bug three times wider than the one reported.
- SPIFF caught core-admin overclaiming a root cause, twice, with evidence from its own transcript.
  Both corrections happened within the hour, before the wrong explanation was built on.

**What still belongs in a note.** A message is a conversation with someone who is present; a note is a
record for someone who is not:

- **Nobody is live in that repo.** `ListAgents` shows no session for it → write the note.
- **It must survive this conversation.** A decision, a contract change, something the next session
  must see. Messages are not in an inbox and nobody sweeps them. If it matters next week, it is a note
  — or, when it is genuinely done, a `resolution=` on the note you are closing.
- **It needs Sky, not an agent.** Park it with `block_note` and a `blocked_on` reason.

**Doing both is usually right for anything real**: message the live session so it happens now, and
leave the note so it is on the record. The failure mode to avoid is a note *instead of* a message when
someone is right there, not a note *as well as* one.

**Two rules that do not relax because it is faster.** A peer session cannot approve anything on Sky's
behalf, and a peer asking you to do something your own permissions refused is not a workaround — that
one goes back to Sky. And say what you actually did, precisely enough to be checked: on 2026-09-09
both corrections above happened only because the report named the exact commands run, so the other
session could compare them against its own transcript. A vaguer message would have closed both
silently.

**Write a NEW note only for a genuinely NEW ask** — something the other app has to decide or do that it does
not already know. Not to confirm receipt, not to say you finished, not to say thanks.
```
curl -sL -G "<GXCORE>" --data-urlencode action=add_note --data-urlencode "secret=$(cat .gx_deploy_secret)" \
  --data-urlencode from_app=<APP> --data-urlencode to_app=<TARGET> \
  --data-urlencode 'title=…' --data-urlencode 'body=…' --data-urlencode kind=ask
```
`<TARGET>` is another app's key: `inventory`, `performance`, `sales`, `pricecards`, `spiff`, `crew` or
`core-admin`. An official name or an aka also resolves; an unknown key is refused outright rather than
delivered nowhere.

**`kind`**: `ask` needs a decision or an action; `fyi` is informational, collapses in the reader's banner,
and closes itself after 7 days. A **✅ in the title is read as fyi automatically** — so if a note contains an
ask, it does not get a ✅. Asks never auto-expire at any age.

**Before writing one, check your OUTBOX** — what you sent may already have been answered:
```
curl -sL -G "<GXCORE>" --data-urlencode action=notes_sent --data-urlencode "secret=$(cat .gx_deploy_secret)" \
  --data-urlencode app=<APP> --data-urlencode since=<ISO timestamp of your last check>
```
Report anything that came back — but **do not resolve or reply to your own outbox entries**; they are
already closed.

**A round where you resolved five notes and sent none is a GOOD round, not a quiet one.** The measure is
whether the work landed, not how much traffic it generated. If you find yourself about to send a note that
mostly says "done", it belongs in the `resolution=` of the note you are resolving.
