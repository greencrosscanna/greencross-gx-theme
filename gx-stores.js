/* GX Stores — the store registry, read from GX Core instead of reinvented per app.
 * Canonical source: greencross-gx-theme/gx-stores.js. Synced into every spoke by gx-sync.sh.
 *
 * WHY THIS EXISTS
 * GX Core's `stores` tab is already the single source of truth and already publishes everything an
 * app needs -- including a `color` column -- via ?action=stores. Apps were duplicating it anyway:
 * Leaderboard hardcoded all six store colors as CSS variables, byte-identical to the registry's.
 *
 * THE MAPPING TRAP THIS CLOSES
 * store_id and display_name are NOT the same, and one store proves it: store_id "bend" has
 * display_name "Century". An app that keys anything on the display name (Leaderboard's variable was
 * literally --store-century) silently breaks the day a store is renamed. Everything here is keyed on
 * store_id; display names are strictly for showing to humans. Use resolve() to go from whatever a
 * user typed or a sheet contains back to the canonical id.
 *
 * USAGE
 *   await GXStores.load(GXCORE_EXEC_URL);   // one call, cached; needs GXClient loaded
 *   GXStores.all()                          // [{store_id, display_name, color, short_code, ...}]
 *   GXStores.get('bend')                    // the row
 *   GXStores.color('bend')                  // '#22D3EE'
 *   GXStores.name('bend')                   // 'Century'
 *   GXStores.resolve('Century')             // 'bend'   <- id, display name, or short code
 *   CSS: var(--store-bend)                  // written for every store by load()
 */
(function (global) {
  if (global.GXStores) return;

  var CACHE_KEY = 'gx_stores_v1';
  var TTL_MS    = 6 * 60 * 60 * 1000;   // 6h — the registry changes a few times a year
  var rows = [];
  var byId = {};

  function index() {
    byId = {};
    rows.forEach(function (s) { if (s && s.store_id) byId[String(s.store_id).toLowerCase()] = s; });
  }

  /* Write --store-<store_id> for every store, keyed on the ID. An app should never hardcode a store
     colour again: `background: var(--store-bend)`. */
  function paintVars() {
    if (!global.document) return;
    var root = document.documentElement;
    rows.forEach(function (s) {
      if (s && s.store_id && s.color) root.style.setProperty('--store-' + s.store_id, s.color);
    });
  }

  function readCache() {
    try {
      var raw = global.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var e = JSON.parse(raw);
      if (!e || !e.ts || (Date.now() - e.ts) > TTL_MS) return null;
      return e.rows && e.rows.length ? e.rows : null;
    } catch (e) { return null; }
  }
  function writeCache(r) {
    try { global.localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), rows: r })); } catch (e) {}
  }

  /* Paint from cache immediately, then refresh in the background: a first paint must never wait on
     a network round-trip through GX Core's flaky two-hop /exec. */
  async function load(gxcoreExecUrl, opts) {
    opts = opts || {};
    var cached = opts.noCache ? null : readCache();
    if (cached) { rows = cached; index(); paintVars(); }

    if (!global.GXClient) {
      if (!rows.length) console.warn('[GXStores] GXClient not loaded — cannot reach GX Core.');
      return rows;
    }
    try {
      var r = await global.GXClient(gxcoreExecUrl).jsonp('stores', {});
      if (r && r.ok && r.stores && r.stores.length) {
        rows = r.stores; index(); paintVars(); writeCache(rows);
      }
    } catch (e) {
      console.warn('[GXStores] refresh failed, using ' + (rows.length ? 'cached' : 'no') + ' data:', e.message);
    }
    return rows;
  }

  function get(id) { return byId[String(id || '').toLowerCase()] || null; }

  /* id | display_name | dutchie_name | short_code  ->  canonical store_id. Returns null rather than
     guessing: a wrong store is worse than a missing one.
     AMBIGUITY IS NOT RESOLVED BY PICKING THE FIRST MATCH. The registry currently has TWO stores
     sharing short_code "CEN" -- bend (Century) and center (Center) -- so a first-match resolver would
     silently hand back the wrong store forever. An ambiguous lookup returns null and warns. */
  function resolve(any) {
    var q = String(any == null ? '' : any).trim().toLowerCase();
    if (!q) return null;
    if (byId[q]) return q;
    var hits = {};
    rows.forEach(function (s) {
      ['display_name', 'dutchie_name', 'short_code'].forEach(function (f) {
        if (s[f] && String(s[f]).trim().toLowerCase() === q) hits[s.store_id] = true;
      });
    });
    var ids = Object.keys(hits);
    if (ids.length === 1) return ids[0];
    if (ids.length > 1) {
      console.warn('[GXStores] "' + any + '" is ambiguous across stores [' + ids.join(', ') +
                   '] — refusing to guess. Fix the duplicate in GX Core `stores`.');
    }
    return null;
  }

  global.GXStores = {
    load: load,
    all: function () { return rows.slice(); },
    get: get,
    resolve: resolve,
    color: function (id) { var s = get(id); return (s && s.color) || null; },
    name:  function (id) { var s = get(id); return (s && s.display_name) || null; },
    paintVars: paintVars
  };
})(typeof window !== 'undefined' ? window : this);
