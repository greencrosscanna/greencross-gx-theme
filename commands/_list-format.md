> **These list rules are GLOBAL, and `~/.claude/CLAUDE.md` is the source.** Sky: *"this should be used
> globably."* Numbering every to-do, the `-NEW` marker, the model per item and the acknowledge-then-wait
> handshake apply wherever work is handed off, and the global file loads in every session including this
> one. What follows is the suite's echo, kept because spoke sessions read this file when picking up work.
> **If the two disagree, the global file wins**, and fix this one rather than leaving a rule with two
> homes drifting apart.

**A to-do YOU discovered gets a number too — never raise one in the prose above the list.** His words:
*"if you create a new thing i need to do, you need to add it to the list of items [N], you blend it in
and its confusing."* The list is the interface: he picks by number, so an item introduced in a paragraph
is invisible to that motion — he either misses it or re-reads the whole reply to work out whether it was
a task or commentary. Offering it as optional does not exempt it. *"Add [7] if you want it tracked"* is
still a decision he has to make, so it is still `[7]`, in the list, phrased as an item. It is the same
failure as the recap rule below — *"nothing for you to do"* followed by things to do: a reply that says
where to look and then puts something load-bearing somewhere else.

**Mark anything added since he last saw the list with a trailing `-NEW`.** Re-listing the whole board is
right, and it has a cost: the one item that moved is now sitting among six he has already read past,
indistinguishable from them. The marker shows the delta without him diffing two lists by eye. Drop it
once he has seen that list.

**Group future-version work under its own "Future development" heading, below the current work** (his
words: *"group tasks that are future versions together, ie v2.0 Task, should be grouped as future
development, not part of the current immediate tasks"*). A to-do titled with a version tag it hasn't
reached yet — `v2`, `v2.0`, `v3`, etc. — is not something to do now; mixed into the current list it
reads as equally urgent, and it isn't. **It keeps its `[N]`** in the same running list — this groups the
readout, it doesn't renumber it — so he can still pick it by number.

**End each item with the model to run it on:** `— Sonnet`, `— Opus` or `— Haiku`, meaning the current
version of each. He picks a number and opens a chat, and the model is a decision he otherwise makes
blind, before anyone has looked at the work — while you have just read the code and know whether it is a
one-line toggle or a cross-app contract. Make the call; do not offer two.

Rough calibration, and it is about the SHAPE of the task, not its importance:
- **Haiku** — one obvious edit in one file. A default, a label, a flag, clearing a stray row.
- **Sonnet** — ordinary build-and-verify work. A contained feature, a fix whose cause is already
  known, a screen that needs writing but not designing.
- **Opus** — diagnosis where the cause is unknown, anything touching a shared contract or the
  IMMEDIATE tier, security and credential work, and anything where being subtly wrong is expensive
  and would pass a test anyway.

An item waiting on Sky carries no model: nothing runs until he answers, and a model name there
implies work is queued when it is not.

**When Sky names a number, it opens in a NEW session on its model — and the chip carries no task.**
A task chip (`spawn_task`) opens an item in its own session on one click. But **a chip carries no
model**: the session starts on the default and begins at once. So:

1. The chip's **prompt holds no task** — only *"You will receive a task from the session that opened
   you. Reply with one word — ready — and wait."* What the task is goes in the chip's `title` and
   `tldr`, which Sky sees and the session does not.
2. **In the same response as `spawn_task`, arm the watcher** — `Bash` with `run_in_background`:
   `bash ~/.claude/scripts/watch-new-session.sh`. It exits the moment a new session registers on this
   machine (a new `/tmp/cc-socks/<pid>.sock`), which wakes you without him having to type "opened".
   Then `ListAgents`, find the session by the chip's title, and **set its model** (`set_session_model`).
   If `/tmp/cc-socks` ever stops existing, fall back to asking him to say "opened".
3. **Then send it the full task with the session-management `send_message` tool**, by session id,
   once. It delivers as a user turn immediately. Don't use `SendMessage` for this — to a chip session it
   is held for approval and the card often never shows; sending both duplicates the task. A silent
   session is not a working one: if delivery is reported held or failed, say so.

**Withhold the task; do not merely ask it to wait.** Asking does not hold: a session that can read the
task will start it, before any model is set. A session cannot start work it has not been given. Sky's
words that set this up: *"have it just acknowledge the task, then switch models before it starts
working"*, and *"when i tell it which number to proceed with it didn't open a new session."*

```
[5] Bug form blames your connection for every failure, hiding the real reason — Sonnet
[6] Brain notes default to collapsed instead of expanded — Haiku
[7] Audit Sales' and Crew's credential-leak checks — nobody has asked whether they find
    every leak point or only the ones their author knew about — Opus -NEW

Future development:
[8] v2.0 AVATAR: upgrades as perks for certain goals — Sonnet
```
