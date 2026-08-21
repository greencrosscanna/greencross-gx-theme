**Close the loop — don't wait to be asked.** When the task's goals look met — the moment you'd naturally
say "that should do it" — **proactively tell Sky it looks complete and offer to ship/close it out.**
Sessions usually resolve with that kind of language on their own; the explicit offer is what makes it
actually get shipped and cleared from the Command Center. Shipping auto-completes the Asana to-do. Don't
leave a finished task sitting `working`.

**Then offer to archive this chat.** Once `dev_ship` succeeds — and only then, never at `in_review`, since
a PR can still bounce back with review comments — ask Sky whether to archive the session, and call
`archive_session` with `session_id: "self"` only if he says yes. One chat per task means a shipped chat is
finished, and archiving clears it from the tray (it stays reopenable from the Archived list). Never archive
speculatively or without an explicit yes.
