#!/usr/bin/env node
/* The SessionStart brain-notes hook must never be silent about a fetch it could not make.
 *
 * THE BUG IT IS WRITTEN FOR (reported by spiff, note_mu5v8xfb_fizf, 2026-09-16). A spiff session
 * opened with a pending ask in its inbox and the hook printed NOTHING. gx_fetch used
 * `curl --max-time 6`; GX Core answered neither call inside six seconds, four times. The same two
 * calls by hand at --max-time 10 and 20 returned immediately — latency at the six-second line, not
 * an outage. Core measured 6-30s on getBrands that month, so six seconds was inside the normal range
 * for a slow library read.
 *
 * THE HALF THAT MATTERED MORE. The fetcher deliberately passes null rather than empty on a failed
 * call, with a comment explaining that the renderer must be able to tell "asked, nothing there" from
 * "could not ask". And then the renderer's next line was `if not notes and not bugs: sys.exit(0)`,
 * with a null doc coerced to {} one line above it — so both cases exited silently and identically.
 * A session opens, sees nothing, and correctly concludes nothing needs it. The distinction the code
 * took care to preserve was thrown away before anything read it.
 *
 * WHY IT LIFTS THE RENDERER OUT OF THE SHIPPED FILE rather than restating it: a copy inlined here
 * would pass forever while gx-brain-notes.sh rotted underneath it. Rewriting the renderer badly in
 * the shipped script fails this test. Nothing here touches the network — the renderer is a pure
 * function of the JSON the fetcher hands it, which is exactly the seam the bug lived in.
 */
const { execFileSync } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✓ ' + msg); }
                            else { fail++; console.log('  ✗ FAIL ' + msg); } };

const HOOK_PATH = path.join(__dirname, '..', 'gx-brain-notes.sh');
const hook = fs.readFileSync(HOOK_PATH, 'utf8');
const lines = hook.split('\n');

// ── 1. the timeout itself ───────────────────────────────────────────────────────────────────────
// Code lines only. The comment above gx_fetch quotes the by-hand repro ("--max-time 10 and 20"),
// and a whole-file match reads that prose as a shipped timeout.
const maxTimes = lines
  .filter(l => !l.trim().startsWith('#'))
  .flatMap(l => (l.match(/--max-time (\d+)/g) || []))
  .map(m => Number(m.split(' ')[1]));
ok(maxTimes.length > 0, 'gx_fetch still bounds its curl with --max-time');
ok(maxTimes.every(t => t >= 15),
   `every --max-time is at least 15s (found ${maxTimes.join(', ')}) — 6s sat inside Core's normal read latency`);

// ── lift the renderer out of the shipped hook ───────────────────────────────────────────────────
// It is the python block fed by the printf that carries notes_doc, so anchor on that rather than on
// a line number: the CI-status block earlier in the file is also `python3 -c`.
const startIdx = lines.findIndex(l => l.includes('notes_doc') && l.includes('python3 -c'));
ok(startIdx !== -1, 'the renderer block is still present in gx-brain-notes.sh');
if (startIdx === -1) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
const endRel = lines.slice(startIdx).findIndex((l, i) => i > 0 && l.startsWith("'"));
const RENDERER = lines.slice(startIdx + 1, startIdx + endRel).join('\n');
ok(/notes_doc/.test(RENDERER) && /sys\.exit/.test(RENDERER), 'the lifted renderer is the real one');

// ── the fetcher must keep handing null, not empty, on a failed call ─────────────────────────────
// The renderer cannot distinguish what it is never told. If this line ever becomes "${_NOTES:-{}}"
// the warning below goes quiet again with every assertion in this file still green.
ok(/\$\{_NOTES:-null\}/.test(hook) && /\$\{_BUGS:-null\}/.test(hook),
   'a failed fetch is still passed to the renderer as null, not as an empty object');
ok(/"app":"%s"/.test(hook),
   'the app key is passed in from the shell, so the warning can name the app when both fetches fail');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gxnotes-'));
const PY = path.join(dir, 'renderer.py');
fs.writeFileSync(PY, RENDERER);
const render = (payload) => {
  try {
    return execFileSync('python3', [PY], { input: JSON.stringify(payload), stdio: ['pipe', 'pipe', 'pipe'] }).toString();
  } catch (e) { return 'RENDERER CRASHED: ' + (e.stderr || '').toString(); }
};

const ASK = { id: 'note_x', title: 'Test ask', from_app: 'core-admin', kind: 'ask', status: 'pending', body: 'body' };

// ── 2. could not ask — the case the bug ate ─────────────────────────────────────────────────────
const bothDown = render({ app: 'inventory', notes_doc: null, bugs_doc: null });
ok(bothDown.trim() !== '', 'a session is TOLD when both fetches failed, instead of seeing nothing');
ok(/could not reach/i.test(bothDown), 'the warning says GX Core could not be reached');
ok(/inventory/.test(bothDown), 'the warning names the app whose inbox went unchecked');
ok(/not an all-clear|not checked/i.test(bothDown), 'the warning says silence here is not an all-clear');

// ── 3. asked, nothing there — must stay silent ──────────────────────────────────────────────────
// The banner is a doorbell. A session with a genuinely clear board must not be given something to read.
const clear = render({ app: 'inventory', notes_doc: { ok: true, app: 'inventory', notes: [] }, bugs_doc: { ok: true, bugs: [] } });
ok(clear.trim() === '', 'an empty board still prints nothing at all');

// ── 4. one fetch down, one up — warn AND render what did arrive ─────────────────────────────────
const halfDown = render({ app: 'inventory', notes_doc: { ok: true, app: 'inventory', notes: [ASK] }, bugs_doc: null });
ok(/could not reach/i.test(halfDown), 'a partial failure still warns');
ok(/bug board/i.test(halfDown), 'the partial warning names WHICH board went unchecked');
ok(/Test ask/.test(halfDown), 'the half that did arrive is still rendered');

// ── 5. the ordinary path is unchanged ───────────────────────────────────────────────────────────
const normal = render({ app: 'inventory', notes_doc: { ok: true, app: 'inventory', notes: [ASK] }, bugs_doc: { ok: true, bugs: [] } });
ok(/NEEDING YOU for inventory/.test(normal), 'a real ask still renders with the app name');
ok(!/could not reach/i.test(normal), 'no warning when both fetches succeeded');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
