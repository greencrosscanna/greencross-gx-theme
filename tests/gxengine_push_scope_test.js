#!/usr/bin/env node
/* ─── gxengine SHIPS ONLY ENGINE SOURCE, AND SAYS SO WHEN THE APP STOPS ANSWERING ────────────────
 *   RUN:  node tests/gxengine_push_scope_test.js
 *
 * WHY THIS EXISTS
 * On 2026-10-13 a library re-pin of sales pushed scripts/tmp/recon-live-attribution.js to Apps
 * Script. rootDir is "." there and .claspignore is a denylist, so a .js in a folder nobody had
 * listed was source. It PARSED, so the push and the redeploy both reported success; then it threw
 * `ReferenceError: require is not defined` at load, on every request. Sales answered nothing for
 * eleven minutes at midday, and the deploy tool's only remark was the warm-instance warning.
 *
 * Two guards, both real code, so both are lifted from the script and RUN here:
 *   gx_push_scope    — what clasp would push must be engine source and nothing else
 *   gx_script_error  — an Apps Script exception page is recognized as one
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SH = path.join(__dirname, '..', 'gxengine.sh');
let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log('  PASS  ' + l)) : (fail++, console.log('  FAIL  ' + l)); };

const src = fs.readFileSync(SH, 'utf8');
function lift(name) {
  const m = new RegExp('^' + name + '\\(\\) \\{[^\\n]*\\n[\\s\\S]*?\\n\\}\\n', 'm').exec(src);
  if (!m) throw new Error('could not find ' + name + '() in gxengine.sh');
  return m[0];
}
function run(name, stdin, args) {
  const r = spawnSync('bash', ['-c', lift(name) + '\n' + name + ' "$@"', 'bash'].concat(args || []),
    { input: stdin, encoding: 'utf8' });
  return { rc: r.status, out: (r.stdout || '').trim() };
}
const scope = (files, root) => run('gx_push_scope',
  typeof files === 'string' ? files : JSON.stringify({ filesToPush: files, untrackedFiles: [] }),
  [root || '.']);

console.log('\ngxengine SHIPS ONLY ENGINE SOURCE\n');

/* 1. EVERY ENGINE IN THE SUITE PASSES TODAY. Real lists, read from `clasp show-file-status --json`
      in each repo on 2026-10-13. A guard that refuses a working app is a guard that gets removed. */
{
  const flat = ['appsscript.json', 'dutchie_proxy.gs', 'index.html'];
  const nested = ['apps-script/appsscript.json', 'apps-script/Code.gs'];
  ok(scope(flat).rc === 0 && scope(flat).out === '', 'sales / inventory (rootDir ".") — clean');
  ok(scope(nested, 'apps-script').rc === 0, 'crew / spiff / price-cards (rootDir apps-script) — clean');
  ok(scope(['appsscript.json', 'Code.gs', 'history.gs', 'index.html']).rc === 0,
     'leaderboard (several root .gs files) — clean');
  ok(scope(nested, './apps-script/').rc === 0, 'a rootDir written ./apps-script/ is the same folder');
}

/* 2. THE FILE THAT TOOK SALES DOWN IS REFUSED, AND NAMED. */
{
  const r = scope(['appsscript.json', 'dutchie_proxy.gs', 'index.html', 'scripts/tmp/recon-live-attribution.js']);
  ok(r.rc !== 0, 'scripts/tmp/…js alongside real source — refused');
  ok(r.out === 'scripts/tmp/recon-live-attribution.js',
     'and the output is exactly the offender, so the message can name it (got: ' + r.out + ')');
}

/* 3. THE RULE IS "ENGINE SOURCE", NOT "NOT THAT ONE FOLDER". */
{
  ok(scope(['appsscript.json', 'serve.js']).rc !== 0, 'a .js in rootDir — refused (no engine file is .js)');
  ok(scope(['appsscript.json', 'tools/helper.gs']).rc !== 0, 'a .gs in a subfolder — refused');
  ok(scope(['appsscript.json', 'worker/package.json']).rc !== 0, 'a stray .json — refused');
  ok(scope(['appsscript.json', 'package.json']).rc !== 0, 'a root .json that is not the manifest — refused');
  ok(scope(['apps-script/appsscript.json', 'apps-script/Code.gs', 'Code.gs'], 'apps-script').rc !== 0,
     'a file OUTSIDE rootDir — refused');
  ok(scope(['apps-script/Code.gs'], '.').rc !== 0, 'rootDir is honored, not guessed from the files');
  const two = scope(['a/x.js', 'appsscript.json', 'b/y.js']);
  ok(two.out.split('\n').length === 2, 'every offender is listed, not only the first');
}

/* 4. UNKNOWN IS NOT CLEAR. If the list cannot be read, the answer is no. */
{
  ok(scope('').rc !== 0 && scope('').out === '?', 'no output from clasp — refused, marked unreadable');
  ok(scope('Error: invalid_grant').rc !== 0, 'a clasp error instead of JSON — refused');
  ok(scope([]).rc !== 0, 'an EMPTY list — refused (clasp found nothing is not "nothing to worry about")');
  ok(scope('{"untrackedFiles":[]}').rc !== 0, 'a different JSON shape — refused');
  ok(scope('{"filesToPush":"appsscript.json"}').rc !== 0, 'a list that is not a list — refused');
}

/* 5. THE EXCEPTION PAGE IS RECOGNIZED. Shape copied from what sales served on 2026-10-13. */
{
  const page = msg => '<!DOCTYPE html><html><head><link rel="shortcut icon" href="//ssl.gstatic.com/docs/script/images/favicon.ico">'
    + '<title>Error</title><style type="text/css" nonce="x">body {background-color: #fff;}</style></head>'
    + '<body><div style="text-align:center">' + msg + '</div></body></html>';
  const err = b => run('gx_script_error', b).out;
  const down = err(page('ReferenceError: require is not defined (line 12, file &quot;scripts/tmp/recon-live-attribution&quot;)'));
  ok(/^ReferenceError: require is not defined \(line 12, file "scripts\/tmp\/recon-live-attribution"\)$/.test(down),
     'the outage page yields the exception, unescaped (got: ' + down + ')');
  ok(/SyntaxError/.test(err(page('SyntaxError: Unexpected token (line 3, file &quot;Code&quot;)'))), 'a SyntaxError page too');
  ok(/Script function not found: doGet/.test(err(page('Script function not found: doGet'))),
     'an error page with no line number is still reported, with its text');
  ok(!/background-color/.test(err(page('Script function not found: doGet'))), 'without the stylesheet in it');
  ok(err('{"ok":true,"gxcore":351}') === '', 'a healthy JSON answer is not an error');
  ok(err('') === '', 'no answer at all is not CLAIMED as an exception (that is the existing warning)');
  ok(err('{"ok":false,"error":"ReferenceError: x is not defined (line 2, file \\"Code\\")"}') === '',
     'an app that answers JSON about an error is answering — only the page counts');
  ok(err('<html><head><title>Page Not Found</title></head><body>Error 404</body></html>') === '',
     'the /exec second-hop 404 flake is not mistaken for a broken engine');
}

/* 6. BOTH ARE WIRED WHERE THEY HAVE TO BE. Position, not presence: a scope check after the push
      protects nobody. */
{
  const iScope = src.indexOf('| gx_push_scope "$_PUSH_ROOT"');
  const iPush = src.indexOf('clasp push --force');
  ok(iScope > 0 && iPush > 0 && iScope < iPush, 'the scope check runs BEFORE clasp push');
  const between = src.slice(iScope, iPush);
  ok(/_PUSH_RC=\$\?/.test(between) && /exit 1/.test(between), 'and a refusal exits before the push line');
  ok((src.match(/^\s*clasp push\b/gm) || []).length === 1,
     'there is exactly one push command, so there is no second door');
  ok(/curl -sL[^\n]*\$EXEC_URL\?action=libversion[^\n]*\| gx_script_error/.test(src),
     'the down-check reads the RAW body — gx_fetch discards HTML and would see nothing');
  ok(/IS DOWN/.test(src) && src.indexOf('if [ -n "$APP_ERR" ]') < src.indexOf('elif [ -z "$LV" ]'),
     'and an exception outranks the warm-instance warning');
  const tail = src.slice(src.lastIndexOf('APP_ERR'));
  ok(/\[ -n "\$APP_ERR" \][^\n]*exit 1/.test(src) || /APP_ERR[\s\S]{0,200}exit 1/.test(tail),
     'and the deploy EXITS NON-ZERO when the app is down — a red deploy, not a remark');
  ok(spawnSync('bash', ['-n', SH]).status === 0, 'the script still parses');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
process.exit(fail ? 1 : 0);
