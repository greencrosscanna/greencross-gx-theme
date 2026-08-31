#!/usr/bin/env node
/* ─── postJSON ↔ price-cards enginePost — the handoff contract — tests ────────────────────────────
 *   RUN:  node tests/postjson_handoff_contract_test.js   (also run by theme-preflight.sh)
 *
 * WHY THIS IS A CROSS-REPO TEST AND NOT A UNIT ONE
 * price-cards carries its own POST retry loop as a documented exception (a spoke may not edit
 * gx-theme), and enginePost ends that exception itself: it branches on
 * `typeof gx.postJSON === "function"` and delegates the moment this file grows one. That branch had
 * never executed — price-cards could only assert the CALL EXISTS TEXTUALLY, because there was
 * nothing on this side to run it against.
 *
 * Adding postJSON therefore does not just add a function. It silently ACTIVATES a live code path in
 * a shipped app, with no deploy on price-cards' side and no review in between — gx-client.js is
 * loaded by URL from Pages, so it reaches five apps inside the 10-minute cache. The producer is the
 * only place that can catch a break in that path before it is everywhere, which is why this lives
 * here rather than in the spoke.
 *
 * WHAT IT PINS: the retry BUDGET crossing the boundary. price-cards passes `{retries: max}` — 4 for
 * an action listed in POST_RETRY_SAFE, 0 for anything else — and this file proves postJSON honours
 * both ends of that, including that an explicit 0 really means one attempt rather than being read as
 * falsy-so-use-the-default.
 *
 * WHAT IT DOES NOT PIN, so nobody trusts it for the wrong thing: postJSON's own DEFAULT. enginePost
 * always passes retries explicitly, so this suite never consults it — flipping the default to
 * RETRIES leaves every case below green. That regression is caught by §1 of
 * gx_client_postjson_test.js, which is where the default belongs. Verified by making the flip and
 * watching this suite pass and that one fail; the claim was the other way round when first written.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };

/* The consumer lives in a sibling repo. Absent (a lone clone, CI) this SKIPS — but says so, loudly
   and by name. A cross-repo test that quietly passes when it found nothing to test is worse than no
   test: it reports green for coverage it never had. */
const PC = path.join(__dirname, '..', '..', 'greencross-price-cards', 'generator.js');
if (!fs.existsSync(PC)) {
  console.log('  SKIP  greencross-price-cards not checked out beside gx-theme — handoff NOT verified.');
  console.log('        This is a skip, not a pass. Run it where the suite is checked out together.');
  process.exit(0);
}

global.window = global;
const GXClient = require(path.join(__dirname, '..', 'gx-client.js'));

/* Slice the REAL enginePost out of the REAL generator.js, the same way price-cards' own suite does.
   Reimplementing the consumer here would test this file against a fiction. */
const SRC = fs.readFileSync(PC, 'utf8');
const m = SRC.match(/@test-slice enginePost[\s\S]*?\*\/\s*([\s\S]*?)\/\* ── @test-slice end/);
if (!m) {
  console.error('LOAD FAILED: the `@test-slice enginePost` sentinels are gone from price-cards/generator.js.');
  console.error('If enginePost was removed because this handoff made it redundant, delete this test WITH it.');
  console.error('If the sentinels merely moved, re-anchor — do not delete the test instead.');
  process.exit(1);
}

let calls = [];
function serve(responder) {
  calls = [];
  global.fetch = async (url, init) => {
    const n = calls.length;
    calls.push({ url, init });
    const r = responder(n);
    return { status: 200, text: async () => r };
  };
}
const DRIVE_HTML = '<html><body>Sorry, unable to open the file at this time.</body></html>';

// enginePost's free variables in the browser, handed in. pcSign stamps the session token — and it
// MUTATES the payload in place, which is the only reason the token survives a handoff that passes
// the original object rather than the signed return value. Model it exactly, or §3 proves nothing.
const built = new Function('GXClient', 'window', 'pcSign',
  m[1] + '\n; return { enginePost: enginePost, SAFE: POST_RETRY_SAFE };')(
  GXClient, global, (p) => { p.token = 'TOK123'; return p; });
const enginePost = built.enginePost;
const BASE = 'https://script.google.com/macros/s/AKfycTEST/exec';

(async () => {
  /* ══ §1 a replay-SAFE action gets its full budget through the boundary ══════════════════════ */
  serve(() => DRIVE_HTML);
  try { await enginePost(BASE, { action: 'saveConfig', config: { a: 1 } }); } catch (e) {}
  ok(calls.length === 5, '§1 saveConfig (listed replay-safe) → 5 attempts, budget crosses intact');
  ok(Object.prototype.hasOwnProperty.call(built.SAFE, 'saveConfig'),
     '§1 …and it is listed for the reason price-cards recorded, not by accident');

  /* ══ §2 an UNLISTED action is sent exactly once ════════════════════════════════════════════
     price-cards audits each write and passes retries:0 for anything it has not cleared. What this
     proves is that the explicit 0 SURVIVES the boundary — a postJSON that treated 0 as falsy and
     substituted its own count would overrule that audit from another repo. (The default itself is
     not exercised here; see the header.) */
  serve(() => DRIVE_HTML);
  try { await enginePost(BASE, { action: 'somethingNobodyAudited', x: 1 }); } catch (e) {}
  ok(calls.length === 1,
     '§2 an UNLISTED write → EXACTLY 1 attempt; an explicit retries:0 is honored across the boundary');

  /* ══ §3 the session token survives the handoff ═════════════════════════════════════════════
     enginePost signs, then hands postJSON the ORIGINAL object. That works only because pcSign
     mutates in place. If postJSON ever cloned before sending, or price-cards stopped mutating,
     every write would go out unsigned and be refused as unauthenticated — on all five apps. */
  serve(() => '{"ok":true}');
  await enginePost(BASE, { action: 'submitCards', cards: [] });
  ok(JSON.parse(calls[0].init.body).token === 'TOK123',
     '§3 the pcSign session token reaches the wire — writes do not go out unsigned');

  /* ══ §4 the caller's error contract is preserved ═══════════════════════════════════════════ */
  serve(() => DRIVE_HTML);
  let err = null;
  try { await enginePost(BASE, { action: 'saveConfig' }); } catch (e) { err = e; }
  ok(err && err.gxUnreachable === true,
     '§4 an exhausted write still sets gxUnreachable — "Google is broken" stays distinguishable');

  /* ══ §5 a refusal RESOLVES, it does not reject ═════════════════════════════════════════════
     Unlike the read door, each price-cards write has its own thing to say to the user, so every
     caller keeps a pcRefused() branch that only runs on a resolved value. */
  serve(() => '{"ok":false,"needsAuth":true,"error":"sign in"}');
  const r = await enginePost(BASE, { action: 'saveConfig' });
  ok(r && r.needsAuth === true, '§5 a refusal resolves for pcRefused() to branch on, not rejects');
  ok(calls.length === 1, '§5 …and is not retried — GX Core answered, it just said no');

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE CRASHED: ' + (e && e.stack || e)); process.exit(1); });
