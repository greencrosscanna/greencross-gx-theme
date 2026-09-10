/* GX Update Check — tell a tab when it is running a stale build. Shared across every Green Cross app.
 * Canonical source: greencross-gx-theme/gx-updatecheck.js. Loaded by URL from Pages.
 *
 * ── WHERE THIS CAME FROM ─────────────────────────────────────────────────────────────────────────
 * Built for Sales first (2026-08-26, "Tell the tab when it is running a stale build") and lifted here
 * on 2026-08-27 while it still existed exactly once. That timing is the point: the bug form was
 * copy-pasted into four apps before anyone shared it, and the bill was 63 duplicated CSS rules and
 * three spellings of one action. The reasoning below is Sales', kept because it is the valuable part.
 *
 * ── WHY IT ASKS GX CORE RATHER THAN LOOKING AT ITSELF ────────────────────────────────────────────
 * A phone can sit on a cached copy for days. A monolith app has no ?v= cache-buster to hang this on —
 * the HTML itself IS the bundle — and a page cannot read its own deployed source without
 * re-downloading a quarter-megabyte to sniff one constant. So it asks GX Core: deploy.sh records
 * every release to version_history, and the newest row there is by definition what shipped last.
 * Most apps already make that call for What's New, so this is a comparison, not a new request.
 *
 * ── IT NEVER RELOADS ON ITS OWN (unless you ask) ─────────────────────────────────────────────────
 * A reload mid-task on a phone loses your scroll position and any tray you had open, and the cost of
 * being one version behind is almost always lower than that. The toast asks; the person decides.
 *
 * The exception is a KIOSK, which is the opposite case: greencross-leaderboard runs unattended for
 * days with nobody to click anything, so a stale build there persists until someone notices. Pass
 * autoReload:true for that, and it reloads instead of prompting — see the guard in maybeReload.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────────────────────────
 *   GXUpdateCheck.init({
 *     app:     'inventory',                  // GX Core app key — 'performance' for Leaderboard
 *     gxcore:  GXCORE_URL,                   // this app's GX Core /exec URL
 *     version: () => APP_VERSION,            // what THIS build calls itself, e.g. 'v3.025'
 *     isAuthed: () => auth.isAuthed(),       // optional — skip the check while signed out
 *     autoReload: false,                     // optional — true only for an unattended kiosk
 *   });
 */
(function (global) {
  'use strict';

  var cfg = null, latest = null, checkedAt = 0, wired = false;
  var THROTTLE_MS = 5 * 60 * 1000;
  var FIRST_CHECK_MS = 4000;

  /* 'v2.526' -> [2,526]. Compares segment by segment so v2.9 < v2.10, which a string compare gets
     backwards. It does NOT order two version SCHEMES against each other: a bare 'v38' is [38], which
     beats [1,432] on the first segment. That is why the latest release is picked by date, below, and
     this comparator only ever decides "is that newer than what I am running". */
  function parts(v) {
    return String(v || '').replace(/^v/i, '').split('.').map(function (n) { return parseInt(n, 10) || 0; });
  }
  function newer(a, b) {                    // is a strictly newer than b?
    var x = parts(a), y = parts(b);
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0;
    }
    return false;
  }

  /* THE LATEST RELEASE IS THE ONE DEPLOYED LAST, not the biggest number. The header above already
     said so ("the newest row there is by definition what shipped last"); the code used to take the
     numeric max instead. An app that changed version schemes then nags forever: Price Cards carries
     old rows v19..v42 from before it moved to v1.4xx, so v38 "beat" v1.432 and every load showed
     "Version v38 is available". Rows without a readable deployed_at fall back to the numeric max,
     which is only wrong across schemes, and a row with a date always outranks one without. */
  function pickLatest(rel) {
    var best = null, bestT = -Infinity;
    rel.forEach(function (r) {
      var t = Date.parse(r && r.deployed_at);
      if (r && r.version && isFinite(t) && t > bestT) { bestT = t; best = r.version; }
    });
    if (best) return best;
    var top = rel[0] && rel[0].version;
    rel.forEach(function (r) { if (r && newer(r.version, top)) top = r.version; });
    return top;
  }

  function el() { return global.document.getElementById('gx-upd'); }

  function build() {
    var doc = global.document;
    if (el()) return;
    var wrap = doc.createElement('div');
    wrap.id = 'gx-upd';
    wrap.className = 'gx-upd';
    wrap.setAttribute('role', 'status');
    wrap.innerHTML =
      '<span class="gx-upd-txt" id="gx-upd-txt"></span>' +
      '<button type="button" class="gx-upd-go" id="gx-upd-go">Reload</button>' +
      '<button type="button" class="gx-upd-x" id="gx-upd-x" aria-label="Dismiss">&#10005;</button>';
    doc.body.appendChild(wrap);
    doc.getElementById('gx-upd-go').addEventListener('click', apply);
    doc.getElementById('gx-upd-x').addEventListener('click', dismiss);
  }

  function show(v) {
    /* Suppressed for a version the user already dismissed, and for one they already TRIED to load.
       Pages can serve a stale copy for a minute after deploy.sh records the release, so without that
       second guard a reload comes back on the old version and re-prompts immediately — a loop. */
    try {
      if (global.sessionStorage.getItem('gx_upd_dismissed') === v) return;
      if (global.sessionStorage.getItem('gx_upd_tried') === v) return;
    } catch (e) {}
    build();
    var t = global.document.getElementById('gx-upd-txt');
    if (!t) return;
    t.textContent = 'Version ' + v + ' is available — you are on ' + current() + '.';
    var e = el(); if (e) e.classList.add('show');
  }

  function dismiss() {
    var e = el(); if (e) e.classList.remove('show');
    try { global.sessionStorage.setItem('gx_upd_dismissed', latest || ''); } catch (err) {}
  }

  function apply() {
    var v = latest || String(Date.now());
    try { global.sessionStorage.setItem('gx_upd_tried', v); } catch (e) {}
    /* A plain reload() can be served from cache, which is the whole problem. A URL the browser has
       never seen cannot be — hence the ?v=.

       THE HASH IS PRESERVED, and that is not cosmetic. Leaderboard routes on the hash and is the one
       app that reloads ITSELF (autoReload, because a kiosk has nobody to click). Dropping the hash
       there would silently return an unattended screen to the default view and leave it there — a
       worse failure than the stale build it was fixing, because nobody is watching either.

       Existing query params are dropped deliberately: they are how an app is deep-linked, and ?v= has
       to be the thing that differs or the browser may serve the same cached entry. Carrying a stale
       one forward risks re-pinning whatever it pointed at. */
    var loc = global.location;
    loc.replace(loc.pathname + '?v=' + encodeURIComponent(v) + (loc.hash || ''));
  }

  function current() { return call(cfg && cfg.version, ''); }
  function call(fn, dflt) {
    if (typeof fn !== 'function') return fn === undefined || fn === null ? dflt : fn;
    try { var v = fn(); return v === undefined || v === null ? dflt : v; } catch (e) { return dflt; }
  }

  /* A kiosk has nobody to click the toast, so it reloads itself. Everything else asks first. */
  function maybeReload(v) {
    if (cfg && cfg.autoReload) { latest = v; apply(); return; }
    show(v);
  }

  function check(force) {
    if (!cfg) return;
    if (typeof global.GXClient !== 'function') return;
    // Not while signed out: a login overlay covers the toast anyway, so the prompt would be invisible
    // noise — and a version check is not worth a call to Core before anyone is looking.
    if (cfg.isAuthed && !call(cfg.isAuthed, false)) return;
    var now = Date.now();
    if (!force && now - checkedAt < THROTTLE_MS) return;
    checkedAt = now;
    /* NO RETRIES, a patient timeout. Nobody is waiting on this answer, and a JSONP timeout does not
       cancel the request — the script tag keeps its connection — so each retry is a second
       connection and a second GX Core job, not a replacement. Crew measured version_history requested
       4 times in one page load this way. A miss here costs nothing: the next check is on the next
       foreground, at most THROTTLE_MS later. */
    global.GXClient(cfg.gxcore).jsonp('version_history', { app: cfg.app },
                                      { retries: 0, timeoutMs: 45000 }).then(function (d) {
      var rel = (d && d.ok && (d.releases || d.history)) || [];
      if (!rel.length) return;
      var top = pickLatest(rel);
      if (!top) return;
      latest = top;
      if (newer(top, current())) maybeReload(top);
    }).catch(function () {});
  }

  function init(options) {
    cfg = options || {};
    if (!cfg.app || !cfg.gxcore) { try { console.warn('[gx-updatecheck] app and gxcore are required'); } catch (e) {} return; }
    if (wired) return;
    wired = true;
    // Checked on boot and whenever the tab comes back to the foreground — waking a phone is exactly
    // when a days-old copy surfaces. Throttled so backgrounding does not hammer Core.
    global.document.addEventListener('visibilitychange', function () {
      if (global.document.visibilityState === 'visible') check(false);
    });
    global.setTimeout(function () { check(true); }, FIRST_CHECK_MS);
  }

  global.GXUpdateCheck = {
    init: init,
    check: check,
    // Exported deliberately: the comparator is the part with edge cases worth checking from a
    // console or a test.
    _parts: parts, _newer: newer, _show: show, _pickLatest: pickLatest,
  };
})(typeof window !== 'undefined' ? window : this);
