/* GX Changelog — the shared version-history popup, and the once-per-login "What's New".
 * Canonical source: greencross-gx-theme/gx-changelog.js.
 *
 * Loaded BY URL from Pages, like gx-theme.css and gx-client.js:
 *     <script src="https://greencrosscanna.github.io/greencross-gx-theme/gx-changelog.js"></script>
 * so an edit here reaches every app on its next load, inside the ~10-minute cache, with no deploy and
 * no review in between. Treat it accordingly.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
 * Same story as gx-bugreport.js. Release notes have lived in ONE place (GX Core `app_versions`) for a
 * while — but the popup that displays them was written from scratch in every app that wanted one.
 * Measured 2026-08-23:
 *
 *   leaderboard  full modal · 21 local .cl-* CSS rules · GC.showChangelog + What's New on login
 *   inventory    full modal · its own .wn-overlay + "Version History" panel
 *   sales        full modal · its own "Version history" panel + its own version_history fetch
 *   core-admin   full modal · its own versionHistory map + per-app popup
 *   pricecards   nothing — the version in the user tray is a dead label
 *   spiff, crew  nothing
 *
 * Four separate implementations of one popup and three apps where clicking the version does nothing.
 * That is the six-different-login-screens pattern, and this file is the answer to it: one modal, one
 * fetch, one date formatter, one "have I seen this version" rule.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────────────────────────
 *   GXChangelog.init({
 *     app:      'inventory',                 // GX Core app key (REQUIRED — 'performance', not 'leaderboard')
 *     title:    'Green Cross Inventory',     // shown under the heading; defaults to the app key
 *     version:  () => APP_VERSION,           // string or fn — the running version, for the subtitle
 *     whatsNew: () => sess.role === 'director',   // optional: gate the auto-popup. true = everyone,
 *                                            //   omitted = never auto-popup, only on demand
 *     core:     GXCORE_EXEC_URL,             // optional override; defaults to the live GX Core exec
 *   });
 *
 * Then nothing else is required: GXTopNav opens this automatically when the user tray's Version row
 * is clicked, if this file is loaded. `GXChangelog.open()` opens it by hand (a version badge, a menu
 * item, wherever). init() is idempotent, so calling it again just updates the config.
 *
 * ── WHAT IT SHOWS ────────────────────────────────────────────────────────────────────────────────
 * GX Core's `version_history` route returns BOTH `releases` (the consolidated staff-facing feed —
 * meaningful upgrades only, per the shared What's New standard) and `history` (the full raw deploy
 * log). The popup shows `releases` and offers a toggle to the full log, because those are two
 * genuinely different questions: "what changed for me" and "what shipped when".
 *
 * Fails soft in every direction. If GX Core is unreachable the popup still opens and says so; the
 * auto-popup simply never fires. A changelog is never worth blocking an app over.
 */
(function (global) {
  'use strict';
  if (global.GXChangelog) return;

  var CORE_DEFAULT = 'https://script.google.com/macros/s/AKfycbx9mjeCBbDpxNYaqBv2hyZaO1hpbGG6PZM9AebFdwl0UwkdtRCGSWrH-8ohEtdF1K_6/exec';
  var TZ  = 'America/Los_Angeles';
  var cfg = null;         // set by init()
  var data = null;        // { releases: [], history: [] } once fetched
  var pending = null;     // the in-flight fetch promise, so N callers share one request
  var mode = 'releases';  // which feed the open modal is showing
  var wnShown = false;

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function val(x) { try { return typeof x === 'function' ? x() : x; } catch (e) { return ''; } }

  /* deployed_at → 'Mon D, YYYY' in PACIFIC. Every GX date is keyed to America/Los_Angeles, and
     gxRecordVersion stamps UTC — so an evening deploy that crossed midnight UTC renders as
     tomorrow unless the zone is forced here. */
  function fmtDate(raw) {
    if (!raw) return '';
    var str = String(raw).trim(), M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (/T/.test(str) || /[zZ]$/.test(str) || /[+\-]\d\d:?\d\d$/.test(str)) {
      var dt = new Date(str);
      if (!isNaN(dt.getTime())) {
        try {
          return new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric' }).format(dt);
        } catch (e) {}
      }
    }
    // Bare 'YYYY-MM-DD' (no time) → parse as LOCAL, or the zone shift moves it a day the other way.
    var m = str.match(/^(\d{4})-(\d{2})-(\d{2})/), d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(str);
    return isNaN(d.getTime()) ? str : (M[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear());
  }

  /* true when a is newer than b. Compares each dot-segment NUMERICALLY, so it is correct even
     across the width change: 'v1.280' (1,280) beats 'v1.28' (1,28). That comparison is exactly what
     the fixed 3-digit build in gx_core.gs exists to make reliable — as plain strings 'v1.28' sorts
     ABOVE 'v1.280', which is the wrong answer and was the live behaviour before padding. */
  function verGt(a, b) {
    function parse(x) {
      return String(x || '').replace(/^v/i, '').split('.').map(function (n) { return parseInt(n, 10) || 0; });
    }
    var aa = parse(a), bb = parse(b), n = Math.max(aa.length, bb.length);
    for (var i = 0; i < n; i++) { var d = (aa[i] || 0) - (bb[i] || 0); if (d) return d > 0; }
    return false;
  }

  function seenKey() { return 'gx_wn_seen_' + (cfg && cfg.app ? cfg.app : 'app'); }

  // ── Fetch, once, shared ────────────────────────────────────────────────────────────────────────
  function load() {
    if (data) return Promise.resolve(data);
    if (pending) return pending;
    if (!global.GXClient) { data = { releases: [], history: [], failed: true }; return Promise.resolve(data); }
    /* Shorter than GXClient's 8s x 3 default, deliberately. Those defaults are tuned for data the app
       cannot work without, where waiting 25s beats failing. A changelog is the opposite: nothing
       downstream depends on it, and the user is staring at a "Loading…" modal the whole time.
       Measured against a dead endpoint the default spent ~35s there. One retry keeps the Drive-HTML
       404 protection that gx-client exists for (~6% of rapid /exec calls) without the long tail. */
    pending = global.GXClient(cfg.core).jsonp('version_history', { app: cfg.app },
                                              { timeoutMs: 6000, retries: 1 })
      .then(function (resp) {
        var ok = resp && resp.ok;
        data = {
          releases: (ok && resp.releases) || [],
          history:  (ok && resp.history)  || [],
          failed:   !ok
        };
        // An older GX Core that predates the consolidated feed sends only `history`.
        if (!data.releases.length && data.history.length) data.releases = data.history;
        pending = null;
        return data;
      })
      .catch(function () {
        data = { releases: [], history: [], failed: true };
        pending = null;
        return data;
      });
    return pending;
  }

  // ── Render ─────────────────────────────────────────────────────────────────────────────────────
  function entryHtml(e) {
    var items = String(e.notes || '').split('\n')
      .map(function (x) { return x.replace(/^[-••\s]+/, '').trim(); })
      .filter(Boolean);
    var body = items.length
      ? '<ul class="gx-cl-items">' + items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'
      : '<div class="gx-cl-nonote">No release note recorded.</div>';
    var sha = e.git_sha ? '<span class="gx-cl-sha" title="commit">' + esc(e.git_sha) + '</span>' : '';
    return '<div class="gx-cl-ver">'
      + '<div class="gx-cl-ver-head"><span class="gx-cl-ver-num">' + esc(e.version) + '</span>'
      +   '<span class="gx-cl-ver-date">' + esc(fmtDate(e.deployed_at)) + '</span>' + sha + '</div>'
      + body + '</div>';
  }

  function paint(overlay, isWhatsNew) {
    var list = (mode === 'history' ? data.history : data.releases) || [];
    var running = val(cfg.version) || '';
    var bodyHtml;
    if (data.failed) {
      bodyHtml = '<div class="gx-cl-empty">Release notes are momentarily unavailable — GX Core did not answer. '
               + 'Close this and try again in a moment.</div>';
    } else if (!list.length) {
      bodyHtml = '<div class="gx-cl-empty">No releases recorded yet for this app.</div>';
    } else {
      bodyHtml = list.map(entryHtml).join('');
    }
    // The raw-log toggle is pointless when the two feeds are the same rows, so only offer it when
    // consolidation actually dropped something.
    var canToggle = !data.failed && data.history.length > data.releases.length && !isWhatsNew;
    var toggle = canToggle
      ? '<button class="gx-cl-toggle" data-gx-cl="toggle">'
        + (mode === 'history' ? '← Release notes' : 'Full deploy log (' + data.history.length + ') →')
        + '</button>'
      : '';
    overlay.innerHTML = '<div class="gx-cl-modal" role="dialog" aria-modal="true" aria-label="Version history">'
      + '<div class="gx-cl-header">'
      +   '<div class="gx-cl-icon"><img src="https://greencrosscanna.github.io/greencross-gx-theme/gc-icon.png" alt=""'
      +     ' onerror="this.replaceWith(this.ownerDocument.createTextNode(String.fromCodePoint(127807)))"></div>'
      +   '<div><div class="gx-cl-title">' + (isWhatsNew ? 'What’s New' : (mode === 'history' ? 'Deploy log' : 'Version history')) + '</div>'
      +     '<div class="gx-cl-sub">' + esc(cfg.title || cfg.app) + (running ? ' · ' + esc(running) : '') + '</div></div>'
      +   '<button class="gx-cl-x" data-gx-cl="close" title="Close" aria-label="Close">✕</button>'
      + '</div>'
      + '<div class="gx-cl-body">' + bodyHtml + '</div>'
      + '<div class="gx-cl-footer">' + toggle
      +   '<button class="gx-cl-ok" data-gx-cl="close">' + (isWhatsNew ? 'Got it' : 'Close') + '</button></div>'
      + '</div>';
  }

  function overlayEl() {
    var overlay = document.getElementById('gxClOverlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'gxClOverlay';
    overlay.className = 'gx-cl-overlay';
    overlay.addEventListener('click', function (ev) {
      var t = ev.target;
      if (t === overlay) return close();
      var hit = t && t.closest ? t.closest('[data-gx-cl]') : null;
      if (!hit) return;
      var what = hit.getAttribute('data-gx-cl');
      if (what === 'close') close();
      else if (what === 'toggle') { mode = (mode === 'history' ? 'releases' : 'history'); paint(overlay, false); }
    });
    document.body.appendChild(overlay);
    return overlay;
  }

  function show(isWhatsNew) {
    if (!cfg) return;                                   // init() never ran — nothing to show
    var overlay = overlayEl();
    overlay.classList.add('gx-cl-open');
    overlay._gxWn = !!isWhatsNew;
    if (!data) {
      overlay.innerHTML = '<div class="gx-cl-modal"><div class="gx-cl-body">'
                        + '<div class="gx-cl-empty">Loading…</div></div></div>';
    }
    load().then(function () {
      if (overlay.classList.contains('gx-cl-open')) paint(overlay, !!overlay._gxWn);
    });
  }

  function open() { mode = 'releases'; show(false); }

  function close() {
    var overlay = document.getElementById('gxClOverlay');
    if (!overlay) return;
    overlay.classList.remove('gx-cl-open');
    // Only a What's New dismissal marks the version seen. Browsing the history on purpose must NOT
    // silently suppress the next login's popup — that would hide the very notes it exists to show.
    if (overlay._gxWn) {
      var top = ((data && data.releases && data.releases[0]) || {}).version || '';
      try { localStorage.setItem(seenKey(), top); } catch (e) {}
      overlay._gxWn = false;
    }
  }

  /* Show unseen releases once. The gate is the app's, because who should see them differs: the
     Leaderboard shows them to directors only, a back-office tool might show everyone. Returning
     false is NOT final — call checkWhatsNew() again once the session is known and it re-tests. */
  function checkWhatsNew() {
    if (!cfg || wnShown || cfg.whatsNew == null) return;
    if (cfg.whatsNew !== true && !val(cfg.whatsNew)) return;    // not eligible yet — retry later
    load().then(function () {
      if (wnShown || data.failed || !data.releases.length) return;
      var seen = '';
      // App-scoped: every app is served from greencrosscanna.github.io, so a bare 'gx_wn_seen' key
      // collides across the suite and whichever app loads last wins.
      try { seen = localStorage.getItem(seenKey()) || ''; } catch (e) {}
      var unseen = data.releases.filter(function (r) { return verGt(r.version, seen); });
      if (!unseen.length) return;
      wnShown = true;
      var all = data.releases;
      data.releases = unseen;
      mode = 'releases';
      show(true);
      data.releases = all;    // restore the full feed for a later manual open
    });
  }

  function init(o) {
    o = o || {};
    if (!o.app) { try { console.warn('GXChangelog.init: app key required'); } catch (e) {} return; }
    /* Re-initing under a DIFFERENT app key must drop the cached feed. The cache is a module global
       keyed on nothing, so without this the popup renders the new app's title and version over the
       previous app's releases — a changelog attributing one app's history to another, which is worse
       than showing none. Caught in the gx-theme preview switching performance → core-admin. */
    if (cfg && cfg.app !== o.app) { data = null; pending = null; wnShown = false; }
    cfg = {
      app:      o.app,
      title:    o.title || o.app,
      version:  o.version,
      whatsNew: o.whatsNew,
      core:     o.core || CORE_DEFAULT
    };
    if (o.whatsNew != null) checkWhatsNew();
    return GXChangelog;
  }

  // Esc closes, like every other overlay in the suite.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var overlay = document.getElementById('gxClOverlay');
    if (overlay && overlay.classList.contains('gx-cl-open')) close();
  });

  var GXChangelog = { init: init, open: open, close: close, checkWhatsNew: checkWhatsNew,
                      reload: function () { data = null; pending = null; return load(); },
                      verGt: verGt, configured: function () { return !!cfg; } };
  global.GXChangelog = GXChangelog;
})(typeof window !== 'undefined' ? window : this);
