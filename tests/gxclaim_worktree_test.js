#!/usr/bin/env node
/* gxclaim across a linked worktree — an EXECUTING test against real git, not a source scan.
 *
 * THE BUG IT IS WRITTEN FOR (greencross-spiff, 2026-09-16, found live between two sessions).
 * gxclaim resolved both the claim file and the hook install against `git rev-parse --git-dir`, which
 * is PER-WORKTREE. Two failures, and neither printed a warning:
 *
 *   1. A claim taken in the main checkout was invisible from a worktree, and vice versa. `who` and
 *      `release` answered confidently about whichever file was local to where they ran. A session
 *      released a claim it did not hold, reported success in good faith, and the real claim kept
 *      refusing the other session's commits.
 *   2. Worse and not in the report: `install` from a worktree wrote the three gates to
 *      .git/worktrees/<name>/hooks, which GIT NEVER READS. It printed success. The SessionStart hook
 *      re-runs install every session because this filesystem drops executable bits, so inside a
 *      worktree that re-arming armed nothing.
 *
 * WHY IT EXECUTES RATHER THAN GREPS. The whole failure is "the gate reports success and protects
 * nothing". A source scan for --git-common-dir would go green on a script whose hooks still landed
 * somewhere git ignores. So this builds real repos and real worktrees, runs the REAL shipped script,
 * and makes real commits that must actually be refused.
 *
 * SECTION 5 IS THE CONTROL. It rebuilds the pre-fix script by substituting the common-dir resolution
 * back to --git-dir and re-runs sections 2-4 against it, REQUIRING them to fail. Without it this file
 * would pass just as happily against the bug it exists for.
 */
const { execFileSync, spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); }
                            else { fail++; console.log('  ✗ FAIL ' + msg); } };

// run a command; returns {code, out}. Never throws — a non-zero exit IS the assertion in most of this file.
function run(cmd, cwd, env) {
  try {
    const out = execFileSync('sh', ['-c', cmd], {
      cwd, env: Object.assign({}, process.env, env || {}), stdio: ['ignore', 'pipe', 'pipe'],
    }).toString();
    return { code: 0, out };
  } catch (e) {
    return { code: e.status == null ? -1 : e.status, out: (e.stdout || '').toString() + (e.stderr || '').toString() };
  }
}

const SCRIPT = fs.readFileSync(path.join(__dirname, '..', 'gxclaim.sh'), 'utf8');

// ── two LIVE pids to stand in for two Claude sessions ───────────────────────────────────────────
// Identity is CLAUDE_PID and liveness is `kill -0`, so a made-up number would be swept as a dead
// session and every claim would look free. These are real sleeping processes, killed at the end.
const procA = spawn('sleep', ['120'], { stdio: 'ignore' });
const procB = spawn('sleep', ['120'], { stdio: 'ignore' });
const A = { CLAUDE_PID: String(procA.pid), CLAUDE_CODE_SESSION_ID: 'session-a' };
const B = { CLAUDE_PID: String(procB.pid), CLAUDE_CODE_SESSION_ID: 'session-b' };
const cleanupProcs = () => { try { procA.kill(); } catch (e) {} try { procB.kill(); } catch (e) {} };

// ── build a repo with a linked worktree, carrying the script under test ─────────────────────────
function buildSuite(scriptText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gxclaimwt-'));
  const main = path.join(root, 'main');
  const wt   = path.join(root, 'wt');
  fs.mkdirSync(main);
  run('git init -q . && git config user.email t@t.t', main);
  run('git config user.name tester', main);
  fs.writeFileSync(path.join(main, 'gxclaim.sh'), scriptText, { mode: 0o755 });
  run('git add -A && git commit -q -m init', main);
  run(`git worktree add -q "${wt}" -b wtbranch`, main);
  return { root, main, wt };
}

function sections(scriptText, label, expect) {
  const { root, main, wt } = buildSuite(scriptText);
  const claimed = [];

  // ── 2. one repo, one claim: taken in main, SEEN from the worktree ──────────────────────────────
  run('sh ./gxclaim.sh claim main-session', main, A);
  const whoWt = run('sh ./gxclaim.sh who', wt, B);
  claimed.push([/held by|claimed by/i.test(whoWt.out),
    `${label}: a claim taken in the main checkout is visible from the worktree`]);

  const checkWt = run('sh ./gxclaim.sh check commit', wt, B);
  claimed.push([checkWt.code === 1,
    `${label}: check from the worktree refuses a foreign session (exit 1, got ${checkWt.code})`]);

  // ── 3. release from the wrong place must not report success over a live claim ──────────────────
  const relWt = run('sh ./gxclaim.sh release', wt, B);
  const stillHeld = run('sh ./gxclaim.sh check commit', main, B);
  claimed.push([relWt.code !== 0 && stillHeld.code === 1,
    `${label}: a foreign session cannot release the claim from the worktree and call it done`]);

  // ── 4. install from the worktree lands where git actually runs hooks ───────────────────────────
  run('sh ./gxclaim.sh install', wt, B);
  const commonHook = path.join(main, '.git', 'hooks', 'pre-commit');
  claimed.push([fs.existsSync(commonHook),
    `${label}: install from a worktree writes pre-commit to the COMMON hooks dir`]);

  // the gate must actually fire — a file in the right place that git does not run is the same bug
  fs.writeFileSync(path.join(wt, 'touched.txt'), 'x');
  const blocked = run('git add -A && git commit -q -m nope', wt, B);
  claimed.push([blocked.code !== 0,
    `${label}: the installed gate refuses a foreign session's commit made from the worktree`]);

  run('sh ./gxclaim.sh release --force', main, A);
  fs.rmSync(root, { recursive: true, force: true });

  if (expect === 'pass') { claimed.forEach(([c, m]) => ok(c, m)); return null; }
  return claimed;
}

console.log('gxclaim — claim and hooks resolve against the common git dir');
sections(SCRIPT, 'shipped', 'pass');

// ── 5. THE CONTROL: the pre-fix script must fail the four assertions above ──────────────────────
console.log('\ncontrol — the pre-fix script (per-worktree git dir) must NOT pass these');
const OLD = SCRIPT
  .replace(/COMMONDIR="\$\(git rev-parse --path-format=absolute --git-common-dir 2>\/dev\/null\)"/,
           'COMMONDIR="$GITDIR"')
  .replace(/\[ -n "\$COMMONDIR" \] \|\| COMMONDIR="\$GITDIR"/, ':');
ok(OLD !== SCRIPT, 'the control could be built (the common-dir resolution is still where it was)');
const oldResults = sections(OLD, 'pre-fix', 'fail');
const oldFailures = oldResults.filter(([c]) => !c).length;
ok(oldFailures >= 3,
   `the pre-fix script fails at least 3 of the 5 assertions (failed ${oldFailures}) — this test can see the bug`);

cleanupProcs();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
