/* GX Bug Report — the shared "report a bug" button, modal and submit.
 * Canonical source: greencross-gx-theme/gx-bugreport.js.
 *
 * Loaded BY URL from Pages, like gx-theme.css and gx-client.js:
 *     <script src="https://greencrosscanna.github.io/greencross-gx-theme/gx-bugreport.js"></script>
 * so an edit here reaches every app on its next load, inside the ~10-minute cache, with no deploy and
 * no review in between. Treat it accordingly.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * The bug form was copy-pasted. THE STATE THIS FILE WAS BUILT TO REPLACE, measured 2026-08-23 —
 * history, NOT current state; see the table below it before you act on this one:
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
 * ── WHO USES IT NOW (2026-08-26) ────────────────────────────────────────────────────────────────
 * ALL SIX. The table above is the "before", and it has already misled someone: on 2026-08-26 it was
 * read as current, concluding pricecards had only a window.prompt and that spiff and crew had no
 * reporter — so two apps were left out of a suite-wide change until Sky caught it.
 *
 * The detail that makes that easy to get wrong twice: two apps wire this from their APP JS, not from
 * index.html, so grepping index.html alone under-counts.
 *
 *   inventory    index.html          leaderboard  index.html
 *   sales        index.html          spiff        index.html
 *   pricecards   generator.js        crew         crew.js
 *
 * Action names still differ per app ('bugreport' / 'reportbug' / 'reportBug') because each proxy
 * spells its own; that is what cfg.action is for and it is not drift to fix.
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
 *
 * ── REOPENED 2026-08-26, on the cost, as that note asked ─────────────────────────────────────────
 * The real report arrived: a Sales pace bug was diagnosable only from its screenshot, and a bug-fixed
 * email had already invited a reporter to "file a new ticket with a photo of the screen" — promising
 * a pathway that did not exist.
 *
 * The two costs both came down. The SINK exists: GX Core gained doPost (it had none, which is what
 * "cannot RECEIVE one" meant above) plus a Drive-backed bug_shot route. And the CAPTURE step turned
 * out to be free — neither html2canvas nor getDisplayMedia. People already take screenshots with
 * Cmd-Shift-4; this accepts a PASTE or a file pick. Zero bytes added to any app, real pixels, no
 * permission prompt.
 *
 * The context snapshot stays, and is still the more useful half for most reports: "the store filter is
 * stuck" needs to say WHICH filter, and a picture of a chart does not.
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
 *     uploadShot: GXBugReport.gxCoreUploader(GXCORE_URL, () => session.token),  // optional
 *   });
 *
 * `uploadShot` is what turns the screenshot field on. Absent, the field is not rendered at all — so
 * this file is inert in an app that has not opted in, and no app breaks by ignoring it.
 *
 * It is a cfg function for the same reason `submit` is: the app owns auth. gxCoreUploader() is a
 * ready-made implementation the app hands its OWN token to, so the credential still comes from the
 * app's session while the transport lives here once instead of five times — which is the whole point
 * of this file.
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
          '<div id="gxBugShotWrap" hidden><div class="gx-bug-label">Screenshot <span class="gx-bug-opt">(optional)</span></div>' +
            '<div class="gx-bug-shot" id="gxBugShotDrop" tabindex="0">' +
              '<span id="gxBugShotHint">Paste an image (Cmd/Ctrl+V), or <button type="button" class="gx-bug-shot-pick" id="gxBugShotPick">choose a file</button></span>' +
              '<img id="gxBugShotPrev" alt="" hidden>' +
              '<button type="button" class="gx-bug-shot-clear" id="gxBugShotClear" hidden title="Remove">&#10005;</button>' +
            '</div><input type="file" accept="image/*" id="gxBugShotFile" hidden></div>' +
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

    // The screenshot field renders ONLY when the app supplied a transport for it. An app that has not
    // opted in sees exactly the form it saw before.
    if (cfg && typeof cfg.uploadShot === 'function') {
      doc.getElementById('gxBugShotWrap').hidden = false;
      var drop = doc.getElementById('gxBugShotDrop');
      var file = doc.getElementById('gxBugShotFile');
      doc.getElementById('gxBugShotPick').addEventListener('click', function () { file.click(); });
      file.addEventListener('change', function () { setShot(file.files && file.files[0]); file.value = ''; });
      doc.getElementById('gxBugShotClear').addEventListener('click', function (e) {
        e.stopPropagation(); setShot(null);
      });
      // Paste is the point. Cmd-Shift-4 puts a PNG on the clipboard, so this is the shortest path from
      // "the screen looks wrong" to "the screen is attached" — no capture library, no window picker.
      // Bound on the document, not the drop zone: nobody thinks to focus a box before pasting.
      doc.addEventListener('paste', onPaste);
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('is-over'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('is-over'); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault(); drop.classList.remove('is-over');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) setShot(f);
      });
    }
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

  // ── the screenshot ─────────────────────────────────────────────────────────────────────────────
  var shotFile = null, shotUrl = '';
  var SHOT_MAX = 10 * 1024 * 1024;

  function setShot(f) {
    var doc = global.document;
    var prev = doc.getElementById('gxBugShotPrev');
    var hint = doc.getElementById('gxBugShotHint');
    var clr  = doc.getElementById('gxBugShotClear');
    var st   = doc.getElementById('gxBugStatus');
    shotUrl = '';                                  // any change invalidates a previous upload
    if (f && f.size > SHOT_MAX) {
      if (st) st.textContent = 'That image is over 10MB.';
      f = null;
    }
    shotFile = f || null;
    if (!shotFile) {
      if (prev) { prev.hidden = true; prev.removeAttribute('src'); }
      if (hint) hint.hidden = false;
      if (clr) clr.hidden = true;
      return;
    }
    // Object URL rather than a base64 data: URI — the file is up to 10MB and this preview is thrown
    // away on close. Revoked when replaced so a long session cannot leak them.
    if (prev) {
      if (prev.src) { try { global.URL.revokeObjectURL(prev.src); } catch (e) {} }
      prev.src = global.URL.createObjectURL(shotFile);
      prev.hidden = false;
    }
    if (hint) hint.hidden = true;
    if (clr) clr.hidden = false;
    if (st) st.textContent = '';
  }

  function onPaste(e) {
    if (!cfg || typeof cfg.uploadShot !== 'function') return;
    var items = (e.clipboardData && e.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
        var f = items[i].getAsFile();
        if (f) { e.preventDefault(); setShot(f); return; }
      }
    }
  }

  // A ready-made uploadShot for any app on GX Core sign-on. Lives HERE so the transport exists once
  // rather than five times — the app supplies only its own token, so auth still comes from the app's
  // session exactly as `submit` does.
  //
  // Routed through GXClient.postJSON: text/plain to dodge the CORS preflight /exec cannot answer, and
  // it detects the Drive HTML page by body shape. retries:2 is a deliberate opt-in — re-running an
  // upload writes a second Drive file, which is wasteful but harmless, and losing a screenshot to one
  // flaky hop is worse.
  function gxCoreUploader(gxCoreUrl, tokenFn) {
    return function (file) {
      return readAsBase64(file).then(function (b64) {
        if (typeof global.GXClient !== 'function') throw new Error('GXClient is not loaded');
        var gx = global.GXClient(gxCoreUrl);
        if (typeof gx.postJSON !== 'function') throw new Error('this GXClient has no postJSON');
        return gx.postJSON('bug_shot', {
          action: 'bug_shot',
          token: (typeof tokenFn === 'function' ? tokenFn() : tokenFn) || '',
          name: file.name || 'screenshot.png',
          type: file.type || 'image/png',
          data: b64,
        }, { retries: 2 });
      });
    };
  }

  function readAsBase64(file) {
    return new Promise(function (res, rej) {
      var fr = new global.FileReader();
      fr.onload = function () {
        var s = String(fr.result || ''), c = s.indexOf(',');
        res(c >= 0 ? s.slice(c + 1) : s);          // strip the data: prefix
      };
      fr.onerror = function () { rej(new Error('could not read that file')); };
      fr.readAsDataURL(file);
    });
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
      // The image goes up FIRST, on its own, and only its URL joins the payload. It cannot ride the
      // report: each app owns that transport and they are not uniform — Sales submits through a GET
      // query string, which a ~273KB base64 would not survive.
      .then(function () {
        if (!shotFile || typeof cfg.uploadShot !== 'function') return null;
        if (shotUrl) return { ok: true, url: shotUrl };      // already uploaded; a retry must not re-send
        btn.textContent = 'Uploading…';
        return cfg.uploadShot(shotFile);
      })
      .then(function (up) {
        if (up && up.ok === false) {
          // Flagged so the catch shows THIS reason instead of the generic transport message. "Check
          // your connection" is actively misleading for "that image is over 10MB" — it sends someone
          // to retry the one thing that cannot work.
          var e = new Error(up.error || 'Could not upload the screenshot');
          e.gxShow = true;
          throw e;
        }
        if (up && up.url) { shotUrl = up.url; payload.screenshot_url = up.url; }
        btn.textContent = 'Sending…';
      })
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
        status.textContent = (e && e.gxShow && e.message)
          ? e.message
          : 'Could not send — check your connection and try again.';
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
    // A ready-made cfg.uploadShot for any app on GX Core sign-on: the app hands it a token getter, so
    // the credential is still the app's while the transport lives here once instead of five times.
    gxCoreUploader: gxCoreUploader,
    _push: push,                 // tests
  };
  global.GXBugReport = GXBugReport;
})(typeof window !== 'undefined' ? window : this);
