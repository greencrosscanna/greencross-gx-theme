#!/usr/bin/env node
/* ─── GXStores — a cached registry is served, never discarded for age ─────────────────────────────
 *   RUN:  node tests/stores_cache_fallback_test.js
 *
 * WHY
 * gx-stores.js threw away a perfectly good store registry at the one moment it was needed. Reported
 * by spiff on 2026-09-09 and reproduced against this file: with the fetch failing and the cache older
 * than the 6h TTL, every store rendered as its SLUG — "bend", "river-rd" — instead of Century and
 * River. Four of six stores have a display_name that differs from the store_id, so half a screen
 * named places nobody calls by those names. Any app doing `GXStores.name(id) || id` degraded the
 * same way, which per this file's own header is every spoke.
 *
 * THE SHAPE OF THE MISTAKE, because it is the reusable part: load() attempts a network refresh on
 * EVERY call regardless of cache age. So the TTL never once prevented a stale paint — the fetch would
 * have replaced the rows anyway. Its only reachable effect was to withhold data on a FAILED fetch.
 * A cache expiry is only a safety feature when something reads the cache INSTEAD of refreshing; here
 * nothing ever did, so the expiry was pure downside and looked prudent the whole time.
 *
 * It also got worse the longer GX Core was unwell: writeCache runs only on a successful fetch, so a
 * bad stretch aged the entry out and left nothing to fall back on — the failure became more likely
 * exactly as the thing it protects against became more common.
 *
 * THIS SUITE DRIVES THE REAL FILE. It builds a sandbox with a fake localStorage and a GXClient whose
 * jsonp throws, loads gx-stores.js as source, and asks GXStores what it would render. Asserting on
 * the source text — "there is no TTL comparison" — would pass on a file that never reads the cache
 * at all, and the whole failure was about which of two paths runs when the network is down.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'gx-stores.js');
const HOUR = 60 * 60 * 1000;

let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log('  PASS  ' + l)) : (fail++, console.log('  FAIL  ' + l)); };

// The four stores whose display_name differs from their id are the whole point of the bug.
const STORES = [
  { store_id: 'bend',        display_name: 'Century',    color: '#22D3EE', short_code: 'CEN', aliases: ['Century Dr'] },
  { store_id: 'river-rd',    display_name: 'River',      color: '#34D399', short_code: 'RIV', aliases: [] },
  { store_id: 'portland-rd', display_name: 'Portland',   color: '#F472B6', short_code: 'PDX', aliases: [] },
  { store_id: 'hillsboro',   display_name: 'Baseline',   color: '#FBBF24', short_code: 'BAS', aliases: [] },
  { store_id: 'center',      display_name: 'Center',     color: '#A78BFA', short_code: 'CTR', aliases: [] },
  { store_id: 'commercial',  display_name: 'Commercial', color: '#60A5FA', short_code: 'COM', aliases: ['South'] },
];

/* opts.cachedAgeMs — seed gx_stores_v1 at that age (null = no cache)
   opts.fetch       — 'fail' (throws, the outage case) or rows to return */
function boot(opts) {
  const o = opts || {};
  const store = {};
  if (o.cachedAgeMs !== null && o.cachedAgeMs !== undefined) {
    store['gx_stores_v1'] = JSON.stringify({ ts: Date.now() - o.cachedAgeMs, rows: o.cachedRows || STORES });
  }
  if (o.rawCache !== undefined) store['gx_stores_v1'] = o.rawCache;

  const win = {
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    },
    document: null,   // paintVars() no-ops without one
    console: { warn() {}, log() {} },
    GXClient: () => ({
      jsonp: async () => {
        if (o.fetch === 'fail') throw new Error('two-hop /exec served HTML');
        return { ok: true, stores: o.fetch };
      },
    }),
  };
  new Function('window', 'console', fs.readFileSync(SRC, 'utf8') + '\n;window.__GXStores = window.GXStores;')(win, win.console);
  return { S: win.__GXStores, raw: () => store['gx_stores_v1'] };
}

(async () => {

console.log('\n1. THE BUG — an old cache with the network down must still name the stores');
{
  const t = boot({ cachedAgeMs: 9 * HOUR, fetch: 'fail' });
  await t.S.load('https://example/exec');
  ok(t.S.all().length === 6, 'the six cached stores are served, not discarded for being 9h old');
  ok(t.S.name('bend') === 'Century', 'bend renders as "Century" — before the fix this was "bend"');
  ok(t.S.name('river-rd') === 'River', 'and river-rd as "River"');
  ok(t.S.color('bend') === '#22D3EE', 'colors survive too, so the store palette does not collapse');
  ok(t.S.resolve('Century Dr') === 'bend', 'and resolve() still works, which needs the rows loaded');
}

console.log('\n2. THE BOUNDARY spiff measured — 5.9h worked, 6.1h did not. Both must work now.');
{
  const young = boot({ cachedAgeMs: 5.9 * HOUR, fetch: 'fail' });
  await young.S.load('u');
  ok(young.S.name('bend') === 'Century', '5.9h — was already fine');

  const old = boot({ cachedAgeMs: 6.1 * HOUR, fetch: 'fail' });
  await old.S.load('u');
  ok(old.S.name('bend') === 'Century', '6.1h — this is the exact line the bug fell off');

  // The registry "changes a few times a year", so an old cache is not a wrong one.
  const ancient = boot({ cachedAgeMs: 365 * 24 * HOUR, fetch: 'fail' });
  await ancient.S.load('u');
  ok(ancient.S.name('bend') === 'Century', 'a YEAR old still beats rendering slugs');
}

console.log('\n3. it must not invent data it does not have');
{
  const none = boot({ cachedAgeMs: null, fetch: 'fail' });
  await none.S.load('u');
  ok(none.S.all().length === 0, 'no cache and a failed fetch gives nothing — not stale, EMPTY');
  ok(none.S.name('bend') === null, 'and name() returns null so the app can fall back deliberately');

  const junk = boot({ rawCache: '{not json', fetch: 'fail' });
  await junk.S.load('u');
  ok(junk.S.all().length === 0, 'corrupt cache is treated as no cache, and does not throw');

  const empty = boot({ rawCache: JSON.stringify({ ts: Date.now(), rows: [] }), fetch: 'fail' });
  await empty.S.load('u');
  ok(empty.S.all().length === 0, 'an empty rows array is no cache either');
}

console.log('\n4. a successful fetch still wins — this is stale-while-REVALIDATE');
{
  const renamed = STORES.map(s => (s.store_id === 'bend' ? Object.assign({}, s, { display_name: 'Century Drive' }) : s));
  const t = boot({ cachedAgeMs: 9 * HOUR, fetch: renamed });
  await t.S.load('u');
  ok(t.S.name('bend') === 'Century Drive', 'the network answer replaces the cached one');
  ok(JSON.parse(t.raw()).rows.length === 6, 'and is written back to the cache');
  ok(t.S.cacheAge() === null, 'cacheAge() is null — these rows came from the network this load');
}

console.log('\n5. the age is reported, not used to withhold');
{
  const t = boot({ cachedAgeMs: 9 * HOUR, fetch: 'fail' });
  await t.S.load('u');
  const age = t.S.cacheAge();
  ok(age >= 9 * HOUR - 5000 && age <= 9 * HOUR + 5000, 'cacheAge() reports roughly 9h');
  ok(t.S.isStale() === true, 'isStale() says yes past 6h — so an app CAN caveat the screen');
  ok(t.S.name('bend') === 'Century', '…while still showing real names, which is the whole change');

  const fresh = boot({ cachedAgeMs: 1 * HOUR, fetch: 'fail' });
  await fresh.S.load('u');
  ok(fresh.S.isStale() === false, 'and no at 1h');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
})();
