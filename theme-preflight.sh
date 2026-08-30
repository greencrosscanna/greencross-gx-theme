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
# DERIVED, not typed. This was a hand-written list of seven and had silently fallen behind by three:
# gx-avatar-picker.js and gx-session.js were never linted at all, and gx-updatecheck.js would have
# joined them on 2026-08-27. Every one of these is loaded by URL from Pages by live apps, so an
# unlinted syntax error ships to five of them inside the 10-minute cache. A glob cannot fall behind.
# Same lesson as gxripple.sh's URL-loaded set the same week: do not encode WHICH files, encode WHAT
# they are.
for f in gx-*.js; do
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

# -- credential literals -------------------------------------------------------------------------
# THE REPO THAT SHIPS THIS CHECK DID NOT RUN IT. gx-preflight.sh carries a credential scan and is
# synced into all six spokes; theme-preflight.sh, which guards gx-theme itself, had no equivalent --
# so the one public repo whose files five live apps load by URL was the one nobody scanned.
#
# It matters because of what the scan was written for: six live Dutchie POS keys sat in the PUBLIC
# greencross-leaderboard repo for 101 days. A real redaction pass in June found the original and
# missed a copy made twelve days earlier, because it greped the file it remembered instead of the
# tree. Bare 32-hex keys carry no provider prefix, so GitHub secret scanning does not catch them
# under its default settings either.
#
# Byte-identical to the block in gx-preflight.sh, and tests/preflight_scan_parity_test.js fails if
# the two ever drift. Duplicated rather than shared because a shared file would have to join the
# gx-sync set in every spoke; asserting the copies match buys the same safety for one test.
echo "  scanning for credential literals..."
_secrets="$(python3 - <<'PYEOF'
import re, subprocess, os
try:
    files = [f for f in subprocess.run(['git','ls-files'], capture_output=True, text=True).stdout.split(chr(10)) if f]
except Exception:
    raise SystemExit(0)
SKIP = {'gx-preflight.sh'}
# Vendored third-party bundles. A minified library is full of 32-hex runs that are not secrets --
# vendor/xlsx@0.18.5/xlsx.full.min.js in gx-theme produces three -- and a scan that cries wolf on
# code nobody wrote gets switched off, which is worse than not having it. Narrow on purpose: it skips
# vendor/ and .min.js, NOT whole file types, so a real key in real source is still caught.
#
# NO LONE APOSTROPHES ANYWHERE IN THIS HEREDOC. It sits inside a command substitution, and the shell
# scans that for the matching paren while tracking quotes -- so a single unbalanced quote character
# in a PYTHON COMMENT desyncs it and the whole gate dies with "unexpected EOF while looking for
# matching )". Cost twenty minutes on 2026-08-29, twice: once in a comment about the vendor skip, and
# again in the comment warning about it. Write "does not", never the contraction or the possessive.
def vendored(p):
    parts = p.split('/')
    return 'vendor' in parts or 'vendors' in parts or 'third_party' in parts or p.endswith('.min.js')
HEX32 = re.compile(r'\b[0-9a-f]{32}\b')
Q = chr(39) + chr(34)
ASSIGN = re.compile(r'(?i)(api[_-]?key|secret|token|password|passwd|credential)\s*[:=]\s*[' + Q + r']([A-Za-z0-9_\-]{20,})[' + Q + r']')
def randomish(v):
    return any(c.isdigit() for c in v) and any(c.islower() for c in v)
out = []
for f in files:
    if f in SKIP or vendored(f) or not os.path.isfile(f):
        continue
    try:
        txt = open(f, encoding='utf-8', errors='ignore').read()
    except Exception:
        continue
    if chr(0) in txt[:4096]:
        continue
    for n, line in enumerate(txt.split(chr(10)), 1):
        if '@notasecret' in line:
            continue
        if HEX32.search(line):
            out.append(f + ':' + str(n) + ': 32-hex literal (Dutchie POS key shape)')
            continue
        m = ASSIGN.search(line)
        if m and randomish(m.group(2)):
            out.append(f + ':' + str(n) + ': ' + m.group(1) + ' assigned a literal secret')
print(chr(10).join(out[:40]))
PYEOF
)"
if [ -n "$_secrets" ]; then
  echo "  X credential literal in a tracked file -- rotate it, then move it to Script Properties:"
  printf '%s\n' "$_secrets" | sed 's/^/      /'
  FAIL=1
else
  echo "  OK no credential literals in tracked files"
fi

# ── tests ────────────────────────────────────────────────────────────────────────────────────────
# The parse checks above prove these files are syntactically valid JS. They cannot prove the shared
# layer still BEHAVES — and this repo is loaded live from Pages by five apps, so a behavioural
# regression here ships to all of them with no deploy and no review in between. Anything with a test
# gets it run on the way out.
# JUDGE THE COMMIT, NOT THE DESK. Same change gx-preflight.sh got on 2026-08-29, and this repo has
# the least excuse to skip it: five apps load these files live from Pages, so what HEAD contains is
# what production gets, working tree or not. A clean tree needs no worktree. The worktree is a
# SIBLING because seven suites here read ../greencross-<app>, and a /tmp worktree would resolve that
# to nothing and turn every cross-repo check into a silent skip.
_rundir="."
_wt=""
_scope="working tree"
if [ -n "$(git status --porcelain 2>/dev/null || true)" ]; then
  _sha="$(git rev-parse HEAD 2>/dev/null || true)"
  _wt="../.gxthemepreflight-$$"
  if [ -n "$_sha" ] && git worktree add --detach "$_wt" "$_sha" >/dev/null 2>&1; then
    _rundir="$_wt"
    _scope="HEAD $(printf '%s' "$_sha" | cut -c1-8) — tree is dirty, so this is what a push sends"
    trap 'git worktree remove --force "$_wt" >/dev/null 2>&1 || true' EXIT INT TERM
  else
    _wt=""
    echo "  ! could not create a worktree at HEAD — tests ran against the WORKING TREE, which is NOT"
    echo "    what is being pushed. Treat a pass here as unproven."
  fi
fi
if ls "$_rundir"/tests/*_test.js >/dev/null 2>&1; then
  echo "  tests run against: $_scope"
  for t in $(cd "$_rundir" && ls tests/*_test.js); do
    # `if out="$(...)"` and NOT `out=...` followed by `[ $? -eq 0 ]`. Under the `set -eu` at the top,
    # a failing assignment aborts the script THERE — so the ✗ branch, FAIL=1 and the PUSH BLOCKED
    # message below were all unreachable, and a failing test blocked the push while printing nothing
    # about why. That is exactly what happened on 2026-08-23: deploy_version_test.js failed with
    # "LOAD FAILED", git said only "failed to push some refs", and the reason had to be traced with
    # `sh -x`. A gate that blocks silently teaches people to reach for --no-verify.
    # An assignment inside an `if` condition is exempt from errexit, which is why this form works —
    # it is the form gx-preflight.sh and the hub's run-tests.sh already use.
    if out="$(cd "$_rundir" && node "$t" 2>&1)"; then
      echo "  ✓ $t — $(echo "$out" | grep -Eo '[0-9]+ passed, [0-9]+ failed' | tail -1)"
    else
      echo "  ✗ $t"
      # Match the failing assertions AND the last line. A test that dies before it can assert anything
      # — a loader that cannot find what it parses, a syntax error, a missing file — prints a message
      # matching none of these patterns, so the grep alone showed an empty ✗ block. The tail is the
      # backstop that guarantees SOMETHING explains the block.
      echo "$out" | grep -E "FAIL|Error|error|LOAD" | head -12 | sed 's/^/      /'
      echo "$out" | tail -1 | sed 's/^/      /'
      FAIL=1
    fi
  done
fi
if [ -n "$_wt" ]; then
  git worktree remove --force "$_wt" >/dev/null 2>&1 || true
  trap - EXIT INT TERM
fi

if [ "$FAIL" = "1" ]; then
  echo ""
  echo "PUSH BLOCKED — this repo feeds every app. Fix the ✗ items, or bypass with: git push --no-verify"
  exit 1
fi
echo "  ✓ shared layer clean — safe to push."
