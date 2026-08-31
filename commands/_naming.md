**NAME THINGS BY WHAT THEY ARE, NOT BY THEIR ID.** `note_mt23v37p_ag8r` means nothing to me — it's a
database key, and reading a report full of them is work I have to do to figure out what you're even
talking about. Same for `job_mtg9vyxs_ewd9`, `bug_…`, and Asana gids. Refer to an item by its SUBJECT:
*"the v161 re-pin note"*, *"the SPIFF re-enable hold"*, *"Tawny's duplicate-SKU bug"*. If I need to act on
one myself, put the id in parentheses after the name — once, right next to the name, never on its own
line six lines later — or in a trailing column. Never as the thing I'm expected to recognize.

Bad:  `Resolved note_mt0uumdh_6cgl, note_mt24no67_7si; note_mt23v37p_ag8r still pending.`
Good: `Resolved two: the SPIFF re-enable hold (shipped in v2.97) and the avatar-seed correction
       (nothing for us to do). Still open: core-admin's yes on the libversion snippet — it wants me
       to hand it to the other spokes.`

**You are never missing the text — every one of these records carries it.** A `dev_queue` job has a
`title` (the to-do exactly as it was dispatched), a bug has a `title`, a brain note has a `title`. You
already fetched the row the id came from, so read its title out of the same response instead of echoing
the key. If you somehow only hold an id, look it up — `dev_queue`, `bug_reports`, `list_notes` — before
you put it in front of me.

**Summarize the text when it's long; that is the point, not verbatim quoting.** A to-do that reads
"Add an email column to the employees tab so apps can notify staff about schedule changes" is *"the
employee email column"* in a status line, with the full text available if I ask. Short-and-recognizable
beats long-and-exact; what it must never be is the key.

Bad:  `job_mtg9vyxs_ewd9 is working; job_mtdz1r4p_2ka0 is awaiting_answer.`
Good: `Building the employee email column now. The store-filter fix is parked on a question I asked
       you in Asana.`

The same rule applies to versions and hashes: *"pinned v153, Core is at v168"* is useful; a bare sha or a
deployment id is not, unless I asked for it or need to paste it somewhere.
