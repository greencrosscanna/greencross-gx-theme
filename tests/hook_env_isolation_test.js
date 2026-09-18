#!/usr/bin/env node
/* ─── A TEST'S THROWAWAY REPO MUST NOT BE THE REAL ONE — even when a hook says otherwise ──────────
 *   RUN:  node tests/hook_env_isolation_test.js
 *
 * WHY THIS EXISTS
 * A push from a git WORKTREE exports an ABSOLUTE GIT_DIR to the pre-push hook, and every test the gate
 * runs inherits it. Under that env, `git init .` does not initialize the temp dir a test is standing
 * in — it runs against whatever repo GIT_DIR names — and the `git config user.email t@t.t` and
 * `git worktree add … -b wtbranch` after it land there too.
 *
 * On 2026-09-17 a task-chip session (chips ALWAYS run in a worktree) pushed gx-bugreport.js and left
 * THIS repo with core.bare=true — git refused to run in the main checkout — plus user.email=t@t.t and
 * user.name=tester, so every later commit here would have been signed "tester", plus a stray `wtbranch`
 * and a worktree in the system temp dir. tests/gxclaim_worktree_test.js did it.
 *
 * THE HUB HAD ALREADY FOUND THIS, on 2026-09-10, with the identical symptom, and fixed it in its own
 * run-tests.sh and its own two suites (greencross-command-center/tests/hook_env_isolation_test.js,
 * which this file is ported from). None of it was carried to the shared runners here — the ones every
 * spoke uses as its push gate — so the fix protected one repo and the hazard stayed live in eight.
 * A fix made in one copy of a shared pattern is not a fix; that is the whole lesson.
 *
 * WHY A CLEAN RUN FROM THE MAIN CHECKOUT PROVES NOTHING: there, GIT_DIR is RELATIVE (".git") and
 * resolves harmlessly inside the temp dir. Both suites passed every time they ran from the main
 * checkout, before and after the damage. Only an ABSOLUTE GIT_DIR reproduces it, which is exactly what
 * this sets.
 *
 * THE FIXTURE THAT MAKES IT FAIL: point GIT_DIR at a victim repo, exactly as a worktree's hook does, run
 * the suites that build throwaway repos, and diff the victim. Confirmed failing before the fix by
 * reverting the CLEAN_ENV strip in gxclaim_worktree_test.js.
 */
'use strict';
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log('  ✓ ' + l)) : (fail++, console.log('  ✗ FAIL ' + l)); };

// This file runs under the same hook, so its OWN git calls must not inherit the real repo either.
const clean = Object.assign({}, process.env);
for (const k of Object.keys(clean)) {
  if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE)$/.test(k)) delete clean[k];
}

const victim = fs.mkdtempSync(path.join(os.tmpdir(), 'hookenv-victim-'));
execSync('git -c init.defaultBranch=main init -q . && git -c user.email=v@v -c user.name=v commit -q --allow-empty -m victim',
         { cwd: victim, env: clean, stdio: 'pipe' });
const cfgPath = path.join(victim, '.git', 'config');
const before = fs.readFileSync(cfgPath, 'utf8');
const branchesBefore = execSync('git branch --format="%(refname:short)"', { cwd: victim, env: clean, encoding: 'utf8' }).trim();

console.log("\nA HOOK'S GIT_DIR MUST NOT TURN A TEST'S THROWAWAY REPO INTO THE REAL ONE\n");
for (const t of ['gxclaim_worktree_test.js', 'worktree_sweep_test.js']) {
  const r = spawnSync(process.execPath, [path.join(__dirname, t)],
                      { env: Object.assign({}, clean, { GIT_DIR: path.join(victim, '.git') }), encoding: 'utf8' });
  const after = fs.readFileSync(cfgPath, 'utf8');
  ok(!/bare\s*=\s*true/.test(after), `${t}: the repo GIT_DIR names is not made bare`);
  ok(!/email\s*=\s*t@t/.test(after) && !/name\s*=\s*tester/.test(after), `${t}: and gets no fake identity`);
  ok(after === before, `${t}: its config is byte-for-byte unchanged`);
  ok(r.status === 0, `${t}: and the suite itself still passes under that env (exit ${r.status})`);
}
const branchesAfter = execSync('git branch --format="%(refname:short)"', { cwd: victim, env: clean, encoding: 'utf8' }).trim();
ok(branchesAfter === branchesBefore, `no test branch landed on the victim (${JSON.stringify(branchesAfter.split('\n'))})`);
const log = execSync('git log --format=%s', { cwd: victim, env: clean, encoding: 'utf8' }).trim();
ok(log === 'victim', `no commit landed on the victim (${JSON.stringify(log.split('\n'))})`);
const wts = execSync('git worktree list --porcelain', { cwd: victim, env: clean, encoding: 'utf8' });
ok((wts.match(/^worktree /gm) || []).length === 1, 'no stray worktree was registered on the victim');

/* THE RUNNERS strip it too — the broad defense, which protects a suite nobody has written yet. Checked
   as text because running a whole preflight from inside a test is the recursion this file avoids. */
const STRIP = /unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE/;
for (const f of ['theme-preflight.sh', 'gx-preflight.sh', 'gx-posttool-tests.sh']) {
  const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  ok(STRIP.test(src), `${f} strips an inherited GIT_DIR before any test runs`);
}

fs.rmSync(victim, { recursive: true, force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
