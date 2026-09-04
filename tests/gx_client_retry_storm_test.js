#!/usr/bin/env node
/* ─── the retry must not amplify a slow GX Core ──────────────────────────────────────────────────
 *   RUN:  node tests/gx_client_retry_storm_test.js   (also run by theme-preflight.sh)
 *
 * WHY THIS EXISTS
 * 2026-09-02, measured: GX Core was running doGet 25-30 times a minute, each execution finishing in
 * 1-3s, while callers waited 56s for a slot. Seven triggers, all infrequent, all ~0% errors — none
 * of the load was scheduled. It was inbound, and it was self-inflicted:
 *
 *   every read retried 4 times at an 8s timeout, so ONE call became FIVE the moment Core crossed 8s
 *   the backoff was linear AND identical everywhere, so every tab in every store retried in lockstep
 *
 * That is a congestion collapse. It sustains itself after the original trigger is gone, then drains
 * and looks fine — which is exactly the "terrible for twenty minutes, then normal" that Crew
 * reported and that I measured recovering on its own with nothing changed.
 *
 * THE ASSERTION THIS FILE EXISTS FOR IS §1: THE DRIVE-HTML MISS STILL RETRIES FIVE TIMES.
 * That retry is the whole reason this client exists — the /exec second hop 404s on ~6% of rapid
 * calls, instantly and cheaply. Damping the SLOW path must not touch it. If §1 ever fails, the cure
 * has become worse than the disease.
 */
'use strict';
const path = require('path');
global.window = global;
const GXClient = require(path.join(__dirname, '..', 'gx-client.js'));

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };
const BASE = 'https://script.google.com/macros/s/AKfycTEST/exec';

/* Drives the REAL jsonp() through a fake <script> element. `plan(i)` decides how attempt i behaves:
     'miss' — script.onerror fires at once   (the instant Drive-HTML second-hop miss)
     'slow' — script.onerror fires LATE      (the same miss, arriving after the budget)
     'hang' — nothing ever fires             (Core is loaded; the timeout budget expires)
     'ok'   — the JSONP callback fires       (success)

   'slow' is the case the first pass of this fix did not model, and its absence is why the fix
   shipped inverted. Measured 2026-09-02: GX Core answered its own hop in ~1.7s median while
   Google's second hop took 20-50s on 12% of calls and 404'd anyway. A miss is NOT reliably
   instant. Anything that reads "took too long" as "the server is loaded" mislabels it. */
function drive(plan, extra) {
  const attempts = [];
  global.document = {
    createElement() {
      const el = { remove() {}, onerror: null };
      let _src;
      Object.defineProperty(el, 'src', { get() { return _src; }, set(v) { _src = v; attempts.push({ t: Date.now(), url: v }); } });
      return el;
    },
    head: {
      appendChild(el) {
        const i = attempts.length - 1;
        const mode = typeof plan === 'function' ? plan(i) : plan;
        if (mode === 'miss') setTimeout(() => { if (el.onerror) el.onerror(); }, 0);
        else if (mode === 'slow') setTimeout(() => { if (el.onerror) el.onerror(); }, 60);  // lands after the 40ms budget
        else if (mode === 'ok') {
          const cb = /[?&]callback=([^&]+)/.exec(attempts[i].url)[1];
          setTimeout(() => { if (global[cb]) global[cb]({ ok: true, via: i }); }, 0);
        }
        // 'hang': deliberately nothing — the per-attempt timer is what ends it
      },
    },
  };
  const c = GXClient(BASE, Object.assign({ timeoutMs: 40, lastTimeoutMs: 90, backoffMs: 10, slowBackoffMs: 10 }, extra || {}));
  return { attempts, client: c };
}

(async () => {
  console.log('\n1. THE ONE THAT MUST NOT REGRESS: an instant miss still gets all five attempts');
  {
    const d = drive('miss');
    let threw = false;
    try { await d.client.jsonp('stores'); } catch (e) { threw = true; }
    ok(threw, 'five instant misses still reject (nothing swallowed)');
    ok(d.attempts.length === 5, 'and it really tried 5 times — got ' + d.attempts.length);
  }

  console.log('\n2. a LOADED core is not hammered — that is the amplification, gone');
  {
    const d = drive('hang');
    let threw = false;
    try { await d.client.jsonp('stores'); } catch (e) { threw = true; }
    ok(threw, 'it still gives up rather than hanging forever');
    /* CORRECTED 2026-09-02 (second pass): 4, not 2. Damping waits for EVIDENCE — three timeouts
       inside the five-attempt window — instead of firing on the first one. A server that is
       genuinely loaded produces that run immediately, so the amplification this section exists to
       prevent is still prevented; what changed is that one unlucky slow response no longer counts
       as a loaded server. §2b is the case that bought the change. */
    ok(d.attempts.length === 4, 'a sustained run of timeouts still skips to the patient final attempt — got ' + d.attempts.length);
    ok(d.client._congested() === true, 'and the client knows it is congested');
  }

  console.log('\n2b. THE INVERSION: a SLOW miss is a miss, not a loaded server');
  {
    /* The first pass classified any timeout as congestion and cut the budget from 5 attempts to 2.
       Under the latency actually measured that afternoon, two slow misses in a row then FAILED the
       call outright — a blank widget in front of a staff member, caused by the cure. The old client
       would have retried three more times and succeeded. This is that exact sequence. */
    const d = drive((i) => (i < 2 ? 'slow' : 'ok'));
    let r = null, threw = false;
    try { r = await d.client.jsonp('stores'); } catch (e) { threw = true; }
    ok(!threw && r && r.ok === true, 'two SLOW misses then a hit still resolves — it must not give up first');
    ok(r && r.via === 2, 'and it was the third attempt that answered');
    ok(d.client._congested() === false, 'two slow responses are not a congested server');
  }

  console.log('\n2c. an isolated slow miss keeps the full retry budget');
  {
    const d = drive((i) => (i === 0 ? 'slow' : 'ok'));
    const r = await d.client.jsonp('stores');
    ok(r && r.via === 1, 'one slow miss then a hit resolves on the very next attempt');
  }

  console.log('\n2d. the congestion window CLEARS — recovery needs no timer');
  {
    const d = drive((i) => (i < 3 ? 'hang' : 'ok'));
    await d.client.jsonp('stores');                       // trips congested(), then succeeds
    for (let i = 0; i < 4; i++) await d.client.jsonp('stores');   // successes push the timeouts out
    ok(d.client._congested() === false, 'a run of successes clears the signal on its own');
  }

  console.log('\n3. the patient final attempt survives — a cold start must still be ridden out');
  {
    const d = drive((i) => (i === 0 ? 'hang' : 'ok'));
    const r = await d.client.jsonp('stores');
    ok(r && r.ok === true, 'a slow first attempt then a success resolves');
    ok(r.via === 1, 'and it was the SECOND attempt that answered');
  }

  console.log('\n4. a miss followed by success still recovers on the fast path');
  {
    const d = drive((i) => (i < 2 ? 'miss' : 'ok'));
    const r = await d.client.jsonp('stores');
    ok(r && r.ok === true, 'two instant misses then a hit resolves');
    ok(d.attempts.length === 3, 'in 3 attempts — the quick cadence is untouched');
  }

  console.log('\n5. success on the first try costs exactly one request');
  {
    const d = drive('ok');
    const r = await d.client.jsonp('stores');
    ok(r && r.ok === true && d.attempts.length === 1, 'no retry when nothing failed');
  }

  console.log('\n6. JITTER: two clients must not retry in lockstep');
  {
    // Same plan, same settings, run twice. With a deterministic backoff the gap sequences would be
    // identical; that identicality across every browser in every store is what built the waves.
    const gaps = async () => {
      const d = drive('miss', { backoffMs: 60 });
      try { await d.client.jsonp('stores'); } catch (e) {}
      return d.attempts.slice(1).map((a, i) => a.t - d.attempts[i].t);
    };
    const a = await gaps(), b = await gaps();
    ok(a.length === 4 && b.length === 4, 'four gaps recorded per run');
    ok(JSON.stringify(a) !== JSON.stringify(b), 'the two runs waited differently — jitter is real (' + a + ' vs ' + b + ')');
    ok(a.every((g) => g >= 0), 'and no gap is negative');
  }

  console.log('\n7. writes are still not retried — postJSON keeps its safety default');
  {
    ok(/postJSON/.test(require('fs').readFileSync(path.join(__dirname, '..', 'gx-client.js'), 'utf8')), 'postJSON still exists');
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'gx-client.js'), 'utf8');
    ok(/retries\s*!=\s*null\s*\?\s*opts\.retries\s*:\s*0/.test(src) || /postJSON[\s\S]{0,900}?retries[^\n]*:\s*0/.test(src),
       'and still defaults to ZERO retries — a replayed write is a corrupted write');
  }

  console.log('\n8. postJSON has a DEADLINE — the write path had none at all');
  {
    // The bug reporter's upload is the visible case: gxCoreUploader asks for retries:2, so before
    // this a hung upload was three UNBOUNDED attempts, each re-sending a multi-MB base64 body,
    // while the modal said "Uploading…" forever. Sky's kiosk report on 2026-09-02 died exactly here.
    let aborted = 0, started = 0;
    global.fetch = (url, init) => new Promise((_res, rej) => {
      started++;
      if (init && init.signal) init.signal.addEventListener('abort', () => { aborted++; rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
      // never resolves otherwise — this is the hang
    });
    const c = GXClient(BASE, { postTimeoutMs: 60, slowBackoffMs: 5 });
    const t0 = Date.now();
    let msg = '';
    try { await c.postJSON('bug_shot', { a: 1 }); } catch (e) { msg = e.message; }
    const el = Date.now() - t0;
    ok(started === 1, 'one attempt by default — a write is still not replayed');
    ok(aborted === 1, 'the hung request was actually aborted, not just abandoned');
    ok(el < 2000, 'and it gave up promptly (' + el + 'ms) instead of hanging forever');
    ok(/timed out/.test(msg), 'the error says it timed out rather than a generic failure — got: ' + msg);
  }

  console.log('\n9. a working POST is not cut off by the deadline');
  {
    global.fetch = async () => ({ status: 200, text: async () => JSON.stringify({ ok: true, url: 'https://drive/x' }) });
    const c = GXClient(BASE, { postTimeoutMs: 60000 });
    const r = await c.postJSON('bug_shot', { a: 1 });
    ok(r && r.ok === true && r.url === 'https://drive/x', 'a normal upload still resolves with its payload');
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'gx-client.js'), 'utf8');
    ok(/POST_TIMEOUT\s*=\s*defaults\.postTimeoutMs\s*!=\s*null\s*\?\s*defaults\.postTimeoutMs\s*:\s*60000/.test(src),
       'the default ceiling is a generous 60s — this ends an infinite wait, it does not police latency');
  }

  console.log('\n10. THE CONGESTION JUMP MUST NOT INFLATE THE BACKOFF (the 32-second dead wait)');
  {
    /* WHY THIS SECTION EXISTS, and why nothing above it could have caught the bug.
     *
     * Every drive() above passes slowBackoffMs: 10 to keep the suite fast. That is correct for what
     * those sections assert — but it also means a 32x multiplier on the slow wait is 320ms, which no
     * assertion here looks at. The suite was fully green for a full day while a stock client sat
     * still for a median 32 SECONDS on every congested sign-in. A green gate is not a passing test:
     * this one never measured the number that was wrong.
     *
     * THE BUG. backoffFor took the exponent from the ATTEMPT INDEX. When congestion trips, the jsonp
     * loop skips the remaining fast attempts with `a = retries - 1`, and `a++` lands on a = 4 — so
     * the FIRST slow wait was 4000 * 2^3 = 32000ms, +/-50% jitter = 16-48s, on top of ~26s of real
     * attempts. Reported as "sign-in takes a minute" by the crew and spiff sessions, 2026-09-03.
     *
     * SO THIS SECTION ASSERTS THE WAIT ITSELF, in real milliseconds, at a REALISTIC slowBackoffMs.
     * It is deliberately the slowest test in the file (~1s) — the alternative is not measuring the
     * thing that broke. PROVEN AGAINST THE BUG: run this file at the commit before the fix and
     * "the first slow wait is one SLOW_BACKOFF" fails with ~3200ms against a 400ms base. */
    const d = drive((i) => (i < 3 ? 'hang' : 'ok'), { timeoutMs: 40, lastTimeoutMs: 90, backoffMs: 10, slowBackoffMs: 400 });
    await d.client.jsonp('stores');
    ok(d.client._congested() === true, 'the run of timeouts did trip congestion (otherwise this proves nothing)');

    // Gap from the LAST fast attempt to the patient one — that is the wait the congestion jump sets.
    const gaps = d.attempts.slice(1).map((a, i) => a.t - d.attempts[i].t);
    const slowGap = gaps[gaps.length - 1];
    // One SLOW_BACKOFF (400ms) +/-50% jitter, plus the 40ms budget the timing-out attempt burned.
    ok(slowGap < 400 * 1.5 + 120,
       'the first slow wait is one SLOW_BACKOFF, not 2^3 of them — got ' + slowGap + 'ms, ceiling ' + Math.round(400 * 1.5 + 120) + 'ms');
    ok(slowGap > 400 * 0.5 - 20,
       'and it still actually waits — got ' + slowGap + 'ms (a slow path with no backoff is the retry storm again)');
  }

  console.log('\n10b. the slow backoff is CAPPED — doubling must not become a hang');
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'gx-client.js'), 'utf8');
    ok(/SLOW_BACKOFF_MAX/.test(src) && /Math\.min\(\s*SLOW_BACKOFF\s*\*\s*Math\.pow\(2,\s*slowWaits/.test(src),
       'backoffFor clamps the exponential to SLOW_BACKOFF_MAX');
    /* Assert on the CALL SHAPE, not on the absence of the old expression. The first cut of this
       check was `!/Math\.pow\(2, attempt - 1\)/` and it failed against the fixed file — because the
       comment above backoffFor QUOTES the old code to explain what was wrong with it. A source-text
       gate that cannot tell code from prose about code is the same class of false signal this whole
       section exists to close; it would have gone green again the moment someone deleted the
       comment. What actually matters is that the loop threads its own counter through. */
    ok(/slowWaits\s*\+\+/.test(src), 'the loop increments a slow-wait counter');
    ok(/backoffFor\(\s*a\s*,\s*slow\s*,\s*slowWaits\s*\)/.test(src),
       'and passes it to backoffFor, so the congestion jump cannot inflate the exponent');
  }

  console.log('\n11. THE TIMEOUT BUDGET DOES NOT TAX THE MISS — which is what makes 20s cheap');
  {
    /* The whole justification for raising TIMEOUT from 8s to 20s is that the Drive-HTML miss is
       detected by script.onerror, not by the clock. If that were ever to stop being true, a bigger
       budget would silently make the suite's most common failure 20s slower each attempt — and
       nothing else in this file would notice. So assert it directly, with an ABSURD budget: five
       instant misses must still complete in well under one of them. */
    const t0 = Date.now();
    const d = drive('miss', { timeoutMs: 30000, lastTimeoutMs: 30000, backoffMs: 10, slowBackoffMs: 10 });
    let threw = false;
    try { await d.client.jsonp('stores'); } catch (e) { threw = true; }
    const el = Date.now() - t0;
    ok(threw && d.attempts.length === 5, 'five instant misses under a 30s budget still make 5 attempts');
    ok(el < 1000, 'and cost ' + el + 'ms, not 5x30s — the miss never spends the timeout');
    ok(d.client._congested() === false, 'instant misses do not read as a congested server at any budget');
  }

  console.log('\n11b. the shipped default clears the measured JSONP p95');
  {
    const src = require('fs').readFileSync(path.join(__dirname, '..', 'gx-client.js'), 'utf8');
    const m = /var TIMEOUT\s*=\s*defaults\.timeoutMs\s*!=\s*null\s*\?\s*defaults\.timeoutMs\s*:\s*(\d+)/.exec(src);
    ok(!!m, 'the default per-attempt timeout is declared where expected');
    // Measured 2026-09-03: JSONP-shaped login answered 3.6-6.4s with spikes far beyond. 8s left ~2s
    // of headroom over the median and failed on every ordinary spike.
    ok(m && Number(m[1]) >= 15000, 'and is >= 15s — got ' + (m && m[1]) + 'ms (8s was under the real p95)');
    ok(m && Number(m[1]) <= 30000, 'but not so large that a dead server holds the screen forever — got ' + (m && m[1]) + 'ms');
  }

  console.log('\n12. AN ABANDONED ATTEMPT MUST NOT THROW WHEN IT FINALLY ARRIVES');
  {
    /* Abandoning a JSONP attempt cancels nothing — the <script> is in flight and GX Core is still
       executing. cleanup() used to `delete global[cb]`, so when the response landed the browser
       evaluated __gx_…({…}) against a missing global: an uncaught ReferenceError per abandoned
       attempt. Reported by the spiff session 2026-09-03 from its boot path. Noise, not breakage —
       but the kind that trains people to ignore a red console, and it lands hardest when something
       IS wrong, because that is when attempts get abandoned. */
    const d = drive('hang');
    let threw = false;
    try { await d.client.jsonp('stores'); } catch (e) { threw = true; }
    ok(threw, 'the call still fails as before');

    // Every attempt's callback name, straight out of the URLs the client actually requested.
    const cbs = d.attempts.map(a => /[?&]callback=([^&]+)/.exec(a.url)[1]);
    ok(cbs.length >= 2, 'several attempts were abandoned (' + cbs.length + ')');

    let late = 0, threwLate = null;
    cbs.forEach(function (cb) {
      // This is the browser evaluating a response that arrived after we stopped listening.
      try { global[cb]({ ok: true, arrived: 'late' }); late++; }
      catch (e) { threwLate = e; }
    });
    ok(threwLate === null,
       'a late response calls a live no-op instead of throwing — got ' + (threwLate && threwLate.name));
    ok(late === cbs.length, `every abandoned callback is still callable (${late}/${cbs.length})`);
  }

  console.log('\n12b. the tombstone does not resolve a settled promise, and is swept');
  {
    // The danger of leaving something callable is that it might do something. It must not: `done`
    // still decides the outcome, so a late arrival cannot revive a call that already failed.
    const d = drive((i) => (i === 0 ? 'hang' : 'ok'));
    const r = await d.client.jsonp('stores');
    ok(r && r.ok === true && r.via === 1, 'the second attempt is what resolved the call');
    const staleCb = /[?&]callback=([^&]+)/.exec(d.attempts[0].url)[1];
    let boom = null;
    try { global[staleCb]({ ok: true, via: 'STALE' }); } catch (e) { boom = e; }
    ok(boom === null, 'the abandoned first attempt can still be called safely');
    ok(r.via === 1, 'and calling it changed nothing — the settled result is untouched');

    const src = require('fs').readFileSync(path.join(__dirname, '..', 'gx-client.js'), 'utf8');
    ok(/setTimeout\(function \(\) \{ try \{ delete global\[cb\]/.test(src),
       'the tombstone is swept on a timer, so it cannot grow without bound');
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
