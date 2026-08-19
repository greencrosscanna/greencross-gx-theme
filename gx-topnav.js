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

  global.GXTopNav = { init: init, renderUser: renderUser, startClock: startClock, stopClock: stopClock,
                      paintClock: paintClock, closeAll: closeAll };
})(typeof window !== 'undefined' ? window : this);
