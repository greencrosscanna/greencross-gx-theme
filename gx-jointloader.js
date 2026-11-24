"use strict";
/* GXJointLoader — the burning-joint loading screen, ported from the Claude Design project
   "Burning joint loading bar" (claude.ai/artifact/JZd5hJ4PgFvox7gkR1UQtc, 2026-11-19) to plain JS.

   Shared by every GX app, loaded by URL from Pages:
     <script src="https://greencrosscanna.github.io/greencross-gx-theme/gx-jointloader.js"></script>
   Do NOT add a ?v= to that tag: deploy.sh reads an app's version from the first ?v= it finds on a
   script tag, so "?v=1" made five apps record as "v1" and fail the vMAJOR.BBB format. Load it AFTER
   gx-handoff.js (the handoff test forbids the other order).
   Self-contained on purpose (styles injected once, no dependencies). z-index 9999: above the sign-in
   card, below the maintenance gate (10000). There is deliberately NO thin top progress bar (removed
   at Sky's request, portal v1.110) — do not add one back.

   Two uses:
     GXJointLoader.screen({ appName, logo, lines })  full-screen cover; returns
         { done() -> Promise (burns to 100%, glows, fades, removes), cancel() (removes now) }.
         Progress is honest about what it knows: it creeps toward 92% while waiting and only reaches
         100% when done() is called, so it never says "done" before the page is.
     GXJointLoader.tabHtml(title, logo)  a whole HTML document for a just-opened tab (CSS-only burn),
         written into it while the app's sign-in code is fetched.

   prefers-reduced-motion: no flicker, no smoke, no sweep; the bar still fills. */
(function () {
  if (window.GXJointLoader) return;

  var CSS =
    '@keyframes gxjflick{0%,100%{opacity:1;transform:scale(1)}22%{opacity:.86;transform:scale(.94)}47%{opacity:1;transform:scale(1.06)}70%{opacity:.9;transform:scale(.97)}}' +
    '@keyframes gxjcrackle{0%,88%,100%{opacity:0;transform:scale(.6)}92%{opacity:.9;transform:scale(1.5)}96%{opacity:0;transform:scale(2.1)}}' +
    '@keyframes gxjsmoke1{0%{opacity:0;transform:translate(-50%,-50%) scale(.4)}18%{opacity:.5}100%{opacity:0;transform:translate(-140%,-620%) scale(2.6)}}' +
    '@keyframes gxjsmoke2{0%{opacity:0;transform:translate(-50%,-50%) scale(.35)}22%{opacity:.42}100%{opacity:0;transform:translate(60%,-700%) scale(2.9)}}' +
    '@keyframes gxjsmoke3{0%{opacity:0;transform:translate(-50%,-50%) scale(.3)}25%{opacity:.34}100%{opacity:0;transform:translate(-30%,-540%) scale(2.3)}}' +
    '@keyframes gxjpuff{0%{opacity:.55;transform:translate(-50%,-50%) scale(.5)}100%{opacity:0;transform:translate(-50%,-160%) scale(3.4)}}' +
    '@keyframes gxjsweep{0%{transform:translateX(-110%)}100%{transform:translateX(240%)}}' +
    '@keyframes gxjroach{0%,100%{opacity:.55}50%{opacity:1}}' +
    '@keyframes gxjblink{0%,45%{opacity:1}55%,100%{opacity:.15}}' +
    '@keyframes gxjpulse{0%,100%{opacity:1;box-shadow:0 0 6px #4ade80}50%{opacity:.3;box-shadow:0 0 0 #4ade80}}' +
    '@keyframes gxjburn{0%{--gxj-p:0}100%{--gxj-p:88}}' +

    /* the bar */
    '.gxj-bar{position:relative;width:100%;height:30px;min-height:8px}' +
    '.gxj-paper{position:absolute;inset:0;clip-path:polygon(0 0,91% 17%,91% 83%,0 100%);background:linear-gradient(180deg,#fdfaf4 0%,#f2ebdc 42%,#ded3bd 74%,#c4b9a2 100%);box-shadow:inset 0 0 0 1px rgba(120,105,80,.35)}' +
    '.gxj-grain{position:absolute;inset:0;background-image:repeating-linear-gradient(74deg,rgba(120,100,70,.055) 0 1px,transparent 1px 9px)}' +
    '.gxj-char{position:absolute;left:0;top:0;bottom:0;width:0;background:linear-gradient(90deg,#0b0a09 0%,#121110 48%,#1d1a17 78%,#3a2a1c 93%,#6e3a15 100%)}' +
    '.gxj-char::after{content:"";position:absolute;inset:0;background-image:repeating-linear-gradient(64deg,rgba(228,224,216,.045) 0 1px,transparent 1px 13px),repeating-linear-gradient(-64deg,rgba(0,0,0,.55) 0 1px,transparent 1px 9px)}' +
    '.gxj-sweep{position:absolute;inset:0;overflow:hidden;display:none}' +
    '.gxj-sweep::before{content:"";position:absolute;top:0;bottom:0;width:38%;background:linear-gradient(90deg,transparent,rgba(255,150,40,.28),transparent);animation:gxjsweep 2.6s ease-in-out infinite}' +
    '.gxj-bar.is-waiting .gxj-sweep{display:block}' +
    '.gxj-crutch{position:absolute;right:0;top:17%;bottom:17%;width:9%;background:linear-gradient(180deg,#d8b076 0%,#c19352 45%,#8f6733 100%);border-radius:1px 2px 2px 1px;box-shadow:inset -1px 0 0 rgba(0,0,0,.25)}' +
    '.gxj-crutch::before{content:"";position:absolute;inset:0;background-image:repeating-linear-gradient(64deg,rgba(90,58,22,.55) 0 1px,transparent 1px 6px)}' +
    '.gxj-roach{display:none;position:absolute;inset:-2px;border-radius:3px;box-shadow:0 0 12px 2px rgba(255,110,20,.75),inset 0 0 6px rgba(255,80,10,.9);animation:gxjroach 1.4s ease-in-out infinite}' +
    '.gxj-bar.is-near .gxj-roach{display:block}' +
    '.gxj-ember{position:absolute;top:50%;left:0;height:calc(100% + 2px);aspect-ratio:1;transform:translate(-50%,-50%);pointer-events:none}' +
    '.gxj-glow{position:absolute;inset:-90%;border-radius:50%;background:radial-gradient(circle,rgba(255,120,20,.45),rgba(255,70,0,.16) 45%,rgba(255,60,0,0) 70%);filter:blur(5px);animation:gxjflick 1.7s ease-in-out infinite}' +
    '.gxj-core{position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,#fff6d0 0%,#ffc23c 26%,#ff6a12 52%,rgba(214,42,0,.55) 70%,rgba(180,30,0,0) 78%);animation:gxjflick 1.15s ease-in-out infinite}' +
    '.gxj-spark{position:absolute;inset:34%;border-radius:50%;background:radial-gradient(circle,#fffdf2,#ffd35e 60%,rgba(255,160,40,0) 72%);animation:gxjcrackle 4.9s linear infinite}' +
    '.gxj-smoke{position:absolute;left:50%;top:50%;width:100%;height:100%;pointer-events:none}' +
    '.gxj-bar.no-smoke .gxj-smoke,.gxj-bar.is-done .gxj-smoke{display:none}' +
    '.gxj-smoke i{position:absolute;left:0;top:-20%;border-radius:50%}' +
    '.gxj-smoke i:nth-child(1){width:100%;height:100%;background:radial-gradient(circle,rgba(226,232,229,.42),rgba(226,232,229,0) 66%);filter:blur(6px);animation:gxjsmoke1 4.2s linear infinite}' +
    '.gxj-smoke i:nth-child(2){width:128%;height:128%;background:radial-gradient(circle,rgba(198,207,203,.34),rgba(198,207,203,0) 66%);filter:blur(8px);animation:gxjsmoke2 5.6s linear infinite;animation-delay:-2.1s}' +
    '.gxj-smoke i:nth-child(3){width:84%;height:84%;background:radial-gradient(circle,rgba(176,186,182,.3),rgba(176,186,182,0) 66%);filter:blur(5px);animation:gxjsmoke3 3.4s linear infinite;animation-delay:-1.2s}' +
    '.gxj-puff{display:none;position:absolute;right:6%;top:50%;width:0;height:0;pointer-events:none}' +
    '.gxj-puff::before{content:"";position:absolute;left:0;top:0;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(232,238,235,.5),rgba(232,238,235,0) 64%);filter:blur(16px);animation:gxjpuff 1.9s ease-out forwards}' +
    '.gxj-bar.is-done .gxj-puff{display:block}' +

    /* the full-screen cover. z-index 9999 + appended last = above the sign-in card (.gx-login 9999),
       below the maintenance gate (10000), which must always win. */
    '.gxj-screen{position:fixed;inset:0;z-index:9999;overflow:auto;color-scheme:dark;background:#0a0e0d radial-gradient(1100px 620px at 50% -10%,rgba(74,222,128,.09),transparent 62%);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#e6ece9;transition:opacity .35s linear}' +
    '.gxj-screen.is-out{opacity:0}' +
    '.gxj-body{display:flex;flex-direction:column;align-items:center;text-align:center;gap:26px;max-width:620px;margin:0 auto;padding:88px 16px 64px}' +
    '.gxj-brand{display:flex;flex-direction:column;align-items:center;gap:10px}' +
    '.gxj-logo{display:block;width:212px;max-width:70vw;height:auto}' +
    '.gxj-tags{display:flex;align-items:center;gap:9px;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase}' +
    '.gxj-app{color:#8a958f}' +
    '.gxj-sep{width:3px;height:3px;border-radius:50%;background:#2e3733}' +
    '.gxj-state{display:inline-flex;align-items:center;gap:7px;color:#4ade80}' +
    '.gxj-state::before{content:"";width:6px;height:6px;border-radius:50%;background:#4ade80;animation:gxjpulse 1.8s ease-in-out infinite}' +
    '.gxj-meter{width:100%;max-width:520px;display:flex;flex-direction:column;gap:14px}' +
    '.gxj-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px}' +
    '.gxj-pct{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:44px;font-weight:800;line-height:1;letter-spacing:-2px;color:#4ade80;text-shadow:0 0 34px rgba(74,222,128,.3)}' +
    '.gxj-burn{font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#8a958f}' +
    '.gxj-line{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.6;color:#8a958f;min-height:20px;text-align:left}' +
    '.gxj-line::before{content:"> ";color:#3fa866}' +
    '.gxj-line::after{content:"\\258D";color:#4ade80;animation:gxjblink 1s steps(1,end) infinite}' +

    '@media (prefers-reduced-motion: reduce){' +
      '.gxj-glow,.gxj-core,.gxj-spark,.gxj-roach,.gxj-state::before,.gxj-line::after,.gxj-sweep::before{animation:none !important}' +
      '.gxj-smoke,.gxj-puff,.gxj-spark,.gxj-sweep{display:none !important}' +
    '}';

  var DEFAULT_LOGO = 'https://greencrosscanna.github.io/greencross-gx-theme/gx-logo.png';
  var DEFAULT_LINES = [
    'waking up GX Core…',
    'checking which apps are yours…',
    'reading the status lights…',
    'rolling one for the road…',
    'almost lit…',
  ];

  function injectCss(doc) {
    doc = doc || document;
    if (doc.getElementById('gxj-css')) return;
    var s = doc.createElement('style');
    s.id = 'gxj-css';
    s.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(s);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var BAR_HTML =
    '<div class="gxj-paper"><div class="gxj-grain"></div><div class="gxj-char"></div><div class="gxj-sweep"></div></div>' +
    '<div class="gxj-crutch"><div class="gxj-roach"></div></div>' +
    '<div class="gxj-ember"><div class="gxj-glow"></div><div class="gxj-core"></div><div class="gxj-spark"></div>' +
      '<div class="gxj-smoke"><i></i><i></i><i></i></div></div>' +
    '<div class="gxj-puff"></div>';

  /* One bar. set(pct) moves the burn line: the char and the ember travel the paper's 91%, and the ember
     shrinks a third as it nears the crutch — the same geometry as the design's JointBar. */
  function bar(opts) {
    opts = opts || {};
    injectCss();
    var el = document.createElement('div');
    el.className = 'gxj-bar' + (opts.smoke === false ? ' no-smoke' : '');
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = BAR_HTML;
    var ch = el.querySelector('.gxj-char'), em = el.querySelector('.gxj-ember');
    function set(pct) {
      var p = Math.max(0, Math.min(100, Number(pct) || 0));
      var x = (p * 0.91).toFixed(2) + '%';
      ch.style.width = x;
      em.style.left = x;
      em.style.height = 'calc(' + (100 - p * 0.34).toFixed(2) + '% + 2px)';
      el.classList.toggle('is-near', p >= 97);
      el.classList.toggle('is-done', p >= 100);
    }
    set(opts.pct || 0);
    return { el: el, set: set };
  }

  var active = null;

  function screen(opts) {
    opts = opts || {};
    if (active) return active.api;   // one cover at a time: a second caller shares the first
    injectCss();
    var lines = (opts.lines && opts.lines.length) ? opts.lines : DEFAULT_LINES;
    var root = document.createElement('div');
    root.className = 'gxj-screen';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.innerHTML =
      '<div class="gxj-body">' +
        '<div class="gxj-brand">' +
          '<img class="gxj-logo" src="' + esc(opts.logo || DEFAULT_LOGO) + '" alt="Green Cross">' +
          '<div class="gxj-tags"><span class="gxj-app">' + esc(opts.appName || 'Green Cross') + '</span>' +
            '<span class="gxj-sep"></span><span class="gxj-state">Loading</span></div>' +
        '</div>' +
        '<div class="gxj-meter">' +
          '<div class="gxj-row"><span class="gxj-pct">0%</span><span class="gxj-burn">burning down</span></div>' +
          '<div class="gxj-main"></div>' +
          '<div class="gxj-line"></div>' +
        '</div>' +
      '</div>';
    var main = bar();
    root.querySelector('.gxj-main').appendChild(main.el);
    main.el.classList.add('is-waiting');
    document.body.appendChild(root);

    var pctEl = root.querySelector('.gxj-pct'), lineEl = root.querySelector('.gxj-line'),
        stateEl = root.querySelector('.gxj-state');
    var pct = 0, li = 0, ivBurn, ivLine, finishing = null, gone = false;

    function paint() {
      main.set(pct);
      pctEl.textContent = Math.round(pct) + '%';
    }
    lineEl.textContent = lines[0];
    ivLine = setInterval(function () { li++; lineEl.textContent = lines[li % lines.length]; }, 2600);

    /* While waiting: fast at first, slowing as it nears 92% and never passing it. The page decides
       when it is really ready (done()); the bar does not guess. */
    ivBurn = setInterval(function () {
      if (pct >= 92) return;
      pct = Math.min(92, pct + Math.max(0.08, (92 - pct) * 0.035) * (0.5 + Math.random()));
      paint();
    }, 90);
    paint();

    function remove() {
      if (gone) return;
      gone = true;
      clearInterval(ivBurn); clearInterval(ivLine);
      if (root.parentNode) root.parentNode.removeChild(root);
      active = null;
    }

    var api = {
      /* Burn the rest quickly, let the roach glow, fade, remove. Resolves once it is gone. */
      done: function () {
        if (finishing) return finishing;
        finishing = new Promise(function (resolve) {
          if (gone) { resolve(); return; }
          clearInterval(ivBurn); clearInterval(ivLine);
          main.el.classList.remove('is-waiting');
          var iv = setInterval(function () {
            pct = Math.min(100, pct + 6);
            paint();
            if (pct < 100) return;
            clearInterval(iv);
            stateEl.textContent = 'Lit';
            lineEl.textContent = 'ready. go.';
            setTimeout(function () {
              root.classList.add('is-out');
              setTimeout(function () { remove(); resolve(); }, 360);
            }, 450);
          }, 30);
        });
        return finishing;
      },
      /* Take it down now, no finish — for a failure the page is about to explain. */
      cancel: remove,
    };
    active = { api: api };
    return api;
  }

  /* A just-opened tab is a blank page on this origin with no scripts of ours, so the burn is CSS-only:
     the char and ember ride the --gxj-p custom property from 0 to 88% over ~4s, easing out so it is
     still visibly moving if the code takes a while. Browsers without @property support show a still
     bar with a flickering ember — fine for a page that is up for a second or two. */
  function tabHtml(title, logo) {
    var t = esc(title || 'Opening…');
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + t + '</title>' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<style>' + CSS +
        '@property --gxj-p{syntax:"<number>";inherits:true;initial-value:0}' +
        'html,body{margin:0;background:#0a0e0d}' +
        '.gxj-screen{position:static;min-height:100vh}' +
        '.gxj-bar{--gxj-p:0;animation:gxjburn 4s cubic-bezier(.15,.7,.3,1) forwards}' +
        '.gxj-char{width:calc(var(--gxj-p) * .91%)}' +
        '.gxj-ember{left:calc(var(--gxj-p) * .91%);height:calc((100 - var(--gxj-p) * .34) * 1% + 2px)}' +
      '</style></head><body>' +
      '<div class="gxj-screen" role="status">' +
        '<div class="gxj-body"><div class="gxj-brand"><img class="gxj-logo" src="' + esc(logo || DEFAULT_LOGO) + '" alt="Green Cross">' +
          '<div class="gxj-tags"><span class="gxj-state">' + t + '</span></div></div>' +
          '<div class="gxj-meter"><div class="gxj-bar">' + BAR_HTML + '</div>' +
          '<div class="gxj-line">signing you in…</div></div></div></div>' +
      '</body></html>';
  }

  window.GXJointLoader = { screen: screen, bar: bar, tabHtml: tabHtml };
})();
