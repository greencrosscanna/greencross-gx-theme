#!/usr/bin/env node
/* ─── GXClient.postJSON — the WRITE door — tests ──────────────────────────────────────────────────
 *   RUN:  node tests/gx_client_postjson_test.js   (also run by theme-preflight.sh)
 *
 * WHY THIS EXISTS
 * gx-client.js had jsonp() and getJSON() and nothing at all for POST, so every app that needed to
 * WRITE through the two-hop /exec redirect had to hand-roll the retry — which price-cards did, in
 * generator.js, as a documented exception, because a spoke may not edit gx-theme. That was the second
 * copy of retry logic in the suite and the note asking for this door said so.
 *
 * THE ASSERTION THIS FILE EXISTS FOR IS §1: THE DEFAULT IS ONE ATTEMPT.
 * A POST retry is not a GET retry. The miss is on the SECOND hop, so the request already reached
 * Apps Script and the write MAY ALREADY HAVE RUN — what was lost is the receipt. A retry re-runs it.
 * jsonp() and getJSON() default to 4 retries because a GET is replay-safe by construction; if this
 * door inherited that default, every caller would get the corrupting one for free. price-cards found
 * one genuinely unsafe write while auditing its own (markPrinted appended an archive row with a fresh
 * UUID per call) that a blanket retry would have started double-archiving. So "absent means once" is
 * a SAFETY property, not a style choice, and the obvious tidy-up — making postJSON's default match
 * its two neighbors — is the exact regression that must fail loudly here.
 *
 * These drive the REAL postJSON out of the real gx-client.js via its module.exports, with fetch and
 * GXDev stubbed. A test that reimplements the thing under test cannot catch it changing.
 */
'use strict';
const path = require('path');

/* gx-client.js binds its `global` with `typeof window !== 'undefined' ? window : this`, and under
   CommonJS `this` at module scope is module.exports — NOT globalThis. So a stub parked on Node's
   global is invisible to the code under test, and the dev-guard cases below would pass vacuously by
   never running the branch at all. Declaring window BEFORE the require makes the module bind exactly
   the object a browser gives it, which is the environment these assertions are about. */
global.window = global;
const GXClient = require(path.join(__dirname, '..', 'gx-client.js'));

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };

const BASE = 'https://script.google.com/macros/s/AKfycTEST/exec';
const DRIVE_HTML = '<!DOCTYPE html><html><body>Sorry, unable to open the file at this time.</body></html>';

// Backoff is real linear sleep (600ms, 1200ms…). Five attempts would idle this suite for 6 seconds,
// and a slow suite is one that gets skipped — so every client is built with backoffMs: 0. The COUNT
// of attempts is what these cases assert; that the pause between them exists is getJSON's contract
// and is not re-litigated here.
function client(extra) { return GXClient(BASE, Object.assign({ backoffMs: 0 }, extra || {})); }

// Records every request so a case can assert on count, URL and body.
function stubFetch(responder) {
  const calls = [];
  global.fetch = async (url, init) => {
    const n = calls.length;
    calls.push({ url, init });
    const r = responder(n);
    return { status: r.status || 200, text: async () => r.body };
  };
  return calls;
}
const html = () => ({ status: 200, body: DRIVE_HTML });          // the cheerful-200 failure
const json = (o) => ({ status: 200, body: JSON.stringify(o) });

async function run() {
  /* ══ §1 THE SAFETY CONTRACT — absent retries means EXACTLY ONE attempt ═══════════════════════════
     If this fails, a shared write door is silently replaying writes nobody opted into. */
  {
    const calls = stubFetch(() => html());
    let threw = null;
    try { await client().postJSON('markPrinted', { action: 'markPrinted', ids: [1] }); }
    catch (e) { threw = e; }
    ok(calls.length === 1, '§1 no opts → ONE attempt, never a retry (the whole safety point)');
    ok(!!threw, '§1 an exhausted write rejects rather than resolving empty');
    ok(threw && /markPrinted/.test(threw.message), '§1 the error names the action, not just "failed"');

    const c2 = stubFetch(() => html());
    try { await client().postJSON('markPrinted', {}, {}); } catch (e) {}
    ok(c2.length === 1, '§1 an opts object with no retries key is still ONE attempt');

    const c3 = stubFetch(() => html());
    try { await client().postJSON('markPrinted', {}, { retries: 0 }); } catch (e) {}
    ok(c3.length === 1, '§1 retries:0 is honored, not treated as "falsy → use the default"');

    // The regression guard, stated as the thing it forbids: constructing the client with the same
    // retries the READS use must NOT leak into the write default. Someone tidying the three doors to
    // look alike would break exactly this.
    const c4 = stubFetch(() => html());
    try { await client({ retries: 4 }).postJSON('markPrinted', {}); } catch (e) {}
    ok(c4.length === 1, '§1 a client-level retries default does NOT arm writes — opt-in is per call');
  }

  /* ══ §2 OPT-IN retries behave like the read doors ═══════════════════════════════════════════════ */
  {
    const calls = stubFetch(() => html());
    try { await client().postJSON('saveConfig', {}, { retries: 4 }); } catch (e) {}
    ok(calls.length === 5, '§2 retries:4 → 5 total attempts (RETRIES + 1, as jsonp/getJSON)');

    const c2 = stubFetch(n => (n === 0 ? html() : json({ ok: true, saved: 1 })));
    const r = await client().postJSON('saveConfig', {}, { retries: 4 });
    ok(c2.length === 2, '§2 stops the moment an attempt returns JSON');
    ok(r && r.ok === true && r.saved === 1, '§2 resolves the PARSED payload, not the raw text');

    const c3 = stubFetch(() => { throw new Error('NetworkError'); });
    try { await client().postJSON('saveConfig', {}, { retries: 2 }); } catch (e) {}
    ok(c3.length === 3, '§2 a fetch that THROWS is a miss too, not an unhandled crash');
  }

  /* ══ §3 A REFUSAL IS NOT A MISS ════════════════════════════════════════════════════════════════
     An auth refusal is well-formed JSON. If it retried, a signed-out iPad would produce a retry
     storm against Core on every write — and the caller would wait five attempts to be told "no". */
  {
    const calls = stubFetch(() => json({ ok: false, needsAuth: true, error: 'sign in' }));
    const r = await client().postJSON('submitCards', {}, { retries: 4 });
    ok(calls.length === 1, '§3 a JSON refusal resolves on attempt 1 — no retry storm when signed out');
    ok(r && r.needsAuth === true, '§3 the refusal is handed back for the caller to branch on');
  }

  /* ══ §4 THE WIRE — a drop-in for the loop it replaces ═══════════════════════════════════════════ */
  {
    const calls = stubFetch(() => json({ ok: true }));
    await client().postJSON('saveConfig', { action: 'saveConfig', config: { a: 1 }, token: 'tok' });
    const { url, init } = calls[0];
    ok(init.method === 'POST', '§4 method is POST');
    ok(/^text\/plain/.test(init.headers['Content-Type']),
       '§4 Content-Type is text/plain — keeps it a "simple" request so there is no CORS preflight');
    ok(JSON.parse(init.body).token === 'tok',
       '§4 the payload is sent verbatim — a caller-stamped session token survives');
    ok(/[?&]_ts=/.test(url), '§4 the URL is cache-busted');

    // Cache-busting only helps if it CHANGES per attempt; a constant _ts lets an intermediary serve
    // the same bad response back forever.
    const c2 = stubFetch(() => html());
    try { await client().postJSON('saveConfig', {}, { retries: 2 }); } catch (e) {}
    const ts = c2.map(c => c.url.split('_ts=')[1]);
    ok(new Set(ts).size === ts.length, '§4 _ts differs on EVERY attempt, not just the first');

    // base already carrying a query string must not produce "?...?_ts="
    const c3 = stubFetch(() => json({ ok: true }));
    const withQ = GXClient(BASE + '?v=2', { backoffMs: 0 });
    await withQ.postJSON('saveConfig', {});
    ok((c3[0].url.match(/\?/g) || []).length === 1, '§4 appends with & when base already has a query');
  }

  /* ══ §5 THE ACTION REACHES THE ENDPOINT ════════════════════════════════════════════════════════
     Apps Script doPost handlers read the action from e.postData.contents, NOT e.parameter. A door
     that took `action` as an argument and put it nowhere on the wire would send a body the endpoint
     refuses as unknown — and the signature would have promised otherwise. */
  {
    const calls = stubFetch(() => json({ ok: true }));
    await client().postJSON('ackProducts', { ids: [7] });
    ok(JSON.parse(calls[0].init.body).action === 'ackProducts',
       '§5 action is folded into the BODY when the payload omits it');

    const c2 = stubFetch(() => json({ ok: true }));
    const payload = { action: 'ackProducts', ids: [7] };
    await client().postJSON('ackProducts', payload);
    ok(c2[0].init.body === JSON.stringify(payload),
       '§5 a payload that already carries the action is sent byte-identical (drop-in for enginePost)');
    ok(payload.action === 'ackProducts' && Object.keys(payload).length === 2,
       '§5 the caller\'s payload object is not mutated');
  }

  /* ══ §6 THE DEV GUARD ══════════════════════════════════════════════════════════════════════════
     check() throws SYNCHRONOUSLY. postJSON is async, so the throw becomes a rejection and unwinds
     through the caller's .catch — price-cards had to convert this by hand to stop a stranded
     spinner. Getting it for free is only true while postJSON stays async; pin it. */
  {
    let seen = null;
    global.GXDev = { check: (a) => { seen = a; if (a === 'nope') throw new Error('writes not armed'); } };
    const calls = stubFetch(() => json({ ok: true }));
    await client().postJSON('saveConfig', {});
    ok(seen === 'saveConfig', '§6 GXDev.check is called with the action');

    const c2 = stubFetch(() => json({ ok: true }));
    let rejected = false;
    try { await client().postJSON('nope', {}); } catch (e) { rejected = true; }
    ok(rejected, '§6 a blocked write REJECTS (not a sync throw past the caller\'s .catch)');
    ok(c2.length === 0, '§6 a blocked write sends nothing at all');
    delete global.GXDev;
  }

  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
run().catch(e => { console.error('SUITE CRASHED: ' + (e && e.stack || e)); process.exit(1); });
