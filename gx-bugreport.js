/* GX Bug Report — the shared "report a bug" button, modal and submit.
 * Canonical source: greencross-gx-theme/gx-bugreport.js.
 *
 * Loaded BY URL from Pages, like gx-theme.css and gx-client.js:
 *     <script src="https://greencrosscanna.github.io/greencross-gx-theme/gx-bugreport.js"></script>
 * so an edit here reaches every app on its next load, inside the ~10-minute cache, with no deploy and
 * no review in between. Treat it accordingly.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * The bug form was copy-pasted. Measured 2026-08-23:
 *
 *   inventory    full form · 21 local .bug-* CSS rules · action 'bugreport'
 *   leaderboard  full form · 21 local .bug-* CSS rules · action 'bugreport'   (byte-alike to inventory)
 *   sales        full form · 21 local .bug-* CSS rules · action 'reportbug'   (note the swap)
 *   pricecards   NO form — a bare window.prompt(), one free-text field · action 'reportBug'
 *   spiff, crew  no way to report a bug at all
 *
 * 63 duplicated CSS rules, three spellings of one action, and two apps with no reporter. Adding one
 * field to "the bug form" meant four edits and two ports. That is the whole case for this file.
 *
 * ── THE CONTEXT SNAPSHOT (what we do instead of attaching a screenshot) ──────────────────────────
 * Every report carries route, filters, viewport, browser and the last console error, captured
 * automatically — the user types nothing extra. For the reports people actually file this beats a
 * picture: "the store filter is stuck" needs to say WHICH filter was set, and a screenshot of a chart
 * does not.
 *
 * BE ACCURATE ABOUT WHY THERE IS NO IMAGE, because the first version of this comment was not. It said
 * an image "has no transport". That is FALSE. A cross-origin browser POST to an Apps Script web app
 * works and its response is readable — measured from the production origin, and Price Cards' bug
 * reporter has been doing exactly that in production the whole time. What is true is narrower: GX Core
 * has no `doPost`, so it cannot receive one; a spoke's OWN engine can, and Sales and Price Cards
 * already do.
 *
 * So images are a COST decision, not an impossibility: an upload sink, Drive storage, a screenshot_url
 * column, and a capture step (html2canvas is ~200KB on every load and only approximates the render;
 * getDisplayMedia gives real pixels but prompts the user to pick a window every time). Sky's call on
 * 2026-08-23 was to ship the text snapshot first and revisit images only if a real report needs one.
 * That call still stands — but if you reopen it, reopen it on the cost, not on a false impossibility.
 *
 * Console errors are captured only from the moment this script loads, and only the last few. It is a
 * breadcrumb, not a log: anything bigger belongs in the app's own telemetry, and GX Core truncates
 * the field at 4000 chars anyway (it has to fit in a URL).
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────────────────────────
 *   GXBugReport.init({
 *     app:      'inventory',                  // GX Core app key
 *     action:   'bugreport',                  // this app's proxy action name — see the table above
 *     submit:   payload => proxyFetch(payload),   // the app's own transport; it owns auth
 *     reporter: () => _getSessionUser(),      // optional
 *     context:  () => ({ tab: state.tab, store: state.store }),   // optional app-specific state
 *     version:  () => APP_VERSION,            // optional
 *     fab:      true,                         // optional — false to supply your own trigger
 *   });
 *
 * `submit` is deliberately the app's function rather than a URL. Each app already has a working,
 * authenticated path to its own proxy (token handling, session expiry, retry); re-implementing that
 * here would be a second auth path to keep correct, and the first bug it caused would be invisible.
 */
(function (global) {
  'use strict';

  var cfg = null;
  var recentErrors = [];
  var MAX_ERRORS = 3;

  /* Breadcrumbs. Passive: never swallows an error, never changes what the console shows. */
  function watchErrors() {
    try {
      global.addEventListener('error', function (e) {
        push((e && e.message) || 'error', e && e.filename, e && e.lineno);
      });
      global.addEventListener('unhandledrejection', function (e) {
        var r = e && e.reason;
        push('unhandled rejection: ' + ((r && r.message) || String(r || '')), null, null);
      });
    } catch (e) {}
  }
  function push(msg, file, line) {
    try {
      var at = file ? (String(file).split('/').pop() + (line ? ':' + line : '')) : '';
      recentErrors.push(String(msg).slice(0, 200) + (at ? ' @' + at : ''));
      while (recentErrors.length > MAX_ERRORS) recentErrors.shift();
    } catch (e) {}
  }

  /* The snapshot. Everything here is cheap and non-identifying beyond what the bug already carries. */
  function snapshot() {
    var o = {};
    try { o.url = String(global.location.href).slice(0, 300); } catch (e) {}
    /* Omit a zero dimension rather than filing "0x0". A backgrounded or not-yet-laid-out window
       reports 0, and "viewport: 0x0" in a bug report is not a small inaccuracy — it is a fact that
       looks measured, and someone will try to explain a layout bug with it. Observed live in the
       preview, not theorised. An absent field is honest; a wrong one is not. */
    try { if (global.innerWidth > 0 && global.innerHeight > 0)
      o.viewport = global.innerWidth + 'x' + global.innerHeight + '@' + (global.devicePixelRatio || 1) + 'x'; } catch (e) {}
    try { if (global.screen.width > 0 && global.screen.height > 0)
      o.screen = global.screen.width + 'x' + global.screen.height; } catch (e) {}
    try { o.ua = String(global.navigator.userAgent).slice(0, 200); } catch (e) {}
    try { o.online = !!global.navigator.onLine; } catch (e) {}
    try { o.at = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }); } catch (e) {}
    // Pacific, matching every other timestamp in the suite — a bug report that says "3:02 PM" has to
    // mean the same 3:02 PM as the sheet it will be read next to.
    try { if (global.GXTopNav && global.GXTopNav.isEmbedded) o.embedded = !!global.GXTopNav.isEmbedded(); } catch (e) {}
    if (recentErrors.length) o.errors = recentErrors.slice();
    // App-specific state last, so an app can override anything above if it knows better.
    if (cfg && typeof cfg.context === 'function') {
      try {
        var extra = cfg.context() || {};
        Object.keys(extra).forEach(function (k) { if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') o[k] = extra[k]; });
      } catch (e) { o.contextError = String(e).slice(0, 120); }
    }
    return o;
  }

  // ── markup ──────────────────────────────────────────────────────────────────────────────────────
  var PRIORITIES = [
    { v: 'low',    label: 'Low',    hint: 'minor annoyance' },
    { v: 'normal', label: 'Normal', hint: "something's wrong" },
    { v: 'high',   label: 'High',   hint: 'blocking my work' },
  ];
  /* 'normal' not 'medium': GX Core stores normal and rewrites medium on the way in. Sending the name
     the store actually uses means the value in the sheet matches the button the user pressed. */
  var priority = 'normal';

  function el(tag, cls, html) {
    var n = global.document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function build() {
    var doc = global.document;
    if (doc.getElementById('gxBugOverlay')) return;

    /* `fab: false` = "I'll supply my own trigger, call GXBugReport.open()". Needed by any app that
       already has a Report-a-bug row in its user tray, and by the gx-theme preview, where a fixed
       floating button hovering over a component gallery is noise. It is an OPTION rather than
       something the caller hides afterwards because build() is deferred to DOMContentLoaded — a
       caller that does `document.getElementById('gxBugFab').style.display='none'` right after init()
       finds nothing there yet and silently fails. (It did, in the preview.) */
    var wantFab = !(cfg && cfg.fab === false);
    var fab = null;
    if (wantFab) {
      fab = el('button', 'gx-bug-fab');
      fab.id = 'gxBugFab';
      fab.type = 'button';
      fab.title = 'Report a bug';
      fab.setAttribute('aria-label', 'Report a bug');
      fab.textContent = '🐞';
      fab.addEventListener('click', open);
    }

    var overlay = el('div', 'gx-bug-overlay');
    overlay.id = 'gxBugOverlay';
    overlay.innerHTML =
      '<div class="gx-bug-modal" role="dialog" aria-modal="true" aria-labelledby="gxBugHdrTitle">' +
        '<div class="gx-bug-hdr"><span id="gxBugHdrTitle">Report a bug</span>' +
          '<button type="button" class="gx-bug-close" id="gxBugClose" aria-label="Close">&#10005;</button></div>' +
        '<div id="gxBugBody">' +
          '<div><div class="gx-bug-label">What went wrong</div>' +
            '<input class="gx-bug-input" id="gxBugTitle" type="text" maxlength="120" ' +
              'placeholder="Short description of what went wrong"></div>' +
          '<div><div class="gx-bug-label">Details <span class="gx-bug-opt">(optional)</span></div>' +
            '<textarea class="gx-bug-textarea" id="gxBugDesc" ' +
              'placeholder="Steps to reproduce, what you expected vs. what happened…"></textarea></div>' +
          '<div><div class="gx-bug-label">Priority</div>' +
            '<div class="gx-bug-pri" id="gxBugPri">' +
              PRIORITIES.map(function (p) {
                return '<button type="button" class="gx-bug-pri-btn" data-pri="' + p.v + '" title="' + p.hint + '">' + p.label + '</button>';
              }).join('') +
            '</div></div>' +
          '<details class="gx-bug-ctx"><summary>What gets sent with this</summary>' +
            '<pre id="gxBugCtx"></pre></details>' +
          '<button type="button" class="gx-bug-submit" id="gxBugSubmit">Submit</button>' +
          '<div class="gx-bug-status" id="gxBugStatus"></div>' +
        '</div>' +
        '<div class="gx-bug-success" id="gxBugSuccess" hidden></div>' +
      '</div>';

    if (fab) doc.body.appendChild(fab);
    doc.body.appendChild(overlay);

    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    doc.getElementById('gxBugClose').addEventListener('click', close);
    doc.getElementById('gxBugSubmit').addEventListener('click', submit);
    doc.getElementById('gxBugPri').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-pri]') : null;
      if (b) { priority = b.getAttribute('data-pri'); paintPriority(); }
    });
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && overlay.classList.contains('open')) close();
    });
  }

  function paintPriority() {
    var wrap = global.document.getElementById('gxBugPri');
    if (!wrap) return;
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-pri]'), function (b) {
      var on = b.getAttribute('data-pri') === priority;
      b.classList.toggle('is-sel', on);
      b.classList.toggle('sel-' + b.getAttribute('data-pri'), on);
    });
  }

  function open() {
    build();
    var doc = global.document;
    priority = 'normal';
    doc.getElementById('gxBugTitle').value = '';
    doc.getElementById('gxBugDesc').value = '';
    doc.getElementById('gxBugStatus').textContent = '';
    doc.getElementById('gxBugBody').hidden = false;
    doc.getElementById('gxBugSuccess').hidden = true;
    var btn = doc.getElementById('gxBugSubmit');
    btn.disabled = false;
    btn.textContent = 'Submit';
    paintPriority();
    /* Show the snapshot rather than attaching it invisibly. It carries the URL and browser, so the
       person filing should be able to see exactly what they are sending before they send it. */
    try { doc.getElementById('gxBugCtx').textContent = JSON.stringify(snapshot(), null, 2); } catch (e) {}
    doc.getElementById('gxBugOverlay').classList.add('open');
    setTimeout(function () { try { doc.getElementById('gxBugTitle').focus(); } catch (e) {} }, 50);
  }

  function close() {
    var o = global.document.getElementById('gxBugOverlay');
    if (o) o.classList.remove('open');
  }

  function submit() {
    var doc = global.document;
    var title = doc.getElementById('gxBugTitle').value.trim();
    var status = doc.getElementById('gxBugStatus');
    if (!title) { status.textContent = 'Please say what went wrong.'; doc.getElementById('gxBugTitle').focus(); return; }
    if (!cfg || typeof cfg.submit !== 'function') { status.textContent = 'Bug reporting is not configured in this app.'; return; }

    var btn = doc.getElementById('gxBugSubmit');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    status.textContent = '';

    var payload = {
      action:   cfg.action || 'bugreport',
      title:    title,
      desc:     doc.getElementById('gxBugDesc').value.trim(),
      priority: priority,
      reporter: call(cfg.reporter, ''),
      appVer:   call(cfg.version, ''),
      context:  JSON.stringify(snapshot()),
    };

    Promise.resolve()
      .then(function () { return cfg.submit(payload); })
      .then(function (res) {
        // An app's transport may resolve with {ok:false,error} instead of rejecting. Treating that as
        // success is how a report vanishes while the user reads "Reported!" — which has happened here
        // before (see gxIngestBug's title fallback).
        if (res && res.ok === false) throw new Error(res.error || 'Failed');
        doc.getElementById('gxBugBody').hidden = true;
        var ok = doc.getElementById('gxBugSuccess');
        ok.hidden = false;
        ok.textContent = '✓ Reported — thank you!';
        setTimeout(close, 2200);
      })
      .catch(function (e) {
        btn.disabled = false;
        btn.textContent = 'Submit';
        status.textContent = 'Could not send — check your connection and try again.';
        try { console.warn('[gx-bugreport]', e); } catch (_) {}
      });
  }

  function call(fn, dflt) {
    if (typeof fn !== 'function') return fn === undefined ? dflt : fn;
    try { var v = fn(); return v === undefined || v === null ? dflt : v; } catch (e) { return dflt; }
  }

  function init(options) {
    cfg = options || {};
    watchErrors();
    if (global.document.readyState === 'loading') {
      global.document.addEventListener('DOMContentLoaded', build);
    } else {
      build();
    }
    return GXBugReport;
  }

  var GXBugReport = {
    init: init, open: open, close: close,
    snapshot: snapshot,          // exposed for tests and for an app that wants it elsewhere
    _push: push,                 // tests
  };
  global.GXBugReport = GXBugReport;
})(typeof window !== 'undefined' ? window : this);
