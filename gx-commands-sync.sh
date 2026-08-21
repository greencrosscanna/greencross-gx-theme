#!/usr/bin/env bash
# Install / update the shared GX slash commands into ~/.claude/commands.
#
# WHY THIS EXISTS. /gxbrain, /gxwhatsnext and /gxappstart are the shared entry points to the whole
# suite, and they lived ONLY in ~/.claude/commands on one laptop, with no version control at all --
# they were briefly inside an accidental git repo at $HOME, and when that was removed (correctly) they
# were left with no history. A command that scaffolds every future app should not be a file that one
# bad sed can silently destroy.
#
# So gx-theme owns them, the same way it owns gx-theme.css and gx-client.js, and this pulls them down.
#
# WHY NOT gx-sync.sh: that installs per-REPO dev files (the SessionStart hook, deploy.sh) into the repo
# it is run in. Slash commands are USER-level -- one copy in ~/.claude/commands serves every repo -- so
# installing them per-repo would mean eight copies drifting apart, which is the exact problem the
# shared layer exists to prevent.
#
#   ./gx-commands-sync.sh            install or update
#   ./gx-commands-sync.sh --dry-run  show what would change, touch nothing
set -uo pipefail

BASE="https://greencrosscanna.github.io/greencross-gx-theme/commands"
DEST="$HOME/.claude/commands"
STATE="$HOME/.claude/.gx-commands-installed"     # sha of what WE last wrote, per file
CMDS="gxbrain gxwhatsnext gxappstart"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

mkdir -p "$DEST"
touch "$STATE"
sha() { shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1; }
recorded() { grep "^$1 " "$STATE" 2>/dev/null | tail -1 | cut -d' ' -f2; }

changed=0; skipped=0; failed=0
for c in $CMDS; do
  local_f="$DEST/$c.md"
  tmp="$(mktemp)"
  if ! curl -fsSL "$BASE/$c.md" -o "$tmp"; then
    printf '  %-14s FETCH FAILED — left alone\n' "$c"; failed=$((failed+1)); rm -f "$tmp"; continue
  fi

  if [ ! -f "$local_f" ]; then
    [ "$DRY" = 0 ] && { cp "$tmp" "$local_f"; printf '%s %s\n' "$c" "$(sha "$local_f")" >> "$STATE"; }
    printf '  %-14s NEW — installed\n' "$c"; changed=$((changed+1)); rm -f "$tmp"; continue
  fi

  if [ "$(sha "$local_f")" = "$(sha "$tmp")" ]; then
    printf '  %-14s up to date\n' "$c"; rm -f "$tmp"; continue
  fi

  # NEVER silently clobber a local edit. If the file on disk no longer matches what this script last
  # wrote, someone changed it here -- overwriting would destroy work with no warning and no history,
  # which is the failure mode this whole arrangement is meant to end.
  if [ -n "$(recorded "$c")" ] && [ "$(sha "$local_f")" != "$(recorded "$c")" ]; then
    printf '  %-14s LOCALLY MODIFIED — NOT overwritten. Diff and push your change to gx-theme:\n' "$c"
    printf '                 diff %s %s\n' "$local_f" "$tmp"
    skipped=$((skipped+1)); continue      # tmp deliberately left for the diff
  fi

  if [ "$DRY" = 1 ]; then
    printf '  %-14s would update\n' "$c"
  else
    cp "$local_f" "$local_f.bak"          # keep one step back, always
    cp "$tmp" "$local_f"
    printf '%s %s\n' "$c" "$(sha "$local_f")" >> "$STATE"
    printf '  %-14s updated (previous kept as %s.bak)\n' "$c" "$c.md"
  fi
  changed=$((changed+1)); rm -f "$tmp"
done

echo
[ "$DRY" = 1 ] && echo "dry run — nothing written."
echo "$changed changed, $skipped skipped as locally modified, $failed failed."
[ "$skipped" -gt 0 ] && echo "A skipped file means YOUR copy is ahead. Send the change to gx-theme rather than losing it."
exit 0
