#!/bin/sh
# Prove the vendored bytes are (a) unchanged since commit and (b) identical to upstream.
#
# (a) is the everyday check. (b) is the one that matters when someone asks "are you sure this is
# really Chart.js and not something with a line added?" -- a question a checksum we generated
# ourselves cannot answer. It needs the network, so it is opt-in.
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)" || exit 1
FAIL=0
echo "vendor — checksums"
if shasum -a 256 -c vendor/SHA256SUMS >/dev/null 2>&1; then
  echo "  ✓ all files match SHA256SUMS"
else
  shasum -a 256 -c vendor/SHA256SUMS 2>&1 | grep -v ': OK$' | sed 's/^/  ✗ /'
  FAIL=1
fi

if [ "$1" = "--remote" ]; then
  echo "vendor — upstream comparison"
  while IFS="$(printf '\t')" read -r f u l; do
    [ -z "$f" ] && continue
    tmp="$(mktemp)"
    if curl -sSL --max-time 60 -o "$tmp" "$u" 2>/dev/null && [ -s "$tmp" ]; then
      if cmp -s "$tmp" "$f"; then echo "  ✓ $f — byte-identical to upstream"
      else echo "  ✗ $f — DIFFERS from $u"; FAIL=1; fi
    else
      # A fetch failure is NOT a verification failure. Saying otherwise would mean this script
      # reports tampering every time a CDN has a bad day, which is the exact thing we stopped
      # depending on.
      echo "  – $f — could not reach $u (skipped, not a failure)"
    fi
    rm -f "$tmp"
  done < vendor/SOURCES.tsv
fi

[ "$FAIL" = "1" ] && { echo "VENDOR VERIFY FAILED"; exit 1; }
echo "  ✓ vendor clean"
exit 0
