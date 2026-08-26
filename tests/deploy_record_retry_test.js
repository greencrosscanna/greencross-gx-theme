#!/usr/bin/env node
/* ─── deploy.sh — recording the release: retry + fail LOUD — tests ────────────────────────────────
 *   RUN:  node tests/deploy_record_retry_test.js   (also run by theme-preflight.sh)
 *
 * WHY
 * GX Core's /exec is a TWO-HOP redirect whose second hop intermittently serves Google's "unable to
 * open the file" HTML page instead of JSON. deploy.sh recorded the release with a bare `curl -sL`,
 * which fetches that page perfectly happily — so on 2026-08-26 it missed twice while recording
 * price-cards v1.422, printed ~200 lines of Drive HTML, AND EXITED 0. The dump was the visible half;
 * the exit code was the dangerous one. version_history is what every app reads for What's New, and a
 * shipper who does not read the markup believes a release was recorded that never was.
 *
 * §3 and §5 are the ones that matter: a failure must exit non-zero AND say why in words. Asserting
 * only the exit code would be satisfied by a script that dies silently, which is barely better than
 * one that exits 0 — the shipper still has nothing to act on. So the stderr text is pinned too.
 *
 * These run the REAL block, sliced out of the real deploy.sh, against a stub `curl` on PATH. A test
 * that reimplements the thing under test cannot catch the thing under test changing.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DEPLOY = fs.readFileSync(path.join(ROOT, 'deploy.sh'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };

/* Slice the live recording block out of deploy.sh. Anchored on `_record_attempts=`, which is the
   first line of it, through end of file. If that variable is ever renamed this loader fails loudly
   rather than silently testing nothing — the failure mode the deploy_version suite warns about. */
const cut = DEPLOY.indexOf('_record_attempts=');
if (cut < 0) {
  console.error('LOAD FAILED: `_record_attempts=` is gone from deploy.sh — the recording block moved or was renamed.');
  console.error('Do not delete this test rather than re-anchoring it: it is the only thing asserting deploy.sh fails loudly.');
  process.exit(1);
}
const BLOCK = DEPLOY.slice(cut);

const DRIVE_HTML = '<!DOCTYPE html><html><head><title>Error</title></head><body>' +
  'Sorry, unable to open the file at this time.<br>'.repeat(60) + '</body></html>';

/* Run the block with a stub curl that emits `responses[n]` on call n, and a stub sleep so the
   linear backoff does not cost this suite six seconds. */
function run(responses) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gxdeploy-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(dir, 'responses.json'), JSON.stringify(responses));
  fs.writeFileSync(path.join(bin, 'curl'),
    '#!/bin/sh\n' +
    'n=$(cat "' + dir + '/count" 2>/dev/null || echo 0)\n' +
    'echo $((n + 1)) > "' + dir + '/count"\n' +
    'python3 -c "import json,sys; r=json.load(open(sys.argv[1]))[int(sys.argv[2])]; sys.stdout.write(r)" "' +
      dir + '/responses.json" "$n"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const script = 'set -euo pipefail\n' +
    'GXCORE="https://example.invalid/exec"\nAPP="pricecards"\nSECRET="s3cr3t"\n' +
    'APP_VERSION="v1.422"\nSHA="abc1234"\nGX_NOTES="a note"\nVERSION_SOURCE="HEAD:index.html"\n' +
    BLOCK;
  const r = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PATH: bin + ':' + process.env.PATH })
  });
  const calls = Number(fs.readFileSync(path.join(dir, 'count'), 'utf8').trim() || 0);
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', calls };
}

const OK_JSON  = '{"ok":true,"app":"pricecards","version":"v1.422"}';
const REFUSAL  = '{"ok":false,"error":"version \'v1.42\' does not match vMAJOR.BBB"}';

/* ══ §1 the happy path is unchanged ═══════════════════════════════════════════════════════════ */
{
  const r = run([OK_JSON]);
  ok(r.code === 0, '§1 a first-try success exits 0');
  ok(r.calls === 1, '§1 …and calls curl exactly once — no retry on success');
  ok(/Recorded pricecards v1\.422/.test(r.out), '§1 …and says so, naming app and version');
}

/* ══ §2 a transient miss is retried and recovers ══════════════════════════════════════════════ */
{
  const r = run([DRIVE_HTML, OK_JSON]);
  ok(r.code === 0, '§2 HTML then JSON → exits 0');
  ok(r.calls === 2, '§2 …having retried exactly once');
  ok(/retrying/.test(r.err), '§2 …and it SAYS it is retrying, so a slow ship is explicable');
}

/* ══ §3 THE CORE FIX — exhausted retries must FAIL, and must not dump the page ════════════════ */
{
  const r = run([DRIVE_HTML, DRIVE_HTML, DRIVE_HTML, DRIVE_HTML]);
  ok(r.code !== 0, '§3 four misses EXIT NON-ZERO (the old bare curl exited 0 here)');
  ok(r.calls === 4, '§3 …after 4 attempts');
  ok(!/DOCTYPE|<html|<body/i.test(r.err + r.out),
     '§3 the Drive HTML is NEVER printed — burying the error is what hid the last one');
  ok(/version_history has NO row/.test(r.err),
     '§3 stderr says the record is missing, in words, not in markup');
  ok(/GX_VERSION=v1\.422/.test(r.err), '§3 …and hands over the exact re-run command');
}

/* ══ §4 an empty response is a failure too, and says which kind ═══════════════════════════════ */
{
  const r = run(['', '', '', '']);
  ok(r.code !== 0, '§4 an empty body exits non-zero');
  ok(/empty/.test(r.err), '§4 …and is distinguished from the HTML page');
}

/* ══ §5 A FAILURE MUST BE LEGIBLE, not merely non-zero ════════════════════════════════════════
   Asserted separately from §3 because a script that died silently would still satisfy "exits
   non-zero" while telling the shipper nothing. Also pins that the LAST attempt does not announce a
   retry it will never make — an off-by-one there reads as "it gave up mid-retry". */
{
  const r = run([DRIVE_HTML, DRIVE_HTML, DRIVE_HTML, DRIVE_HTML]);
  ok(r.err.trim().length > 0, '§5 the failure path actually PRINTS something — never a silent exit 1');
  ok(/FAILED to record/.test(r.err), '§5 …and it is the error block, naming what failed');
  // The last attempt must NOT advertise a retry it will never make.
  ok((r.err.match(/retrying/g) || []).length === 3,
     '§5 exactly 3 "retrying" lines for 4 attempts — the last one does not promise a 5th');
}

/* ══ §6 answering is not agreeing ═════════════════════════════════════════════════════════════
   A format refusal or a bad secret is well-formed JSON. Treating "GX Core replied" as success would
   rebuild the silent-failure bug one layer up. */
{
  const r = run([REFUSAL]);
  ok(r.code !== 0, '§6 an ok:false refusal exits non-zero');
  ok(r.calls === 1, '§6 …and is NOT retried — GX Core answered, it just said no');
  ok(/REFUSED/.test(r.err) && /vMAJOR\.BBB/.test(r.err), '§6 …showing what GX Core actually said');
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
