#!/usr/bin/env node
/* ─── gx-updatecheck — is this tab on a stale build? — tests ─────────────────────────────────────
 *   RUN:  node tests/updatecheck_test.js   (also run by theme-preflight.sh)
 *
 * WHY
 * Lifted out of Sales on 2026-08-27, while it still existed exactly once — the bug form was copied
 * into four apps before anyone shared it, and that cost 63 duplicated CSS rules and three spellings
 * of one action. Sharing it early is the cheap moment; testing it is what makes sharing safe, since
 * a break now reaches five live apps inside the Pages cache.
 *
 * THE TWO THINGS THAT MUST NOT DRIFT
 *   §1 The COMPARATOR. 'v2.9' vs 'v2.10' is the case a string compare gets backwards, and it is not
 *      hypothetical: the suite's build numbers cross digit boundaries constantly. Getting this wrong
 *      means either a permanent nag or permanent silence, and both look like "the feature is broken".
 *   §3 The RELOAD LOOP GUARD. Pages can serve a stale copy for a minute after deploy.sh records the
 *      release, so a reload can come back on the OLD version. Without the `tried` guard the toast
 *      reappears immediately and the user is in a loop they cannot dismiss.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };

// Minimal DOM + storage, enough for the toast path.
function load(opts) {
  const store = {};
  const el = (id) => ({
    id, className: '', textContent: '', innerHTML: '', _cls: new Set(), _listeners: {},
    classList: { add: c => el_cache[id]._cls.add(c), remove: c => el_cache[id]._cls.remove
      ? el_cache[id]._cls.remove(c) : el_cache[id]._cls.delete(c), contains: c => el_cache[id]._cls.has(c) },
    setAttribute() {}, addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    appendChild() {},
  });
  const el_cache = {};
  const mk = (id) => (el_cache[id] = el_cache[id] || el(id));
  const doc = {
    visibilityState: 'visible', _listeners: {},
    createElement: () => { const n = mk('gx-upd'); n.appendChild = () => {}; return n; },
    getElementById: (id) => el_cache[id] || null,
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    body: { appendChild() {} },
  };
  const win = Object.assign({
    document: doc,
    sessionStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    location: { pathname: '/app/', replace(u) { win.__replaced = u; } },
    setTimeout: () => 0,
    console: { warn() {} },
  }, opts || {});
  win.window = win;
  const src = fs.readFileSync(path.join(__dirname, '..', 'gx-updatecheck.js'), 'utf8');
  new Function('window', src + '\n;window.__U = window.GXUpdateCheck;')(win);
  return { U: win.__U, win, store, el_cache, mk, doc };
}

console.log('\n1. the comparator — segment by segment, not string order');
{
  const { U } = load();
  ok(U._newer('v2.10', 'v2.9') === true,  'v2.10 IS newer than v2.9  (a string compare says no)');
  ok(U._newer('v2.9', 'v2.10') === false, '…and not the other way round');
  ok(U._newer('v3.000', 'v2.999') === true, 'a major bump wins over a big build');
  ok(U._newer('v1.284', 'v1.284') === false, 'equal is NOT newer — otherwise it nags forever');
  ok(U._newer('v39', 'v1.284') === true, 'a bare old-scheme v39 still orders sanely (39 > 1)');
  ok(U._newer('', 'v1.0') === false, 'an empty version never claims to be newer');
  ok(JSON.stringify(U._parts('v2.526')) === '[2,526]', 'parts() strips the v and splits');
}

console.log('\n2. the toast says which version you are on');
{
  const { U, mk } = load();
  mk('gx-upd'); mk('gx-upd-txt'); mk('gx-upd-go'); mk('gx-upd-x');
  U.init({ app: 'inventory', gxcore: 'https://x/exec', version: () => 'v3.024' });
  U._show('v3.025');
  const t = mk('gx-upd-txt');
  ok(/v3\.025/.test(t.textContent) && /v3\.024/.test(t.textContent),
     'names BOTH versions — "available" and "you are on"');
}

console.log('\n3. THE LOOP GUARD — a version already tried must not re-prompt');
{
  const { U, mk, store } = load();
  mk('gx-upd'); mk('gx-upd-txt'); mk('gx-upd-go'); mk('gx-upd-x');
  U.init({ app: 'inventory', gxcore: 'https://x/exec', version: () => 'v3.024' });

  store['gx_upd_tried'] = 'v3.025';
  mk('gx-upd-txt').textContent = '';
  U._show('v3.025');
  ok(mk('gx-upd-txt').textContent === '',
     'already TRIED → silent. Pages can serve the old copy for a minute after the record, and without ' +
     'this the toast returns instantly and cannot be escaped');

  delete store['gx_upd_tried'];
  store['gx_upd_dismissed'] = 'v3.025';
  mk('gx-upd-txt').textContent = '';
  U._show('v3.025');
  ok(mk('gx-upd-txt').textContent === '', 'already DISMISSED → stays dismissed');

  store['gx_upd_dismissed'] = 'v3.024';        // a DIFFERENT version
  mk('gx-upd-txt').textContent = '';
  U._show('v3.025');
  ok(/v3\.025/.test(mk('gx-upd-txt').textContent),
     'dismissing one version does not mute the next — that would silence it forever');
}

console.log('\n4. init refuses to run half-configured');
{
  const { U, doc } = load();
  U.init({ app: 'inventory' });                 // no gxcore
  ok(!(doc._listeners.visibilitychange || []).length,
     'no gxcore → nothing is wired, rather than a listener that calls undefined every focus');
}

console.log('\n5. a check without GXClient is a no-op, not a crash');
{
  const { U } = load();                          // no GXClient on the window
  let threw = false;
  try { U.init({ app: 'inventory', gxcore: 'https://x/exec', version: () => 'v1' }); U.check(true); }
  catch (e) { threw = true; }
  ok(!threw, 'gx-client.js may not have arrived yet — this must not throw into the app');
}

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
