#!/usr/bin/env node
/* ─── gx-maintenance — the "out back" gate — tests ────────────────────────────────────────────────
 *   RUN:  node tests/maintenance_test.js   (also run by theme-preflight.sh)
 *
 * WHY THIS FILE IS WORTH MORE THAN THE FEATURE LOOKS LIKE IT IS WORTH
 * This module can take every app in the suite dark from one JSON file on a CDN. It is the only piece
 * of the shared layer whose SUCCESS state is "the app is unusable", which inverts the usual risk: a
 * bug here does not degrade a feature, it manufactures the outage it was built to explain.
 *
 * So §2 is the one that matters. Every path that cannot answer "is it down?" must answer "it is up".
 * A 404 on the flag file, a Pages hiccup, malformed JSON, GX Core timing out — none of them may gate.
 * The failure this guards against is not theoretical: the flag is fetched on EVERY page load of
 * EVERY app, so a fail-closed default would turn one bad minute of GitHub's CDN into a suite-wide
 * outage with no bad deploy behind it and nothing in version_history to point at.
 *
 * §5 pins the copy. It reads as fussy for a joke page, but "Fatty" is a product name and the capital
 * F is the difference between a brand reference and something else entirely — the kind of edit a
 * later pass makes while "fixing a typo", on a screen nobody reviews because nobody sees it.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'gx-maintenance.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };

/* ── A DOM stub just deep enough for render()/teardown() ────────────────────────────────────────
   Nodes built from innerHTML are registered by scanning the markup for id="…", so getElementById
   finds the buttons and the timer slots the way a real parser would. Without that, render() wires
   listeners to null and every behavioural test below passes vacuously. */
function load(opts) {
  opts = opts || {};
  const byId = {};
  const reg = (n) => {
    if (n.id) byId[n.id] = n;
    const m = String(n._html || '').match(/id="([^"]+)"/g) || [];
    m.forEach((s) => {
      const id = s.slice(4, -1);
      if (!byId[id]) byId[id] = node('span', id);
    });
  };
  const unreg = (n) => { if (n.id) delete byId[n.id]; };

  function node(tag, id) {
    return {
      tagName: tag, id: id || '', className: '', textContent: '', _html: '',
      style: {}, children: [], attrs: {}, inert: false, parentNode: null, _l: {},
      get innerHTML() { return this._html; },
      set innerHTML(v) { this._html = v; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      hasAttribute(k) { return k in this.attrs; },
      removeAttribute(k) { delete this.attrs[k]; },
      addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
      click() { (this._l.click || []).forEach((f) => f()); },
      appendChild(c) { c.parentNode = this; this.children.push(c); reg(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; unreg(c); return c; },
      focus() {},
    };
  }

  const doc = {
    title: 'App', _l: {},
    documentElement: node('html'),
    head: node('head'),
    body: node('body'),
    createElement: (t) => node(t),
    getElementById: (id) => byId[id] || null,
    addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
  };

  const store = {};
  const intervals = [];
  const win = Object.assign({
    document: doc,
    sessionStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
    },
    location: { href: 'https://greencrosscanna.github.io/app/', pathname: '/app/', hash: '',
                replace(u) { win.__replaced = u; } },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    clearInterval: (id) => { if (id) intervals[id - 1] = null; },
    console: { warn() {} },
  }, opts);
  win.window = win;
  new Function('window', SRC + '\n;window.__M = window.GXMaintenance;')(win);
  return { M: win.__M, win, doc, byId, store, intervals };
}

const fetchOK = (body) => () => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const fetch404 = () => () => Promise.resolve({ ok: false, json: () => Promise.reject(new Error('no')) });
const fetchBoom = () => () => Promise.reject(new Error('network'));

(async function main() {

  console.log('\n1. flag parsing — a kv value is TEXT, and every spelling of true must gate');
  {
    const { M } = load();
    /* This list is GXCore.gxTruthy_'s list, verbatim. The two halves of this feature read the SAME
       kv cell, so a value either side accepts alone is a value they disagree about — and nothing on
       either screen would show you which one the store is getting. */
    [true, 'true', 'TRUE', ' True ', '1', 'yes', 'active'].forEach((v) => {
      ok(M._truthy(v), JSON.stringify(v) + ' reads as ON');
    });
    [false, 'false', '0', 'no', 'off', 'on', '', null, undefined, 'maybe'].forEach((v) => {
      ok(!M._truthy(v), JSON.stringify(v) + ' reads as OFF');
    });
    // Pinned against the real thing next door, not just asserted here.
    const core = __dirname + '/../../greencross-command-center/gx_core.gs';
    if (require('fs').existsSync(core)) {
      const m = require('fs').readFileSync(core, 'utf8').match(/function gxTruthy_[\s\S]{0,220}?\n\}/);
      const words = (m ? m[0].match(/s === '([a-z0-9]+)'/g) || [] : []).map(x => x.slice(7, -1)).sort();
      ok(words.join(',') === 'true,1,yes,active'.split(',').sort().join(','),
         'and it still matches GXCore.gxTruthy_ next door (' + words.join('/') + ')');
    } else {
      console.log('  SKIP  the hub is not checked out beside this repo — cannot pin against gxTruthy_');
    }
    // The object form is how Master Control ships `since` and custom lines through one kv cell.
    ok(M._parseKv('{"on":true,"since":"2026-08-28T09:00:00Z"}') !== null, 'JSON kv value with on:true gates');
    ok(M._parseKv('{"on":false}') === null, 'JSON kv value with on:false does NOT gate');
    ok(M._parseKv('{"since":"2026-08-28"}') !== null, 'JSON kv value without `on` defaults to ON (it was set for a reason)');
    ok(M._parseKv('{not json') === null, 'malformed JSON in kv does NOT gate');
    ok(M._parseKv('') === null && M._parseKv(null) === null, 'an empty kv cell does NOT gate');
  }

  console.log('\n2. FAIL SAFE — anything that cannot answer "is it down?" must answer "it is up"');
  {
    for (const [label, f] of [['a 404 on the flag file', fetch404()], ['a network error', fetchBoom()]]) {
      const { M } = load({ fetch: f });
      M.init({ app: 'inventory' });
      await new Promise((r) => setTimeout(r, 0));
      ok(!M.isGated(), label + ' does NOT gate the app');
    }
    {
      const { M } = load({ fetch: fetchOK(null) });
      M.init({ app: 'inventory' });
      await new Promise((r) => setTimeout(r, 0));
      ok(!M.isGated(), 'an empty flag body does NOT gate the app');
    }
    {
      // GX Core being down is the SCENARIO, not an error: the Pages flag still answers.
      const { M } = load({
        fetch: fetchOK({ all: true }),
        GXClient: () => ({ jsonp: () => Promise.reject(new Error('core down')) }),
      });
      M.init({ app: 'inventory', gxcore: 'https://script.google.com/x/exec' });
      await new Promise((r) => setTimeout(r, 0));
      ok(M.isGated(), 'the Pages flag still gates when GX Core is unreachable — the whole point of two sources');
    }
    {
      const { M } = load({
        fetch: fetch404(),
        GXClient: () => ({ jsonp: () => Promise.resolve({ ok: true, config: { 'cfg.maint.inventory': 'true' } }) }),
      });
      M.init({ app: 'inventory', gxcore: 'https://script.google.com/x/exec' });
      await new Promise((r) => setTimeout(r, 0));
      ok(M.isGated(), 'the kv flag gates on its own when the Pages file is missing');
    }
  }

  console.log('\n3. scope — `all` covers the suite, an app entry covers one app, and only that one');
  {
    const mk = async (body, app) => {
      const { M } = load({ fetch: fetchOK(body) });
      M.init({ app });
      await new Promise((r) => setTimeout(r, 0));
      return M.isGated();
    };
    ok(await mk({ all: true, apps: {} }, 'sales'), 'all:true gates an app with no entry of its own');
    ok(await mk({ all: false, apps: { sales: true } }, 'sales'), 'apps.sales gates sales');
    ok(!(await mk({ all: false, apps: { sales: true } }, 'inventory')), 'apps.sales does NOT gate inventory');
    ok(!(await mk({ all: false, apps: {} }, 'sales')), 'the shipped default gates nothing');
    ok(await mk({ all: false, apps: { performance: { on: true } } }, 'performance'),
       'the object form gates (this is how `since` and custom lines arrive)');
    ok(!(await mk({ all: true, apps: { crew: { on: false } } }, 'crew')),
       'an explicit on:false for one app overrides all:true — the way to keep one app up mid-outage');
    ok(!(await mk({ all: true, apps: { crew: false } }, 'crew')),
       'the bare `false` form does too');

    // Same rule on the kv side, keyed on non-empty rather than on presence: clearing a Master
    // Control toggle blanks the cell, it does not delete the row.
    const kv = async (config, app) => {
      const { M } = load({ fetch: fetch404(), GXClient: () => ({ jsonp: () => Promise.resolve({ ok: true, config }) }) });
      M.init({ app, gxcore: 'https://script.google.com/x/exec' });
      await new Promise((r) => setTimeout(r, 0));
      return M.isGated();
    };
    ok(await kv({ 'cfg.maint.all': 'true' }, 'sales'), 'cfg.maint.all gates an app with no key of its own');
    ok(!(await kv({ 'cfg.maint.all': 'true', 'cfg.maint.sales': 'false' }, 'sales')),
       'cfg.maint.sales=false holds sales up through a cfg.maint.all outage');
    ok(await kv({ 'cfg.maint.all': 'true', 'cfg.maint.sales': '  ' }, 'sales'),
       'a BLANK cfg.maint.sales is "no opinion", not "false" — kv cannot tell empty from absent');
  }

  console.log('\n4. the down-timer is seeded from `since`, so a refresh does not restart the clock');
  {
    const { M } = load();
    const ago = new Date(Date.now() - 3 * 60 * 1000 - 5000).toISOString();
    M._seed({ since: ago });
    ok(/^down 03:0[45]$/.test(M._elapsed()), 'a `since` 3m05s ago reads "down 03:05" (got ' + M._elapsed() + ')');
    M._seed({});
    ok(M._elapsed() === 'down 00:00', 'no `since` starts at 00:00');
    M._seed({ since: 'not a date' });
    ok(M._elapsed() === 'down 00:00', 'an unparseable `since` falls back to now rather than to NaN');
    // Dates are TEXT in this suite and a long outage is exactly when someone reads this label.
    M._seed({ since: new Date(Date.now() - 3 * 3600 * 1000 - 4 * 60 * 1000).toISOString() });
    ok(/^down 3:04:0\d$/.test(M._elapsed()), 'past an hour it rolls to H:MM:SS rather than "down 184:0x" (got ' + M._elapsed() + ')');
  }

  console.log('\n5. the copy is the handoff\'s, verbatim');
  {
    ok(SRC.indexOf("It must be 4:20 — the Tech Team is out back smokin' a Fatty.") > 0,
       'headline matches, em dash included');
    ok(/smokin' a Fatty\./.test(SRC) && !/smokin' a fatty/.test(SRC),
       'Fatty keeps its capital F — it is a product name, not an adjective');
    ok(SRC.indexOf('Nothing you did caused this and nothing you typed was lost.') > 0,
       'the reassurance line survives (it is the only sentence a store user actually needs)');
    ok(SRC.indexOf('BRB. — Green Cross Tech') > 0, 'sign-off matches');
    ok(SRC.indexOf("Check if they're back") > 0 && SRC.indexOf('Poke the tech team') > 0,
       'both action labels match');
  }

  console.log('\n6. escalation goes to Sky, and there is no tech@ to go to');
  {
    ok(SRC.indexOf('sky@greencrosscanna.com') > 0, 'escalation address is sky@greencrosscanna.com');
    ok(SRC.indexOf('tech@greencrosscanna.com') < 0,
       'the handoff\'s tech@greencrosscanna.com is GONE — that mailbox does not exist, so the prototype\'s link went nowhere');
    ok(/GXBugReport[\s\S]{0,200}\.open\(\)/.test(SRC),
       '"Poke" opens the shared bug reporter first; mailto is only the fallback');
    ok(/gxBugOverlay[\s\S]{0,900}zIndex\s*=\s*'10100'/.test(SRC),
       'the bug overlay is raised above the gate — at its usual 300 it would open INVISIBLY behind it');
  }

  console.log('\n7. stacking — the gate outranks the login screen, on purpose');
  {
    const { M } = load();
    const css = M._styles();
    ok(/\.gx-maint\{[^}]*z-index:10000/.test(css), 'the gate is z-index 10000');

    /* Checked against the DOCUMENTED ladder, not against a `.gx-login{…z-index}` rule — there isn't
       one. gx-theme.css only ships .gx-login's layout; the 9999 belongs to each app's own login
       overlay (leaderboard/index.html, inventory/index.html), so a selector-scoped regex here finds
       nothing and a loose one runs past the closing brace and matches the NEXT rule's z-index. It
       did: an earlier version of this test "passed" by reading .gx-cl-overlay's 1000 and calling it
       the login gate, which would have let a 5000 through as beating a 9999. */
    const ladder = fs.readFileSync(path.join(ROOT, 'gx-theme.css'), 'utf8');
    const top = ladder.match(/^\s*(\d+)\s+\.gx-login\s/m);
    ok(!!top, 'gx-theme.css still documents the shared stacking ladder');
    ok(top && Number(top[1]) === 9999 && 10000 > Number(top[1]),
       'the gate beats .gx-login (' + (top ? top[1] : '?') + ') — being told the app is down should not require signing in first');
    const highest = (ladder.match(/z-index:\s*(\d+)/g) || [])
      .map(s => Number(s.replace(/\D/g, ''))).reduce((a, b) => Math.max(a, b), 0);
    ok(highest < 10000, 'and beats every z-index actually set in gx-theme.css (highest is ' + highest + ')');
    ok(/prefers-reduced-motion:reduce/.test(css), 'reduced motion is honoured (the smoke is the point of that query)');
    ok(/@media \(max-width:520px\)/.test(css) && /font-size:64px/.test(css),
       'the 108px clock is clamped on a phone');
  }

  console.log('\n8. the escape hatch survives the retry button\'s reload');
  {
    const { M, store } = load({
      fetch: fetchOK({ all: true }),
      location: { href: 'https://x/app/?gxmaint=off', pathname: '/app/', hash: '', replace() {} },
    });
    M.init({ app: 'inventory' });
    await new Promise((r) => setTimeout(r, 0));
    ok(!M.isGated(), '?gxmaint=off bypasses a live flag');
    ok(store.gx_maint_override === 'off',
       'and is remembered for the session — otherwise the reload strips the param and re-gates you');
    const { M: M2 } = load({ fetch: fetchOK({ all: false, apps: {} }) });
    M2.init({ app: 'inventory' });
    await new Promise((r) => setTimeout(r, 0));
    ok(!M2.isGated(), 'no override and no flag: the app is up');
  }

  console.log('\n9. it renders, then tears itself back down when the flag clears');
  {
    let body = { all: true, apps: {} };
    const { M, doc, byId } = load({ fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(body) }) });
    M.init({ app: 'performance', appName: 'Leaderboard' });
    await new Promise((r) => setTimeout(r, 0));
    ok(M.isGated() && !!byId['gx-maint'], 'the gate mounts');
    ok(!!doc.getElementById('gx-maint-css'), 'its stylesheet is injected on activation, not shipped in gx-theme.css');
    ok(doc.title === 'BRB — Green Cross', 'the tab title says so too');
    ok(byId['gx-maint'].innerHTML.indexOf('Leaderboard') > 0, 'appName is used for the meta label');
    ok((byId['gx-maint'].innerHTML.match(/gx-maint-rad/g) || []).length === 8, 'all 8 smoke plumes are present');

    body = { all: false, apps: {} };
    await M.check(true);
    ok(!M.isGated(), 'clearing the flag un-gates it with nobody clicking — a kiosk has nobody to click');
    ok(!byId['gx-maint'], 'the node is removed');
    ok(!doc.getElementById('gx-maint-css'), 'and so is the stylesheet');
    ok(doc.title === 'App', 'the tab title is restored, not left saying BRB');
  }

  console.log('\n10. the shipped flag file and the template wiring');
  {
    const raw = fs.readFileSync(path.join(ROOT, 'gx-maintenance.json'), 'utf8');
    let flag = null;
    try { flag = JSON.parse(raw); } catch (e) {}
    ok(!!flag, 'gx-maintenance.json is valid JSON (it is fetched by every app on every load)');
    ok(flag && flag.all === false, 'it ships with all:false');
    ok(flag && flag.apps && Object.keys(flag.apps).length === 0, 'and no app gated');
    ok(!!(flag && flag._readme), 'it carries its own instructions — it will be edited under pressure, at speed');

    const TPL = fs.readFileSync(path.join(ROOT, 'gx-app-template.html'), 'utf8');
    ok(/gx-theme\/gx-maintenance\.js/.test(TPL), 'the template loads gx-maintenance.js');
    ok(/GXMaintenance\.init\(/.test(TPL), 'and initialises it');
    ok(/GXMaintenance\.init\(\{[\s\S]{0,200}app:\s*'__APP_KEY__'/.test(TPL), 'passing the app key placeholder');
  }

  console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
