#!/usr/bin/env node
/* gx-sync.sh must warn when the serve.js it just placed is inside clasp's push scope.
 *
 * WHY THIS EXISTS
 * serve.js is the first ROOT-LEVEL .js file gx-sync has ever placed. clasp pushes .js/.gs/.ts/
 * .html/.json and ignores everything else, so deploy.sh, gx-preflight.sh, gxengine.sh (.sh) and
 * serve.py (.py) were never candidates — eight months of clean syncs proved nothing about this case.
 *
 * When it arises, clasp ships serve.js as serve.gs and `#!/usr/bin/env node` is a parse error that
 * fails the ENTIRE push, naming a file the deployer never touched. Sales hit it for real on
 * 2026-09-03 on an unrelated backend fix. It is armed by the file LANDING, not by the deploy.
 *
 * .claspignore is deliberately not synced, so gx-sync cannot fix this for a spoke — only warn, at the
 * one moment someone is looking. That makes the warning's ACCURACY the whole product:
 *
 *   · a MISSED warning is the broken deploy this exists to prevent;
 *   · a FALSE warning is worse than none, because it is unactionable in a repo that is already fine,
 *     and it trains people to scroll past the true one. Two sessions independently called `spiff`
 *     armed by string-comparing rootDir against "." — it is "apps-script" — and both called
 *     `performance` armed by not recognising an allowlist. This file pins both mistakes shut.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SYNC = path.join(ROOT, 'gx-sync.sh');
const src = fs.readFileSync(SYNC, 'utf8');

let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log('  PASS  ' + l)) : (fail++, console.log('  FAIL  ' + l)); };

console.log('\nCLASP PUSH SCOPE — gx-sync must warn exactly when serve.js would be pushed\n');

/* A guard that does not parse protects nothing. */
{
  let parsed = true;
  try { execFileSync('sh', ['-n', SYNC], { stdio: 'pipe' }); } catch (e) { parsed = false; }
  ok(parsed, 'gx-sync.sh parses as valid sh');
}

/* Extract the guard so the test runs the REAL code, not a paraphrase of it. A reimplementation here
   would drift from the script and pass while the script was broken. */
const START = '# ── WILL clasp PUSH serve.js INTO THE APPS SCRIPT PROJECT? ─';
const i = src.indexOf(START);
ok(i > -1, 'the push-scope guard is present in gx-sync.sh');
const block = src.slice(i, src.indexOf('\nfi\n', src.indexOf('if [ -f .clasp.json ]', i)) + 4);

/* Build a throwaway repo with a given .clasp.json / .claspignore and run the guard in it. */
function probe({ rootDir, claspignore, serveJs = true, absRoot = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claspscope-'));
  if (rootDir !== null) {
    const rd = absRoot ? dir : rootDir;
    fs.writeFileSync(path.join(dir, '.clasp.json'),
      JSON.stringify({ scriptId: 'X', rootDir: rd }));
  } else {
    fs.writeFileSync(path.join(dir, '.clasp.json'), JSON.stringify({ scriptId: 'X' }));
  }
  if (claspignore !== null && claspignore !== undefined) {
    fs.writeFileSync(path.join(dir, '.claspignore'), claspignore);
  }
  if (serveJs) fs.writeFileSync(path.join(dir, 'serve.js'), '#!/usr/bin/env node\n');
  fs.mkdirSync(path.join(dir, 'apps-script'), { recursive: true });
  const out = execFileSync('sh', ['-c', block], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  return /serve\.js is inside clasp's push scope/.test(out);
}

/* ══ ARMED — the warning must fire ══════════════════════════════════════════════════════════════ */
ok(probe({ rootDir: '.', claspignore: null }),
   'rootDir "." with NO .claspignore at all → warns');
ok(probe({ rootDir: '.', claspignore: '**/*.html\n!index.html\ntests/\n' }),
   'rootDir "." with a denylist that never names serve.js → warns (the sales/inventory shape)');
ok(probe({ rootDir: './', claspignore: 'tests/\n' }),
   'rootDir "./" is the repo root too → warns (not just the literal ".")');
ok(probe({ rootDir: null, absRoot: true, claspignore: 'tests/\n' }),
   'an ABSOLUTE rootDir pointing at the repo root → warns');
ok(probe({ rootDir: null, claspignore: 'tests/\n' }),
   'rootDir absent entirely (clasp defaults to the repo root) → warns');

/* ══ SAFE — the warning must stay silent ════════════════════════════════════════════════════════ */
ok(!probe({ rootDir: 'apps-script', claspignore: null }),
   'rootDir "apps-script" → SILENT: a root serve.js is outside the push scope (spiff/crew/pricecards)');
ok(!probe({ rootDir: '.', claspignore: 'tests/\nserve.js\n' }),
   'a denylist that names serve.js → SILENT (inventory 797855e, sales 94411ef)');
ok(!probe({ rootDir: '.', claspignore: '**\n!index.html\n!appsscript.json\n!goals.gs\n' }),
   'an allowlist of ** + !includes → SILENT: serve.js is excluded without being mentioned (performance)');
ok(!probe({ rootDir: '.', claspignore: 'serve.js  # node dev server\n' }),
   'a trailing comment on the rule does not hide it');
ok(!probe({ rootDir: '.', claspignore: '  serve.js  \n' }),
   'surrounding whitespace does not hide the rule');
ok(!probe({ rootDir: '.', claspignore: 'tests/\n', serveJs: false }),
   'no serve.js on disk → SILENT: nothing has landed to warn about');

/* An allowlist that deliberately re-includes serve.js is NOT safe — `!serve.js` puts it back. */
ok(probe({ rootDir: '.', claspignore: '**\n!index.html\n!serve.js\n' }),
   'an allowlist that re-includes serve.js with !serve.js → warns (it IS pushed again)');

/* ══ THE WARNING MUST BE ACTIONABLE ═════════════════════════════════════════════════════════════ */
ok(/\.claspignore/.test(block) && />> \.claspignore/.test(block),
   'the message hands over the exact command, not just a diagnosis');
ok(/whatever that/.test(block) || /whatever the deploy/.test(block) || /whatever it contains/.test(block),
   'it says the failure is unrelated to whatever the next deploy carries — the reading that costs hours');

/* ══ THE REASONING MUST SURVIVE IN THE SCRIPT ═══════════════════════════════════════════════════ */
const prose = src.replace(/\s+/g, ' ');
ok(/FIRST ROOT-LEVEL \.js FILE/i.test(prose),
   'the source records WHY months of clean syncs proved nothing (extension, not luck)');
ok(/RESOLVE rootDir, DO NOT STRING-COMPARE/i.test(prose),
   'and warns the next editor off the string-compare that produced two false alarms');
ok(/deliberately NOT a synced file/i.test(prose),
   'and why gx-sync warns rather than fixing it');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
