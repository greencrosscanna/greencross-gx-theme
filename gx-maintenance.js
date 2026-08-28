/* GX Maintenance — the shared "we're out back" gate. One screen, every Green Cross app.
 * Canonical source: greencross-gx-theme/gx-maintenance.js. Loaded by URL from Pages, so an edit here
 * reaches all six apps on their next load, inside the ~10-minute cache, with no deploy and no review
 * in between. Treat it accordingly.
 *
 * Design: design_handoff_under_construction/ in this repo (Sky, 2026-08-26). Copy, spacing, timings
 * and the smoke field are recreated from that handoff; the colours are theme tokens, not the hexes
 * the prototype inlined.
 *
 * ── WHY IT IS ONE SHARED MODULE AND NOT SIX maintenance.html FILES ───────────────────────────────
 * The handoff proposed a per-spoke static page. That is the shape the bug form had before
 * gx-bugreport.js: six copies, 63 duplicated CSS rules, three spellings of one action, and a fix that
 * meant four edits and two ports. gx-updatecheck.js is the precedent to follow instead — shared
 * module, loaded by URL, polls a flag, takes over the UI. This is that with a stricter verdict.
 *
 * ── THE FLAG LIVES IN TWO PLACES, AND THAT IS THE WHOLE DESIGN ───────────────────────────────────
 * The outage this page exists for is, more often than not, GX CORE ITSELF being down. A switch that
 * lives only in GX Core `kv` is unreachable in exactly the failure it was built for — you would be
 * clicking a toggle that cannot be read. So the gate reads two independent sources and gates if
 * EITHER says so:
 *
 *   1. gx-maintenance.json on this repo's Pages   — static file on GitHub's CDN, no Apps Script in
 *      the path. Reachable when Core is not. Lever: edit + commit + push. Latency ~1 minute.
 *      THIS IS THE ONE THAT MATTERS. Everything else is convenience.
 *
 *   2. cfg.maint.<app> / cfg.maint.all in GX Core kv — instant, no push, toggled from Master
 *      Control. Requires Core to be up, which is precisely when you may not need it.
 *
 * Neither is authoritative over the other and there is deliberately no precedence rule: two ORs is
 * one line of code and cannot deadlock, where "the file wins" would strand a toggle nobody can clear.
 * Turning the gate OFF means clearing BOTH. The banner in Master Control says so for that reason.
 *
 * ── IT OVERLAYS, IT DOES NOT REPLACE ─────────────────────────────────────────────────────────────
 * The gate is a fixed, opaque, full-viewport layer over the app, not a document.body rewrite. Two
 * reasons, both learned the boring way from the stacking-order comment in gx-theme.css:
 *   • "Poke the tech team" opens the SHARED bug reporter, which is a sibling node on body. Wiping
 *     body destroys it, and the one path a user has to tell us it is still broken dies with the page
 *     that is telling them it is broken.
 *   • Un-gating is then just removing a node. A body rewrite is a one-way door needing a reload, and
 *     a reload during an outage is the thing the retry button already does badly enough.
 *
 * z-index 10000 — ABOVE .gx-login (9999). Deliberate, and the one place this file outranks the login
 * gate: asking someone to sign in to be told the app is down is a worse answer than telling them.
 * The bug overlay (300) is raised inline to 10100 when opened from here; see pokeTechTeam().
 *
 * ── THE ESCAPE HATCH IS NOT A SECURITY BOUNDARY ──────────────────────────────────────────────────
 * `?gxmaint=off` bypasses the gate for the rest of the session; `?gxmaint=on` forces it, for
 * previewing without touching a flag. Anyone who reads this file can bypass it. That is fine and
 * intended — this is a courtesy screen, not an authorization check. Nothing behind it is protected by
 * it, and the real protections (session, roleCanEdit, the secret-gated writes) are untouched. If the
 * app is genuinely unsafe to use, take the backend down; do not rely on a client-side div.
 *
 * ── IT UN-GATES ITSELF ───────────────────────────────────────────────────────────────────────────
 * While gated it re-checks every 20s and tears itself down when both flags clear, so the app comes
 * back without anyone clicking anything — which matters for the Leaderboard kiosks, where nobody is
 * there to click. "Check if they're back" is the impatient path, not the only one.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────────────────────────
 *   GXMaintenance.init({
 *     app:     'inventory',          // GX Core app key — 'performance' for Leaderboard
 *     appName: 'Inventory',          // optional display label; defaults to a title-cased app key
 *     gxcore:  GXCORE_URL,           // optional — omit and only the Pages flag is read
 *   });
 *
 * Nothing else is required. No CSS to add: the stylesheet is injected on activation, so an app that
 * never goes down pays one same-origin fetch of a ~120-byte JSON per load and nothing else.
 */
(function (global) {
  'use strict';

  var BASE      = 'https://greencrosscanna.github.io/greencross-gx-theme';
  var FLAG_URL  = BASE + '/gx-maintenance.json';
  var LOGO_URL  = BASE + '/gx-logo.png';
  var ESCALATE  = 'sky@greencrosscanna.com';   // Sky is the tech team. There is no tech@.

  var IDLE_MS   = 60 * 1000;   // re-check cadence while the app is up
  var GATED_MS  = 20 * 1000;   // …and while it is down, so it can clear itself
  var TICK_MS   = 1000;        // down-timer
  var LINE_MS   = 3400;        // console rotation

  var DEFAULT_LINES = [
    'rolling back the last deploy…',
    'server took a hit, coughing it out…',
    're-hydrating the database…',
    "someone said 'it works on my machine'…",
    'tech team located. sandwich in hand.',
    'almost there. do not refresh 40 times.',
  ];

  var cfg = null, wired = false, gated = false, bypassed = false, forced = false;
  var checkedAt = 0, timers = [], startedAt = 0, lineIdx = 0, active = null;
  var prevTitle = null, prevOverflow = null, inerted = [];

  /* Booleans are TEXT everywhere in this suite (a sheet round-trip turns true into 'TRUE' or 'true'
     or 1), so never compare === true.
     THIS LIST IS GXCore.gxTruthy_'s LIST, EXACTLY — true / 1 / yes / active — and it has to stay that
     way. Two readers of one kv cell that disagree about what it says is worse than either rule on its
     own: an earlier draft here accepted 'on' and dropped 'active', so a cell reading `active` would
     have been down to the cockpit and up to the app, and a cell reading `on` the reverse. Nobody
     looking at either screen could have told which. Do not "improve" this list on one side. */
  function truthy(v) {
    if (v === true) return true;
    var s = String(v == null ? '' : v).trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'active';
  }

  function call(fn, dflt) {
    if (typeof fn !== 'function') return fn === undefined || fn === null ? dflt : fn;
    try { var v = fn(); return v === undefined || v === null ? dflt : v; } catch (e) { return dflt; }
  }

  /* 'inventory' -> 'Inventory', 'price-cards' -> 'Price Cards'. Only a fallback: an app that wants
     "Sales / Cashflow" passes appName. */
  function titleCase(key) {
    return String(key || '').split(/[-_]/).filter(Boolean).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  /* ── Flag reading ───────────────────────────────────────────────────────────────────────────────
     Both readers resolve to a "notice" object or null, and NEITHER ever rejects. A network error
     reading the flag must not gate the app: the failure mode of a false positive here is every app
     in the suite showing a maintenance page because Pages hiccuped, which is a self-inflicted
     outage strictly worse than the one it is reporting. Absent evidence, the app is up. */

  function noticeFrom(v) {
    if (v && typeof v === 'object') return truthy(v.on == null ? true : v.on) ? v : null;
    return truthy(v) ? {} : null;
  }

  function fromFile() {
    if (typeof global.fetch !== 'function') return Promise.resolve(null);
    // Cache-buster: without it the browser serves its own copy and "Check if they're back" checks
    // nothing. Same-origin — every app is on greencrosscanna.github.io alongside this repo.
    return global.fetch(FLAG_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return null;
        var apps = d.apps || {};
        /* AN EXPLICIT APP ENTRY DECIDES, including when it says false. Not `perApp || all`, which
           looks equivalent and is not: it makes `{"all":true,"apps":{"crew":false}}` gate crew
           anyway, so there is no way to hold one app up during a suite-wide outage — and the moment
           you want that is when crew is the app you are using to fix everything else. */
        if (Object.prototype.hasOwnProperty.call(apps, cfg.app)) return noticeFrom(apps[cfg.app]);
        return noticeFrom(d.all) || null;
      })
      .catch(function () { return null; });
  }

  function fromCore() {
    if (!cfg.gxcore || typeof global.GXClient !== 'function') return Promise.resolve(null);
    return global.GXClient(cfg.gxcore).jsonp('config', {})
      .then(function (d) {
        var c = (d && d.ok && d.config) || null;
        if (!c) return null;
        /* A kv value is a string. Plain 'true' is the common case; a JSON object is the way to carry
           `since`/`lines` from Master Control without a schema change.

           Same "explicit entry decides" rule as the file, keyed on NON-EMPTY rather than on presence,
           because kv genuinely cannot tell empty from absent — clearing a toggle blanks the cell, it
           does not delete the row (the same wrinkle gx_core.gs records for cfg.bugWatchEmail). So a
           blank cfg.maint.crew means "no opinion, follow all"; the literal 'false' means "keep crew
           up regardless". */
        var own = String(c['cfg.maint.' + cfg.app] == null ? '' : c['cfg.maint.' + cfg.app]).trim();
        if (own) return parseKv(own);
        return parseKv(c['cfg.maint.all']);
      })
      .catch(function () { return null; });
  }

  function parseKv(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    if (s.charAt(0) === '{') { try { return noticeFrom(JSON.parse(s)); } catch (e) { return null; } }
    return noticeFrom(s);
  }

  /* ── Down-timer ─────────────────────────────────────────────────────────────────────────────────
     Seeded from the notice's `since` when there is one, so a refresh does not restart the clock at
     00:00 and quietly claim a four-hour outage just started. Dates are TEXT in this suite; anything
     Date can parse is accepted, anything it cannot falls back to "since this tab noticed". */
  function seed(notice) {
    var t = notice && notice.since ? Date.parse(notice.since) : NaN;
    startedAt = isNaN(t) ? Date.now() : t;
  }

  function elapsed() {
    var s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    var pad = function (n) { return n < 10 ? '0' + n : String(n); };
    return 'down ' + (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(ss);
  }

  /* ── The page ───────────────────────────────────────────────────────────────────────────────────
     Injected on activation rather than shipped in gx-theme.css. The smoke alone is eight keyframe
     tracks; putting ~4KB of animation CSS in the stylesheet every app loads on every request, for a
     screen shown a handful of times a year, is a cost with no payer. */
  function styles() {
    var rad = '', dirs = [[0,-760],[532,-532],[760,0],[532,532],[0,760],[-532,532],[-760,0],[-532,-532]];
    dirs.forEach(function (d, i) {
      rad += '@keyframes gx-maint-rad' + (i + 1) + '{' +
        '0%{transform:translate(-50%,-50%) translate3d(0,0,0) scale(.35);opacity:0}' +
        '18%{opacity:.85}62%{opacity:.6}' +
        '100%{transform:translate(-50%,-50%) translate3d(' + d[0] + 'px,' + d[1] + 'px,0) scale(2.6);opacity:0}}';
    });
    return rad +
      '@keyframes gx-maint-blink{0%,45%{opacity:1}55%,100%{opacity:.15}}' +
      '@keyframes gx-maint-pulse{0%,100%{opacity:1}50%{opacity:.3}}' +
      '@keyframes gx-maint-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(220%)}}' +
      /* The gate outranks .gx-login (9999) on purpose — see the header. */
      '.gx-maint{position:fixed;inset:0;z-index:10000;overflow:auto;color-scheme:dark;' +
        'background:var(--gx-bg,#0a0e0d) radial-gradient(1100px 620px at 50% -10%,rgba(74,222,128,.09),transparent 62%);' +
        'font-family:var(--gx-font,-apple-system,BlinkMacSystemFont,"Inter","Segoe UI",Roboto,sans-serif);' +
        'color:var(--gx-text,#e6ece9);display:flex;align-items:center;justify-content:center;padding:40px 24px;}' +
      '.gx-maint-grid{position:absolute;inset:0;pointer-events:none;opacity:.45;' +
        'background-image:linear-gradient(rgba(74,222,128,.05) 1px,transparent 1px),' +
        'linear-gradient(90deg,rgba(74,222,128,.05) 1px,transparent 1px);background-size:64px 64px;' +
        '-webkit-mask-image:radial-gradient(700px 520px at 50% 40%,#000,transparent 78%);' +
        'mask-image:radial-gradient(700px 520px at 50% 40%,#000,transparent 78%);}' +
      '.gx-maint-col{position:relative;width:100%;max-width:620px;display:flex;flex-direction:column;' +
        'align-items:center;text-align:center;gap:26px;}' +
      '.gx-maint-brand{display:flex;flex-direction:column;align-items:center;gap:10px;}' +
      '.gx-maint-logo{display:block;width:212px;height:auto;max-width:70vw;}' +
      '.gx-maint-meta{display:flex;align-items:center;gap:9px;}' +
      '.gx-maint-cap{font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;' +
        'color:var(--gx-text-mute,#5e6864);}' +
      '.gx-maint-sep{width:3px;height:3px;border-radius:50%;background:var(--gx-border-strong,#2e3733);}' +
      '.gx-maint-out{display:inline-flex;align-items:center;gap:7px;color:var(--gx-gold,#d4a847);}' +
      '.gx-maint-dot{width:6px;height:6px;border-radius:50%;background:var(--gx-green,#4ade80);' +
        'box-shadow:0 0 6px var(--gx-green,#4ade80);animation:gx-maint-pulse 1.8s ease-in-out infinite;}' +
      '.gx-maint-dot-gold{background:var(--gx-gold,#d4a847);box-shadow:0 0 6px var(--gx-gold,#d4a847);}' +
      '.gx-maint-clock{display:flex;align-items:baseline;justify-content:center;gap:2px;' +
        'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:800;font-size:108px;' +
        'line-height:.9;letter-spacing:-2px;color:var(--gx-green,#4ade80);text-shadow:0 0 46px rgba(74,222,128,.35);}' +
      '.gx-maint-colon{animation:gx-maint-blink 1.1s steps(1,end) infinite;}' +
      '.gx-maint-pm{font-size:24px;letter-spacing:1px;color:var(--gx-green-dim,#2f8a52);margin-left:10px;}' +
      '.gx-maint-say{display:flex;flex-direction:column;gap:14px;max-width:520px;}' +
      '.gx-maint-say h1{margin:0;font-size:34px;line-height:1.15;font-weight:800;letter-spacing:-.5px;' +
        'color:var(--gx-text,#e6ece9);text-wrap:pretty;}' +
      '.gx-maint-say p{margin:0;font-size:15px;line-height:1.6;color:var(--gx-text-dim,#8a958f);text-wrap:pretty;}' +
      '.gx-maint-card{width:100%;max-width:520px;background:var(--gx-surface,#121715);' +
        'border:1px solid var(--gx-border,#232a27);border-radius:var(--gx-radius-xl,12px);overflow:hidden;' +
        'box-shadow:0 28px 70px rgba(0,0,0,.5);text-align:left;}' +
      '.gx-maint-hair{height:2px;background:linear-gradient(90deg,transparent,var(--gx-green,#4ade80),transparent);opacity:.75;}' +
      '.gx-maint-hdr{display:flex;align-items:center;gap:10px;padding:12px 16px;' +
        'border-bottom:1px solid var(--gx-border,#232a27);}' +
      '.gx-maint-el{margin-left:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;' +
        'color:var(--gx-text-mute,#5e6864);}' +
      '.gx-maint-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:8px;}' +
      '.gx-maint-line{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.6;' +
        'color:var(--gx-text-dim,#8a958f);min-height:20px;}' +
      '.gx-maint-prompt{color:var(--gx-green-dim,#2f8a52);}' +
      '.gx-maint-caret{animation:gx-maint-blink 1s steps(1,end) infinite;color:var(--gx-green,#4ade80);}' +
      '.gx-maint-track{position:relative;height:3px;border-radius:var(--gx-radius-pill,999px);' +
        'background:var(--gx-surface-3,#1a221f);overflow:hidden;}' +
      '.gx-maint-fill{position:absolute;inset:0;width:45%;border-radius:var(--gx-radius-pill,999px);' +
        'background:linear-gradient(90deg,transparent,var(--gx-green,#4ade80),transparent);' +
        'animation:gx-maint-sweep 2.4s ease-in-out infinite;}' +
      '.gx-maint-acts{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px;}' +
      '.gx-maint-go{display:inline-flex;align-items:center;justify-content:center;gap:7px;' +
        'background:var(--gx-green,#4ade80);border:1px solid var(--gx-green,#4ade80);' +
        'border-radius:var(--gx-radius,6px);color:var(--gx-green-ink,#06210f);font:700 13.5px/1 inherit;' +
        'padding:11px 20px;cursor:pointer;transition:background .15s,border-color .15s;}' +
      '.gx-maint-go:hover{background:var(--gx-green-bright,#5ee68f);border-color:var(--gx-green-bright,#5ee68f);}' +
      '.gx-maint-poke{display:inline-flex;align-items:center;justify-content:center;background:transparent;' +
        'color:var(--gx-text-dim,#8a958f);border:1px solid var(--gx-border-strong,#2e3733);' +
        'border-radius:var(--gx-radius,6px);padding:11px 16px;font:400 12.5px/1 inherit;cursor:pointer;' +
        'text-decoration:none;transition:color .15s,border-color .15s;}' +
      '.gx-maint-poke:hover{color:var(--gx-text,#e6ece9);border-color:var(--gx-green,#4ade80);}' +
      '.gx-maint-sig{font-size:11px;letter-spacing:.6px;color:var(--gx-text-mute,#5e6864);}' +
      '.gx-maint-smoke{position:absolute;inset:0;z-index:20;pointer-events:none;overflow:hidden;filter:blur(40px);}' +
      '.gx-maint-smoke i{position:absolute;left:50%;top:50%;border-radius:50%;display:block;}' +
      /* The clock is the only thing that genuinely does not fit a phone; everything else already
         reflows. 520px rather than 480 because the h1 wraps to four lines before that. */
      '@media (max-width:520px){.gx-maint{padding:28px 18px;}.gx-maint-clock{font-size:64px;}' +
        '.gx-maint-pm{font-size:16px;margin-left:6px;}.gx-maint-say h1{font-size:26px;}' +
        '.gx-maint-logo{width:168px;}.gx-maint-col{gap:20px;}}' +
      /* Smoke drifting across a screen is the exact thing this media query exists for, and a person
         who has asked for less motion is not the person to surprise with it. */
      '@media (prefers-reduced-motion:reduce){.gx-maint-smoke{display:none;}' +
        '.gx-maint-dot,.gx-maint-colon,.gx-maint-caret,.gx-maint-fill{animation:none;}' +
        '.gx-maint-fill{width:100%;opacity:.5;}}';
  }

  function smoke() {
    var size  = [520, 700, 600, 820, 660, 760, 580, 720];
    var gray  = ['236,241,238', '206,214,210', '176,186,182', '220,228,224'];
    var alpha = [0.115, 0.098, 0.082, 0.066];
    var dur   = [17.0, 19.9, 22.8, 25.7, 28.6, 17.5, 20.4, 23.3];
    var out = '';
    for (var i = 0; i < 8; i++) {
      var g = gray[i % 4], a = alpha[i % 4];
      out += '<i style="width:' + size[i] + 'px;height:' + size[i] + 'px;' +
        'background:radial-gradient(circle,rgba(' + g + ',' + a + '),rgba(' + g + ',0) 66%);' +
        'animation:gx-maint-rad' + (i + 1) + ' ' + dur[i].toFixed(1) + 's linear infinite;' +
        // Negative delays so the field is already mid-cycle on first paint — otherwise the page
        // opens on an empty screen and the smoke visibly "starts", which reads as a loading bug.
        'animation-delay:-' + (i * 3.4).toFixed(1) + 's"></i>';
    }
    return out;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render(notice) {
    var doc = global.document;
    if (doc.getElementById('gx-maint')) return;

    if (!doc.getElementById('gx-maint-css')) {
      var st = doc.createElement('style');
      st.id = 'gx-maint-css';
      st.textContent = styles();
      doc.head.appendChild(st);
    }

    var label = cfg.appName || titleCase(cfg.app);
    var body  = notice && notice.message
      ? esc(notice.message)
      : "Something went sideways, so we took it apart. It'll be back up before the munchies hit. " +
        'Nothing you did caused this and nothing you typed was lost.';

    var wrap = doc.createElement('div');
    wrap.id = 'gx-maint';
    wrap.className = 'gx-maint';
    wrap.setAttribute('role', 'alertdialog');
    wrap.setAttribute('aria-label', label + ' is temporarily down for maintenance');
    wrap.innerHTML =
      '<div class="gx-maint-grid" aria-hidden="true"></div>' +
      '<div class="gx-maint-col">' +
        '<div class="gx-maint-brand">' +
          '<img class="gx-maint-logo" src="' + LOGO_URL + '" alt="Green Cross">' +
          '<div class="gx-maint-meta">' +
            '<span class="gx-maint-cap">' + esc(label) + '</span>' +
            '<span class="gx-maint-sep" aria-hidden="true"></span>' +
            '<span class="gx-maint-cap gx-maint-out">' +
              '<span class="gx-maint-dot gx-maint-dot-gold" aria-hidden="true"></span>Out back</span>' +
          '</div>' +
        '</div>' +
        '<div class="gx-maint-clock" aria-hidden="true">' +
          '<span>4</span><span class="gx-maint-colon">:</span><span>20</span>' +
          '<span class="gx-maint-pm">PM</span>' +
        '</div>' +
        '<div class="gx-maint-say">' +
          "<h1>It must be 4:20 — the Tech Team is out back smokin' a Fatty.</h1>" +
          '<p>' + body + '</p>' +
        '</div>' +
        '<div class="gx-maint-card">' +
          '<div class="gx-maint-hair" aria-hidden="true"></div>' +
          '<div class="gx-maint-hdr">' +
            '<span class="gx-maint-dot" aria-hidden="true"></span>' +
            '<span class="gx-maint-cap">Status</span>' +
            '<span class="gx-maint-el" id="gx-maint-el">' + elapsed() + '</span>' +
          '</div>' +
          '<div class="gx-maint-body">' +
            '<div class="gx-maint-line" aria-live="polite">' +
              '<span class="gx-maint-prompt" aria-hidden="true">&gt;&nbsp;</span>' +
              '<span id="gx-maint-line"></span>' +
              '<span class="gx-maint-caret" aria-hidden="true">▍</span>' +
            '</div>' +
            '<div class="gx-maint-track" aria-hidden="true"><div class="gx-maint-fill"></div></div>' +
          '</div>' +
        '</div>' +
        '<div class="gx-maint-acts">' +
          '<button type="button" class="gx-maint-go" id="gx-maint-go">Check if they\'re back</button>' +
          '<button type="button" class="gx-maint-poke" id="gx-maint-poke">Poke the tech team</button>' +
        '</div>' +
        '<div class="gx-maint-sig">BRB. — Green Cross Tech</div>' +
      '</div>' +
      '<div class="gx-maint-smoke" aria-hidden="true">' + smoke() + '</div>';

    doc.body.appendChild(wrap);
    active = wrap;

    doc.getElementById('gx-maint-go').addEventListener('click', retry);
    doc.getElementById('gx-maint-poke').addEventListener('click', pokeTechTeam);

    var lines = (notice && notice.lines && notice.lines.length) ? notice.lines : DEFAULT_LINES;
    lineIdx = 0;
    paintLine(lines);

    timers.push(global.setInterval(function () {
      var e = doc.getElementById('gx-maint-el'); if (e) e.textContent = elapsed();
    }, TICK_MS));
    timers.push(global.setInterval(function () { lineIdx++; paintLine(lines); }, LINE_MS));

    hideApp(wrap);
    try { doc.getElementById('gx-maint-go').focus(); } catch (e) {}
  }

  function paintLine(lines) {
    var n = global.document.getElementById('gx-maint-line');
    if (n) n.textContent = lines[lineIdx % lines.length];
  }

  /* The gate covers the app visually; this stops the app underneath from still being reachable by
     Tab and from being read out by a screen reader, which an opaque div does not do on its own.
     `inert` is not universal — where it is missing the aria-hidden still lands and the visual cover
     is unchanged, so this degrades to "looks right, tab order leaks", not to a broken page. */
  function hideApp(keep) {
    var doc = global.document;
    prevOverflow = doc.documentElement.style.overflow;
    doc.documentElement.style.overflow = 'hidden';
    prevTitle = doc.title;
    doc.title = 'BRB — Green Cross';
    inerted = [];
    Array.prototype.slice.call(doc.body.children).forEach(function (n) {
      if (n === keep || n.id === 'gxBugOverlay' || n.id === 'gxBugFab') return;
      var had = n.hasAttribute('aria-hidden') ? n.getAttribute('aria-hidden') : null;
      inerted.push({ n: n, aria: had, inert: !!n.inert });
      n.setAttribute('aria-hidden', 'true');
      try { n.inert = true; } catch (e) {}
    });
  }

  function showApp() {
    var doc = global.document;
    if (prevOverflow !== null) doc.documentElement.style.overflow = prevOverflow;
    if (prevTitle !== null) doc.title = prevTitle;
    prevOverflow = prevTitle = null;
    inerted.forEach(function (r) {
      if (r.aria === null) r.n.removeAttribute('aria-hidden'); else r.n.setAttribute('aria-hidden', r.aria);
      try { r.n.inert = r.inert; } catch (e) {}
    });
    inerted = [];
  }

  /* Sky IS the tech team, so "poke" routes to the shared bug reporter rather than a mailto — a report
     lands on the right board with the route, filters, viewport, browser and last console error
     attached, which is the whole reason gx-bugreport.js captures a context snapshot.
     mailto: is the fallback for an app that has not wired the reporter, or whose reporter is the
     thing that is broken. Both are honest; only one is useful. */
  function pokeTechTeam() {
    var doc = global.document;
    var ov = doc.getElementById('gxBugOverlay');
    if (ov && global.GXBugReport && typeof global.GXBugReport.open === 'function') {
      // The bug overlay sits at 300 in the shared stacking order and the gate is at 10000, so opened
      // as-is it renders INVISIBLY behind this page — the same trap the gx-theme.css stacking comment
      // records for the changelog popup under the login gate. Raised inline, not in the stylesheet,
      // because it is only true while the gate is up.
      ov.style.zIndex = '10100';
      var fab = doc.getElementById('gxBugFab');
      if (fab) fab.style.zIndex = '10100';
      try { global.GXBugReport.open(); return; } catch (e) {}
    }
    global.location.href = 'mailto:' + ESCALATE +
      '?subject=' + encodeURIComponent('Still down — ' + (cfg.appName || titleCase(cfg.app)));
  }

  /* A plain reload() can be served from cache, and during an outage the cached copy is exactly what
     is wrong. Same device as gx-updatecheck's apply(), including keeping the hash: Leaderboard routes
     on it and an unattended kiosk that reloads to the default view has been silently re-pointed. */
  function retry() {
    var loc = global.location;
    loc.replace(loc.pathname + '?t=' + Date.now() + (loc.hash || ''));
  }

  function teardown() {
    timers.forEach(global.clearInterval);
    timers = [];
    showApp();
    if (active && active.parentNode) active.parentNode.removeChild(active);
    active = null;
    var st = global.document.getElementById('gx-maint-css');
    if (st && st.parentNode) st.parentNode.removeChild(st);
    var ov = global.document.getElementById('gxBugOverlay');
    if (ov) ov.style.zIndex = '';
    var fab = global.document.getElementById('gxBugFab');
    if (fab) fab.style.zIndex = '';
  }

  function apply(notice) {
    if (notice && !gated) {
      gated = true;
      seed(notice);
      if (global.document.body) render(notice);
      else global.document.addEventListener('DOMContentLoaded', function () { render(notice); });
    } else if (!notice && gated) {
      gated = false;
      teardown();
    }
  }

  function check(force) {
    if (!cfg || bypassed) return Promise.resolve(false);
    if (forced) { apply({}); return Promise.resolve(true); }
    var now = Date.now();
    var wait = gated ? GATED_MS : IDLE_MS;
    if (!force && now - checkedAt < wait) return Promise.resolve(gated);
    checkedAt = now;
    return Promise.all([fromFile(), fromCore()]).then(function (r) {
      apply(r[0] || r[1] || null);
      return gated;
    });
  }

  function param(name) {
    try { return new URL(global.location.href).searchParams.get(name); } catch (e) { return null; }
  }

  function init(options) {
    cfg = options || {};
    if (!cfg.app) { try { console.warn('[gx-maintenance] app is required'); } catch (e) {} return; }
    if (wired) return;
    wired = true;

    /* Sticky for the session so the escape hatch survives the retry button's reload — otherwise
       ?gxmaint=off works exactly once and then the reload strips it and re-gates you. */
    try {
      var p = param('gxmaint');
      if (p !== null) global.sessionStorage.setItem('gx_maint_override', p);
      var o = String(global.sessionStorage.getItem('gx_maint_override') || '').trim().toLowerCase();
      /* Spelled out rather than run through truthy(): this is a URL param a person types, not a kv
         cell, so 'on'/'off' are the natural words for it — and truthy() is pinned to the sheet's
         vocabulary (true/1/yes/active) and must not drift to accommodate a query string. */
      bypassed = (o === 'off' || o === '0' || o === 'false' || o === 'no');
      forced   = (o === 'on' || o === '1' || o === 'true' || o === 'yes');
    } catch (e) {}
    if (bypassed) return;

    global.document.addEventListener('visibilitychange', function () {
      if (global.document.visibilityState === 'visible') check(false);
    });
    // While gated, poll on a timer as well: a kiosk is never backgrounded and never refocused, so
    // visibilitychange alone would leave it showing this page long after the app came back.
    global.setInterval(function () { if (gated) check(false); }, GATED_MS);

    // No startup delay, unlike gx-updatecheck's 4s. A stale-build toast can wait for the app to
    // settle; "this app is down" is the first thing the person needs and every second before it is a
    // second of them fighting a broken screen.
    check(true);
  }

  global.GXMaintenance = {
    init: init,
    check: check,
    isGated: function () { return gated; },
    // Exported for tests and for a console preview without touching a flag.
    _apply: apply, _truthy: truthy, _parseKv: parseKv, _elapsed: elapsed, _titleCase: titleCase,
    _seed: seed, _styles: styles,
  };
})(typeof window !== 'undefined' ? window : this);
