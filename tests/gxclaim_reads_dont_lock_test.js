#!/usr/bin/env node
/* gxclaim — a read must never lock, and the script acts on the repo it lives in. EXECUTING test.
 *   RUN:  node tests/gxclaim_reads_dont_lock_test.js
 *
 * THE INCIDENT (2026-09-17, ~22:20–23:40 PT). Two hub sessions each held the gxclaim lock on all five
 * spokes without editing any of them, renewed about once a minute, and blocked an approved GX Core
 * re-pin three times. Two separate defects:
 *
 *   1. The only way to ask "is anyone here?" was `check`, and `check` CLAIMS an unclaimed repo and
 *      renews its holder. gxfanout's dry run asked it in every spoke, and a hub test ran that dry run
 *      on every file save. Sky's rule from that night: reads must not lock. `peek` is the read.
 *   2. The repo came from the caller's cwd. `sh /path/to/spoke/gxclaim.sh release`, run from the hub,
 *      released the HUB's claim and printed nothing, so the holder believed it had freed the spokes.
 *
 * THE CONTROL runs the same assertions against the pre-fix script (origin/main when this was written,
 * embedded by substitution below) and REQUIRES them to fail, so this file cannot pass against the bug.
 */
'use strict';
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL ' + m); } };

// Never inherit a hook's GIT_DIR — see gxclaim_worktree_test.js for what that did to the real repo.
const CLEAN_ENV = Object.assign({}, process.env);
for (const k of Object.keys(CLEAN_ENV)) {
  if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE)$/.test(k)) delete CLEAN_ENV[k];
}
function run(cmd, cwd, env) {
  try {
    const out = execFileSync('sh', ['-c', cmd + ' 2>&1'], { cwd, env: Object.assign({}, CLEAN_ENV, env || {}), stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return { code: 0, out };
  } catch (e) {
    return { code: e.status == null ? -1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'gxclaim.sh'), 'utf8');

// Live pids stand in for sessions: liveness is `kill -0`, so a made-up number would be swept as dead.
const procA = spawn('sleep', ['120'], { stdio: 'ignore' });
const procB = spawn('sleep', ['120'], { stdio: 'ignore' });
const A = { CLAUDE_PID: String(procA.pid), CLAUDE_CODE_SESSION_ID: 'aaaaaaaa-hub' };
const B = { CLAUDE_PID: String(procB.pid), CLAUDE_CODE_SESSION_ID: 'bbbbbbbb-spoke' };

// Two sibling repos, each carrying the script at its root, the way gx-sync lays them out.
function buildSuite(scriptText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gxclaim-reads-'));
  const mk = name => {
    const d = path.join(root, name);
    fs.mkdirSync(d);
    run('git -c init.defaultBranch=main init -q . && git config user.email t@t && git config user.name t', d);
    fs.writeFileSync(path.join(d, 'gxclaim.sh'), scriptText, { mode: 0o755 });
    run('git add -A && git commit -qm init', d);
    return d;
  };
  return { root, hub: mk('hub'), spoke: mk('spoke') };
}
const claimFile = d => path.join(d, '.git', 'gx-claim');
const touched = d => { const m = /^touched=(\d+)$/m.exec(fs.readFileSync(claimFile(d), 'utf8')); return m ? m[1] : ''; };
const backdate = d => fs.writeFileSync(claimFile(d), fs.readFileSync(claimFile(d), 'utf8').replace(/^touched=\d+$/m, 'touched=' + (Math.floor(Date.now() / 1000) - 600)));

function sections(scriptText, label) {
  const r = [];
  const { root, hub, spoke } = buildSuite(scriptText);

  // 1. a read of an unclaimed repo leaves it unclaimed
  const p = run('sh ./gxclaim.sh peek', spoke, A);
  r.push([p.code === 0 && !fs.existsSync(claimFile(spoke)),
    `${label}: peek on an unclaimed repo answers "clear" (exit 0, got ${p.code}) and writes no claim`]);

  // 2. a read by the HOLDER does not renew — only real work keeps a claim alive
  run('sh ./gxclaim.sh claim "spoke work"', spoke, B);
  backdate(spoke);
  const before = touched(spoke);
  run('sh ./gxclaim.sh peek', spoke, B);
  r.push([fs.existsSync(claimFile(spoke)) && touched(spoke) === before,
    `${label}: peek by the holder does not renew the claim`]);

  // 3. a read by a FOREIGN session sees the holder, refuses, and changes nothing
  const pf = run('sh ./gxclaim.sh peek', spoke, A);
  r.push([pf.code === 1 && touched(spoke) === before && /spoke work/.test(fs.readFileSync(claimFile(spoke), 'utf8')),
    `${label}: peek by another session exits 1 while the repo is held, and leaves the claim as it was`]);
  run('sh ./gxclaim.sh release --force', spoke, B);

  // 4. the script acts on the repo it LIVES in, not the caller's cwd, and says which
  run('sh ./gxclaim.sh claim "hub work"', hub, A);
  run('sh ./gxclaim.sh claim ""', spoke, A);
  const rel = run(`sh "${path.join(spoke, 'gxclaim.sh')}" release`, hub, A);
  r.push([fs.existsSync(claimFile(hub)) && !fs.existsSync(claimFile(spoke)),
    `${label}: the spoke's script run from the hub releases the SPOKE and leaves the hub's claim alone`]);
  r.push([/released spoke/.test(rel.out) && /acting on .*spoke/.test(rel.out),
    `${label}: its output names the repo it acted on, and says it is not the caller's folder`]);

  fs.rmSync(root, { recursive: true, force: true });
  return r;
}

console.log('gxclaim — reads do not lock; the script acts on its own repo');
sections(SCRIPT, 'shipped').forEach(([c, m]) => ok(c, m));

// 5. THE CONTROL: check still claims. Without this, "no claim appeared" could mean the fixture can't
//    produce one at all — which would make sections 1-3 decorative.
{
  const { root, spoke } = buildSuite(SCRIPT);
  run('sh ./gxclaim.sh check "this commit"', spoke, A);
  ok(fs.existsSync(claimFile(spoke)), 'control: `check` (the real-work path) still claims an unclaimed repo');
  backdate(spoke);
  const t = touched(spoke);
  run('sh ./gxclaim.sh check "this commit"', spoke, A);
  ok(touched(spoke) !== t, 'control: `check` by the holder still renews — real work keeps the claim alive');
  fs.rmSync(root, { recursive: true, force: true });
}

// 6. THE MUTATION: the pre-fix behavior must fail. Rebuild it from the shipped script by deleting the
//    self-directory resolution and turning `peek` into `check` — exactly the two defects.
console.log('\ncontrol — the pre-fix behavior must NOT pass these');
const OLD = SCRIPT
  .replace(/if \[ -n "\$_SELF_DIR" \] && cd "\$_SELF_DIR"/, 'if false')
  .replace(/^  peek\)$/m, '  peek_disabled)')
  .replace(/^  check\)$/m, '  check|peek)');
ok(OLD !== SCRIPT && /check\|peek\)/.test(OLD) && /if false/.test(OLD), 'the mutation could be built (both fixes are still where they were)');
const failed = sections(OLD, 'pre-fix').filter(([c]) => !c).length;
ok(failed >= 4, `the pre-fix behavior fails at least 4 of the 5 assertions (failed ${failed}) — this test can see both bugs`);

try { procA.kill(); } catch (e) {}
try { procB.kill(); } catch (e) {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
