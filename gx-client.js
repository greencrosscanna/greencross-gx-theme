/* GX Client — resilient calls to GX Core's web app. Shared across every Green Cross app.
 * Canonical source: greencross-gx-theme/gx-client.js. Inline a copy per app (most robust — no extra
 * load dependency) OR <script src> it. Keep the copies in sync with this file.
 *
 * WHY THIS EXISTS
 * GX Core's /exec URL is a TWO-HOP redirect: script.google.com/macros/s/…/exec → 302 →
 * script.googleusercontent.com/macros/echo?user_content_key=… . The SECOND hop intermittently 404s with
 * Google's "Sorry, unable to open the file at this time" HTML page. This is Google's content-delivery layer
 * failing — NOT our doGet (which ran fine and produced a valid redirect). Measured ~6% of rapid calls.
 * Failure modes callers must survive:
 *   • JSONP: the HTML page loads as a <script> that NEVER calls our callback and usually does NOT fire
 *     script.onerror — so a naive timeout just resolves empty and the feature blanks for the whole session.
 *   • fetch: the body is HTML, not JSON (and the status may be 200, 404, or 302-followed).
 * The only fix is client-side: detect the miss and RETRY with backoff (a fresh exec→content flow succeeds).
 * Route ALL GX Core calls through this so no app hand-rolls (and mis-handles) the retry again.
 *
 * USAGE
 *   const GX = GXClient('https://script.google.com/macros/s/AKfyc…/exec');
 *   const r  = await GX.jsonp('version_history', { app: 'inventory' });   // cross-origin GET (no CORS) — the common case
 *   const r2 = await GX.getJSON('config', { keys: 'lbGoals' });           // fetch variant (same-origin / CORS-enabled)
 *   const r3 = await GX.postJSON('saveConfig', payload, { retries: 4 }); // WRITE — retries are OPT-IN, see below
 * The two READS retry transparently and reject only after every attempt misses; wrap in try/catch and
 * render a clear "couldn't reach GX Core" state on final failure (never a silent blank).
 *
 * WRITES ARE NOT READS. postJSON retries ZERO times unless you ask, because the miss is on the second
 * hop — the write may already have run and a retry re-runs it. Read the long comment on postJSON and
 * name the reason a replay is a no-op before you pass a retries count.
 *
 * DEV GUARD
 * All three entry points call GXDev.check(action) when gx-dev.js is present, so any app routing through this
 * client is protected on localhost without wiring its own call sites: an action the app has not declared
 * a read is blocked until writes are armed. The dependency is OPTIONAL — a page without gx-dev.js behaves
 * exactly as before, and gx-dev.js is inert outside localhost. An app that ALSO hand-rolls its own call
 * layer must call GXDev.check() there too; this client only sees what goes through it.
 */
(function (global) {
  // Callback names must be unique across EVERY client on the page, not just within one
  // instance. An app that talks to GX Core *and* its own engine holds two clients; if both
  // fire in the same millisecond, a per-instance counter produces the same name twice —
  // the second registration clobbers the first, one response resolves the WRONG promise
  // with the wrong payload, and the other throws "__gx_… is not defined". Silent, and it
  // looks like an empty API result. Counter + nonce live here, shared by all instances.
  var _uid   = 0;
  var _nonce = Math.random().toString(36).slice(2, 8);

  function GXClient(baseUrl, defaults) {
    defaults = defaults || {};
    var RETRIES  = defaults.retries   != null ? defaults.retries   : 4;      // total attempts = RETRIES + 1
    var TIMEOUT  = defaults.timeoutMs != null ? defaults.timeoutMs : 8000;   // per-attempt; a miss = no callback within this
    /* THE LAST ATTEMPT WAITS PROPERLY, because two different failures were being treated as one.
     *
     * The Drive-HTML miss this client exists for is INSTANT — the second hop answers immediately
     * with the wrong thing, so an 8s timeout and a quick retry is exactly right, and the fresh
     * exec→content flow usually succeeds.
     *
     * An Apps Script COLD START is the opposite: the request is alive and would succeed, it just
     * takes 30-40s. Measured on GX Core 2026-09-01 after a run of deploys — 40.9s then 1.2s on the
     * very next call. Against that, an 8s timeout does not detect a failure, it CAUSES one: it
     * abandons an instance that is warming and starts another cold request, five times over. The
     * whole budget was 5 x 8s + 6s backoff = 46s, which is why sign-in took ~45s in a warm browser
     * and failed outright in a private window.
     *
     * So the fast retries stay for the miss, and the FINAL attempt is patient enough to ride out a
     * cold start. Same total attempts, roughly double the budget, and the extra time is only ever
     * spent when every fast attempt has already failed. */
    var LAST_TIMEOUT = defaults.lastTimeoutMs != null ? defaults.lastTimeoutMs : 45000;
    var BACKOFF  = defaults.backoffMs != null ? defaults.backoffMs : 600;    // linear: 600ms, 1200ms, 1800ms…
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    /* SLOW_BACKOFF / JITTER — added 2026-09-02 after GX Core spent a morning at 25-30 doGet/min with
     * callers queueing 56s for executions that themselves ran in 2s.
     *
     * The old wait was `BACKOFF * a` — linear, and IDENTICAL in every browser. Every open tab in
     * every store therefore retried at the same 600ms / 1200ms / 1800ms offsets and arrived as one
     * synchronized wave, which is the worst possible shape for a server that is already behind.
     * Jitter is the whole point: same average delay, spread arrivals.
     *
     * The slow path also backs off exponentially and from a much higher base, because a timeout is
     * evidence the server is loaded — the correct response to which is to wait, not to try harder.
     * The fast path (an instant Drive-HTML miss) keeps the old quick cadence: that retry is cheap,
     * it is what this client was written for, and nothing about it adds load. */
    /* An explicit backoffMs governs BOTH paths. A caller that asked for no backoff — every test in
       this suite passes backoffMs:0 to stay fast — must not be handed a 4s slow-path wait it never
       asked for. Only an unconfigured client gets the higher default, and slowBackoffMs still wins
       outright when it is named. (Caught by postjson_handoff_contract_test.js hanging: it set
       backoffMs:0 and my first cut ignored it, which is the same bug in miniature as the one this
       whole change is about — a client deciding it knows better than the caller about waiting.) */
    var SLOW_BACKOFF = defaults.slowBackoffMs != null ? defaults.slowBackoffMs
                     : (defaults.backoffMs != null ? defaults.backoffMs : 4000);
    // Per-ATTEMPT ceiling for postJSON. Deliberately far larger than jsonp's 8s: a multi-megabyte
    // screenshot through the two-hop redirect is legitimately slow, and this is here to end an
    // unbounded wait, not to enforce a latency budget.
    var POST_TIMEOUT = defaults.postTimeoutMs != null ? defaults.postTimeoutMs : 60000;
    var JITTER = 0.5;                                        // +/- 50% of the computed wait
    function backoffFor(attempt, slow) {
      var base = slow ? SLOW_BACKOFF * Math.pow(2, attempt - 1) : BACKOFF * attempt;
      var spread = base * JITTER;
      return Math.round(base - spread + Math.random() * 2 * spread);
    }

    /* CONGESTION IS A PROPERTY OF THE SERVER, NOT OF ONE ATTEMPT — 2026-09-02, second pass.
     *
     * The first pass damped the retry the moment a SINGLE attempt timed out, on the reasoning that
     * "a miss answers instantly, so anything slow must be a loaded server". Measured the same
     * afternoon, that premise is false. GX Core answered its own hop in ~1.7s (median of 25 calls)
     * while the SECOND hop — Google's content server, which we do not run and cannot speed up —
     * took 20-50s on 12% of calls and returned the Drive-HTML miss anyway. A miss is not reliably
     * instant. It is just as often slow, and it is still a miss.
     *
     * Treating that as congestion inverted the fix: a slow miss dropped the call from five attempts
     * to two, cutting the retry budget by 60% for exactly the failure this client was written to
     * defeat. Two slow misses in a row then failed the call outright, where the old client would
     * have retried three more times and succeeded — a blank widget in front of a staff member,
     * caused by the cure rather than the disease.
     *
     * So the signal is no longer read off one attempt. Congestion means a RUN of timeouts across
     * every call this client has made recently: CONGESTION_TRIP of the last CONGESTION_WINDOW
     * outcomes. That is the shape of a genuinely loaded server and it is not the shape of one
     * unlucky second hop. Real congestion still trips it within the first call or two and every
     * call after that is damped — which is all the original fix needed to stop the fleet-wide
     * amplification. An isolated slow miss keeps the full five attempts.
     *
     * Successes push timeouts out of the window, so recovery needs no timer and no reset. */
    var CONGESTION_WINDOW = defaults.congestionWindow != null ? defaults.congestionWindow : 5;
    var CONGESTION_TRIP   = defaults.congestionTrip   != null ? defaults.congestionTrip   : 3;
    var _recent = [];                                        // last N attempt outcomes; true = timed out
    function noteOutcome(timedOut) {
      _recent.push(timedOut === true);
      while (_recent.length > CONGESTION_WINDOW) _recent.shift();
    }
    function congested() {
      var n = 0;
      for (var i = 0; i < _recent.length; i++) if (_recent[i]) n++;
      return n >= CONGESTION_TRIP;
    }

    function buildUrl(action, params, extra) {
      var u = new URL(baseUrl);
      u.searchParams.set('action', action);
      if (params) Object.keys(params).forEach(function (k) { if (params[k] != null) u.searchParams.set(k, params[k]); });
      if (extra)  Object.keys(extra).forEach(function (k) { u.searchParams.set(k, extra[k]); });
      return u.toString();
    }

    // One JSONP attempt. Resolves the payload when our callback fires; rejects on timeout (the Drive HTML
    // page — callback never fires) or on script error.
    function jsonpOnce(action, params, timeoutMs) {
      return new Promise(function (resolve, reject) {
        var cb = '__gx_' + _nonce + '_' + Date.now() + '_' + (++_uid);
        var script = document.createElement('script');
        var done = false;
        var cleanup = function () { done = true; try { delete global[cb]; } catch (e) { global[cb] = undefined; } script.remove(); clearTimeout(timer); };
        /* LABEL THE FAILURE, because two of them need opposite responses and this client used to
           treat them as one. A Drive-HTML second-hop miss answers INSTANTLY — retrying it at once is
           free and correct, and is why this client exists. A TIMEOUT means GX Core is loaded and has
           not answered; retrying that four more times is how a slow minute becomes a twenty-minute
           outage (measured 2026-09-02: doGet running 25-30/min, each 1-3s, while callers waited 56s
           for a slot). `gxSlow` is what tells jsonp() which one it just had. */
        var timer = setTimeout(function () {
          if (done) return;
          cleanup();
          var e = new Error('jsonp timeout (likely Drive HTML page)');
          e.gxSlow = true;                       // no answer within the budget -> Core is loaded
          reject(e);
        }, timeoutMs);
        global[cb] = function (payload) { if (done) return; cleanup(); resolve(payload); };
        script.onerror = function () {
          if (done) return;
          cleanup();
          var e = new Error('jsonp script error');
          e.gxSlow = false;                      // answered, just not with JS -> the instant miss
          reject(e);
        };
        // cache-bust every attempt so a bad intermediary response is never reused
        script.src = buildUrl(action, params, { callback: cb, _ts: String(Date.now()) + '_' + _uid });
        document.head.appendChild(script);
      });
    }

    // JSONP with retry+backoff. THE call to use for GX Core from a spoke frontend.
    function jsonp(action, params, opts) {
      if (global.GXDev) global.GXDev.check(action);   // dev write-guard; inert in production
      opts = opts || {};
      var retries = opts.retries != null ? opts.retries : RETRIES;
      var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : TIMEOUT;
      var lastTimeoutMs = opts.lastTimeoutMs != null ? opts.lastTimeoutMs : LAST_TIMEOUT;
      var run = async function () {
        var lastErr, slow = false;
        for (var a = 0; a <= retries; a++) {
          if (a) await sleep(backoffFor(a, slow));
          // The final attempt gets the patient budget — by now the instant-miss theory is spent,
          // and what is left looks like a cold start that simply needs longer.
          var budget = (a === retries) ? Math.max(timeoutMs, lastTimeoutMs) : timeoutMs;
          try {
            var payload = await jsonpOnce(action, params, budget);
            noteOutcome(false);                  // it answered — evidence the server is NOT loaded
            return payload;
          }
          catch (e) {
            lastErr = e;
            noteOutcome((e && e.gxSlow) === true);
            /* CONGESTION: skip the remaining fast attempts and go straight to the patient one.
               Five 8s attempts per call means every caller multiplies its own load by five at
               exactly the moment GX Core is least able to take it — and because the old backoff
               was linear and identical everywhere, every open tab in every store retried in
               lockstep and arrived as one wave. Two attempts still ride out a cold start (the
               final budget is 45s); five only ever made the queue longer.

               But this is decided by congested(), NOT by this one attempt timing out. A single
               slow response is an unlucky second hop far more often than it is a loaded server,
               and damping on it costs the miss retry this client exists for. See congested(). */
            slow = congested();
            if (slow && a < retries - 1) a = retries - 1;
          }
        }
        throw new Error('GX jsonp "' + action + '" failed after ' + (retries + 1) + ' tries: ' + (lastErr && lastErr.message));
      };
      return run();
    }

    /* A READ NEEDS A DEADLINE TOO — and this door shipped without one, for longer than the write did.
     *
     * TIMEOUT/LAST_TIMEOUT are jsonp's. postJSON got its own ceiling on 2026-09-02 when someone
     * noticed nothing bounded a write. getJSON was never given one, so `await fetch(...)` waited as
     * long as the connection stayed open: no progress, no cancel, no failure, nothing to retry.
     *
     * THAT IS NOT MERELY UNPROTECTED, IT IS MULTIPLIED. The retry loop below turns one unbounded
     * attempt into RETRIES+1 of them in series — five by default. So "route your engine calls
     * through the shared client" was, against a socket that accepts and never answers, actively
     * worse than a bare fetch. Three sessions were giving that advice today, mine included.
     *
     * Measured 2026-09-03 in Sky's own browser: a bare fetch to a hung endpoint had still not settled
     * after 7.5 seconds — no error, no rejected promise, nothing to catch. The row simply shimmered.
     * That reached him as "Portland is stalling". Three of those in series is 22 seconds of shimmer
     * where there was 7. GX Core's own probe recorded the server-side twin the same afternoon: a
     * 24-second failure on a SINGLE redirect, so this is not only the content-key bounce.
     *
     * PER ATTEMPT, NOT PER LADDER. Bounding the whole ladder unblocks the caller but lets one hung
     * attempt eat the entire budget, so the later attempts — the ones that would have succeeded —
     * never run. The deadline has to end an ATTEMPT for a retry to mean anything.
     *
     * The ceiling is an OPTION rather than a constant because the right budget depends on the
     * caller's cadence, not on this file. A 60s auto-refresh is already a retry: sales gives a
     * per-store fetch 2 attempts at 15s rather than 3 at 30s, because a long chain holds the
     * in-flight guard that blocks the very poll which would have fixed it. Retrying harder there
     * recovers slower. The default is deliberately generous — this exists to end an infinite wait,
     * not to police latency, and a deadline that fires on a working request is worse than none.
     *
     * AbortController is guarded exactly as postJSON guards it: universal in the browsers this suite
     * runs on, but under a test harness or an old WebView its absence must degrade to the previous
     * behaviour rather than throw on the read path.
     *
     * THE RETRY RULE DOES NOT MOVE. A parsed body still returns, {ok:false} included; only a
     * transport miss retries. An AbortError IS a transport miss, so it retries — but a refusal is
     * well-formed JSON, resolves on the first attempt, and never will. */
    /* WHICH DIRECTION IS DANGEROUS: tightening this, not loosening it.
     *
     * 20s looks generous and is not. GX Core's probe splits caller-wait by whether the request
     * bounced, and the two are different populations: a call that does NOT bounce still averages
     * 12.2s against ~1.3s of actual execution, while a bounced one averages 89s. So twelve seconds
     * is the ORDINARY case here, not the tail.
     *
     * That distinction cost a release the day this landed. sales v2.566 shipped a pace ceiling of 8s,
     * set from the fast samples (2.2s, 3.9s) on the reasonable-sounding assumption that 12-17s was
     * the tail. It is the middle. An 8s ceiling would have aborted a large share of perfectly healthy
     * calls, the pace fractions would never have populated, and the day view would have sat
     * permanently on its fallback ramp — a fallback that is fine for one poll cycle and wrong as a
     * steady state. Corrected in v2.567 to one attempt at 20s.
     *
     * A ceiling set from the fast samples of a bimodal distribution is not conservative, it is an
     * outage that looks like a working app. If you are tuning this, raise it or leave it; a caller
     * making several of these in parallel wants MORE headroom, not less. The one number never worth
     * copying is the one your own fast samples suggest. */
    var GET_TIMEOUT = defaults.getTimeoutMs != null ? defaults.getTimeoutMs : 20000;

    // fetch variant: detects the Drive HTML page (body isn't JSON) and retries. For same-origin or
    // CORS-enabled endpoints; for cross-origin GX Core GETs use jsonp() (no CORS headers there).
    async function getJSON(action, params, opts) {
      if (global.GXDev) global.GXDev.check(action);   // dev write-guard; inert in production
      opts = opts || {};
      var retries = opts.retries != null ? opts.retries : RETRIES;
      var getTimeoutMs = opts.timeoutMs != null ? opts.timeoutMs : GET_TIMEOUT;
      var lastErr;
      for (var a = 0; a <= retries; a++) {
        if (a) await sleep(BACKOFF * a);
        var ctl = null, killer = null;
        try {
          var init = { redirect: 'follow' };
          if (typeof AbortController === 'function') {
            ctl = new AbortController();
            init.signal = ctl.signal;
            /* Armed across the BODY READ as well, not just the fetch. A response whose headers
               arrive and whose body never finishes streaming hangs identically, and aborting only
               the fetch would leave that hole exactly where the Drive-HTML miss lives. Cleared in
               `finally`, so a fast attempt never leaves a timer pending. */
            killer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, getTimeoutMs);
          }
          var res = await fetch(buildUrl(action, params, { _ts: String(Date.now()) + '_' + a }), init);
          var text = (await res.text()).trim();
          if (text && (text.charAt(0) === '{' || text.charAt(0) === '[')) return JSON.parse(text);
          lastErr = new Error('non-JSON body (HTTP ' + res.status + ') — Drive HTML page');
        } catch (e) {
          lastErr = (e && e.name === 'AbortError')
            ? new Error('get timed out after ' + getTimeoutMs + 'ms')
            : e;
        } finally { if (killer) clearTimeout(killer); }
      }
      throw new Error('GX getJSON "' + action + '" failed after ' + (retries + 1) + ' tries: ' + (lastErr && lastErr.message));
    }

    // ── POST variant. READ THE RETRY RULE BEFORE YOU CALL IT ────────────────────────────────────
    // Same transport failure as getJSON — the second hop serves Google's HTML page with a cheerful
    // 200, so the BODY SHAPE is the only tell — but NOT the same safety problem, and this door must
    // not pretend otherwise.
    //
    // The miss happens on the SECOND hop. The request already reached Apps Script, so the write MAY
    // ALREADY HAVE RUN: what the caller lost is the RECEIPT, not the write. A retry therefore
    // RE-RUNS it. That is fine for a write that is a no-op the second time and silently corrupting
    // for one that is not — price-cards found exactly one of the latter while auditing its own
    // writes (markPrinted appended an archive entry with a fresh UUID per call, so a blanket retry
    // would have started double-archiving print runs).
    //
    // So retries here DEFAULT TO ZERO. jsonp() and getJSON() default to RETRIES because a GET is
    // replay-safe by construction; a POST is not, and a shared door that guessed otherwise would
    // hand every caller the corrupting default. Opting in is per call and deliberate:
    //
    //   GX.postJSON('saveConfig', payload, { retries: 4 })   // whole-config replace — replay is a no-op
    //   GX.postJSON('markPrinted', payload)                  // unlisted → exactly one attempt
    //
    // THE CALLER OWNS IDEMPOTENCY. Before passing a retries count, say out loud why re-running this
    // action changes nothing — a de-dupe on the server, a content-derived id the engine replays, a
    // remove-by-id or a whole-record replace. If you cannot finish that sentence, do not pass one.
    // The pattern worth copying is price-cards' POST_RETRY_SAFE map: a table of action → the reason
    // a replay is a no-op, with anything unlisted sent exactly once, so a write added later without
    // thought is simply not retried.
    //
    // A REFUSAL IS NOT A MISS. An auth refusal is well-formed JSON, so it resolves on the first
    // attempt and never retries — no retry storm on a signed-out device. Only a transport miss
    // (non-JSON body, or fetch throwing) retries.
    //
    // text/plain;charset=utf-8 is deliberate: it keeps the request "simple" so the browser skips the
    // CORS preflight, which /exec cannot answer. Apps Script reads the body from e.postData.contents
    // regardless of the declared type.
    async function postJSON(action, payload, opts) {
      if (global.GXDev) global.GXDev.check(action);   // dev write-guard; inert in production
      opts = opts || {};
      // NOT `!= null ? … : RETRIES` — see above. Absent means once.
      var retries = opts.retries != null ? opts.retries : 0;
      var postTimeoutMs = opts.timeoutMs != null ? opts.timeoutMs : POST_TIMEOUT;
      // The action travels in the BODY, where Apps Script doPost handlers read it (e.postData
      // .contents), not in e.parameter. A caller that already put it there — the common case — gets
      // a byte-identical body; one that only passed it as the argument still gets a well-formed
      // request instead of an action-less one the endpoint would refuse.
      var body = JSON.stringify(
        (payload && payload.action != null) ? payload : Object.assign({ action: action }, payload || {})
      );
      /* A WRITE NEEDS A DEADLINE, and this door shipped without one.
       *
       * TIMEOUT/LAST_TIMEOUT above are jsonp's; nothing bounded a POST, so an attempt waited as long
       * as the connection stayed open — no progress, no cancel, no failure. The bug reporter's image
       * upload is the visible case: gxCoreUploader asks for retries:2, so a hung upload was THREE
       * unbounded attempts, each re-sending a multi-megabyte base64 body, while the modal said
       * "Uploading…" forever. Leaderboard measured a bug_shot POST taking 26.1s cold just to REFUSE
       * an invalid token, so with a real screenshot that state is indistinguishable from stuck.
       *
       * Generous on purpose — a large upload through the two-hop redirect is legitimately slow, and
       * a deadline that fires on a working request is worse than none. This exists to end the
       * infinite wait, not to police latency.
       *
       * AbortController is guarded: it is universal in the browsers this suite runs on, but under a
       * test harness or an old WebView its absence must degrade to the previous behaviour rather
       * than throw on the write path. */
      var lastErr;
      for (var a = 0; a <= retries; a++) {
        /* JITTERED, but NOT the read path's exponential slow base. That base exists because a read
           storm is many tabs piling onto one server; a write is one person's click, and there are
           never many of them at once. Applying it here made price-cards' exhausted submit wait
           4+8+16+32s of pure backoff on top of its attempts — minutes, for someone standing at a
           label printer. Jitter still helps and costs nothing; the escalation does not belong. */
        if (a) await sleep(backoffFor(a, false));
        var ctl = null, killer = null;
        try {
          // cache-bust every attempt so a bad intermediary response is never reused
          var u = baseUrl + (baseUrl.indexOf('?') < 0 ? '?' : '&') + '_ts=' + Date.now() + '_' + a;
          var init = {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: body,
            redirect: 'follow'
          };
          if (typeof AbortController === 'function') {
            ctl = new AbortController();
            init.signal = ctl.signal;
            killer = setTimeout(function () { try { ctl.abort(); } catch (e) {} }, postTimeoutMs);
          }
          var res = await fetch(u, init);
          var text = (await res.text()).trim();
          if (text && (text.charAt(0) === '{' || text.charAt(0) === '[')) return JSON.parse(text);
          lastErr = new Error('non-JSON body (HTTP ' + res.status + ') — Drive HTML page');
        } catch (e) {
          lastErr = (e && e.name === 'AbortError')
            ? new Error('post timed out after ' + postTimeoutMs + 'ms')
            : e;
        } finally { if (killer) clearTimeout(killer); }
      }
      throw new Error('GX postJSON "' + action + '" failed after ' + (retries + 1) + ' tr' + (retries ? 'ies' : 'y') + ': ' + (lastErr && lastErr.message));
    }

    return { jsonp: jsonp, getJSON: getJSON, postJSON: postJSON, buildUrl: buildUrl, base: baseUrl, _congested: congested };
  }

  global.GXClient = GXClient;
  if (typeof module !== 'undefined' && module.exports) module.exports = GXClient;
})(typeof window !== 'undefined' ? window : this);
