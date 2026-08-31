**Close the loop — don't wait to be asked.** When the task's goals look met — the moment you'd naturally
say "that should do it" — **proactively tell Sky it looks complete and offer to ship/close it out.**
Sessions usually resolve with that kind of language on their own; the explicit offer is what makes it
actually get shipped and cleared from the Command Center. Shipping auto-completes the Asana to-do. Don't
leave a finished task sitting `working`.

**Then RE-LIST what's open, numbered — never propose a next task from memory.** Once the job is shipped
(or `in_review` and genuinely out of your hands), do **not** say "want me to look at the store filter
next?" — that item is whatever you happened to notice hours ago, and Sky is being asked to pick from a
list only you can see. He should choose by NUMBER off a fresh list, not by recalling what exists.

Re-fetch, because the board moved while you worked — the thing you just shipped is gone from it, and
something may have been dispatched from the Command Center in the meantime:

```sh
curl -sL --http1.1 -G "<GXCORE>" --data-urlencode action=whats_next \
  --data-urlencode "secret=$(cat .gx_deploy_secret)" --data-urlencode app=<APP>
```

Present it the way `/gxwhatsnext` step 4 does — **in flight first, then the build order, every actionable
item numbered `[1] [2] [3]…` in one continuous list**, one short line each, **named by its `title`, never
its id**. No re-litigating priorities and no essay per item; he is picking, not reading a report. If Sky
names a number, start it: rename this chat to it (`set_session_title`, `session_id: "self"`) and register
it with `dev_start` exactly as `/gxwhatsnext` step 5 says.

If the fetch comes back empty — nothing in flight, nothing sequenced — say so plainly in one line rather
than inventing something to offer.

**Then offer to archive this chat.** Once `dev_ship` succeeds — and only then, never at `in_review`, since
a PR can still bounce back with review comments — ask Sky whether to archive the session, and call
`archive_session` with `session_id: "self"` only if he says yes. One chat per task means a shipped chat is
finished, and archiving clears it from the tray (it stays reopenable from the Archived list). Never archive
speculatively or without an explicit yes.

**Ask both at once, in one message** — the numbered list, with "or say archive and I'll close this chat
out" as the last line. Two separate questions back to back is the thing that makes closing a task feel
like paperwork.
