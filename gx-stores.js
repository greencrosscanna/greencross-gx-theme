/* GX Stores — the store registry, read from GX Core instead of reinvented per app.
 * Canonical source: greencross-gx-theme/gx-stores.js.
 *
 * NOT synced into spokes by gx-sync.sh -- it is not in that script's fetch list, and never was.
 * Like gx-theme.css and gx-client.js it is loaded BY URL from Pages:
 *     <script src="https://greencrosscanna.github.io/greencross-gx-theme/gx-stores.js"></script>
 * which means an edit here reaches every app on its next load, with no deploy and no review in
 * between. (The header claimed it was synced until 2026-08-22. It matters which: a synced file is
 * pinned per repo until someone re-syncs; this one is not pinned at all.)
 *
 * WHY THIS EXISTS
 * GX Core's `stores` tab is already the single source of truth and already publishes everything an
 * app needs -- including a `color` column -- via ?action=stores. This is the one client for it, so
 * apps do not each write their own.
 *
 * WHAT IT IS NOT: a fix for apps that ignore the registry. As of 2026-08-22 every spoke already
 * reads it -- Inventory via GXCore.getStores() in its proxy, Sales via fetchStoresMeta, Price Cards
 * via loadStores, Crew via loadStores, Leaderboard via GC.loadStoreColors, SPIFF via this file --
 * each keeping a hardcoded table as a first-paint/offline fallback, which is what gx-conventions.md
 * prescribes. What is still duplicated is the OVERLAY CODE: six bespoke implementations of "fetch
 * the registry, merge it over my local table". Consolidating those onto this client is the real
 * remaining win, and it is a refactor of six live apps -- not a doc change. Do it deliberately,
 * with a way to verify each app afterwards.
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
 *   GXStores.resolve('Century Dr')           // 'bend'   <- id, display name, short code, or alias
 *   CSS: var(--store-bend)                  // written for every store by load()
 */
(function (global) {
  if (global.GXStores) return;

  var CACHE_KEY = 'gx_stores_v1';
  /* THERE IS NO EXPIRY ON THE READ, DELIBERATELY. There used to be a 6h TTL and it could only ever
     do harm, which took a while to see: load() attempts a network refresh on EVERY call regardless
     of cache age, so a fresh fetch replaces the cached rows anyway and the TTL never once prevented
     a stale paint. The only thing it could do was throw the rows away at the exact moment they were
     needed — a FAILED fetch — which is the opposite of what this file says it is for two comments
     below ("a first paint must never wait on a network round-trip through GX Core's flaky two-hop
     /exec").
     What that cost, reported by spiff on 2026-09-09 and reproduced against this file: every store
     rendered as its slug — "bend", "river-rd" — instead of Century and River. Four of six stores
     have a display_name that differs from the store_id, so half a screen names places nobody calls
     by those names. Any app doing `GXStores.name(id) || id` degrades identically, which per the
     header is every spoke.
     It also got MORE likely the longer GX Core was unwell: writeCache only runs on a successful
     fetch, so a bad stretch aged the entry out and then there was nothing left to fall back on.
     The age is still available — GXStores.cacheAge() — because "how old is this" is a real question.
     It is now INFORMATION a consumer can act on rather than a verdict this file makes for them. */
  var STALE_MS  = 6 * 60 * 60 * 1000;   // 6h — only what cacheAge()/isStale() report, never a discard
  var rows = [];
  var byId = {};

  function index() {
    byId = {};
    rows.forEach(function (s) { if (s && s.store_id) byId[String(s.store_id).toLowerCase()] = s; });
  }

  /* Write --store-<store_id> for every store, keyed on the ID. An app should never hardcode a store
     color again: `background: var(--store-bend)`. */
  function paintVars() {
    if (!global.document) return;
    var root = document.documentElement;
    rows.forEach(function (s) {
      if (s && s.store_id && s.color) root.style.setProperty('--store-' + s.store_id, s.color);
    });
  }

  var cachedAt = null;             // ts of whatever readCache() last served, for cacheAge()

  function readCache() {
    try {
      var raw = global.localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var e = JSON.parse(raw);
      // Age is recorded, not judged. A year-old registry still beats rendering slugs, and the
      // refresh below replaces it on any successful fetch anyway.
      if (!e || !e.rows || !e.rows.length) return null;
      cachedAt = e.ts || null;
      return e.rows;
    } catch (e) { return null; }
  }
  function writeCache(r) {
    try {
      cachedAt = Date.now();
      global.localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: cachedAt, rows: r }));
    } catch (e) {}
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
        cachedAt = null;   // served from the network this load, so there is no cache age to report
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
      // `aliases` is every name staff or a vendor export actually uses for this store -- the Bend store
      // is called Bend, Century, or Century Dr; the Commercial store is South, Commercial, or
      // Commercial St. GX Core publishes the list so no app has to keep its own.
      (s.aliases || []).forEach(function (a) {
        if (String(a).trim().toLowerCase() === q) hits[s.store_id] = true;
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

  /* How old are the rows in hand, in ms — null when they came from the network this load, or when
     there are none. Exposed because withholding the data was the wrong way to express "this might be
     old": an app that wants to caveat a screen can now do so while still showing real store names. */
  function cacheAge() { return cachedAt === null ? null : Date.now() - cachedAt; }

  global.GXStores = {
    load: load,
    all: function () { return rows.slice(); },
    cacheAge: cacheAge,
    isStale: function () { var a = cacheAge(); return a !== null && a > STALE_MS; },
    get: get,
    resolve: resolve,
    color: function (id) { var s = get(id); return (s && s.color) || null; },
    name:  function (id) { var s = get(id); return (s && s.display_name) || null; },
    paintVars: paintVars
  };
})(typeof window !== 'undefined' ? window : this);
