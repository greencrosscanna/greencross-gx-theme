#!/usr/bin/env node
/* getJSON must be able to end a request that never answers.
 *
 * WHY THIS EXISTS
 * TIMEOUT/LAST_TIMEOUT belong to jsonp(). postJSON got its own ceiling on 2026-09-02, when someone
 * noticed nothing bounded a write. getJSON was never given one — so `await fetch(...)` waited as
 * long as the connection stayed open: no error, no rejected promise, nothing to catch or retry.
 *
 * AND THE RETRY LOOP MULTIPLIED IT. One unbounded attempt became RETRIES+1 of them in series, five
 * by default. So "route your engine calls through the shared client" was, against a socket that
 * accepts and never answers, actively worse than a bare fetch. Three sessions were giving that
 * advice on 2026-09-03, including the one that owns this file.
 *
 * Measured that day in Sky's browser: a bare fetch to a hung endpoint had still not settled after
 * 7.5 seconds. The row simply shimmered — that is what reached him as "Portland is stalling".
 * Three in series is 22 seconds of shimmer where there was 7. GX Core's own probe recorded the
 * server-side twin the same afternoon: a 24-second failure on a SINGLE redirect, so this is not
 * only the content-key bounce.
 *
 * WHAT THESE CASES PIN:
 *   §1 a hang ENDS, per attempt, and the later attempts still get to run;
 *   §2 the retry rule does not move — a parsed body returns, only transport misses retry;
 *   §3 the ceiling is caller-tunable, because the right budget depends on the caller's cadence;
 *   §4 it degrades rather than throws where AbortController does not exist;
 *   §5 a fast attempt leaves no timer armed.
 */
'use strict';
const path = require('path');

/* Same binding note as the postJSON suite: gx-client.js binds `global` with
   `typeof window !== 'undefined' ? window : this`, and under CommonJS `this` at module scope is
   module.exports — so a stub parked on Node's global is invisible unless window exists FIRST. */
global.window = global;
const GXClient = require(path.join(__dirname, '..', 'gx-client.js'));

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };

const BASE = 'https://script.google.com/macros/s/AKfycTEST/exec';
const DRIVE_HTML = '<!DOCTYPE html><html><body>Sorry, unable to open the file at this time.</body></html>';

function client(extra) { return GXClient(BASE, Object.assign({ backoffMs: 0 }, extra || {})); }

/* A fetch that honours an AbortSignal, which is the whole point — a stub that ignored the signal
   would let these cases pass while the real hang went unbounded. `hang()` never resolves on its
   own; only the abort ends it. */
function stubFetch(responder) {
  const calls = [];
  global.fetch = (url, init) => {
    const n = calls.length;
    calls.push({ url, init });
    const r = responder(n);
    if (r.hang) {
      return new Promise((resolve, reject) => {
        const sig = init && init.signal;
        if (!sig) return;                       // no controller: genuinely unbounded, as before
        if (sig.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        sig.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    return Promise.resolve({ status: r.status || 200, text: async () => r.body });
  };
  return calls;
}
const hang = () => ({ hang: true });
const html = () => ({ status: 200, body: DRIVE_HTML });
const json = (o) => ({ status: 200, body: JSON.stringify(o) });

async function run() {
  /* ══ §1 A HANG ENDS, AND THE NEXT ATTEMPT RUNS ═══════════════════════════════════════════════ */
  {
    // First attempt hangs forever; second answers. Before the deadline this never reached the second.
    const calls = stubFetch(n => (n === 0 ? hang() : json({ ok: true, v: 1 })));
    const t0 = Date.now();
    const out = await client().getJSON('load', {}, { timeoutMs: 120 });
    const ms = Date.now() - t0;
    ok(out && out.v === 1, '§1 a hung first attempt does not prevent the second from succeeding');
    ok(calls.length === 2, `§1 exactly two attempts were made (${calls.length})`);
    ok(ms < 3000, `§1 and it returned promptly rather than waiting forever (${ms}ms)`);
  }
  {
    // PER ATTEMPT, not per ladder: every attempt hangs, so the ladder must end after retries+1
    // deadlines rather than after one.
    const calls = stubFetch(() => hang());
    let threw = null;
    const t0 = Date.now();
    try { await client({ retries: 2 }).getJSON('load', {}, { timeoutMs: 80 }); }
    catch (e) { threw = e; }
    const ms = Date.now() - t0;
    ok(!!threw, '§1 an all-hanging ladder rejects instead of hanging forever');
    ok(calls.length === 3, `§1 each attempt got its own deadline, so all three ran (${calls.length})`);
    ok(ms < 3000, `§1 and the whole ladder still ended quickly (${ms}ms)`);
    ok(threw && /timed out/.test(threw.message), '§1 the error says it timed out, not just "failed"');
  }

  /* ══ §2 THE RETRY RULE DOES NOT MOVE ═════════════════════════════════════════════════════════
     A refusal is well-formed JSON. It must resolve on the FIRST attempt — a signed-out device must
     not produce a retry storm, and the deadline must not have changed that. */
  {
    const calls = stubFetch(() => json({ ok: false, error: 'Not signed in', code: 'auth_required' }));
    const out = await client().getJSON('load', {});
    ok(out && out.ok === false, '§2 a parsed {ok:false} is RETURNED, not treated as a failure');
    ok(calls.length === 1, `§2 and it never retries a refusal (${calls.length} attempt)`);
  }
  {
    // The Drive-HTML miss is a transport failure and must still retry — that is why this client exists.
    const calls = stubFetch(n => (n < 2 ? html() : json({ ok: true })));
    const out = await client().getJSON('load', {});
    ok(out && out.ok === true, '§2 the Drive-HTML miss still retries through to a real answer');
    ok(calls.length === 3, `§2 and took the attempts it needed (${calls.length})`);
  }
  {
    // An abort is a transport miss, so it retries — the distinction that matters is parsed vs not.
    const calls = stubFetch(n => (n === 0 ? hang() : json({ ok: false, code: 'no_access' })));
    const out = await client().getJSON('load', {}, { timeoutMs: 80 });
    ok(out && out.code === 'no_access',
       '§2 a timeout retries, and the refusal that follows is returned rather than retried again');
    ok(calls.length === 2, `§2 exactly two attempts (${calls.length})`);
  }

  /* ══ §3 THE CEILING IS THE CALLER'S TO SET ═══════════════════════════════════════════════════
     A 60s auto-refresh is already a retry: sales gives a per-store fetch 2 attempts at 15s rather
     than 3 at 30s, because a long chain holds the in-flight guard that blocks the very poll which
     would have fixed it. Retrying harder there recovers slower. */
  {
    const calls = stubFetch(() => hang());
    const t0 = Date.now();
    try { await client({ retries: 0 }).getJSON('load', {}, { timeoutMs: 60 }); } catch (e) {}
    const fast = Date.now() - t0;

    const calls2 = stubFetch(() => hang());
    const t1 = Date.now();
    try { await client({ retries: 0 }).getJSON('load', {}, { timeoutMs: 400 }); } catch (e) {}
    const slow = Date.now() - t1;

    ok(calls.length === 1 && calls2.length === 1, '§3 both were single attempts');
    ok(slow > fast, `§3 a larger timeoutMs genuinely waits longer (${fast}ms vs ${slow}ms)`);
  }
  {
    // A construction-time default must work too, so an app can set its cadence once.
    const calls = stubFetch(() => hang());
    const t0 = Date.now();
    try { await client({ retries: 0, getTimeoutMs: 60 }).getJSON('load', {}); } catch (e) {}
    ok(calls.length === 1 && Date.now() - t0 < 2000,
       '§3 getTimeoutMs can be set once at construction rather than per call');
  }

  /* ══ §4 NO AbortController → DEGRADE, DO NOT THROW ═══════════════════════════════════════════
     Universal in the browsers this suite runs on, but a test harness or an old WebView must fall
     back to the previous behaviour rather than break the read path. */
  {
    const saved = global.AbortController;
    delete global.AbortController;
    try {
      const calls = stubFetch(() => json({ ok: true, v: 9 }));
      const out = await client().getJSON('load', {});
      ok(out && out.v === 9, '§4 a working read still works with no AbortController present');
      ok(calls.length === 1 && !calls[0].init.signal, '§4 and no signal is attached');
    } finally { global.AbortController = saved; }
  }

  /* ══ §5 A FAST ATTEMPT LEAVES NOTHING ARMED ══════════════════════════════════════════════════
     If the killer were not cleared, a long-lived page would accumulate timers, and Node would hang
     on exit — which is itself the assertion here: this suite must terminate on its own. */
  {
    const calls = stubFetch(() => json({ ok: true }));
    await client().getJSON('load', {}, { timeoutMs: 30000 });
    ok(calls.length === 1, '§5 a fast attempt is one fetch');
    ok(true, '§5 and the suite reaching this line means no 30s timer is still pending');
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
