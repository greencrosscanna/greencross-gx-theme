#!/usr/bin/env node
/* ─── every call says which app it came from ─────────────────────────────────────────────────────
 *   RUN:  node tests/gx_client_app_attribution_test.js   (also run by gx-preflight.sh)
 *
 * WHY THIS EXISTS
 * GX Core counts traffic per app from an `app=` parameter, and that parameter was OPT-IN AT EVERY
 * CALL SITE. Measured on the live cockpit 2026-09-16, the first day the execution-load panel carried
 * real traffic: 653 of 870 calls — 80.6% of execution time — arrived unattributed. Across the suite
 * roughly one call site in five passed it (leaderboard 21 of ~116, spiff 29 of ~104, crew 12 of ~68).
 *
 * So the panel's "which app is loudest" ranking was sorting the fifth that volunteered a name, and
 * "Leaderboard 14.5%" meant 14.5% of the labeled fifth rather than of the load. That ranking exists
 * to answer one question — whether Leaderboard should move off the 30-execution ceiling every GX app
 * shares — and it could not answer it.
 *
 * The fix is one line per app instead of one per call site: the client reads `data-app` off its own
 * <script> tag. These tests pin the three properties that decide whether that is safe to put in the
 * shared layer, which reaches every app inside the 10-minute Pages cache with no deploy and no review.
 */
'use strict';
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };
const BASE = 'https://script.google.com/macros/s/AKfycTEST/exec';
const SRC = path.join(__dirname, '..', 'gx-client.js');

/* The identity is read from document.currentScript AT LOAD TIME — that is the only moment it is
   valid — so each case must load the module fresh with a different fake document in place. */
function loadWith(dataApp) {
  global.window = global;
  global.document = (dataApp === undefined) ? undefined : {
    currentScript: { getAttribute: (k) => (k === 'data-app' ? dataApp : null) },
  };
  delete require.cache[require.resolve(SRC)];
  const GXClient = require(SRC);
  delete global.document;
  return GXClient;
}
const appParam = (url) => new URL(url).searchParams.get('app');

console.log('\n1. THE INCIDENT: a call now carries the app without the call site saying so');
{
  const C = loadWith('performance');
  const c = new C(BASE);
  ok(appParam(c.buildUrl('storetoday', { store: 'river' })) === 'performance',
     'a plain call is labeled from the script tag — no call site changed');
  ok(c.app === 'performance', 'and the client reports what it is calling itself');
}

console.log('\n2. ABSENT THE ATTRIBUTE, NOTHING MOVES — this is what makes it safe to ship shared');
{
  const C = loadWith(null);            // script tag present, no data-app
  const c = new C(BASE);
  const url = c.buildUrl('storetoday', { store: 'river' });
  ok(appParam(url) === null, 'no attribute means no app parameter at all, exactly as before');
  ok(c.app === '', 'and the client admits it does not know');

  const C2 = loadWith(undefined);      // no document at all (node, a worker, an inlined copy)
  const c2 = new C2(BASE);
  ok(appParam(c2.buildUrl('health')) === null, 'no document is survivable, not a throw');
}

console.log('\n3. AN EXPLICIT app STILL WINS — a call made on another app\'s behalf keeps saying so');
{
  /* version_history is asked for BY app. If the tag silently overwrote that, the cockpit would
     report every such call as the asking app and the answer would be for the wrong one. */
  const C = loadWith('core-admin');
  const c = new C(BASE);
  ok(appParam(c.buildUrl('version_history', { app: 'inventory' })) === 'inventory',
     'params.app beats the script tag');
  ok(appParam(c.buildUrl('version_history', {})) === 'core-admin',
     'and the tag still applies when the caller says nothing');

  const c2 = new C(BASE, { app: 'spiff' });
  ok(c2.app === 'spiff', 'defaults.app beats the tag, so two clients on one page can differ');
  ok(appParam(c2.buildUrl('stores', { app: 'crew' })) === 'crew', 'and params still beat that');
}

console.log('\n4. the value is normalized, because a label that varies is a label that splits');
{
  const C = loadWith('  PERFORMANCE  ');
  ok(new C(BASE).app === 'performance',
     'whitespace and case are normalized — "Performance" and "performance" must not become two rows');
}

console.log('\n5. it is not derived from the page URL, and the comment says why');
{
  /* greencross-leaderboard is app key `performance`. Deriving from the URL needs a hardcoded table,
     and a table that rots mislabels traffic — worse than not labeling it. Pin the absence. */
  const src = fs.readFileSync(SRC, 'utf8');
  ok(!/location\.(pathname|href)[^\n]*app/i.test(src),
     'the app key is never guessed from the page URL');
  ok(/performance/.test(src) && /not derivable/i.test(src),
     'and the reason is written down where the next reader will look');
}

console.log('\n6. the parameter goes on BEFORE params, so the override in §3 is structural');
{
  /* If app were set after params, params.app could never win and §3 would pass only by luck of
     ordering inside a loop. This pins the order in the source rather than the outcome alone. */
  const src = fs.readFileSync(SRC, 'utf8');
  const fn = src.slice(src.indexOf('function buildUrl'), src.indexOf('function jsonpOnce'));
  ok(fn.indexOf("u.searchParams.set('app', APP)") < fn.indexOf('if (params)'),
     'app is set before params are applied, so an explicit app overwrites it');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
