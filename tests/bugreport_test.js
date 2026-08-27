#!/usr/bin/env node
/* ─── gx-bugreport.js — tests ─────────────────────────────────────────────────────────────────────
 *   RUN:  node tests/bugreport_test.js   (also run by theme-preflight.sh)
 *
 * This file replaces four divergent bug reporters with one, so the assertions worth having are the
 * ones about the divergences that actually bit:
 *
 *   · the action name differs per app ('bugreport' / 'reportbug' / 'reportBug') — it MUST stay
 *     configurable, because each app's proxy still spells it its own way and this script cannot
 *     change those without editing four spokes.
 *   · a transport that resolves {ok:false} instead of rejecting must be treated as FAILURE. Inventory
 *     used to show "Bug reported — thanks!" while the report was rejected server-side; gxIngestBug's
 *     title fallback exists because of reports lost exactly that way.
 *   · the snapshot must never be able to break the submit. It reads location, navigator, screen and
 *     an app-supplied callback, any of which can throw in an embedded or locked-down context.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// ── a DOM stub just deep enough for the component's build/open/submit path ──────────────────────
/* The component writes its inner controls with innerHTML, which this stub does not parse. Rather than
   pull in a DOM library, getElementById AUTO-VIVIFIES: the first ask for an id mints an element and
   caches it. The one exception is #gxBugOverlay, which must read as ABSENT until build() appends it —
   build() uses exactly that check to stay idempotent, and a stub that answers too early skips the
   whole listener wiring and makes every later assertion vacuous. (It did, on the first run.) */
function makeDom() {
  const byId = {};
  let overlayAppended = false;

  const mk = (tag) => {
    const n = {
      tagName: String(tag).toUpperCase(), className: '', type: '', title: '', value: '',
      textContent: '', innerHTML: '', hidden: false, disabled: false, children: [],
      _listeners: {}, _attrs: {}, _id: '',
      classList: {
        _s: new Set(),
        add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); },
        toggle(c, on) { if (on === undefined) on = !this._s.has(c); if (on) this._s.add(c); else this._s.delete(c); },
      },
      setAttribute(k, v) { this._attrs[k] = v; if (k === 'id') this.id = v; },
      getAttribute(k) { return this._attrs[k]; },
      appendChild(c) {
        this.children.push(c);
        if (c && c._id === 'gxBugOverlay') overlayAppended = true;
        return c;
      },
      addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
      querySelectorAll() { return []; },
      closest() { return null; },
      focus() {},
    };
    Object.defineProperty(n, 'id', {
      get() { return n._id; },
      set(v) { n._id = v; if (v) byId[v] = n; },
    });
    return n;
  };

  const doc = {
    readyState: 'complete',
    _listeners: {},
    createElement: mk,
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    getElementById(id) {
      if (id === 'gxBugOverlay' && !overlayAppended) return null;
      if (!byId[id]) { const n = mk('div'); n.id = id; }
      return byId[id];
    },
  };
  doc.body = mk('body');
  return { doc, byId, mk };
}

function load(overrides) {
  const { doc, byId } = makeDom();
  const win = Object.assign({
    document: doc,
    location: { href: 'https://greencrosscanna.github.io/greencross-inventory/?tab=stock' },
    navigator: { userAgent: 'TestUA/1.0', onLine: true },
    screen: { width: 1920, height: 1080 },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2,
    addEventListener() {},
    setTimeout: (fn) => { void fn; return 0; },   // never auto-close during a test
    console: { warn() {} },
  }, overrides || {});
  win.window = win;
  const src = fs.readFileSync(path.join(__dirname, '..', 'gx-bugreport.js'), 'utf8');
  new Function('window', src + '\n;window.__GXB = window.GXBugReport;')(win);
  return { GXB: win.__GXB, doc, byId, win };
}

/* Fire the click the component wired up. Throws loudly if nothing is bound — silence here would mean
   every submit assertion below passes for the wrong reason. */
function click(doc, id) {
  const el = doc.getElementById(id);
  const fns = el && el._listeners && el._listeners.click;
  if (!fns || !fns.length) throw new Error('no click listener bound on #' + id + ' — build() did not wire it');
  fns.forEach(fn => fn({ target: el }));
}

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };
const tick = () => new Promise(r => setImmediate(r));

(async function () {

console.log('\n1. the snapshot captures state, and cannot break the form');
{
  const { GXB } = load();
  GXB.init({ app: 'inventory', submit: () => ({ ok: true }) });
  const s = GXB.snapshot();
  ok(s.viewport === '1280x720@2x', 'viewport captured with pixel ratio');
  ok(s.screen === '1920x1080', 'screen captured');
  ok(/greencross-inventory/.test(s.url), 'url captured');
  ok(s.ua === 'TestUA/1.0', 'user agent captured');
  ok(s.online === true, 'online flag captured');
}
{
  // A backgrounded / not-yet-laid-out window reports 0. Observed live in the gx-theme preview.
  const { GXB } = load({ innerWidth: 0, innerHeight: 0, screen: { width: 0, height: 0 } });
  GXB.init({ app: 'inventory', submit: () => ({ ok: true }) });
  const s = GXB.snapshot();
  ok(!('viewport' in s), 'a 0-width window omits viewport rather than filing "0x0"');
  ok(!('screen' in s), 'same for screen — an absent field is honest, a wrong one is not');
  ok('ua' in s, 'the rest of the snapshot is unaffected');
}
{
  // Everything the snapshot reads, throwing at once.
  const boom = { get href() { throw new Error('x'); } };
  const { GXB } = load({ location: boom, navigator: null, screen: null });
  GXB.init({ app: 'inventory', submit: () => ({ ok: true }) });
  let s = null, threw = false;
  try { s = GXB.snapshot(); } catch (e) { threw = true; }
  ok(!threw && s && typeof s === 'object', 'snapshot survives every source throwing');
}
{
  const { GXB } = load();
  GXB.init({ app: 'inventory', submit: () => ({ ok: true }), context: () => { throw new Error('app blew up'); } });
  const s = GXB.snapshot();
  ok(/app blew up/.test(s.contextError || ''), "an app's context callback throwing is recorded, not fatal");
}
{
  const { GXB } = load();
  GXB.init({ app: 'inventory', submit: () => ({ ok: true }), context: () => ({ tab: 'stock', store: 'river-rd', blank: '' }) });
  const s = GXB.snapshot();
  ok(s.tab === 'stock' && s.store === 'river-rd', 'app-specific context is merged in');
  ok(!('blank' in s), 'empty context values are dropped rather than filed as empty columns');
}

console.log('\n2. console errors ride along as breadcrumbs, capped');
{
  const { GXB } = load();
  GXB.init({ app: 'inventory', submit: () => ({ ok: true }) });
  ok(!('errors' in GXB.snapshot()), 'no errors key when nothing has gone wrong');
  GXB._push('first', 'a.js', 1);
  GXB._push('second', 'b.js', 2);
  GXB._push('third', 'c.js', 3);
  GXB._push('fourth', 'd.js', 4);
  const e = GXB.snapshot().errors;
  ok(e.length === 3, 'capped at 3 — a breadcrumb, not a log');
  ok(e[0] === 'second @b.js:2' && e[2] === 'fourth @d.js:4', 'keeps the most RECENT three, in order');
}

console.log('\n3. the action name stays per-app (three spellings are live today)');
{
  for (const [app, action] of [['inventory', 'bugreport'], ['sales', 'reportbug'], ['pricecards', 'reportBug']]) {
    const { GXB, doc } = load();
    let sent = null;
    GXB.init({ app: app, action: action, submit: p => { sent = p; return { ok: true }; } });
    GXB.open();
    doc.getElementById('gxBugTitle').value = 'it broke';
    click(doc, 'gxBugSubmit');
    await tick();
    ok(sent && sent.action === action, app + " sends its own action name '" + action + "'");
  }
}
{
  const { GXB, doc } = load();
  let sent = null;
  GXB.init({ app: 'crew', submit: p => { sent = p; return { ok: true }; } });
  GXB.open();
  doc.getElementById('gxBugTitle').value = 'x';
  click(doc, 'gxBugSubmit');
  await tick();
  ok(sent.action === 'bugreport', "defaults to 'bugreport' when an app names none");
}

console.log('\n4. the payload carries what GX Core reads');
{
  const { GXB, doc } = load();
  let sent = null;
  GXB.init({
    app: 'inventory', submit: p => { sent = p; return { ok: true }; },
    reporter: () => 'dean', version: () => 'v3.4.1', context: () => ({ tab: 'orders' }),
  });
  GXB.open();
  doc.getElementById('gxBugTitle').value = 'Store filter sticks';
  doc.getElementById('gxBugDesc').value = 'picks Bend every time';
  click(doc, 'gxBugSubmit');
  await tick();
  ok(sent.title === 'Store filter sticks', 'title');
  ok(sent.desc === 'picks Bend every time', 'desc');
  ok(sent.reporter === 'dean' && sent.appVer === 'v3.4.1', 'reporter + version from the app callbacks');
  ok(sent.priority === 'normal', "priority defaults to 'normal' — the value GX Core stores, not 'medium'");
  ok(typeof sent.context === 'string' && JSON.parse(sent.context).tab === 'orders',
     'context is a JSON STRING (it has to survive a query string)');
}
{
  const { GXB, doc } = load();
  let called = false;
  GXB.init({ app: 'inventory', submit: () => { called = true; return { ok: true }; } });
  GXB.open();
  doc.getElementById('gxBugTitle').value = '   ';
  click(doc, 'gxBugSubmit');
  await tick();
  ok(!called, 'a blank title does not submit');
  ok(/what went wrong/i.test(doc.getElementById('gxBugStatus').textContent), 'and says so');
}

console.log('\n5. a failed send is never reported as success');
{
  // The bug this assertion exists for: a transport that RESOLVES with {ok:false}.
  const { GXB, doc } = load();
  GXB.init({ app: 'inventory', submit: () => ({ ok: false, error: 'title or detail required' }) });
  GXB.open();
  doc.getElementById('gxBugTitle').value = 'x';
  click(doc, 'gxBugSubmit');
  await tick(); await tick();
  ok(doc.getElementById('gxBugSuccess').hidden === true, '{ok:false} does NOT show the success panel');
  ok(/could not send/i.test(doc.getElementById('gxBugStatus').textContent), 'it shows an error');
  ok(doc.getElementById('gxBugSubmit').disabled === false, 'and re-enables Submit so it can be retried');
}
{
  const { GXB, doc } = load();
  GXB.init({ app: 'inventory', submit: () => Promise.reject(new Error('network')) });
  GXB.open();
  doc.getElementById('gxBugTitle').value = 'x';
  click(doc, 'gxBugSubmit');
  await tick(); await tick();
  ok(doc.getElementById('gxBugSuccess').hidden === true, 'a rejected promise does not show success either');
}
{
  const { GXB, doc } = load();
  GXB.init({ app: 'inventory', submit: () => ({ ok: true, id: 'bug_1' }) });
  GXB.open();
  doc.getElementById('gxBugTitle').value = 'x';
  click(doc, 'gxBugSubmit');
  await tick(); await tick();
  ok(doc.getElementById('gxBugSuccess').hidden === false, 'a real success DOES show the success panel');
}
{
  const { GXB, doc } = load();
  GXB.init({ app: 'inventory' });   // no submit configured
  GXB.open();
  doc.getElementById('gxBugTitle').value = 'x';
  click(doc, 'gxBugSubmit');
  await tick();
  ok(/not configured/i.test(doc.getElementById('gxBugStatus').textContent),
     'an app that forgot to wire submit says so instead of silently doing nothing');
}


/* ── the screenshot field (added 2026-08-26) ────────────────────────────────────────────────────
   The rule that matters is OPT-IN: an app that has not supplied uploadShot must see exactly the form
   it saw before. Five live apps load this file from Pages inside a 10-minute cache, so a field that
   appeared everywhere the moment this shipped would be a change nobody asked for in four of them. */
console.log('\nS1. the field is opt-in');
{
  const { GXB, doc } = load();
  GXB.init({ app: 'inventory', submit: () => ({ ok: true }) });
  GXB.open();
  // Asserted on the MARKUP, not on the stub's element: this DOM stub does not parse innerHTML, so an
  // auto-vivified node reports hidden:false regardless of what the template says. Checking the string
  // is what actually proves the field ships hidden.
  ok(/id="gxBugShotWrap" hidden/.test(doc.getElementById('gxBugOverlay').innerHTML),
     'no uploadShot → the screenshot field is rendered hidden');
  ok(!(doc.getElementById('gxBugShotPick')._listeners || {}).click,
     'and nothing is wired — an app that ignored this release is untouched');
}
{
  const { GXB, doc } = load();
  GXB.init({ app: 'inventory', submit: () => ({ ok: true }), uploadShot: () => ({ ok: true, url: 'u' }) });
  GXB.open();
  ok(doc.getElementById('gxBugShotWrap').hidden === false, 'with uploadShot → the field renders');
  ok(((doc.getElementById('gxBugShotPick')._listeners || {}).click || []).length === 1, 'the picker is wired');
  ok(((doc._listeners || {}).paste || []).length === 1,
     'paste is bound on the DOCUMENT — nobody focuses a box before hitting Cmd-V');
}

console.log('\nS2. the image goes up FIRST, and only its URL joins the payload');
{
  const order = [];
  let sent = null;
  const { GXB, doc, win } = load();
  win.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  GXB.init({
    app: 'inventory',
    submit: p => { order.push('submit'); sent = p; return { ok: true, id: 'bug_9' }; },
    uploadShot: f => { order.push('upload'); return Promise.resolve({ ok: true, url: 'https://drive/FILE' }); },
  });
  GXB.open();
  doc.getElementById('gxBugTitle').value = 'it broke';
  // Drive setShot through the picker's own change listener, so this exercises the real wiring.
  const file = doc.getElementById('gxBugShotFile');
  file.files = [{ name: 'shot.png', type: 'image/png', size: 2048 }];
  (file._listeners.change || []).forEach(fn => fn());
  click(doc, 'gxBugSubmit');
  await tick(); await tick(); await tick();
  ok(order.join(',') === 'upload,submit', 'upload runs BEFORE submit, never in parallel');
  ok(sent && sent.screenshot_url === 'https://drive/FILE',
     'the payload carries only the URL — a base64 would not survive Sales\' GET transport');
  ok(sent && !sent.screenshot, 'and no raw image is in the payload');
}

console.log('\nS3. a failed upload does not silently file a report without the picture');
{
  let submitted = false;
  const { GXB, doc, win } = load();
  win.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  GXB.init({
    app: 'inventory',
    submit: () => { submitted = true; return { ok: true }; },
    uploadShot: () => Promise.resolve({ ok: false, error: 'over 10MB' }),
  });
  GXB.open();
  doc.getElementById('gxBugTitle').value = 'it broke';
  const file = doc.getElementById('gxBugShotFile');
  file.files = [{ name: 'shot.png', type: 'image/png', size: 2048 }];
  (file._listeners.change || []).forEach(fn => fn());
  click(doc, 'gxBugSubmit');
  await tick(); await tick(); await tick();
  ok(submitted === false, 'the report is NOT sent when the upload was refused');
  ok(/10MB|upload/i.test(doc.getElementById('gxBugStatus').textContent || ''),
     'and the reason is shown rather than swallowed');
}

console.log('\nS4. no image attached → unchanged behaviour');
{
  let sent = null, uploads = 0;
  const { GXB, doc } = load();
  GXB.init({
    app: 'inventory',
    submit: p => { sent = p; return { ok: true }; },
    uploadShot: () => { uploads++; return { ok: true, url: 'u' }; },
  });
  GXB.open();
  doc.getElementById('gxBugTitle').value = 'no picture';
  click(doc, 'gxBugSubmit');
  await tick(); await tick();
  ok(uploads === 0, 'uploadShot is not called when nothing was attached');
  ok(sent && !sent.screenshot_url, 'and no screenshot_url is added');
}

console.log('\nS5. gxCoreUploader hands the app\'s OWN token to GX Core');
{
  const calls = [];
  const { GXB, win } = load();
  win.GXClient = function (url) {
    calls.push(['client', url]);
    return { postJSON: (action, payload, opts) => { calls.push(['post', action, payload, opts]); return { ok: true, url: 'https://drive/X' }; } };
  };
  win.FileReader = function () {
    this.readAsDataURL = () => { this.result = 'data:image/png;base64,QUJD'; this.onload(); };
  };
  const up = GXB.gxCoreUploader('https://gxcore/exec', () => 'sky:123:sig');
  const r = await up({ name: 'a.png', type: 'image/png' });
  ok(r.ok === true && r.url === 'https://drive/X', 'it resolves the Drive url');
  const post = calls.find(c => c[0] === 'post');
  ok(post && post[1] === 'bug_shot', 'it calls the bug_shot route');
  ok(post && post[2].token === 'sky:123:sig',
     'with the token the APP supplied — auth still comes from the app session, as cfg.submit does');
  ok(post && post[2].data === 'QUJD', 'and the base64 has its data: prefix stripped');
  ok(post && post[3] && post[3].retries === 2,
     'retries are opted into explicitly — postJSON defaults to none for writes');
}

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
