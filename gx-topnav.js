/* GX TopNav — behaviour for the shared header's user menu.
 * Canonical source: greencross-gx-theme/gx-topnav.js.
 *
 * Settings, version and sign-out are deliberately NOT separate header buttons -- they live behind the
 * user chip, so the bar stays readable as an app grows. That means a menu, and a menu means behaviour
 * every app would otherwise reimplement (and get wrong: click-outside, Escape, aria-expanded).
 *
 * USAGE  — call once after the header is in the DOM:
 *   GXTopNav.init();                                  // wires every .gx-user on the page
 *   document.addEventListener('gx-topnav:action', function (e) {
 *     e.detail.action;                                // 'settings' | 'version' | 'logout' | your own
 *   });
 *   GXTopNav.startClock();                            // optional: drives .gx-clock-time/.gx-clock-date
 *
 * Times render in PACIFIC, not the browser's zone. Every GX date is keyed to America/Los_Angeles, and a
 * header clock showing a laptop's local time in another zone is exactly the kind of quiet mismatch that
 * makes someone mistrust the numbers underneath it.
 */
(function (global) {
  if (global.GXTopNav) return;
  var TZ = 'America/Los_Angeles';

  function closeAll(except) {
    var menus = document.querySelectorAll('.gx-user-menu');
    Array.prototype.forEach.call(menus, function (m) {
      if (m === except) return;
      m.hidden = true;
      var btn = m.parentNode && m.parentNode.querySelector('.gx-user-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }

  function init(root) {
    root = root || document;
    var wraps = root.querySelectorAll('.gx-user');
    Array.prototype.forEach.call(wraps, function (wrap) {
      if (wrap.__gxWired) return;
      wrap.__gxWired = true;
      var btn  = wrap.querySelector('.gx-user-btn');
      var menu = wrap.querySelector('.gx-user-menu');
      if (!btn || !menu) return;

      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = menu.hidden;
        closeAll(menu);
        menu.hidden = !open;
        btn.setAttribute('aria-expanded', String(open));
      });

      menu.addEventListener('click', function (e) {
        var item = e.target.closest ? e.target.closest('.gx-user-item') : null;
        if (!item) return;
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        var action = item.getAttribute('data-gx-action') || '';
        document.dispatchEvent(new CustomEvent('gx-topnav:action', {
          detail: { action: action, item: item, wrap: wrap }
        }));
      });
    });

    if (!global.__gxTopNavGlobal) {
      global.__gxTopNavGlobal = true;
      document.addEventListener('click', function () { closeAll(null); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(null); });
    }
  }

  function paintClock() {
    var t = document.querySelectorAll('.gx-clock-time');
    var d = document.querySelectorAll('.gx-clock-date');
    if (!t.length && !d.length) return;
    var now = new Date();
    var time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(now);
    var date = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(now);
    Array.prototype.forEach.call(t, function (el) { el.textContent = time; });
    Array.prototype.forEach.call(d, function (el) { el.textContent = date; });
  }

  var timer = null;
  function startClock() { paintClock(); if (timer) clearInterval(timer); timer = setInterval(paintClock, 20000); }
  function stopClock()  { if (timer) { clearInterval(timer); timer = null; } }

  /* Build the whole user chip + menu, so no app hand-writes this markup. Every app was otherwise
     assembling the same HTML string itself, which is how two apps end up with menus that drift apart
     -- one gains an item, the other does not, and neither is obviously wrong.
     Adding a menu item later is one line of config here, not new markup in the app:
       GXTopNav.renderUser(slot, {
         name: 'Sky Pinnick', role: 'admin', avatar: GXAvatar.chip(cfg, name),
         items: [ {action:'settings', label:'Settings'},
                  {action:'version',  label:'Version', value: 'v18'},
                  {action:'logout',   label:'Sign out', danger: true} ]
       });
     Clicks emit gx-topnav:action with the item's `action`; what it MEANS stays in the app.
     A row with no `action` renders as static info (the GX Core status row in SPIFF).

     CANONICAL ORDER -- keep it identical across apps, so the same item is in the same place wherever
     someone happens to be working. Every app is expected to grow a settings panel; when one lands,
     it goes in the SETTINGS slot below and nowhere else:
       1. app-specific info rows   (no action -- status, connection, environment)
       2. { action: 'settings', label: 'Settings' }
       3. { action: 'version',  label: 'Version', value: APP_VERSION }
       4. { action: 'logout',   label: 'Sign out', danger: true }
     Omit a slot the app genuinely lacks rather than shipping an item that does nothing -- SPIFF had a
     settings GEAR wired to no handler at all, which looked functional and was not. */
  function renderUser(slot, opts) {
    if (!slot) return;
    opts = opts || {};
    if (!opts.name) { slot.innerHTML = ''; return; }
    var esc = function (v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    };
    var rows = (opts.items || []).map(function (it) {
      var value = it.value ? '<span class="gx-user-ver">' + esc(it.value) + '</span>' : '';
      var cls = 'gx-user-item' + (it.danger ? ' is-danger' : '');
      // no action -> a static info row, not a button: it must not look clickable
      if (!it.action) return '<div class="' + cls + '" style="cursor:default">' + esc(it.label) + ' ' + value + '</div>';
      return '<button class="' + cls + '" data-gx-action="' + esc(it.action) + '">' + esc(it.label) + ' ' + value + '</button>';
    }).join('');

    slot.innerHTML =
      '<div class="gx-user">' +
        '<button class="gx-user-btn" aria-haspopup="menu" aria-expanded="false">' +
          '<span class="gx-user-ava">' + (opts.avatar || esc(opts.name).slice(0, 2).toUpperCase()) + '</span>' +
          '<span class="gx-user-name">' + esc(opts.name) + '</span>' +
        '</button>' +
        '<div class="gx-user-menu" role="menu" hidden>' +
          '<div class="gx-user-head">' + esc(opts.name) +
            '<span>' + esc(opts.role || '') + '</span></div>' +
          rows +
        '</div>' +
      '</div>';
    init(slot);
    return slot.querySelector('.gx-user-btn');
  }

  /* ── EMBEDDED (nested sub-app) MODE ──────────────────────────────────────────────────────────────
     Price Cards and SPIFF are embedded in Inventory by iframe, pointing at their live URLs -- the
     nested instance is the SAME deployed page. So a sub-app has to know which context it is in:

       standalone   full .gx-topnav (logo, clock, user chip) + its own action row
       nested       NO top-level nav -- the host already provides that chrome. Only the action row,
                    and Settings joins it, because the user tray it would otherwise live in belongs
                    to the host.

     Detection prefers an explicit ?embed=1 over iframe sniffing: Inventory itself runs inside a GAS
     iframe, so "am I framed" is ambiguous in this suite, and an explicit flag can also be opened
     directly to review the embedded layout without a host.

     Apps mark controls declaratively; no JS branching needed:
       data-gx-embed-only        shown ONLY when nested   (e.g. the Settings button in the action row)
       data-gx-standalone-only   shown ONLY when standalone
     and the html element carries .gx-embedded, which hides .gx-topnav via gx-theme.css. */
  function isEmbedded() {
    try {
      if (/[?&]embed=1\b/.test(global.location.search)) return true;
      if (/[?&]embed=0\b/.test(global.location.search)) return false;   // explicit opt-out wins
      return global.self !== global.top;
    } catch (e) {
      return true;   // cross-origin access threw, which itself means we are framed
    }
  }

  /* Applied to <html> as early as possible: waiting for DOMContentLoaded lets the top nav paint and
     then vanish, which reads as a layout glitch on every embedded load. */
  function applyEmbedClass() {
    try {
      var root = global.document && global.document.documentElement;
      if (root) root.classList.toggle('gx-embedded', isEmbedded());
    } catch (e) {}
  }
  applyEmbedClass();

  global.GXTopNav = { init: init, renderUser: renderUser, startClock: startClock, stopClock: stopClock,
                      paintClock: paintClock, closeAll: closeAll,
                      isEmbedded: isEmbedded, applyEmbedClass: applyEmbedClass };
})(typeof window !== 'undefined' ? window : this);
