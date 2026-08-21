#!/usr/bin/env bash
# Install / update the shared GX slash commands into ~/.claude/commands.
#
# WHY THIS EXISTS. /gxbrain, /gxwhatsnext, /gxbug and /gxappstart are the shared entry points to the
# whole suite, and they lived ONLY in ~/.claude/commands on one laptop, with no version control at all --
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
# INCLUDES. Rules that MUST be identical across commands -- the ship policy, the note discipline, the
# GX Core URL -- live once in a `_partial.md` and are pulled in with a marker alone on its line:
#
#     <!-- @include _ship-policy.md -->
#
# This script expands them at install time, so the file that lands in ~/.claude/commands is flat and
# self-contained; Claude never sees a marker. Leading whitespace before the marker is applied to every
# line of the partial, so an include nested under a numbered list stays nested.
#
# This exists because the copies HAD drifted: /gxbrain said a small fix ships direct to main while
# /gxwhatsnext said spokes never merge. Which policy an app chat followed depended on which command
# Sky happened to type.
#
#   ./gx-commands-sync.sh            install or update
#   ./gx-commands-sync.sh --dry-run  show what would change, touch nothing
set -uo pipefail

BASE="https://greencrosscanna.github.io/greencross-gx-theme/commands"
DEST="$HOME/.claude/commands"
STATE="$HOME/.claude/.gx-commands-installed"     # sha of what WE last wrote, per file
CMDS="gxbrain gxwhatsnext gxbug gxappstart"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

# Local source dir wins when this is run from a checkout -- so you can test an edit before pushing.
SRC=""; [ -d "$(dirname "$0")/commands" ] && SRC="$(cd "$(dirname "$0")/commands" && pwd)"

mkdir -p "$DEST"
touch "$STATE"
CACHE="$(mktemp -d)"
trap 'rm -rf "$CACHE"' EXIT
sha() { shasum -a 256 "$1" 2>/dev/null | cut -d' ' -f1; }
recorded() { grep "^$1 " "$STATE" 2>/dev/null | tail -1 | cut -d' ' -f2; }

# fetch <name.md> <dest> -- local checkout first, then Pages
fetch() {
  if [ -n "$SRC" ] && [ -f "$SRC/$1" ]; then cp "$SRC/$1" "$2"; return 0; fi
  curl -fsSL "$BASE/$1" -o "$2"
}

# partial <name.md> -- echoes the cached path, fetching once. Non-zero if it cannot be had.
partial() {
  [ -f "$CACHE/$1" ] && { printf '%s' "$CACHE/$1"; return 0; }
  fetch "$1" "$CACHE/$1" || return 1
  printf '%s' "$CACHE/$1"
}

# expand <raw> <out> -- one pass. Non-zero (and $out is garbage, so discard it) if an include is
# missing: writing a command with half its rules would be worse than not updating it at all.
expand() {
  local raw="$1" out="$2" line indent name p
  : > "$out"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      *"<!-- @include "*" -->"*)
        indent="${line%%<!-- @include *}"
        name="${line#*<!-- @include }"; name="${name%% -->*}"
        # only whitespace may precede a marker -- real text would be prepended to EVERY line of a
        # multi-line partial, quietly producing garbage instead of failing
        case "$indent" in
          *[!' '$'\t']*) printf '  INCLUDE MUST BE ALONE ON ITS LINE: %s\n' "$line" >&2; return 1 ;;
        esac
        p="$(partial "$name")" || { printf '  MISSING INCLUDE: %s\n' "$name" >&2; return 1; }
        # apply the marker's own indentation to every line, so a nested include stays nested
        while IFS= read -r pl || [ -n "$pl" ]; do
          if [ -n "$pl" ]; then printf '%s%s\n' "$indent" "$pl"; else printf '\n'; fi
        done < "$p" >> "$out"
        ;;
      *) printf '%s\n' "$line" >> "$out" ;;
    esac
  done < "$raw"
  # one pass only -- a partial that includes another partial is a loop waiting to happen
  if grep -q "<!-- @include " "$out"; then
    printf '  NESTED INCLUDE (not supported): %s\n' "$raw" >&2; return 1
  fi
  return 0
}

changed=0; skipped=0; failed=0
for c in $CMDS; do
  local_f="$DEST/$c.md"
  raw="$(mktemp)"; tmp="$(mktemp)"
  if ! fetch "$c.md" "$raw"; then
    printf '  %-14s FETCH FAILED — left alone\n' "$c"; failed=$((failed+1)); rm -f "$raw" "$tmp"; continue
  fi
  if ! expand "$raw" "$tmp"; then
    printf '  %-14s INCLUDE FAILED — left alone\n' "$c"; failed=$((failed+1)); rm -f "$raw" "$tmp"; continue
  fi
  rm -f "$raw"
  # from here $tmp is the EXPANDED text -- every comparison below is expanded-vs-installed, which is
  # what makes the checksums mean anything once includes exist.

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
[ "$failed" -gt 0 ] && exit 1
exit 0
