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
for f in gx-avatar.js gx-bugreport.js gx-changelog.js gx-client.js gx-dev.js gx-stores.js gx-topnav.js; do
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

# ── Shared slash commands ────────────────────────────────────────────────────────────────────────
# These are shared assets like the scripts above: /gxappstart scaffolds every future app, /gxbrain is
# how every chat orients. They are installed into ~/.claude/commands by gx-commands-sync.sh, so a
# broken one here reaches every machine that syncs. An unbalanced code fence is the nasty case --
# markdown silently swallows the rest of the file, so the command still "works" while missing half
# its instructions.
if [ -d commands ]; then
  _bad="$(python3 - <<'PY'
import io, glob, os
bad = []
for f in sorted(glob.glob('commands/*.md')):
    n = os.path.basename(f)
    s = io.open(f, encoding='utf-8').read()
    if s.count('```') % 2:
        bad.append(n + ' — unbalanced code fence (markdown will swallow the rest of the file)')
    if n == 'README.md':
        continue
    # _partial.md files are INCLUDED into commands, not installed as commands. Frontmatter in one
    # would land mid-file in whatever includes it, and a nested include is a loop the installer
    # refuses -- so partials get the opposite checks.
    if n.startswith('_'):
        if s.startswith('---'):
            bad.append(n + ' — a partial must NOT have frontmatter (it would land mid-file)')
        if '@include' in s:
            bad.append(n + ' — a partial cannot include another partial (the installer refuses it)')
        continue
    if not s.startswith('---') or 'description:' not in s.split('---')[1]:
        bad.append(n + ' — missing frontmatter with a description:')

# every include must name a partial that exists, and must sit alone on its line -- both are
# install-time failures otherwise, on somebody elses machine, after a push.
have = set(os.path.basename(f) for f in glob.glob('commands/_*.md'))
for f in sorted(glob.glob('commands/*.md')):
    n = os.path.basename(f)
    for i, line in enumerate(io.open(f, encoding='utf-8'), 1):
        if '<!-- @include ' not in line:
            continue
        name = line.split('<!-- @include ', 1)[1].split(' -->', 1)[0]
        if name not in have:
            bad.append('%s:%d — includes %s, which does not exist' % (n, i, name))
        if line.split('<!-- @include', 1)[0].strip():
            bad.append('%s:%d — an include must be alone on its line' % (n, i))
print('\n'.join(bad))
PY
)"
  if [ -n "$_bad" ]; then
    echo "  ✗ commands/ — a broken command reaches every machine that syncs:"
    printf '%s\n' "$_bad" | sed 's/^/      /'
    FAIL=1
  else
    _nc=$(ls commands/*.md | grep -v "/_" | grep -vc "README"); _np=$(ls commands/_*.md 2>/dev/null | wc -l | tr -d " ")
    echo "  ✓ commands/ — $_nc commands + $_np partials, frontmatter + fences + includes intact"
  fi
fi

# ── vendored libraries ───────────────────────────────────────────────────────────────────────────
# These are upstream bytes and must stay upstream bytes. An edit here would ship to every app that
# loads them, from a directory nobody thinks to review.
if [ -f vendor/verify.sh ]; then
  if sh vendor/verify.sh >/dev/null 2>&1; then
    echo "  ✓ vendor/ — $(grep -c '^[0-9a-f]' vendor/SHA256SUMS) libraries match their checksums"
  else
    echo "  ✗ vendor/ — a vendored file has been MODIFIED. These are upstream bytes; never edit them."
    sh vendor/verify.sh 2>&1 | grep '✗' | sed 's/^/    /'
    FAIL=1
  fi
fi

# ── tests ────────────────────────────────────────────────────────────────────────────────────────
# The parse checks above prove these files are syntactically valid JS. They cannot prove the shared
# layer still BEHAVES — and this repo is loaded live from Pages by five apps, so a behavioural
# regression here ships to all of them with no deploy and no review in between. Anything with a test
# gets it run on the way out.
if ls tests/*_test.js >/dev/null 2>&1; then
  for t in tests/*_test.js; do
    out="$(node "$t" 2>&1)"
    if [ $? -eq 0 ]; then
      echo "  ✓ $t — $(echo "$out" | grep -Eo '[0-9]+ passed, [0-9]+ failed' | tail -1)"
    else
      echo "  ✗ $t"
      echo "$out" | grep -E "FAIL|Error|error" | head -12 | sed 's/^/      /'
      FAIL=1
    fi
  done
fi

if [ "$FAIL" = "1" ]; then
  echo ""
  echo "PUSH BLOCKED — this repo feeds every app. Fix the ✗ items, or bypass with: git push --no-verify"
  exit 1
fi
echo "  ✓ shared layer clean — safe to push."
