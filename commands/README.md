# GX shared slash commands

`/gxbrain`, `/gxwhatsnext`, `/gxbug` and `/gxappstart` — the shared entry points to the suite. gx-theme
owns them for the same reason it owns `gx-theme.css` and `gx-client.js`: one source, many consumers.

## Why they live here

They used to exist ONLY as files in `~/.claude/commands` on one laptop, with no version control.
For a while they sat inside an accidental git repo at `$HOME`; when that was removed — correctly, it
was staging the entire home folder including live credentials — these were left with no history at
all. During the session that discovered this, `gxbrain.md` changed on disk with nothing anyone ran
touching it, and there was no way to see what changed or roll it back.

`/gxappstart` scaffolds every future app in the suite. It should not be a file that one bad `sed`
can destroy without a trace.

## Installing them

```sh
curl -fsSL https://greencrosscanna.github.io/greencross-gx-theme/gx-commands-sync.sh \
  -o gx-commands-sync.sh && chmod +x gx-commands-sync.sh && ./gx-commands-sync.sh
```

`--dry-run` shows what would change without writing.

**It will not silently overwrite a local edit.** The installer records a checksum of what it last
wrote; if your copy no longer matches, it skips the file, tells you, and leaves the fetched version
in `/tmp` so you can diff. A skipped file means YOUR copy is ahead — send the change here rather than
losing it.

## Why not `gx-sync.sh`

That installs per-REPO dev files (the SessionStart hook, `deploy.sh`) into the repo it runs in. Slash
commands are USER-level: one copy in `~/.claude/commands` serves every repo. Installing them per-repo
would mean eight copies drifting apart — the exact problem the shared layer exists to prevent.

## Changing one

Edit it HERE, commit, push. Pages serves it within ~10 minutes (the same cache window as the rest of
the shared layer), then re-run the installer wherever you use them. Editing your local copy directly
works fine for trying something out, but it is a local fork until you bring it back.

## Shared rules live in partials — don't copy a rule between commands

Anything that must be **identical** across commands lives once in a `_partial.md` and is pulled in by a
marker alone on its own line:

```
<!-- @include _ship-policy.md -->
```

| partial | holds | used by |
|---|---|---|
| `_gxcore.md` | the GX Core `/exec` URL | all four |
| `_ship-policy.md` | direct-to-main vs `feat/` branch, and why | gxbrain, gxwhatsnext |
| `_notes-discipline.md` | read inbox/bugs, resolve-don't-reply, `kind`, outbox | gxbrain |
| `_closeout.md` | offer to ship, then offer to archive | gxbrain, gxwhatsnext |
| `_naming.md` | name things by subject, never by id | gxbrain, gxwhatsnext, gxbug |

`gx-commands-sync.sh` expands these when it installs, so the file that lands in `~/.claude/commands` is
flat and self-contained — Claude never sees a marker. Leading whitespace before a marker is applied to
every line of the partial, so an include nested under a list item stays nested. Anything other than
whitespace before a marker is an error rather than a silent mangling, and a partial that can't be fetched
fails that command and leaves the installed copy untouched — a command with half its rules is worse than
a stale one.

**This exists because the copies had already drifted.** `/gxbrain` said a small fix ships direct to `main`;
`/gxwhatsnext` said spokes never merge. Which policy an app chat followed depended on which command Sky
happened to type. Editing a rule in one file and not the other is exactly the failure the partials remove.

To change a shared rule: edit the partial, commit, push, re-run the installer. To change one command's own
behavior: edit that command. If you find yourself pasting the same paragraph into a second command, it
wants to be a partial.
