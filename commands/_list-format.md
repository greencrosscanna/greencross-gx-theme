> **These list rules are GLOBAL, and `~/.claude/CLAUDE.md` is the source.** Sky, 2026-09-17: *"this
> should be used globably."* Numbering every to-do, the `-NEW` marker, the model per item and the
> acknowledge-then-wait handshake are not GX conventions — they apply wherever work is handed off, and
> the global file loads in every session including this one. What follows is the suite's echo, kept
> because spoke sessions read this file when picking up work. **If the two disagree, the global file
> wins**, and fix this one rather than leaving a rule with two homes drifting apart.

**A to-do YOU discovered gets a number too — never raise one in the prose above the list.** His words,
2026-09-17: *"if you create a new thing i need to do, you need to add it to the list of items [N], you
blend it in and its confusing."* The list is the interface: he picks by number, so an item introduced in
a paragraph is invisible to that motion — he either misses it or re-reads the whole reply to work out
whether it was a task or commentary. Offering it as optional does not exempt it. *"Add [7] if you want
it tracked"* is still a decision he has to make, so it is still `[7]`, in the list, phrased as an item.

This is the same failure as the recap rule below — *"nothing for you to do"* followed by things to do —
and it arrived the same evening, one message after it. Both are a reply that says where to look and then
puts something load-bearing somewhere else.

**Mark anything added since he last saw the list with a trailing `-NEW`** (his ask, immediately after).
Re-listing the whole board is right, and it has a cost: the one item that moved is now sitting among six
he has already read past, indistinguishable from them. The marker is what makes re-listing worth doing —
it shows the delta without him diffing two lists by eye. Drop it once he has seen that list.

**End each item with the model to run it on** (his ask, 2026-09-17): `— Sonnet 5`, `— Opus 5`,
`— Haiku 4.5`. He picks a number and opens a chat, and the model is a decision he otherwise makes
blind, before anyone has looked at the work — while you have just read the code and know whether it
is a one-line toggle or a cross-app contract. Make the call; do not offer two.

Rough calibration, and it is about the SHAPE of the task, not its importance:
- **Haiku 4.5** — one obvious edit in one file. A default, a label, a flag, clearing a stray row.
- **Sonnet 5** — ordinary build-and-verify work. A contained feature, a fix whose cause is already
  known, a screen that needs writing but not designing.
- **Opus 5** — diagnosis where the cause is unknown, anything touching a shared contract or the
  IMMEDIATE tier, security and credential work, and anything where being subtly wrong is expensive
  and would pass a test anyway.

An item waiting on Sky carries no model: nothing runs until he answers, and a model name there
implies work is queued when it is not.

**If you hand an item to a new session, tell it to acknowledge and STOP.** A task chip (`spawn_task`)
opens the item in its own session on one click, and that is worth doing — the task text travels, so
the new chat does not open by asking Sky what he meant. But **the chip carries no model**: the new
session starts on the default and begins working at once. So end every chip prompt with an explicit
instruction to acknowledge the task in one line, start nothing, and wait. The spawning session then
sets the model (`set_session_model`) and messages it to begin.

Skipping that line costs an interrupt mid-turn — which is how this rule was found on 2026-09-17: the
first chip launched, started on the wrong model, and had to be stopped, re-modeled and restarted
while it was already reading the repo. Sky's words: *"have it just acknowledge the task, then switch
models before it starts working."*

```
[5] Bug form blames your connection for every failure, hiding the real reason — Sonnet 5
[6] Brain notes default to collapsed instead of expanded — Haiku 4.5
[7] Audit Sales' and Crew's credential-leak checks — nobody has asked whether they find
    every leak point or only the ones their author knew about — Opus 5 -NEW
```
