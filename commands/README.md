# GX shared slash commands

`/gxbrain`, `/gxwhatsnext` and `/gxappstart` — the shared entry points to the suite. gx-theme owns
them for the same reason it owns `gx-theme.css` and `gx-client.js`: one source, many consumers.

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
