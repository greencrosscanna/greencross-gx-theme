#!/usr/bin/env node
/* ─── GXClient.bootPart — one boot call per page, and never worse than before ─────────────────────
 *   RUN:  node tests/gx_client_bootstrap_test.js
 *
 * WHY THIS EXISTS
 * Four shared files each asked GX Core a rarely-changing question at boot as its own round trip —
 * stores, config, and version_history TWICE. Each costs a browser ~7.3s on the /exec transport while
 * GX Core runs it in under a second (measured 2026-09-17). ?action=bootstrap answers all three, and
 * GXClient.bootPart shares that one request between every file on the page.
 *
 * WHAT MUST HOLD, driven through the REAL jsonp() and a fake <script> element:
 *   §1 every consumer's first ask on one page costs ONE request, and each gets its own route's shape;
 *   §2 a GX Core that does not know `bootstrap` yet ("Unknown action") is a SKIP, so every consumer
 *      falls back to its own route — this is what makes gx-theme safe to ship before the Core deploy;
 *   §3 a part that failed server-side is a skip for THAT part only;
 *   §4 a version_history fetched for another app is a skip — never another app's changelog;
 *   §5 after BOOT_MAX_AGE_MS the memo refuses, so a later poller always sees a change;
 *   §6 a transport failure is NOT a skip — falling back would double the wait on a dead Core;
 *   §7 gx-stores.js end to end: one request serves it, and an old Core still gets it its stores;
 *   §8 the other three consumers route their first ask through bootPart and fall back only on a skip.
 */
'use strict';
const fs = require('fs');
const path = require('path');
global.window = global;
const GXClient = require(path.join(__dirname, '..', 'gx-client.js'));

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };
const BASE = 'https://script.google.com/macros/s/AKfycBOOT/exec';

const STORES = { ok: true, stores: [{ store_id: 'bend', display_name: 'Century' }] };
const CONFIG = { ok: true, config: { 'cfg.maint.all': '' } };
const VH = app => ({ ok: true, app, history: [{ version: 'v1.2' }], releases: [{ version: 'v1.2' }] });

/* server(action, params) -> payload | 'miss'. Records every request sent. */
function install(server) {
  const sent = [];
  global.document = {
    createElement() {
      const el = { remove() {}, onerror: null };
      let _src;
      Object.defineProperty(el, 'src', { get() { return _src; }, set(v) { _src = v; } });
      return el;
    },
    head: {
      appendChild(el) {
        const u = new URL(el.src);
        const action = u.searchParams.get('action');
        const params = Object.fromEntries(u.searchParams.entries());
        sent.push({ action, params });
        const payload = server(action, params);
        setTimeout(() => {
          if (payload === 'miss') { if (el.onerror) el.onerror(); return; }
          const cb = u.searchParams.get('callback');
          if (global[cb]) global[cb](payload);
        }, 2);
      },
    },
  };
  GXClient._bootReset();
  return sent;
}
const modern = (action, p) => {
  if (action === 'bootstrap') return { ok: true, stores: STORES, config: CONFIG, version_history: p.app ? VH(p.app) : null };
  if (action === 'stores') return STORES;
  if (action === 'config') return CONFIG;
  if (action === 'version_history') return VH(p.app);
  return { error: 'Unknown action' };
};
const oldCore = (action, p) => (action === 'bootstrap' ? { error: 'Unknown action' } : modern(action, p));

/* How every consumer uses it: bootPart, and on a skip, its own route. */
function consumer(part, app) {
  const own = () => GXClient(BASE, { retries: 0 }).jsonp(part, app ? { app } : {});
  return GXClient.bootPart(BASE, part, app ? { app } : undefined)
    .catch(e => { if (e && e.gxBootSkip) return own(); throw e; });
}

(async () => {
  console.log('\n§1 four first asks on one page = ONE request');
  {
    const sent = install(modern);
    const [s, c, v1, v2] = await Promise.all([
      consumer('stores'),                          // gx-stores.js knows no app
      consumer('config', 'inventory'),             // gx-maintenance.js
      consumer('version_history', 'inventory'),    // gx-changelog.js
      consumer('version_history', 'inventory'),    // gx-updatecheck.js
    ]);
    ok(sent.length === 1 && sent[0].action === 'bootstrap', 'one request, and it was bootstrap — sent ' + JSON.stringify(sent.map(x => x.action)));
    ok(sent[0].params.app === 'inventory', 'the app named by a later init() in the same tick reached the request');
    ok(JSON.stringify(s) === JSON.stringify(STORES), 'stores got exactly the stores route shape');
    ok(JSON.stringify(c) === JSON.stringify(CONFIG), 'config got exactly the config route shape');
    ok(JSON.stringify(v1) === JSON.stringify(VH('inventory')) && JSON.stringify(v2) === JSON.stringify(v1),
       'both changelog readers got the same version_history, once');
  }

  console.log('\n§2 a GX Core without `bootstrap` — every consumer falls back, nothing breaks');
  {
    const sent = install(oldCore);
    const [s, c, v] = await Promise.all([consumer('stores'), consumer('config', 'crew'), consumer('version_history', 'crew')]);
    ok(s.ok && c.ok && v.ok && v.app === 'crew', 'all three still got their answer');
    const acts = sent.map(x => x.action).sort();
    ok(JSON.stringify(acts) === JSON.stringify(['bootstrap', 'config', 'stores', 'version_history']),
       'one wasted bootstrap ask, then each own route — ' + JSON.stringify(acts));
  }

  console.log('\n§3 a part that failed server-side is a skip for that part only');
  {
    const sent = install((a, p) => a === 'bootstrap'
      ? { ok: true, stores: STORES, config: CONFIG, version_history: { ok: false, error: 'sheet unreadable' } }
      : modern(a, p));
    const [s, v] = await Promise.all([consumer('stores'), consumer('version_history', 'sales')]);
    ok(s.ok && v.ok, 'both answered');
    ok(sent.filter(x => x.action === 'version_history').length === 1 && !sent.some(x => x.action === 'stores'),
       'only the failed part went to its own route');
  }

  console.log('\n§4 a version_history fetched for a different app is never served');
  {
    const sent = install(modern);
    const a = consumer('version_history', 'inventory');
    await a;
    const b = await consumer('version_history', 'pricecards');     // an embedded sub-app asking for its own
    ok(b.app === 'pricecards', 'the second app got ITS OWN changelog, not inventory\'s');
    ok(sent.some(x => x.action === 'version_history' && x.params.app === 'pricecards'), 'via its own route');
  }

  console.log('\n§5 after the one-minute window the memo refuses');
  {
    const sent = install(modern);
    const realNow = Date.now;
    await consumer('config', 'sales');
    Date.now = () => realNow() + 61000;
    try { await consumer('config', 'sales'); } finally { Date.now = realNow; }
    ok(sent.map(x => x.action).join(',') === 'bootstrap,config', 'a late ask went to ?action=config, not the page-load memo');
  }

  console.log('\n§6 a transport failure is NOT a skip');
  {
    const sent = install(() => 'miss');
    let err = null;
    try {
      await GXClient.bootPart(BASE, 'stores').catch(e => { if (e && e.gxBootSkip) throw new Error('skipped'); throw e; });
    } catch (e) { err = e; }
    ok(err && !err.gxBootSkip && err.message !== 'skipped', 'rejected as a failure, so the consumer does not fire a second slow call');
    ok(sent.every(x => x.action === 'bootstrap'), 'and nothing but the boot call (with its normal retries) was sent');
  }

  console.log('\n§7 gx-stores.js end to end');
  for (const [label, server, wantActs] of [['current Core', modern, ['bootstrap']], ['old Core', oldCore, ['bootstrap', 'stores']]]) {
    const sent = install(server);
    const store = {};
    const win = {
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
      document: null, console: { warn() {}, log() {} }, GXClient,
    };
    new Function('window', fs.readFileSync(path.join(__dirname, '..', 'gx-stores.js'), 'utf8'))(win);
    const rows = await win.GXStores.load(BASE, { noCache: true });
    ok(rows.length === 1 && rows[0].display_name === 'Century', label + ': the store list loaded');
    ok(JSON.stringify(sent.map(x => x.action)) === JSON.stringify(wantActs), label + ': requests ' + JSON.stringify(sent.map(x => x.action)));
  }

  console.log('\n§8 the other three consumers ask bootPart first and fall back only on a skip');
  for (const [file, part] of [['gx-maintenance.js', 'config'], ['gx-changelog.js', 'version_history'], ['gx-updatecheck.js', 'version_history']]) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    ok(new RegExp("bootPart\\([^)]*'" + part + "'").test(src), file + ' asks bootPart for ' + part);
    ok(/if \(e && e\.gxBootSkip\) return own\(\); throw e;/.test(src), file + ' falls back only on gxBootSkip');
    ok(/typeof global\.GXClient\.bootPart [!=]== 'function'/.test(src), file + ' still works against an older gx-client');
  }
  for (const file of ['gx-maintenance.js', 'gx-updatecheck.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    ok(/bootAsked = true;/.test(src), file + ' uses the boot call on its FIRST ask only — its pollers keep their own route');
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
