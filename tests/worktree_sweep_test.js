#!/usr/bin/env node
/* Orphaned-preflight-worktree sweep — an EXECUTING test, not a source scan.
 *
 * WHY IT EXECUTES. Most suites in this repo assert that a pattern is present or absent in source
 * text. That is cheap and legitimate, but it cannot tell a sweep that works from a sweep that
 * deletes the wrong thing — and "deletes the wrong thing" is the entire risk here. So this builds
 * real git repos, makes real worktrees, and runs the REAL block lifted out of the shipped script.
 *
 * WHY IT LIFTS THE BLOCK RATHER THAN RE-STATING IT. A copy of the sweep inlined here would pass
 * forever while the shipped script rotted underneath it — the false-green shape gx-conventions.md
 * warns about. Extraction means rewriting the sweep badly in gx-preflight.sh fails this test.
 *
 * THE BUG IT IS WRITTEN FOR: 20 orphaned worktrees across the suite on 2026-09-09, ~80MB, oldest
 * 2026-08-29. Cases 1 and 2 below are the guards that make the fix safe to run in seven repos at
 * once; case 3 is the actual cleanup. Run each against a script with the guard removed and it fails.
 */
const { execFileSync } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); }
                            else { fail++; console.log('  ✗ FAIL ' + msg); } };

const sh = (cmd, cwd) => execFileSync('sh', ['-c', cmd], { cwd, stdio: ['ignore','pipe','pipe'] }).toString();

// ── lift the sweep out of the shipped script ────────────────────────────────────────────────────
const script = fs.readFileSync(path.join(__dirname, '..', 'gx-preflight.sh'), 'utf8');
const lines  = script.split('\n');
const start  = lines.findIndex(l => l.startsWith('_mine="../.gxpreflight-'));
ok(start !== -1, 'the sweep block is still present in gx-preflight.sh');
if (start === -1) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
const endRel = lines.slice(start).findIndex((l, i) => i > 0 && l.trim() === 'done');
const SWEEP  = lines.slice(start, start + endRel + 2).join('\n');   // through the trailing prune
ok(/kill -0/.test(SWEEP),          'the lifted sweep still has its live-pid guard');
ok(/basename "\$PWD"/.test(SWEEP), 'the lifted sweep is still scoped to this repo');

// ── build a scratch suite: two sibling repos, like the real GX Dashboards folder ─────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gxsweep-'));
const mkrepo = (name) => {
  const d = path.join(root, name);
  fs.mkdirSync(d);
  sh('git init -q . && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base', d);
  return d;
};
const repoA = mkrepo('greencross-alpha');
const repoB = mkrepo('greencross-beta');

const mkwt = (repo, name) => {
  sh(`git worktree add --detach ../${name} HEAD >/dev/null 2>&1`, repo);
  return path.join(root, name);
};

const DEAD = 999999;                       // no such process
const LIVE = process.pid;                  // this test run — stands in for a concurrent preflight

const aDead  = mkwt(repoA, `.gxpreflight-greencross-alpha-${DEAD}`);
const aLive  = mkwt(repoA, `.gxpreflight-greencross-alpha-${LIVE}`);
const bDead  = mkwt(repoB, `.gxpreflight-greencross-beta-${DEAD}`);
const unrel  = path.join(root, 'somebody-elses-folder');
fs.mkdirSync(unrel);

ok(fs.existsSync(aDead) && fs.existsSync(aLive) && fs.existsSync(bDead),
   'scenario built: three worktrees, one of them owned by a live pid');

// ── run the real sweep, from repoA, exactly as a push from repoA would ───────────────────────────
sh(`set -eu\ncd "${repoA}"\n${SWEEP}`, repoA);

// 3. the actual cleanup — the 2026-09-09 orphans
ok(!fs.existsSync(aDead), "sweeps this repo's own orphan whose pid is gone");

// 1. LIVE-PID GUARD. Without it, two sessions pushing the same repo delete each other's worktree
//    mid-test-run. Remove `kill -0` from the script and this line fails.
ok(fs.existsSync(aLive), 'SKIPS a worktree whose pid is still alive (concurrent preflight in this repo)');

// 2. REPO-SCOPE GUARD. Without it, a push from alpha deletes the worktree beta is testing inside.
//    Widen the glob to ../.gxpreflight-* and this line fails.
ok(fs.existsSync(bDead), "leaves ANOTHER repo's worktree alone (a sales push must not break crew)");

ok(fs.existsSync(unrel), 'touches nothing that is not a preflight worktree');

// git metadata, not just directories: a prunable registration is half the mess
const listA = sh('git worktree list', repoA);
ok(!listA.includes(`alpha-${DEAD}`), 'the removed worktree is deregistered from git, not just deleted');
ok(listA.includes(`alpha-${LIVE}`),  'the live worktree stays registered');

// ── the sweep must be safe when there is nothing to sweep ───────────────────────────────────────
const repoC = mkrepo('greencross-gamma');
let clean = true;
try { sh(`set -eu\ncd "${repoC}"\n${SWEEP}`, repoC); } catch (e) { clean = false; }
ok(clean, 'exits 0 under `set -eu` when no worktrees match (the glob stays literal)');

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
