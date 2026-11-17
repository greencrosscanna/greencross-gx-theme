/* gx-handoff.js — open an app from a staff-portal tile already signed in.
 *
 * The portal (apps.greencrosscanna.com) asks GX Core for a 60-second, single-use code for (this
 * person, this app) and opens the app at  <app url>#gxcode=<code>.  This file, loaded by the app:
 *
 *   1. AT LOAD, before anything else reads the address bar, takes the code out of it
 *      (history.replaceState) — so a hash router never sees it, an update-check reload never carries
 *      it, and it is not left in history or a screenshot. Load it as a plain <script> in <head>, BEFORE
 *      the app's own router/boot code.
 *   2. When the app calls GXHandoff.run({...}), trades the code ONCE for the app's normal session
 *      (GX Core handoff_exchange — the person's real grant on this app, never more), hands it to the
 *      app's own `save` so it lands exactly where the app's password sign-in puts it, then reloads so
 *      the app boots signed in through its ordinary path.
 *
 * The app owns its storage; this file never writes a session anywhere itself. Every app keeps its
 * password form — any refusal leaves the person on it, with one plain line saying why.
 *
 *   GXHandoff.code                       the captured code, or null
 *   GXHandoff.run({
 *     app:      'inventory',             // REQUIRED — the GX Core app key this page is
 *     save:     function (payload) {},   // REQUIRED — write the session the way your sign-in does
 *     current:  function () { return userOrNull; },  // optional — who is signed in here already
 *     exchange: function (code) { return Promise<payload> },  // optional — trade via your own backend
 *     reload:   true,                    // optional — false: call onSignedIn instead of reloading
 *     onSignedIn: function (payload) {}, // optional — with reload:false
 *   }) → Promise<payload|null>
 *
 * NEVER RETRIED. The code is single-use: a second attempt after a lost response can only ever be
 * refused, so the one request is sent once, and a failure falls back to the sign-in form.
 */
(function (global) {
  'use strict';
  var GXCORE_URL = 'https://script.google.com/macros/s/AKfycbx9mjeCBbDpxNYaqBv2hyZaO1hpbGG6PZM9AebFdwl0UwkdtRCGSWrH-8ohEtdF1K_6/exec';
  var CODE_RE = /^h1\.[A-Za-z0-9_-]{40,64}$/;

  // ── 1. take the code out of the address bar, synchronously, at load ──
  function capture(loc, hist) {
    var hash = String((loc && loc.hash) || '').replace(/^#/, '');
    if (hash.indexOf('gxcode=') < 0) return null;
    var code = null, rest = [];
    hash.split('&').forEach(function (part) {
      if (part.indexOf('gxcode=') === 0) code = decodeURIComponent(part.slice(7));
      else if (part) rest.push(part);
    });
    try {
      if (hist && hist.replaceState) hist.replaceState(hist.state, '', loc.pathname + loc.search + (rest.length ? '#' + rest.join('&') : ''));
    } catch (e) {}
    return CODE_RE.test(String(code || '')) ? code : null;
  }

  var captured = null;
  try { captured = capture(global.location, global.history); } catch (e) { captured = null; }

  // ── the holding line while the code is traded (a couple of seconds on the /exec transport) ──
  function banner(text, tone) {
    var d = global.document; if (!d || !d.body) return null;
    var el = d.getElementById('gx-handoff-banner');
    if (!el) {
      el = d.createElement('div'); el.id = 'gx-handoff-banner'; el.setAttribute('role', 'status');
      el.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483000;' +
        'max-width:calc(100% - 32px);padding:10px 16px;border-radius:10px;font:14px/1.4 system-ui,sans-serif;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.25);';
      d.body.appendChild(el);
    }
    el.style.background = tone === 'bad' ? '#3b1414' : '#10291c';
    el.style.color = tone === 'bad' ? '#ffd7d7' : '#d7f5e3';
    el.textContent = text;
    return el;
  }
  function clearBanner(after) {
    setTimeout(function () {
      var el = global.document && global.document.getElementById('gx-handoff-banner');
      if (el && el.parentNode) el.parentNode.removeChild(el);
    }, after || 0);
  }
  function whenBody(fn) {
    var d = global.document;
    if (!d || d.body) return fn();
    d.addEventListener('DOMContentLoaded', fn);
  }

  function defaultExchange(app) {
    return function (code) {
      var body = { action: 'handoff_exchange', code: code, app: app };
      if (typeof global.GXClient === 'function') {
        return global.GXClient(GXCORE_URL, { app: app }).postJSON('handoff_exchange', body, { retries: 0, timeoutMs: 30000 });
      }
      return global.fetch(GXCORE_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body), redirect: 'follow' }).then(function (r) { return r.json(); });
    };
  }

  var ran = false;
  function run(opts) {
    opts = opts || {};
    var code = captured;
    if (!code || ran) return Promise.resolve(null);
    ran = true; captured = null; api.code = null;   // single use on this side too
    if (!opts.app || typeof opts.save !== 'function') return Promise.resolve(null);
    var current = typeof opts.current === 'function' ? opts.current : function () { return null; };
    var exchange = typeof opts.exchange === 'function' ? opts.exchange : defaultExchange(opts.app);
    whenBody(function () { banner('Signing you in from the staff portal…'); });
    return Promise.resolve().then(function () { return exchange(code); }).then(function (r) {
      if (!r || !r.ok || !r.token) {
        var e = new Error((r && r.error) || 'Could not sign you in'); e.code = r && r.code; throw e;
      }
      var was = null; try { was = current(); } catch (e) {}
      opts.save(r);
      if (was && String(was).toLowerCase() === String(r.user).toLowerCase()) { clearBanner(); return r; }   // same person: nothing to redraw
      if (opts.reload === false) { clearBanner(); if (typeof opts.onSignedIn === 'function') opts.onSignedIn(r); return r; }
      global.location.reload();
      return r;
    }).catch(function (e) {
      var signedIn = null; try { signedIn = current(); } catch (x) {}
      if (signedIn) { clearBanner(); return null; }   // already signed in here — a spent code changes nothing
      whenBody(function () {
        banner((e && e.code === 'no_access') ? "You don't have access to this app. Ask Sky to add you."
          : 'Could not sign you in from the portal — sign in below, or open the app from the portal again.', 'bad');
        clearBanner(7000);
      });
      return null;
    });
  }

  var api = { code: captured, run: run, _capture: capture, _CODE_RE: CODE_RE };
  global.GXHandoff = api;
})(typeof window !== 'undefined' ? window : this);
