/* GX Session bridge — a nested sub-app inherits the host's sign-in instead of asking again.
 * Canonical source: greencross-gx-theme/gx-session.js.
 *
 * WHY THIS EXISTS
 * Price Cards and SPIFF are embedded in Inventory by iframe at their live URLs. Different origin means
 * separate storage, so the nested app saw no session and showed its own login -- signing in twice to
 * reach one screen. That is not a nested app, it is two apps stacked.
 *
 * WHY A TOKEN CAN CROSS AT ALL
 * GX Core signs every token as user:exp:HMAC with GC_SESSION_SECRET, and that secret is shared across
 * projects, so a token issued for one app validates in another. The bridge moves an EXISTING token; it
 * mints nothing and grants nothing the user did not already have.
 *
 * WHY postMessage AND NOT A QUERY PARAM
 * A token in a URL leaks into history, referrers and server logs, and iframe src attributes are visible
 * in the host's DOM. postMessage keeps it out of all of those.
 *
 * DIRECTION OF TRUST — read this before changing anything here
 * The CHILD asks and the HOST answers, never the reverse, and both ends check origin against an
 * allowlist. A child that accepted a session pushed by any frame would take one from a malicious
 * embedder; a host that answered any asker would hand sessions to any page that framed it.
 *
 * HOST (the dashboard doing the embedding)
 *   GXSession.serve(function () {
 *     return { token: t, user: 'sky', displayName: 'Sky Pinnick', role: 'admin', avatarConfig: cfg };
 *   });
 *
 * CHILD (the nested app)
 *   GXSession.request(6000).then(function (sess) {
 *     if (sess) adoptSession(sess);   // nested and the host had one
 *     else      renderGate();         // standalone, or the host is signed out
 *   });
 */
(function (global) {
  if (global.GXSession) return;

  var ALLOWED = [
    /^https:\/\/greencrosscanna\.github\.io$/,
    /^https:\/\/script\.google\.com$/,
    /^https:\/\/[a-z0-9-]+\.googleusercontent\.com$/,
    /^http:\/\/localhost(:\d+)?$/,
    /^http:\/\/127\.0\.0\.1(:\d+)?$/
  ];
  function originAllowed(o) {
    return ALLOWED.some(function (re) { return re.test(String(o || '')); });
  }

  var REQ = 'gx-session:request';
  var RES = 'gx-session:response';

  /* HOST side. Answers only same-suite origins, and only with what the provider chooses to expose --
     never the raw storage object, so a host cannot leak more than it means to. */
  function serve(provider) {
    if (!global.addEventListener) return;
    global.addEventListener('message', function (e) {
      if (!e.data || e.data.type !== REQ) return;
      if (!originAllowed(e.origin)) return;
      var payload = null;
      try { payload = provider ? provider() : null; } catch (err) { payload = null; }
      try {
        e.source.postMessage({ type: RES, session: payload || null }, e.origin);
      } catch (err) {}
    });
  }

  /* CHILD side. Resolves null rather than hanging when standalone, when the host has no session, or
     when the host is an older build that does not answer -- the app must still be able to show its
     own sign-in instead of waiting forever on a message that is never coming. */
  function request(timeoutMs) {
    timeoutMs = timeoutMs || 6000;
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (done) return; done = true; cleanup(); resolve(v); }
      function onMsg(e) {
        if (!e.data || e.data.type !== RES) return;
        if (!originAllowed(e.origin)) return;
        finish(e.data.session || null);
      }
      var cleanup = function () {
        try { global.removeEventListener('message', onMsg); } catch (err) {}
        clearTimeout(timer);
      };
      var timer = setTimeout(function () { finish(null); }, timeoutMs);
      try {
        if (global.self === global.top) return finish(null);   // not nested: nobody to ask
        global.addEventListener('message', onMsg);
        /* ASK REPEATEDLY, not once. postMessage is not queued: if the host has not registered its
           listener yet the message is simply dropped, and a single attempt then waits out the whole
           timeout and falls back to a login the user should never have seen. The host embeds the
           iframe in its own HTML, so the child routinely loads and asks BEFORE the host's script has
           run -- asking once works only when the ordering happens to favour it. */
        var ask = function () { try { global.parent.postMessage({ type: REQ }, '*'); } catch (e) {} };
        ask();
        var poll = setInterval(function () { if (done) { clearInterval(poll); return; } ask(); }, 200);
        var stop = setTimeout(function () { clearInterval(poll); }, timeoutMs);
        var origCleanup = cleanup;
        cleanup = function () { clearInterval(poll); clearTimeout(stop); origCleanup(); };
      } catch (err) { finish(null); }
    });
  }

  global.GXSession = { serve: serve, request: request, originAllowed: originAllowed };
})(typeof window !== 'undefined' ? window : this);
