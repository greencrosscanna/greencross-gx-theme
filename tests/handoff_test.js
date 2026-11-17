#!/usr/bin/env node
/* gx-handoff.js — the app side of "open from a portal tile signed in".   RUN: node tests/handoff_test.js
 *
 * GX Core does every security check (greencross-command-center tests/handoff_test.js). What can go
 * wrong HERE, each with a case:
 *   - the code is left in the address bar (history, screenshots, a hash router that rewrites it, an
 *     update-check reload that carries it along);
 *   - the code is sent twice (it is single-use: the second can only be refused);
 *   - a refusal writes a session, or leaves no sign-in form;
 *   - the app's session is written anywhere but through the app's own `save`.
 * The real file runs in a stub window. */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log('  PASS  ' + l)) : (fail++, console.log('  FAIL  ' + l)); };
const SRC = fs.readFileSync(path.join(__dirname, '..', 'gx-handoff.js'), 'utf8');
const CODE = 'h1.' + 'Ab9_-'.repeat(8) + 'xyz';   // 43 chars after h1.

function boot(hash, o) {
  o = o || {};
  const st = { replaced: [], reloads: 0, posts: [], body: { children: [] } };
  const els = {};
  const doc = {
    body: { appendChild: el => { els[el.id] = el; el.parentNode = { removeChild: () => { delete els[el.id]; } }; } },
    getElementById: id => els[id] || null,
    createElement: () => ({ style: {}, setAttribute() {}, textContent: '' }),
    addEventListener() {},
  };
  const loc = { hash: hash, pathname: '/greencross-inventory/', search: o.search || '', reload: () => { st.reloads++; } };
  const win = {
    location: loc, document: doc,
    history: { state: { k: 1 }, replaceState: (s, t, u) => { st.replaced.push(u); loc.hash = u.indexOf('#') >= 0 ? u.slice(u.indexOf('#')) : ''; } },
    GXClient: (url, d) => ({ postJSON: (action, body, opts) => { st.posts.push({ url, action, body, opts }); return o.answer ? o.answer(body) : Promise.resolve({ ok: true, user: 'tawny', role: 'editor', token: 'tawny:1:S', expiresAt: 'x' }); } }),
  };
  new Function('window', SRC)(win);
  return { win, st, els, GX: win.GXHandoff };
}
const tick = () => new Promise(r => setTimeout(r, 0));

(async function () {
  console.log('\n1. the code leaves the address bar at load, before the app reads it');
  {
    const { GX, st, win } = boot('#gxcode=' + CODE);
    ok(GX.code === CODE, 'the code is captured');
    ok(st.replaced.length === 1 && st.replaced[0] === '/greencross-inventory/', 'and the URL is rewritten with no fragment at all');
    ok(win.location.hash === '', 'so a hash router or a reload that keeps the hash sees nothing');
    const b = boot('#/director&gxcode=' + CODE, { search: '?v=3' });
    ok(b.GX.code === CODE && b.st.replaced[0] === '/greencross-inventory/?v=3#/director', 'other fragment content and the query string are kept');
    const c = boot('#gxcode=h1.<img src=x>');
    ok(c.GX.code === null && c.st.replaced.length === 1, 'a malformed code is still wiped — and not used');
    const n = boot('#/store/river');
    ok(n.GX.code === null && n.st.replaced.length === 0, 'no code → the address bar is not touched');
  }

  console.log('\n2. a good code: one exchange, saved through the app, then a reload');
  {
    const { GX, st } = boot('#gxcode=' + CODE);
    const saved = [];
    const r = await GX.run({ app: 'inventory', save: p => saved.push(p) });
    ok(st.posts.length === 1 && st.posts[0].action === 'handoff_exchange', 'GX Core handoff_exchange asked once');
    ok(st.posts[0].body.code === CODE && st.posts[0].body.app === 'inventory', 'with this code and THIS app');
    ok(st.posts[0].opts.retries === 0, 'never retried — the code is single-use');
    ok(/script\.google\.com\/macros\/s\/AKfycbx9mjeCBbDpxNYaqBv2hyZaO1hpbGG6PZM9AebFdwl0UwkdtRCGSWrH-8ohEtdF1K_6\/exec$/.test(st.posts[0].url), 'sent to GX Core');
    ok(saved.length === 1 && saved[0].token === 'tawny:1:S' && r && r.user === 'tawny', "the session goes to the app's own save");
    ok(st.reloads === 1, 'then the page reloads to boot signed in through its normal path');
    const again = await GX.run({ app: 'inventory', save: p => saved.push(p) });
    ok(again === null && st.posts.length === 1, 'a second run does nothing — the code is spent on this side too');
  }

  console.log('\n3. already signed in as the same person: refresh the session, no reload');
  {
    const { GX, st } = boot('#gxcode=' + CODE);
    const saved = [];
    await GX.run({ app: 'inventory', save: p => saved.push(p), current: () => 'Tawny' });
    ok(saved.length === 1 && st.reloads === 0, 'saved, not reloaded');
  }

  console.log('\n4. a refusal writes nothing and leaves the sign-in form');
  {
    for (const [label, answer, code] of [
      ['code already used', () => Promise.resolve({ ok: false, code: 'invalid_code', error: 'used' })],
      ['no grant here', () => Promise.resolve({ ok: false, code: 'no_access', error: 'No access to inventory' }), 'no_access'],
      ['GX Core unreachable', () => Promise.reject(new Error('net'))],
      ['an ok with no token', () => Promise.resolve({ ok: true })],
    ]) {
      const { GX, st, els } = boot('#gxcode=' + CODE, { answer });
      const saved = [];
      const r = await GX.run({ app: 'inventory', save: p => saved.push(p) });
      ok(r === null && saved.length === 0 && st.reloads === 0, label + ' → nothing saved, no reload');
      const b = els['gx-handoff-banner'];
      ok(b && (code === 'no_access' ? /access to this app/.test(b.textContent) : /sign in below/.test(b.textContent)), '  …and one plain line says why');
    }
    const s = boot('#gxcode=' + CODE, { answer: () => Promise.resolve({ ok: false, code: 'invalid_code' }) });
    await s.GX.run({ app: 'inventory', save() {}, current: () => 'tawny' });
    await tick();   // the holding line is removed on the next tick
    ok(!s.els['gx-handoff-banner'], 'already signed in here → a spent code is silent');
  }

  console.log('\n5. an app may trade the code through its own backend');
  {
    const { GX, st } = boot('#gxcode=' + CODE);
    let got = null;
    await GX.run({ app: 'performance', save() {}, exchange: c => { got = c; return Promise.resolve({ ok: true, user: 'x', token: 't' }); } });
    ok(got === CODE && st.posts.length === 0, 'the custom exchange gets the code; GX Core is not also called');
  }

  console.log('\n6. no code, no work');
  {
    const { GX, st } = boot('');
    const r = await GX.run({ app: 'inventory', save() { throw new Error('should not run'); } });
    ok(r === null && st.posts.length === 0, 'run() resolves null without a request');
  }

  console.log('\n' + (fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
