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
     backwards, and so a bare 'v39' from the old scheme still orders sanely against it. */
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
       never seen cannot be. */
    var loc = global.location;
    loc.replace(loc.pathname + '?v=' + encodeURIComponent(v));
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
    global.GXClient(cfg.gxcore).jsonp('version_history', { app: cfg.app }).then(function (d) {
      var rel = (d && d.ok && (d.releases || d.history)) || [];
      if (!rel.length) return;
      // Newest first by contract, but do not trust the order — take the max.
      var top = rel[0].version;
      rel.forEach(function (r) { if (newer(r.version, top)) top = r.version; });
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
    _parts: parts, _newer: newer, _show: show,
  };
})(typeof window !== 'undefined' ? window : this);
