#!/usr/bin/env node
/* ─── the credential scan exists twice — it must stay the SAME twice ─────────────────────────────
 *   RUN:  node tests/preflight_scan_parity_test.js   (also run by ./theme-preflight.sh)
 *
 * WHY
 * The scan that blocks credential literals lives in two files:
 *   gx-preflight.sh     — the TEMPLATE, synced into all six spokes
 *   theme-preflight.sh  — gx-theme's own gate
 * It was in the first and not the second, which meant the repo that SHIPS the check was the one repo
 * not running it — and it is the public one whose files five live apps load by URL from Pages.
 *
 * Copying it fixed that and created a new risk: two copies drift, and the one nobody looks at rots.
 * The usual answer is to extract a shared file, but a new shared file has to join the gx-sync set in
 * every spoke, which is a much wider change than the hole justifies. So: duplicate deliberately, and
 * make drift a test failure. That is cheap and it cannot rot silently.
 *
 * THE OTHER THING THIS GUARDS, which cost real time on 2026-08-30:
 * The block sits inside a command substitution. The shell scans that for its matching paren while
 * tracking quote state, so ONE unbalanced apostrophe anywhere in the heredoc — including inside a
 * Python comment — desyncs the scan and the entire gate dies with "unexpected EOF while looking for
 * matching )". Not a subtle degradation: the gate stops running. It happened twice in ten minutes,
 * the second time in the comment added to warn about the first. A human will write "does not" as
 * "doesn" + apostrophe + "t" eventually, so this asserts the balance instead of hoping.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };

/* The scan is delimited by its own heredoc markers, so it can be lifted without a line-number map
   that would go stale on the first edit above it. */
function extractScan(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const start = src.indexOf('_secrets="$(python3 - <<');
  if (start < 0) return null;
  const endMarker = '\nPYEOF\n)"';
  const end = src.indexOf(endMarker, start);
  if (end < 0) return null;
  return src.slice(start, end + endMarker.length);
}

console.log('1. both gates carry the scan');
const tpl = extractScan('gx-preflight.sh');
const own = extractScan('theme-preflight.sh');
ok(tpl !== null, 'gx-preflight.sh (the spoke template) has the credential scan');
ok(own !== null, 'theme-preflight.sh (gx-theme own gate) has the credential scan');

console.log('\n2. and they have not drifted');
if (tpl && own) {
  if (tpl === own) {
    ok(true, 'the two copies are byte-identical (' + tpl.split('\n').length + ' lines)');
  } else {
    const a = tpl.split('\n'), b = own.split('\n');
    const diffs = [];
    for (let i = 0; i < Math.max(a.length, b.length) && diffs.length < 5; i++) {
      if (a[i] !== b[i]) diffs.push('    line ' + (i + 1) + ':\n      template: ' + (a[i] === undefined ? '<absent>' : a[i])
                                   + '\n      theme:    ' + (b[i] === undefined ? '<absent>' : b[i]));
    }
    ok(false, 'THE TWO COPIES HAVE DRIFTED — a fix applied to one is not protecting the other:\n' + diffs.join('\n'));
  }
} else {
  ok(false, 'cannot compare — one copy could not be extracted');
}

console.log('\n3. quote balance — an unbalanced apostrophe kills the whole gate, silently');
for (const [name, block] of [['gx-preflight.sh', tpl], ['theme-preflight.sh', own]]) {
  if (!block) continue;
  const bad = [];
  block.split('\n').forEach((line, i) => {
    const n = (line.match(/'/g) || []).length;
    if (n % 2) bad.push('line ' + (i + 1) + ': ' + line.trim().slice(0, 90));
  });
  ok(bad.length === 0, name + ' — ' + (bad.length
    ? 'UNBALANCED QUOTE, the gate will die with "unexpected EOF":\n      ' + bad.join('\n      ')
    : 'every line has balanced quotes'));
}

console.log('\n4. the scan still skips vendored bundles');
for (const [name, block] of [['gx-preflight.sh', tpl], ['theme-preflight.sh', own]]) {
  if (!block) continue;
  ok(/def vendored\(/.test(block) && /vendored\(f\)/.test(block),
     name + ' — vendored() is defined AND applied. Without the skip, a minified bundle reads as '
     + 'leaked keys, and a gate that cries wolf gets switched off');
}

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
