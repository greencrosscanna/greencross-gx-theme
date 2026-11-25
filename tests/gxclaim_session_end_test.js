#!/usr/bin/env node
/* A chat that ends releases its gxclaim — EXECUTING test against real git and real settings files.
 *   RUN:  node tests/gxclaim_session_end_test.js
 *
 * THE INCIDENT (2026-11-24). A SPIFF chat ran /wrapup, the archive was interrupted, the process stayed
 * alive, and greencross-spiff stayed claimed until Sky released it by hand. gxclaim frees a claim only
 * when its holder's process dies or after 90 idle minutes; nothing released it when a chat ENDED.
 *
 * The fix has two halves and this tests both:
 *   1. gx-session-end.sh, the SessionEnd hook — releases this chat's claims and nobody else's.
 *   2. gx-settings-hooks.js, which gx-sync runs to ADD that hook to each repo's existing
 *      settings.json without disturbing the hooks already there (spiff's SessionStart + PostToolUse).
 *
 * THE CONTROL that makes (1) meaningful: a bare `release` with CLAUDE_PID unset removes ANYONE's
 * claim. The hook's no-op without CLAUDE_PID is therefore load-bearing, and section B proves the
 * fixture would have caught its absence.
 */
'use strict';
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ FAIL ' + m); } };

// Never inherit a hook's GIT_DIR, nor THIS session's identity — see gxclaim_worktree_test.js.
const CLEAN_ENV = Object.assign({}, process.env);
for (const k of Object.keys(CLEAN_ENV)) {
  if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE)$/.test(k)) delete CLEAN_ENV[k];
}
delete CLEAN_ENV.CLAUDE_PID; delete CLEAN_ENV.CLAUDE_CODE_SESSION_ID; delete CLEAN_ENV.CLAUDE_PROJECT_DIR;
function run(cmd, cwd, env) {
  try {
    return { code: 0, out: execFileSync('sh', ['-c', cmd + ' 2>&1'], { cwd, env: Object.assign({}, CLEAN_ENV, env || {}), stdio: ['ignore', 'pipe', 'pipe'] }).toString() };
  } catch (e) {
    return { code: e.status == null ? -1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

const GXCLAIM = fs.readFileSync(path.join(ROOT, 'gxclaim.sh'), 'utf8');
const HOOK = path.join(ROOT, 'gx-session-end.sh');
const MERGE = path.join(ROOT, 'gx-settings-hooks.js');

// Live pids stand in for sessions: liveness is `kill -0`, so a made-up number would be swept as dead.
const procA = spawn('sleep', ['120'], { stdio: 'ignore' });
const procB = spawn('sleep', ['120'], { stdio: 'ignore' });
const A = { CLAUDE_PID: String(procA.pid), CLAUDE_CODE_SESSION_ID: 'aaaaaaaa-ending' };
const B = { CLAUDE_PID: String(procB.pid), CLAUDE_CODE_SESSION_ID: 'bbbbbbbb-other' };

function buildSuite() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gxclaim-end-'));
  const mk = name => {
    const d = path.join(root, name);
    fs.mkdirSync(d);
    run('git -c init.defaultBranch=main init -q . && git config user.email t@t && git config user.name t', d);
    fs.writeFileSync(path.join(d, 'gxclaim.sh'), GXCLAIM, { mode: 0o755 });
    run('git add -A && git commit -qm init', d);
    return d;
  };
  return { root, hub: mk('greencross-command-center'), spoke: mk('greencross-spiff'), other: mk('greencross-crew') };
}
const claimFile = d => path.join(d, '.git', 'gx-claim');
const held = d => fs.existsSync(claimFile(d));
const hook = (projectDir, env) => run(`sh "${HOOK}"`, projectDir, Object.assign({ CLAUDE_PROJECT_DIR: projectDir }, env || {}));

// ── A. the SessionEnd hook releases this chat's claims, and only those ─────────────────────────────
console.log('A. gx-session-end.sh');
{
  const s = buildSuite();
  run('sh ./gxclaim.sh claim "spiff work"', s.spoke, A);
  run('sh ./gxclaim.sh claim "hub work"', s.hub, A);     // a hub chat that also holds a spoke
  run('sh ./gxclaim.sh claim "crew work"', s.other, B);  // another chat, still working
  ok(held(s.spoke) && held(s.hub) && held(s.other), 'fixture: three claims taken (two by the ending chat, one by another)');
  const r = hook(s.spoke, A);
  ok(r.code === 0, `the hook exits 0 (got ${r.code})`);
  ok(!held(s.spoke), "the ending chat's claim on its own repo is released");
  ok(!held(s.hub), "the ending chat's claim on a SIBLING repo is released too");
  ok(held(s.other) && /crew work/.test(fs.readFileSync(claimFile(s.other), 'utf8')), "another chat's claim is left exactly as it was");
  ok(/free/.test(run('sh ./gxclaim.sh who', s.spoke, B).out), '`who` then reports the repo free');
  const again = hook(s.spoke, A);
  ok(again.code === 0 && held(s.other), 'running it again (nothing left to release) is a quiet no-op');
  fs.rmSync(s.root, { recursive: true, force: true });
}

// ── B. no CLAUDE_PID → the hook does nothing, and that guard is load-bearing ───────────────────────
console.log('\nB. without CLAUDE_PID');
{
  const s = buildSuite();
  run('sh ./gxclaim.sh claim "crew work"', s.spoke, B);
  const r = hook(s.spoke, {});
  ok(r.code === 0 && held(s.spoke), 'with no CLAUDE_PID the hook releases nothing (it cannot tell whose claim it is)');
  run('sh ./gxclaim.sh release', s.spoke, {});
  ok(!held(s.spoke), "control: a bare `release` with no CLAUDE_PID DOES remove another chat's claim — so the guard matters");
  fs.rmSync(s.root, { recursive: true, force: true });
}

// ── C. a chat in a linked worktree still finds its main checkout and the siblings ──────────────────
console.log('\nC. from a linked worktree');
{
  const s = buildSuite();
  const wt = path.join(s.spoke, '.claude', 'worktrees', 'wt-1');
  run(`git worktree add -q "${wt}" -b wt-1`, s.spoke);
  run('sh ./gxclaim.sh claim "from worktree"', wt, A);
  run('sh ./gxclaim.sh claim "hub too"', s.hub, A);
  ok(held(s.spoke), 'fixture: a worktree claim lands on the main checkout (common git dir)');
  hook(wt, A);
  ok(!held(s.spoke) && !held(s.hub), 'the hook run from the worktree releases the main checkout and the sibling');
  fs.rmSync(s.root, { recursive: true, force: true });
}

// ── D. the settings merge adds SessionEnd and disturbs nothing ─────────────────────────────────────
console.log('\nD. gx-settings-hooks.js');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gx-settings-'));
  const f = path.join(dir, 'settings.json');
  // spiff's shape: SessionStart + PostToolUse, plus a repo's own permissions and an extra hook.
  const spiff = {
    permissions: { allow: ['Bash(sh ./gxclaim.sh who)'] },
    hooks: {
      SessionStart: [{ hooks: [{ type: 'command', command: 'sh .claude/gx-brain-notes.sh' }] }],
      PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'sh .claude/gx-posttool-tests.sh' }] },
                    { matcher: 'Bash', hooks: [{ type: 'command', command: 'sh ./repo-own.sh' }] }],
    },
  };
  fs.writeFileSync(f, JSON.stringify(spiff, null, 2));
  const r1 = run(`node "${MERGE}" "${f}"`, dir);
  const after = JSON.parse(fs.readFileSync(f, 'utf8'));
  ok(r1.code === 0 && /added SessionEnd/.test(r1.out) && !/added Session(Start)|added PostToolUse/.test(r1.out), `adds SessionEnd and only SessionEnd (${r1.out.trim()})`);
  ok(after.hooks.SessionEnd && after.hooks.SessionEnd[0].hooks[0].command === 'sh .claude/gx-session-end.sh', 'the SessionEnd hook runs .claude/gx-session-end.sh');
  ok(JSON.stringify(after.hooks.SessionStart) === JSON.stringify(spiff.hooks.SessionStart), 'SessionStart is unchanged');
  ok(JSON.stringify(after.hooks.PostToolUse) === JSON.stringify(spiff.hooks.PostToolUse), "PostToolUse is unchanged, including the repo's own Bash hook");
  ok(JSON.stringify(after.permissions) === JSON.stringify(spiff.permissions), 'permissions are unchanged');
  const before2 = fs.readFileSync(f, 'utf8');
  const r2 = run(`node "${MERGE}" "${f}"`, dir);
  ok(r2.code === 0 && r2.out.trim() === '' && fs.readFileSync(f, 'utf8') === before2, 'a second run changes nothing (idempotent)');

  // A hand-written variant of the hook counts as present — no duplicate.
  fs.writeFileSync(f, JSON.stringify({ hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: '[ -f x ] && sh .claude/gx-session-end.sh' }] }] } }));
  run(`node "${MERGE}" "${f}"`, dir);
  ok(JSON.parse(fs.readFileSync(f, 'utf8')).hooks.SessionEnd.length === 1, 'a hand-written SessionEnd variant is respected, not duplicated');

  // Unparseable or wrong-shaped files are left byte-for-byte alone.
  fs.writeFileSync(f, '{ "hooks": { broken');
  const r3 = run(`node "${MERGE}" "${f}"`, dir);
  ok(r3.code === 1 && fs.readFileSync(f, 'utf8') === '{ "hooks": { broken', 'invalid JSON: exit 1 and the file is untouched');
  fs.writeFileSync(f, '{"hooks":[]}');
  const r4 = run(`node "${MERGE}" "${f}"`, dir);
  ok(r4.code === 1 && fs.readFileSync(f, 'utf8') === '{"hooks":[]}', '"hooks" not an object: exit 1 and the file is untouched');

  // A missing file is created with all three shared hooks.
  fs.unlinkSync(f);
  run(`node "${MERGE}" "${f}"`, dir);
  const fresh = JSON.parse(fs.readFileSync(f, 'utf8'));
  ok(['SessionStart', 'PostToolUse', 'SessionEnd'].every(e => Array.isArray(fresh.hooks[e])), 'a missing settings.json is created with SessionStart, PostToolUse and SessionEnd');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── E. gx-sync.sh actually wires both halves ───────────────────────────────────────────────────────
console.log('\nE. gx-sync.sh');
{
  const sync = fs.readFileSync(path.join(ROOT, 'gx-sync.sh'), 'utf8');
  ok(/^fetch gx-session-end\.sh\s+\.claude\/gx-session-end\.sh 755/m.test(sync), 'gx-sync fetches gx-session-end.sh to .claude/gx-session-end.sh');
  ok(/gx-settings-hooks\.js/.test(sync) && /node "\$_merge" \.claude\/settings\.json/.test(sync), 'gx-sync runs the settings merge on .claude/settings.json');
  ok(!/cat > \.claude\/settings\.json/.test(sync), 'gx-sync no longer writes settings.json wholesale (the merge creates it when missing)');
}

// ── F. the live suite, when it is beside us (informational: lists repos still needing a re-sync) ───
{
  const suite = path.dirname(ROOT);
  const repos = fs.readdirSync(suite).filter(n => !n.startsWith('.') && fs.existsSync(path.join(suite, n, '.gx_app')) || n === 'greencross-command-center');
  if (repos.length) {
    const missing = repos.filter(n => {
      try { return !/gx-session-end\.sh/.test(fs.readFileSync(path.join(suite, n, '.claude', 'settings.json'), 'utf8')); }
      catch (e) { return true; }
    });
    console.log('\nF. live suite (informational, does not fail): ' + (missing.length
      ? 'still need a re-sync for the SessionEnd hook → ' + missing.join(', ')
      : 'every GX repo carries the SessionEnd hook'));
  }
}

try { procA.kill(); } catch (e) {}
try { procB.kill(); } catch (e) {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
