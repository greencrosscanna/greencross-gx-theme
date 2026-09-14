#!/usr/bin/env node
/* ─── hedged reads — a second copy of a stalled read, never of a write ───────────────────────────
 *   RUN:  node tests/gx_client_hedge_test.js   (also run by theme-preflight.sh)
 *
 * WHY THIS EXISTS
 * On 2026-09-14 GX Core's /exec was measured stalling on its FIRST hop — the moment Apps Script
 * starts an execution — for 18-34s on 5 of 35 calls to a route that runs in milliseconds, while GX
 * Core averaged well under one execution at a time. The stall is per request, so jsonp() now sends
 * one more copy of a READ that has not answered within hedgeMs and takes whichever lands first.
 *
 * THE ASSERTION THIS FILE EXISTS FOR IS §3: A WRITE IS NEVER HEDGED.
 * jsonp() carries writes — Crew sends incentive_approve, incentive_send and roster_merge through
 * it — and a losing JSONP copy is not cancelled; its execution runs to the end. A hedged write runs
 * twice. If §3 ever fails, a pay approval can be sent twice by a slow network.
 *
 * Drives the REAL jsonp() through a fake <script> element, the same way
 * gx_client_retry_storm_test.js does. Each copy's behavior is scripted by its index:
 *   { ok: ms }    the JSONP callback fires after ms
 *   { miss: ms }  script.onerror fires after ms   (the Drive-HTML miss)
 *   'hang'        nothing ever fires              (the stall)
 */
'use strict';
const path = require('path');
global.window = global;
const GXClient = require(path.join(__dirname, '..', 'gx-client.js'));

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };
const BASE = 'https://script.google.com/macros/s/AKfycTEST/exec';

function drive(plan, extra) {
  const copies = [];
  global.document = {
    createElement() {
      const el = { remove() {}, onerror: null };
      let _src;
      Object.defineProperty(el, 'src', { get() { return _src; }, set(v) { _src = v; copies.push({ t: Date.now(), url: v }); } });
      return el;
    },
    head: {
      appendChild(el) {
        const i = copies.length - 1;
        const mode = typeof plan === 'function' ? plan(i) : plan;
        if (mode && mode.ok != null) {
          const cb = /[?&]callback=([^&]+)/.exec(copies[i].url)[1];
          setTimeout(() => { if (global[cb]) global[cb]({ ok: true, via: i }); }, mode.ok);
        } else if (mode && mode.miss != null) {
          setTimeout(() => { if (el.onerror) el.onerror(); }, mode.miss);
        }
      },
    },
  };
  /* Timings scaled down 1000x from production (hedge 6s, budget 20s) so the suite stays fast, with
     the RATIOS intact: the budget is comfortably more than twice the hedge delay. */
  const c = GXClient(BASE, Object.assign({ hedgeMs: 30, timeoutMs: 200, lastTimeoutMs: 400,
                                           backoffMs: 5, slowBackoffMs: 5, retries: 4 }, extra || {}));
  return { copies, client: c, t0: Date.now() };
}

(async () => {
  console.log('\n1. a STALLED read gets a second copy, and the second copy wins');
  {
    const d = drive(i => (i === 0 ? 'hang' : { ok: 5 }));
    const r = await d.client.jsonp('stores');
    const took = Date.now() - d.t0;
    ok(r && r.ok === true && r.via === 1, 'resolved with the SECOND copy\'s payload');
    ok(d.copies.length === 2, 'exactly two requests were sent — got ' + d.copies.length);
    ok(took < 150, 'and it answered near hedgeMs + 5ms, not after the 200ms budget — took ' + took + 'ms');
  }

  console.log('\n2. a FAST read is never duplicated');
  {
    const d = drive({ ok: 5 });
    await d.client.jsonp('stores');
    await new Promise(r => setTimeout(r, 60));            // well past hedgeMs — nothing may fire late
    ok(d.copies.length === 1, 'one request, and no hedge fires after it answered — got ' + d.copies.length);
  }

  console.log('\n3. THE ONE THAT MUST NOT REGRESS: a stalled WRITE is never hedged');
  {
    for (const action of ['incentive_approve', 'incentive_send', 'roster_merge', 'report_bug', 'add_note']) {
      const d = drive(i => (i === 0 ? 'hang' : { ok: 5 }));
      let r = null;
      try { r = await d.client.jsonp(action, null, { retries: 0 }); } catch (e) { r = null; }
      ok(d.copies.length === 1, action + ': one request while it stalled, never a second copy — got ' + d.copies.length);
    }
  }

  console.log('\n4. an instant MISS before the hedge still retries at once, unhedged');
  {
    /* The Drive-HTML miss is what this client was written for. It must keep its fast retry and must
       not be converted into a hedge — the miss already answered, so there is nothing to race. */
    const d = drive(i => (i === 0 ? { miss: 1 } : { ok: 1 }));
    const r = await d.client.jsonp('stores');
    ok(r && r.via === 1, 'the retry after the miss answered');
    ok(d.copies.length === 2, 'one miss + one retry, no hedge copy in between — got ' + d.copies.length);
  }

  console.log('\n5. the FIRST copy can still win after the hedge fires');
  {
    const d = drive(i => (i === 0 ? { ok: 40 } : 'hang'));
    const r = await d.client.jsonp('stores');
    ok(r && r.via === 0, 'the original answered first and was used');
    ok(d.copies.length === 2, 'the hedge had been sent (40ms > 30ms hedge) — got ' + d.copies.length);
  }

  console.log('\n6. both copies failing is one failed ATTEMPT, and the retry loop carries on');
  {
    // copies 0 and 1 stall (attempt 1, hedged); copy 2 answers (attempt 2)
    const d = drive(i => (i < 2 ? 'hang' : { ok: 2 }));
    const r = await d.client.jsonp('stores');
    ok(r && r.via === 2, 'a doubly-stalled attempt rejected and the next attempt answered');
  }

  console.log('\n7. a late loser does not resolve twice or throw');
  {
    let unhandled = 0;
    const onUnhandled = () => { unhandled++; };
    process.on('unhandledRejection', onUnhandled);
    const d = drive(i => (i === 0 ? { ok: 80 } : { ok: 2 }));   // hedge wins at ~32ms, original lands at 80ms
    const r = await d.client.jsonp('stores');
    await new Promise(res => setTimeout(res, 120));
    process.removeListener('unhandledRejection', onUnhandled);
    ok(r && r.via === 1, 'the winner is the payload returned');
    ok(unhandled === 0, 'the original arriving later raises nothing — got ' + unhandled + ' unhandled');
  }

  console.log('\n8. no hedge when the attempt budget is too short to give a second copy a fair chance');
  {
    /* A caller that set a short timeout has decided how long this call may take. A second copy
       with a sliver of budget would add a request and almost never win. */
    const d = drive(i => (i === 0 ? 'hang' : { ok: 1 }), { timeoutMs: 50, lastTimeoutMs: 50, retries: 0 });
    try { await d.client.jsonp('stores'); } catch (e) { /* expected: it stalls and times out */ }
    ok(d.copies.length === 1, 'budget 50ms < 2 x hedge 30ms, so one request — got ' + d.copies.length);
  }

  console.log('\n9. no hedge while CONGESTED — a server that is behind gets fewer requests, not more');
  {
    const d = drive(i => (i < 3 ? 'hang' : 'hang'), { timeoutMs: 40, lastTimeoutMs: 40, hedgeMs: 30, retries: 4 });
    // 40ms budget already disables hedging; trip congestion first with short attempts...
    try { await d.client.jsonp('stores'); } catch (e) {}
    ok(d.client._congested() === true, 'a run of timeouts trips congestion');
    // ...then give the SAME client a budget long enough to hedge and confirm it still does not.
    const before = d.copies.length;
    try { await d.client.jsonp('stores', null, { timeoutMs: 200, lastTimeoutMs: 200, retries: 0 }); } catch (e) {}
    ok(d.copies.length - before === 1, 'a congested client sends one copy per attempt — got ' + (d.copies.length - before));
  }

  console.log('\n10. the attempt never takes LONGER than it did before hedging existed');
  {
    const d = drive('hang', { retries: 0 });
    const t0 = Date.now();
    try { await d.client.jsonp('stores'); } catch (e) {}
    const took = Date.now() - t0;
    ok(took < 400 + 60, 'two stalled copies still end at the 400ms final budget, not 400 + 30 — took ' + took + 'ms');
    ok(d.copies.length === 2, 'and both copies were sent — got ' + d.copies.length);
  }

  console.log('\n' + (fail ? 'FAIL' : 'PASS') + '  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
