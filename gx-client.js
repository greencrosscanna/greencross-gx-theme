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
        var timer = setTimeout(function () { if (!done) { cleanup(); reject(new Error('jsonp timeout (likely Drive HTML page)')); } }, timeoutMs);
        global[cb] = function (payload) { if (done) return; cleanup(); resolve(payload); };
        script.onerror = function () { if (!done) { cleanup(); reject(new Error('jsonp script error')); } };
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
        var lastErr;
        for (var a = 0; a <= retries; a++) {
          if (a) await sleep(BACKOFF * a);
          // The final attempt gets the patient budget — by now the instant-miss theory is spent,
          // and what is left looks like a cold start that simply needs longer.
          var budget = (a === retries) ? Math.max(timeoutMs, lastTimeoutMs) : timeoutMs;
          try { return await jsonpOnce(action, params, budget); }
          catch (e) { lastErr = e; }
        }
        throw new Error('GX jsonp "' + action + '" failed after ' + (retries + 1) + ' tries: ' + (lastErr && lastErr.message));
      };
      return run();
    }

    // fetch variant: detects the Drive HTML page (body isn't JSON) and retries. For same-origin or
    // CORS-enabled endpoints; for cross-origin GX Core GETs use jsonp() (no CORS headers there).
    async function getJSON(action, params, opts) {
      if (global.GXDev) global.GXDev.check(action);   // dev write-guard; inert in production
      opts = opts || {};
      var retries = opts.retries != null ? opts.retries : RETRIES;
      var lastErr;
      for (var a = 0; a <= retries; a++) {
        if (a) await sleep(BACKOFF * a);
        try {
          var res = await fetch(buildUrl(action, params, { _ts: String(Date.now()) + '_' + a }), { redirect: 'follow' });
          var text = (await res.text()).trim();
          if (text && (text.charAt(0) === '{' || text.charAt(0) === '[')) return JSON.parse(text);
          lastErr = new Error('non-JSON body (HTTP ' + res.status + ') — Drive HTML page');
        } catch (e) { lastErr = e; }
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
      // The action travels in the BODY, where Apps Script doPost handlers read it (e.postData
      // .contents), not in e.parameter. A caller that already put it there — the common case — gets
      // a byte-identical body; one that only passed it as the argument still gets a well-formed
      // request instead of an action-less one the endpoint would refuse.
      var body = JSON.stringify(
        (payload && payload.action != null) ? payload : Object.assign({ action: action }, payload || {})
      );
      var lastErr;
      for (var a = 0; a <= retries; a++) {
        if (a) await sleep(BACKOFF * a);
        try {
          // cache-bust every attempt so a bad intermediary response is never reused
          var u = baseUrl + (baseUrl.indexOf('?') < 0 ? '?' : '&') + '_ts=' + Date.now() + '_' + a;
          var res = await fetch(u, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: body,
            redirect: 'follow'
          });
          var text = (await res.text()).trim();
          if (text && (text.charAt(0) === '{' || text.charAt(0) === '[')) return JSON.parse(text);
          lastErr = new Error('non-JSON body (HTTP ' + res.status + ') — Drive HTML page');
        } catch (e) { lastErr = e; }
      }
      throw new Error('GX postJSON "' + action + '" failed after ' + (retries + 1) + ' tr' + (retries ? 'ies' : 'y') + ': ' + (lastErr && lastErr.message));
    }

    return { jsonp: jsonp, getJSON: getJSON, postJSON: postJSON, buildUrl: buildUrl, base: baseUrl };
  }

  global.GXClient = GXClient;
  if (typeof module !== 'undefined' && module.exports) module.exports = GXClient;
})(typeof window !== 'undefined' ? window : this);
