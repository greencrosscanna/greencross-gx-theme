#!/usr/bin/env node
/* gx-handoff.js — the "Sign in with Google" button on every app's sign-in screen.
 *   RUN: node tests/handoff_google_button_test.js
 *
 * The button sends a signed-out person to the staff portal (?open=<app>), which signs them in with
 * Google and hands back with a code. What can go wrong HERE, each with a case:
 *   - the wrong app key goes to the portal (leaderboard is `performance`, not `leaderboard`);
 *   - it lands on a form that is not the sign-in form (a change-password form), or on no form at all;
 *   - it is added twice, or lost when an app repaints its sign-in screen;
 *   - it shows inside another app's frame (Price Cards / SPIFF in Inventory), or for someone signed in;
 *   - it appears on a page that never asked (the hub's Command Center, localhost).
 * The real file runs in a small fake DOM. */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log('  PASS  ' + l)) : (fail++, console.log('  FAIL  ' + l)); };
const SRC = fs.readFileSync(path.join(__dirname, '..', 'gx-handoff.js'), 'utf8');
const SRC_HOLDER = { src: SRC };   // section 7 swaps in the GOOGLE_ONLY = false copy
const CODE = 'h1.' + 'Ab9_-'.repeat(8) + 'xyz';
const PORTAL = 'https://apps.greencrosscanna.com/?open=';

// ── a fake DOM just big enough for the selectors the file uses ──
function el(tag, attrs) {
  const e = { tagName: tag.toUpperCase(), children: [], parentNode: null, style: {}, attrs: {}, textContent: '' };
  Object.assign(e.attrs, attrs || {});
  Object.defineProperty(e, 'id', { get: () => e.attrs.id || '', set: v => { e.attrs.id = v; } });
  Object.defineProperty(e, 'className', { get: () => e.attrs.class || '', set: v => { e.attrs.class = v; } });
  e.getAttribute = k => (k in e.attrs ? e.attrs[k] : null);
  e.setAttribute = (k, v) => { e.attrs[k] = String(v); };
  e.appendChild = c => { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = e; e.children.push(c); return c; };
  e.insertBefore = (c, ref) => { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = e; const i = e.children.indexOf(ref); e.children.splice(i < 0 ? e.children.length : i, 0, c); return c; };
  e.removeChild = c => { const i = e.children.indexOf(c); if (i >= 0) e.children.splice(i, 1); c.parentNode = null; return c; };
  e.querySelectorAll = sel => { const out = []; walk(e, n => { if (n !== e && matches(n, sel)) out.push(n); }); return out; };
  e.querySelector = sel => e.querySelectorAll(sel)[0] || null;
  e.closest = sel => { for (let n = e; n; n = n.parentNode) if (n.tagName && matches(n, sel)) return n; return null; };
  return e;
}
function walk(n, fn) { fn(n); (n.children || []).forEach(c => walk(c, fn)); }
function matches(n, sel) {
  if (/^[a-z]+$/.test(sel)) return n.tagName === sel.toUpperCase();
  if (sel === 'input[type="password"]') return n.tagName === 'INPUT' && n.attrs.type === 'password';
  if (sel.charAt(0) === '.') return (' ' + n.className + ' ').indexOf(' ' + sel.slice(1) + ' ') >= 0;
  throw new Error('fake DOM: unsupported selector ' + sel);
}
// The suite's sign-in card: .gx-login > .gx-login-card > form.gx-login-form (user + password)
function loginCard(opts) {
  opts = opts || {};
  const wrap = el('div', { class: opts.wrapClass === undefined ? 'gx-login' : opts.wrapClass });
  const card = wrap.appendChild(el('div', { class: 'gx-login-card' }));
  const form = card.appendChild(el(opts.tag || 'form', { class: opts.formClass === undefined ? 'gx-login-form' : opts.formClass }));
  form.appendChild(el('input', { type: 'text' }));
  form.appendChild(el('input', { type: 'password' }));
  return { wrap, card, form };
}

function boot(o) {
  o = o || {};
  const body = el('body');
  const st = { observers: [], reloads: 0 };
  const doc = {
    body, readyState: 'complete',
    currentScript: o.dataApp ? el('script', { 'data-gx-app': o.dataApp }) : null,
    getElementById: id => { let f = null; walk(body, n => { if (!f && n.id === id) f = n; }); return f; },
    querySelectorAll: sel => body.querySelectorAll(sel),
    createElement: t => el(t),
    addEventListener() {},
  };
  const loc = { hostname: o.host || 'greencrosscanna.github.io', pathname: o.path || '/greencross-inventory/',
    search: o.search || '', hash: o.hash || '', reload: () => { st.reloads++; } };
  const win = {
    location: loc, document: doc,
    history: { state: null, replaceState: (s, t, u) => { loc.hash = u.indexOf('#') >= 0 ? u.slice(u.indexOf('#')) : ''; } },
    MutationObserver: function (cb) { this.observe = () => st.observers.push(cb); },
    GXClient: () => ({ postJSON: () => (o.answer ? o.answer() : Promise.resolve({ ok: true, user: 'tawny', token: 't' })) }),
  };
  win.self = win; win.top = o.framed ? {} : win;
  if (typeof o.GX_EMBED === 'boolean') win.GX_EMBED = o.GX_EMBED;
  (o.before || []).forEach(n => body.appendChild(n));
  new Function('window', SRC_HOLDER.src)(win);
  const mutate = () => { st.observers.forEach(cb => cb([])); return tick(); };
  const buttons = () => body.querySelectorAll('a').filter(a => a.id === 'gx-handoff-google');
  return { win, st, body, doc, GX: win.GXHandoff, mutate, buttons };
}
const tick = () => new Promise(r => setTimeout(r, 0));

(async function () {
  console.log('\n1. the app key comes from where the page is served — never guessed');
  {
    const { GX } = boot({ before: [] });
    const at = (host, p) => GX._appFromLocation({ hostname: host, pathname: p });
    const H = 'greencrosscanna.github.io';
    for (const [repo, key] of [['greencross-inventory', 'inventory'], ['greencross-sales', 'sales'],
      ['greencross-leaderboard', 'performance'], ['greencross-crew', 'crew'], ['greencross-spiff', 'spiff'],
      ['greencross-price-cards', 'pricecards'], ['greencross-displayshop', 'displayshop']]) {
      ok(at(H, '/' + repo + '/') === key, repo + ' → ' + key);
    }
    ok(at(H, '/greencross-leaderboard/index.html') === 'performance', 'a page inside the folder maps the same');
    ok(at('script.google.com', '/macros/s/x/exec') === null, "the hub's Command Center (Apps Script) → nothing");
    ok(at('localhost', '/') === null, 'localhost → nothing');
    ok(at(H, '/greencross-portal/') === null && at(H, '/greencross-gx-theme/') === null, 'the portal and gx-theme → nothing');
    ok(at(H, '/constructor/') === null && at(H, '/__proto__/') === null, 'an inherited object key is not an app');
    ok(at('evil.example', '/greencross-inventory/') === null, 'the right folder on another host → nothing');
  }

  console.log('\n2. a signed-out app page: one button, above the password form, to the portal for THIS app');
  {
    const c = loginCard();
    const { buttons, mutate, GX } = boot({ before: [c.wrap] });
    const b = buttons();
    ok(b.length === 1, 'exactly one button');
    ok(b[0] && b[0].getAttribute('href') === PORTAL + 'inventory', 'it goes to the portal with ?open=inventory');
    const kids = c.card.children, note = kids.find(n => n.id === 'gx-handoff-google-note');
    ok(b[0] && note && kids.indexOf(b[0]) + 1 === kids.indexOf(note) && kids.indexOf(note) + 1 === kids.indexOf(c.form),
      'button, then the one-line note, then the form — inside the card');
    ok(b[0] && b[0].className === 'gx-btn gx-btn-green gx-login-submit', "styled as the suite's primary sign-in button");
    ok(b[0] && b[0].textContent === 'Sign in with Google', 'and says what it does');
    ok(note && /Password sign-in is turned off/.test(note.textContent), 'the note says why there is no password box');
    ok(c.form.style.display === 'none' && c.form.getAttribute('aria-hidden') === 'true', 'GOOGLE ONLY: the password form is hidden');
    ok(c.form.parentNode === c.card && c.form.querySelector('input[type="password"]'), '…hidden, not removed, so the app\'s own code still finds it');
    ok(!b[0].getAttribute('target'), 'top-level page: an ordinary link');
    await mutate(); await mutate(); GX._offer(); GX._offer();
    ok(buttons().length === 1, 'repeated checks never add a second');
    const lb = boot({ path: '/greencross-leaderboard/', before: [loginCard().wrap] });
    ok(lb.buttons()[0] && lb.buttons()[0].getAttribute('href') === PORTAL + 'performance', 'Leaderboard sends its real key, performance');
  }

  console.log('\n3. a sign-in form painted later, and repainted on sign-out');
  {
    const t = boot({ path: '/greencross-sales/' });
    ok(t.buttons().length === 0, 'no form yet → nothing');
    const c = loginCard();
    t.body.appendChild(c.wrap);
    await t.mutate();
    ok(t.buttons().length === 1 && t.buttons()[0].getAttribute('href') === PORTAL + 'sales', 'the form appears → the button follows');
    t.body.removeChild(c.wrap);
    await t.mutate();
    ok(t.buttons().length === 0, 'signed in, the screen goes → so does the button');
    t.body.appendChild(loginCard().wrap);
    await t.mutate();
    ok(t.buttons().length === 1, 'signed out again, a fresh form → one button again');
    // An app that repaints ONLY the form, leaving the card (and the button) in place.
    const card = t.body.children[t.body.children.length - 1].children[0];
    const old = card.children.find(n => n.tagName === 'FORM');
    card.removeChild(old);
    const fresh = card.appendChild(el('form', { class: 'gx-login-form' }));
    fresh.appendChild(el('input', { type: 'password' }));
    await t.mutate();
    ok(t.buttons().length === 1 && fresh.style.display === 'none', 'only the form repainted → still one button, and the new form is hidden too');
  }

  console.log('\n4. only the sign-in form, and nothing when there is none');
  {
    ok(boot({ before: [el('div')] }).buttons().length === 0, 'no form on the page → no-op');
    const modal = loginCard({ tag: 'div', formClass: 'signin', wrapClass: 'modal' });
    ok(boot({ before: [modal.wrap] }).buttons().length === 0, 'a password box that is not in a form (SPIFF\'s edit modal) → nothing');
    const change = loginCard({ formClass: 'settings-form', wrapClass: 'settings' });
    ok(boot({ before: [change.wrap] }).buttons().length === 0, 'a change-password form elsewhere in an app → nothing');
    const noPw = el('form', { class: 'gx-login-form' }); noPw.appendChild(el('input', { type: 'text' }));
    ok(boot({ before: [noPw] }).buttons().length === 0, 'a sign-in-styled form with no password box → nothing');
    const inLogin = loginCard({ formClass: '' });
    ok(boot({ before: [inLogin.wrap] }).buttons().length === 1, 'a plain form inside .gx-login still counts');
  }

  console.log('\n5. inside another app it opens the whole window; never on a page that did not ask');
  {
    const top = t => t.buttons().length === 1 && t.buttons()[0].getAttribute('target') === '_top';
    const fr = loginCard();
    const framed = boot({ framed: true, path: '/greencross-spiff/', before: [fr.wrap] });
    ok(top(framed) && framed.buttons()[0].getAttribute('href') === PORTAL + 'spiff', 'framed (SPIFF inside Inventory) → one button, target=_top, its own key');
    ok(fr.form.style.display === 'none', '…and the useless password form is hidden there too');
    ok(top(boot({ search: '?embed=1', path: '/greencross-price-cards/', before: [loginCard().wrap] })), '?embed=1 → target=_top');
    ok(top(boot({ GX_EMBED: true, before: [loginCard().wrap] })), 'window.GX_EMBED = true → target=_top');
    const cc = boot({ host: 'script.google.com', path: '/macros/s/x/exec', before: [loginCard().wrap] });
    ok(cc.buttons().length === 0 && cc.st.observers.length === 0, "the hub's Command Center: nothing, and nothing even watching");
    ok(boot({ host: 'localhost', path: '/', before: [loginCard().wrap] }).buttons().length === 0, 'local dev → nothing');
    const declared = boot({ host: 'localhost', path: '/', dataApp: 'crew', before: [loginCard().wrap] });
    ok(declared.buttons()[0] && declared.buttons()[0].getAttribute('href') === PORTAL + 'crew', 'unless the page names its app (data-gx-app)');
    ok(boot({ host: 'localhost', path: '/', dataApp: 'Crew"><x', before: [loginCard().wrap] }).buttons().length === 0, 'a malformed declared key is refused');
  }

  console.log('\n6. run() and the code path');
  {
    const a = boot({ hash: '#gxcode=' + CODE, before: [loginCard().wrap] });
    ok(a.buttons().length === 0, 'arriving WITH a code → no button while it is traded');
    await a.GX.run({ app: 'inventory', save() {} });
    ok(a.buttons().length === 0 && a.st.reloads === 1, 'a good code → saved and reloaded, no button');
    const b = boot({ hash: '#gxcode=' + CODE, answer: () => Promise.resolve({ ok: false, code: 'invalid_code' }), before: [loginCard().wrap] });
    await b.GX.run({ app: 'inventory', save() {} });
    ok(b.buttons().length === 1, 'a refused code → the person is on the password form, and Google is offered beside it');
    const c = boot({ host: 'localhost', path: '/', before: [loginCard().wrap] });
    const r = await c.GX.run({ app: 'sales', save() { throw new Error('no'); } });
    ok(r === null && c.buttons().length === 1 && c.buttons()[0].getAttribute('href') === PORTAL + 'sales', 'run() with no code names the app → button');
    const d = boot({ host: 'localhost', path: '/', before: [loginCard().wrap] });
    await d.GX.run({ app: 'sales', save() {}, current: () => 'tawny' });
    ok(d.buttons().length === 0, 'run() with no code but someone signed in (current) → nothing');
    const e = boot({ path: '/greencross-crew/', before: [loginCard().wrap] });
    await e.GX.run({ app: 'crew', save() {}, current: () => null });
    ok(e.buttons().length === 1, 'the load-time button and a later run() for the same app → still one');
    const f = boot({ before: [loginCard().wrap] });
    await f.GX.run({ app: '../../evil', save() {} });
    ok(f.buttons()[0] && f.buttons()[0].getAttribute('href') === PORTAL + 'inventory', 'a malformed run() key cannot redirect the button');
  }

  console.log('\n7. the rollback switch: GOOGLE_ONLY = false restores the password form exactly');
  {
    const ORIG = SRC;
    const off = ORIG.replace('var GOOGLE_ONLY = true;', 'var GOOGLE_ONLY = false;');
    ok(off !== ORIG, 'the switch exists, spelled the way the rollback note says');
    const bootOff = (o) => { const prev = SRC_HOLDER.src; SRC_HOLDER.src = off; try { return boot(o); } finally { SRC_HOLDER.src = prev; } };
    const c = loginCard();
    const t = bootOff({ before: [c.wrap] });
    ok(t.buttons().length === 1 && t.buttons()[0].className === 'gx-btn gx-login-submit', 'off: the outline button above the form, as before');
    ok(c.form.style.display !== 'none' && !t.doc.getElementById('gx-handoff-google-note'), 'off: the form is visible and there is no note');
    ok(bootOff({ framed: true, path: '/greencross-spiff/', before: [loginCard().wrap] }).buttons().length === 0, 'off: framed → nothing, as before');
  }

  console.log('\n' + (fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
