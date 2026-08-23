#!/usr/bin/env node
/* ─── deploy.sh — version extraction — tests ──────────────────────────────────────────────────────
 *   RUN:  node tests/deploy_version_test.js   (also run by theme-preflight.sh)
 *
 * WHY
 * deploy.sh read the ?v= cache-buster with `grep -oE '...js\?v=[0-9]+' | grep -oE '[0-9]+'`. Against
 * <script src="spiff.js?v=1.28"> that stopped at the dot and filed the release as **v1** — and printed
 * a SUCCESS line while doing it. version_history is what every app reads for What's New, so it failed
 * silently in the worst possible place. Reported independently by spiff and by crew on 2026-08-23;
 * both were blocked from moving to the suite's 1.NN scheme and were recording releases by hand.
 *
 * The trap this file exists for: the obvious one-character fix is WRONG. Widening the second stage to
 * `[0-9.]+` makes it match the dot in ".js" before it ever reaches the version, so it returns "." for
 * EVERY app — including crew (26) and price-cards (40), which work correctly today. That fix was
 * proposed in good faith and would have broken every spoke's release log instead of one. So the
 * assertions below pin the integer cases as hard as the dotted ones, and explicitly re-run the
 * rejected pattern to prove it is worse.
 *
 * These shell out to the REAL pipeline from deploy.sh rather than reimplementing it in JS. A test that
 * reimplements the thing under test cannot catch the thing under test changing.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEPLOY = fs.readFileSync(path.join(ROOT, 'deploy.sh'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };

/* Pull the live pipeline out of deploy.sh, so this tests what ships. */
const line = DEPLOY.split('\n').find(l => l.trim().startsWith('_ver=') && l.includes('js\\?v='));
if (!line) { console.error('LOAD FAILED: could not find the ?v= extraction line in deploy.sh'); process.exit(2); }
const PIPELINE = line.trim().replace(/^_ver="\$\(/, '').replace(/\)"$/, '').replace(/index\.html/g, '"$1"');

function extract(pipeline, tag) {
  const tmp = path.join(require('os').tmpdir(), 'gxdeployver.html');
  fs.writeFileSync(tmp, '<!doctype html>\n<script src="' + tag + '"></script>\n');
  try {
    return execFileSync('bash', ['-c', 'set -o pipefail; ' + pipeline, '_', tmp], { encoding: 'utf8' }).trim();
  } catch (e) { return '<<error>>'; }
}

console.log('\n1. the real deploy.sh pipeline, against every version shape in the suite');
[
  ['spiff.js?v=1.28',      '1.28', 'spiff — the report that started this'],
  ['crew.js?v=1.27',       '1.27', 'crew — blocked on the same thing'],
  ['crew.js?v=27',         '27',   'crew today (integer) must not regress'],
  ['generator.js?v=41',    '41',   'price-cards today (integer) must not regress'],
  ['app.js?v=3',           '3',    'single digit'],
  ['my-app.min.js?v=2.10', '2.10', 'a dotted minor with a dot in the FILENAME too'],
  ['a_b-c.js?v=10.0',      '10.0', 'underscores and hyphens in the name'],
].forEach(([tag, want, label]) => {
  const got = extract(PIPELINE, tag);
  ok(got === want, label + ' — ' + tag + ' → "' + got + '"' + (got === want ? '' : ' (wanted "' + want + '")'));
});

console.log('\n2. a trailing zero survives — "1.10" must not become "1.1"');
{
  ok(extract(PIPELINE, 'x.js?v=1.10') === '1.10', '1.10 stays 1.10 (string, never parsed as a number)');
  ok(extract(PIPELINE, 'x.js?v=1.0') === '1.0', '1.0 stays 1.0');
}

console.log('\n3. the two REJECTED patterns, re-run to prove they are worse');
{
  // What shipped until 2026-08-23.
  const OLD = `grep -oE '[A-Za-z0-9_.-]+\\.js\\?v=[0-9]+' "$1" | grep -oE '[0-9]+' | head -1`;
  ok(extract(OLD, 'spiff.js?v=1.28') === '1', 'the OLD pattern really did truncate 1.28 → 1');

  // The "one-character fix" both notes proposed first. It is not a smaller fix, it is a bigger break.
  const NAIVE = `grep -oE '[A-Za-z0-9_.-]+\\.js\\?v=[0-9.]+' "$1" | grep -oE '[0-9.]+' | head -1`;
  ok(extract(NAIVE, 'spiff.js?v=1.28') === '.', 'widening only the char class yields "." for a dotted version');
  ok(extract(NAIVE, 'crew.js?v=26') === '.', '…and ALSO breaks the integer apps that work today');
}

console.log('\n4. deploy.sh still refuses a versionless release');
{
  ok(/could not determine a version/.test(DEPLOY), 'the guard message is still there');
  ok(/\[ -z "\$APP_VERSION" \] \|\| \[ "\$APP_VERSION" = "v" \]/.test(DEPLOY),
     'still rejects both empty and a bare "v" — a blank entry in version_history is worse than a visible failure');
  ok(extract(PIPELINE, 'app.js') === '', 'a tag with no ?v= extracts nothing (falls through to APP_VERSION)');
}

console.log('\n5. gx-preflight.sh carries the same pattern, and stays in step');
{
  const PRE = fs.readFileSync(path.join(ROOT, 'gx-preflight.sh'), 'utf8');
  const pat = /\[A-Za-z0-9_\.-\]\+\\\.js\\\?v=\[0-9\]\+\(\\\.\[0-9\]\+\)\?/;
  ok(pat.test(DEPLOY), 'deploy.sh uses the MAJOR.MINOR-aware pattern');
  ok(pat.test(PRE), 'gx-preflight.sh uses it too — two copies drifting is how the bug survived');
}

console.log('\n6. the vMAJOR.BBB format gate — the real block from deploy.sh');
{
  /* Extraction and FORMAT are two different jobs and the tests above only cover the first. deploy.sh
     could extract '1.28' perfectly and still file a version that does not sort against 'v1.280'.
     Same technique as above: run the REAL block, never a reimplementation of it. */
  const start = DEPLOY.indexOf('_bad_version() {');
  const end   = DEPLOY.indexOf('\nesac', start);
  if (start < 0 || end < 0) {
    ok(false, 'LOAD: could not find the format gate in deploy.sh');
  } else {
    const GATE = DEPLOY.slice(start, end + '\nesac'.length);
    const gate = v => {
      try {
        execFileSync('bash', ['-c', 'set -euo pipefail; APP_VERSION="$1"; ' + GATE, '_', v],
                     { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true };
      } catch (e) { return { ok: false, err: String(e.stderr || '') }; }
    };
    // Accepted: exactly one dot, digits both sides, build exactly 3 wide.
    [['v1.583', 'performance today'], ['v3.020', 'inventory, padded'], ['v2.500', 'sales, padded'],
     ['v1.420', 'pricecards, given a MAJOR at last'], ['v1.280', 'spiff and crew, padded']
    ].forEach(([v, why]) => ok(gate(v).ok, `accepts ${v} — ${why}`));

    // Rejected: every shape the suite was actually carrying on 2026-08-23.
    [['v3.02', 'v3.020'], ['v2.4', 'v2.400'], ['v1.28', 'v1.280'], ['v42', 'v1.420'], ['v27', 'v1.270']
    ].forEach(([v, want]) => {
      const r = gate(v);
      ok(!r.ok && r.err.includes(want), `rejects ${v} AND names the fix (${want})`);
    });
    ['2.5', 'v1.0.0', 'v1.abc', '', 'vX', 'x1.000'].forEach(v =>
      ok(!gate(v).ok, `rejects ${JSON.stringify(v)}`));

    /* The pad direction is the whole ballgame. The build is the FRACTIONAL half of a decimal that has
       been counting up, so v1.28 is the 280s. Left-padding to v1.028 would send every app backwards
       past every version it has already shipped — a What's New popup would then re-show years of
       notes, and every "newer than seen" check would invert. Pin the direction, not just the width. */
    ok(gate('v1.28').err.includes('v1.280') && !gate('v1.28').err.includes('v1.028'),
       'pads RIGHT (v1.28 → v1.280), never left (v1.028) — left would move the app backwards');
  }
}

console.log('\n7. GX Core enforces the same rule server-side');
{
  /* The deploy.sh gate is the one that saves a redeploy; this one is the actual gate, because any
     curl can skip the script. They must agree, so the rule is asserted in both places. */
  const core = path.join(ROOT, '..', 'greencross-command-center', 'gx_core.gs');
  if (!fs.existsSync(core)) {
    console.log('  SKIP  gx_core.gs not checked out beside gx-theme — server-side rule unverified here');
  } else {
    const SRC = fs.readFileSync(core, 'utf8');
    ok(/GX_VERSION_BUILD_DIGITS\s*=\s*3/.test(SRC), 'gx_core.gs pins the same 3-digit build width');
    ok(/function gxCheckVersionFormat_/.test(SRC), 'gx_core.gs has the format check');
    ok(/const fmt = gxCheckVersionFormat_\(a, version\); if \(!fmt\.ok\) return fmt;/.test(SRC),
       'gxRecordVersion actually CALLS it — an uncalled validator is the failure mode this pins');
  }
}

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
