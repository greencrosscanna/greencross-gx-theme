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

  global.GXTopNav = { init: init, startClock: startClock, stopClock: stopClock, paintClock: paintClock, closeAll: closeAll };
})(typeof window !== 'undefined' ? window : this);
