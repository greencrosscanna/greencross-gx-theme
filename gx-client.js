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
 * Both retry transparently and reject only after every attempt misses; wrap in try/catch and render a
 * clear "couldn't reach GX Core" state on final failure (never a silent blank).
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
      opts = opts || {};
      var retries = opts.retries != null ? opts.retries : RETRIES;
      var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : TIMEOUT;
      var run = async function () {
        var lastErr;
        for (var a = 0; a <= retries; a++) {
          if (a) await sleep(BACKOFF * a);
          try { return await jsonpOnce(action, params, timeoutMs); }
          catch (e) { lastErr = e; }
        }
        throw new Error('GX jsonp "' + action + '" failed after ' + (retries + 1) + ' tries: ' + (lastErr && lastErr.message));
      };
      return run();
    }

    // fetch variant: detects the Drive HTML page (body isn't JSON) and retries. For same-origin or
    // CORS-enabled endpoints; for cross-origin GX Core GETs use jsonp() (no CORS headers there).
    async function getJSON(action, params, opts) {
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

    return { jsonp: jsonp, getJSON: getJSON, buildUrl: buildUrl, base: baseUrl };
  }

  global.GXClient = GXClient;
  if (typeof module !== 'undefined' && module.exports) module.exports = GXClient;
})(typeof window !== 'undefined' ? window : this);
