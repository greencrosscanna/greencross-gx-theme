#!/usr/bin/env node
/* ─── gxengine RECORDS THE VERSION IT PINNED, NOT THE FIRST ONE THAT ANSWERS ─────────────────────
 *   RUN:  node tests/gxengine_pin_record_test.js
 *
 * WHY THIS EXISTS
 * The poll after a deploy used to break on the first SUCCESSFUL read — and a warm Apps Script
 * instance serving the PRE-DEPLOY snapshot is a successful read. It answers with the old version,
 * both loops break, and that number is written to core_pins as what the app is running.
 *
 * Measured 2026-09-04 (crew): gxengine recorded lib_version 299 with the correct sha at 03:07:16;
 * health calls at 03:07:31, :33, :35 answered 299, 300, 300. The instance flipped seconds later.
 *
 * It matters because core_pins is documented — in gxengine.sh's own header and the hub CLAUDE.md —
 * as the only reliable answer to what an app is running, written BY the deploy so the recording
 * cannot be the step that gets skipped. A systematically stale value defeats exactly that. And it is
 * intermittent (inventory recorded 300 correctly minutes earlier), which is how it gets explained
 * away as "it'll catch up".
 *
 * The 12 attempts only ever protected against NO answer. The stale-but-present case is worse: an
 * empty read prints a warning, a stale read looks like a clean deploy.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SH = path.join(__dirname, '..', 'gxengine.sh');
let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log('  PASS  ' + l)) : (fail++, console.log('  FAIL  ' + l)); };

const src = fs.readFileSync(SH, 'utf8');

console.log('\ngxengine RECORDS THE VERSION IT PINNED\n');

/* 1. THE EXTRACTION IS REAL CODE, so run it rather than eyeball it. Lifted verbatim from the script
      and executed against fixture repos in both layouts the suite actually uses. */
function wantLvFor(rootDir, manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gxeng-'));
  fs.writeFileSync(path.join(dir, '.clasp.json'),
    JSON.stringify(rootDir === '.' ? { scriptId: 'x' } : { scriptId: 'x', rootDir: rootDir }));
  const mdir = rootDir === '.' ? dir : path.join(dir, rootDir);
  if (mdir !== dir) fs.mkdirSync(mdir, { recursive: true });
  if (manifest) fs.writeFileSync(path.join(mdir, 'appsscript.json'), JSON.stringify(manifest));
  const script = `
ROOT_DIR="$(python3 -c "
import json
try: print(json.load(open('.clasp.json')).get('rootDir') or '.')
except Exception: print('.')" 2>/dev/null)"
python3 -c "
import json, os
try:
    d = json.load(open(os.path.join('''$ROOT_DIR''', 'appsscript.json')))
    for l in (d.get('dependencies') or {}).get('libraries') or []:
        if l.get('userSymbol') == 'GXCore': print(int(l.get('version'))); break
except Exception: pass" 2>/dev/null`;
  return execFileSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8' }).trim();
}

const bound = v => ({ dependencies: { libraries: [{ userSymbol: 'GXCore', version: String(v) }] } });

ok(wantLvFor('.', bound(300)) === '300',
   'root-layout repo (inventory, leaderboard, sales) — reads the pinned version');
ok(wantLvFor('apps-script', bound(300)) === '300',
   'apps-script-layout repo (crew, spiff) — rootDir is honoured, not assumed');
ok(wantLvFor('apps-script', { dependencies: { libraries: [] } }) === '',
   'an UNBOUND engine (price-cards) yields no expected version, rather than erroring');
ok(wantLvFor('.', null) === '', 'a missing manifest yields nothing rather than crashing the deploy');
ok(wantLvFor('.', { dependencies: { libraries: [{ userSymbol: 'Other', version: '5' }] } }) === '',
   'a different library is not mistaken for GXCore');

/* 2. THE LOOP MUST COMPARE, NOT JUST SUCCEED. */
{
  ok(/WANT_LV=/.test(src), 'the script derives the version it expects');
  ok(/\[ "\$READ" = "\$WANT_LV" \]/.test(src),
     'and the poll breaks on MATCHING that version, not on any successful read');
  ok(/LV_SEEN=/.test(src), 'a stale answer is remembered separately from an accepted one');
  ok(/sleep 5/.test(src),
     'and there is a real wait between attempts — the old loop retried instantly, so 12 tries '
     + 'elapsed in about as long as one and could not span the warm window');
}

/* 3. A STALE READ MUST NOT BE RECORDED. This is the whole point: a gap you can see beats a number
      you cannot trust. */
{
  const rows = /ROWS="\[\{[^\n]*\}\]"/.exec(src);
  ok(!!rows, 'the recorded row is still built in one place');
  ok(rows && /\$LV/.test(rows[0]) && !/\$LV_SEEN/.test(rows[0]),
     'and carries only the ACCEPTED version — never the stale one it saw');
  const warn = src.slice(src.indexOf('if [ -z "$LV" ]'));
  ok(/answered, but never with the version this repo pins/.test(warn),
     'the stale case gets its own message, distinct from "no answer at all"');
  ok(/last live answer: v\$LV_SEEN/.test(warn),
     'which names both numbers, so the reader can tell a warm instance from a wrong pin');
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
