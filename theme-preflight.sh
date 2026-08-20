#!/bin/sh
# ─── theme-preflight — guard the repo with the widest blast radius ───────────────────────────────
# Every app loads gx-theme.css, gx-client.js, gx-stores.js and gx-topnav.js LIVE from Pages, so a bad
# push here reaches production in every app on the next page load. There is no staging and no version
# pin. This is the only thing standing between a typo and six broken apps.
# Installed as .git/hooks/pre-push. Run by hand any time:  ./theme-preflight.sh
#
# Bake changes locally first:  python3 -m http.server 8790  ->  http://localhost:8790/preview.html
set -eu
cd "$(dirname "$0")"
FAIL=0

echo "theme-preflight — checking the shared layer…"

# 1. Every var(--gx-*) must resolve. An unresolved token is not a CSS error: the declaration is simply
#    dropped, so it fails SILENTLY and every app inherits the breakage looking fine locally.
python3 - <<'PY' || FAIL=1
import re, sys
css = open('gx-theme.css', encoding='utf-8').read()
used    = set(re.findall(r'var\((--gx-[a-z0-9-]+)', css))
defined = set(re.findall(r'(--gx-[a-z0-9-]+)\s*:', css))
missing = sorted(used - defined)
if missing:
    print('  ✗ gx-theme.css references undefined tokens: ' + ', '.join(missing))
    sys.exit(1)
print('  ✓ gx-theme.css — all %d referenced tokens resolve' % len(used))
PY

# 2. Braces must balance. A stray brace silently swallows every rule after it.
python3 - <<'PY' || FAIL=1
import sys
css = open('gx-theme.css', encoding='utf-8').read()
o, c = css.count('{'), css.count('}')
if o != c:
    print('  ✗ gx-theme.css braces unbalanced: %d open vs %d close' % (o, c)); sys.exit(1)
print('  ✓ gx-theme.css — braces balanced (%d rules)' % o)
PY

# 3. Every shared script must parse. These are loaded by all six apps.
for f in gx-avatar.js gx-client.js gx-dev.js gx-stores.js gx-topnav.js; do
  [ -f "$f" ] || continue
  if node --check "$f" 2>/dev/null; then echo "  ✓ $f — parses"
  else echo "  ✗ $f — SYNTAX ERROR"; node --check "$f" 2>&1 | head -3 | sed 's/^/      /'; FAIL=1; fi
done

# 4. serve.py must stay a TEMPLATE. It is easy to clobber with an app-substituted copy while testing,
#    and then every spoke syncs a server hardcoded to the wrong app's port.
if [ -f serve.py ] && ! grep -q "APP  = '__APP__'" serve.py; then
  echo "  ✗ serve.py is no longer a template — APP must stay '__APP__' (restore: git checkout serve.py)"
  FAIL=1
else
  echo "  ✓ serve.py — still a template"
fi

# 5. Same for the spoke preflight template.
if [ -f gx-preflight.sh ] && ! grep -q 'APP="__APP__"' gx-preflight.sh; then
  echo "  ✗ gx-preflight.sh is no longer a template — APP must stay \"__APP__\""
  FAIL=1
else
  echo "  ✓ gx-preflight.sh — still a template"
fi

# 6. THE PREVIEW MUST NOT LIE. It exists to show what an app gets; every way it differs from a real
#    app is a defect it can hide. This has bitten twice already: overriding .gx-login's height removed
#    the component's own background and hid the ambient glow, and a <body> without .gx-app missed
#    -webkit-font-smoothing so every label rendered heavier than any app would.
#      (a) it must carry .gx-app on <body>, exactly like every app
#      (b) it must not style ANY .gx-* selector -- preview chrome is .pv-* only
if [ -f preview.html ]; then
  if grep -q '<body class="gx-app">' preview.html; then
    echo "  ✓ preview.html — <body class=\"gx-app\">, renders like a real app"
  else
    echo "  ✗ preview.html — <body> must carry class=\"gx-app\" or it misreports weight and spacing"
    FAIL=1
  fi
  _bad="$(python3 - <<'PY'
import re
s = open('preview.html', encoding='utf-8').read()
head = s.split('</style>')[0] if '</style>' in s else ''
bad = [m for m in re.findall(r'^\s*([.#][\w .:>#\[\]="-]*)\s*\{', head, re.M) if '.gx-' in m]
print('\n'.join(bad))
PY
)"
  if [ -n "$_bad" ]; then
    echo "  ✗ preview.html styles shared components — every such rule can hide a real defect:"
    printf '%s\n' "$_bad" | sed 's/^/      /'
    FAIL=1
  else
    echo "  ✓ preview.html — styles no .gx-* selector"
  fi
fi

if [ "$FAIL" = "1" ]; then
  echo ""
  echo "PUSH BLOCKED — this repo feeds every app. Fix the ✗ items, or bypass with: git push --no-verify"
  exit 1
fi
echo "  ✓ shared layer clean — safe to push."
