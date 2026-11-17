#!/usr/bin/env node
/* Every app opens signed in from a portal tile — adoption check.   RUN: node tests/handoff_adoption_test.js
 *
 * gx-handoff.js only works if each app (a) loads it BEFORE anything that reads the address bar — a
 * hash router (Leaderboard), a deep-link reader (Crew's #approve), an update-check reload that keeps
 * the hash — and (b) asks GX Core for ITS OWN app key, so the session it gets is that app's grant.
 * Reads the sibling repos when they are checked out beside this one; an app that is not checked out
 * prints SKIP (the suite's marker), which CI reports as missing coverage.
 *
 * MERGE ORDER: the spokes first, then gx-theme. CI reads each spoke's main, so this is red until they
 * land; an app that loads gx-handoff.js before it is published simply does nothing (it is guarded). */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0, missing = [];
const ok = (c, l) => { c ? (pass++, console.log('  PASS  ' + l)) : (fail++, console.log('  FAIL  ' + l)); };
const SUITE = path.join(__dirname, '..', '..');

// repo → [page, script holding the run() call, app key]
const APPS = [
  ['greencross-inventory',   'index.html', 'index.html',   "'inventory'"],
  ['greencross-sales',       'index.html', 'index.html',   "'sales'"],
  ['greencross-leaderboard', 'index.html', 'index.html',   "'performance'"],
  ['greencross-crew',        'index.html', 'crew.js',      "'crew'"],
  ['greencross-spiff',       'index.html', 'spiff.js',     "'spiff'"],
  ['greencross-price-cards', 'index.html', 'generator.js', 'APP_KEY'],
];

const TAG = '/greencross-gx-theme/gx-handoff.js"></script>';
for (const [repo, page, js, key] of APPS) {
  const dir = path.join(SUITE, repo);
  if (!fs.existsSync(path.join(dir, page))) { missing.push(repo); continue; }
  console.log('\n' + repo);
  const html = fs.readFileSync(path.join(dir, page), 'utf8');
  const src = fs.readFileSync(path.join(dir, js), 'utf8');
  const t = html.indexOf(TAG);
  const firstTheme = html.search(/<script src="https:\/\/greencrosscanna\.github\.io\/greencross-gx-theme\/gx-(?!handoff|dev)[a-z-]+\.js/);
  ok(t > 0, 'loads gx-handoff.js');
  ok(t > 0 && firstTheme > t, 'before every other gx-theme script');
  ok(html.split(TAG).length === 2, 'exactly once');
  const re = new RegExp('GXHandoff\\.run\\(\\{\\s*app: ' + key.replace(/'/g, "'") + ',');
  ok(re.test(src), 'asks for its own app key (' + key + ')');
  ok(/save: /.test(src.slice(src.indexOf('GXHandoff.run('), src.indexOf('GXHandoff.run(') + 600)), 'and saves through its own writer');
}
// The suite's one skip marker (see .github/workflows/tests.yml): CI checks every public spoke out, so
// a SKIP there means a checkout failed and the run is reported as not green.
missing.forEach(r => console.log('  SKIP ' + r + ' is not checked out beside gx-theme — not checked'));
console.log('\n' + (fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
