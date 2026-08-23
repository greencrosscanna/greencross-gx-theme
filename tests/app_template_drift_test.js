#!/usr/bin/env node
/* ─── gx-app-template.html — drift tests ──────────────────────────────────────────────────────────
 *   RUN:  node tests/app_template_drift_test.js   (also run by theme-preflight.sh)
 *
 * WHY
 * The new-app scaffold used to be a prose code block inside commands/gxappstart.md. Nothing compared
 * it to reality, so it rotted quietly: by 2026-08-22 it still prescribed a direct
 * `<script src=".../gx-dev.js">` tag and an unconditional `window.GX_EMBED = false`, and NEITHER
 * appeared in ANY of the six live apps. A new app built from it started life already needing two
 * migrations everyone else had finished — the exact opposite of "start from the right template".
 *
 * Moving it into gx-app-template.html removes the distance but not the rot. This test is what
 * actually holds: it asserts the template still matches what the shipped apps do, so the next drift
 * fails a push instead of surfacing in a new repo six months later.
 *
 * The sibling-repo checks are SKIPPED, not failed, when the repos aren't checked out next to this one
 * (CI, a fresh clone). A test that can't see the evidence must not claim the evidence agrees.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TPL = fs.readFileSync(path.join(ROOT, 'gx-app-template.html'), 'utf8');

let pass = 0, fail = 0, skip = 0;
const ok   = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };
const skipf = l => { skip++; console.log('  SKIP  ' + l); };

console.log('\n1. the template loads the whole shared layer');
[
  ['gx-theme.css',  /<link rel="stylesheet" href="https:\/\/greencrosscanna\.github\.io\/greencross-gx-theme\/gx-theme\.css">/],
  ['gx-client.js',  /gx-theme\/gx-client\.js/],
  ['gx-topnav.js',  /gx-theme\/gx-topnav\.js/],
  ['gx-stores.js',  /gx-theme\/gx-stores\.js/],
  ['gx-avatar.js',  /gx-theme\/gx-avatar\.js/],
  ['gx-bugreport.js', /gx-theme\/gx-bugreport\.js/],
  ['gc-icon.png (favicon)',      /rel="icon"[^>]*gx-theme\/gc-icon\.png/],
  ['gc-touch-icon.png (iOS)',    /rel="apple-touch-icon"[^>]*gx-theme\/gc-touch-icon\.png/],
  ['gx-logo.png (nav brand)',    /gx-theme\/gx-logo\.png/],
].forEach(([name, re]) => ok(re.test(TPL), 'template references ' + name));

console.log('\n2. the two patterns that already caused production bugs stay fixed');
ok(!/<script\s+src="[^"]*gx-theme\/gx-dev\.js"/.test(TPL),
   'NO direct gx-dev.js <script src> tag (404s on every kiosk load; absent, not inert, on GAS)');
ok(/location\.hostname/.test(TPL) && /createElement\('script'\)/.test(TPL) && /gx-dev\.js/.test(TPL),
   'uses the localhost-only dev-guard injector instead');
ok(!/^\s*window\.GX_EMBED\s*=/m.test(TPL),
   'does NOT set window.GX_EMBED (it beats ?embed=1, so it would double a sub-app\'s header)');

console.log('\n3. the dev-guard injector matches gx-dev-boot.html, its canonical source');
{
  const boot = fs.readFileSync(path.join(ROOT, 'gx-dev-boot.html'), 'utf8');
  const body = s => {
    const m = s.match(/\(function \(\) \{[\s\S]*?\}\)\(\);/);
    return m ? m[0].replace(/\s+/g, ' ').trim() : null;
  };
  const a = body(boot), b = body(TPL);
  ok(a !== null && b !== null && a === b, 'injector IIFE is byte-identical (modulo whitespace) to gx-dev-boot.html');
}

console.log('\n4. placeholders are present and consistent');
['__APP_TITLE__', '__APP_JS__', '__GX_READS__', '__APP_KEY__'].forEach(p =>
  ok(TPL.includes(p), 'placeholder ' + p + ' present'));
ok(/src="__APP_JS__\?v=1"/.test(TPL), 'app script carries the ?v= cache-buster deploy.sh reads');
/* Every new app gets a bug reporter. SPIFF and Crew both shipped without one, and an app with no
   reporter produces no reports — which reads as "no problems", not "no reporter". */
ok(/GXBugReport\.init\(/.test(TPL), 'the template WIRES the reporter, not just loads the script');

console.log('\n5. gxappstart.md fetches the template instead of inlining a scaffold');
{
  const cmd = fs.readFileSync(path.join(ROOT, 'commands', 'gxappstart.md'), 'utf8');
  ok(/curl -fsSL https:\/\/greencrosscanna\.github\.io\/greencross-gx-theme\/gx-app-template\.html/.test(cmd),
     'gxappstart curls gx-app-template.html');
  ok(!/<script src="https:\/\/greencrosscanna\.github\.io\/greencross-gx-theme\/gx-dev\.js"><\/script>/.test(cmd),
     'gxappstart no longer prescribes the direct gx-dev.js tag');
  ok(!/^\s*<script>window\.GX_EMBED = false;<\/script>/m.test(cmd),
     'gxappstart no longer prescribes an unconditional GX_EMBED = false');
}

console.log('\n6. reality check — the live apps agree (skipped when siblings absent)');
{
  const SPOKES = ['greencross-inventory', 'greencross-leaderboard', 'greencross-sales',
                  'greencross-price-cards', 'greencross-spiff', 'greencross-crew'];
  const seen = SPOKES
    .map(r => ({ repo: r, file: path.join(ROOT, '..', r, 'index.html') }))
    .filter(x => fs.existsSync(x.file))
    .map(x => ({ repo: x.repo, html: fs.readFileSync(x.file, 'utf8') }));

  if (!seen.length) { skipf('no sibling app repos checked out — cannot verify against live apps'); }
  else {
    console.log('       (checked: ' + seen.map(s => s.repo.replace('greencross-', '')).join(', ') + ')');
    const none = (re, what) => {
      const bad = seen.filter(s => re.test(s.html)).map(s => s.repo);
      ok(bad.length === 0, 'no live app ' + what + (bad.length ? ' — found in: ' + bad.join(', ') : ''));
    };
    const all = (re, what) => {
      const bad = seen.filter(s => !re.test(s.html)).map(s => s.repo);
      ok(bad.length === 0, 'every live app ' + what + (bad.length ? ' — missing in: ' + bad.join(', ') : ''));
    };
    none(/<script\s+src="https:\/\/greencrosscanna\.github\.io\/greencross-gx-theme\/gx-dev\.js"/,
         'uses the direct gx-dev.js tag (so the template must not either)');
    none(/window\.GX_EMBED\s*=/,
         'sets window.GX_EMBED (so the template must not either)');
    all(/gx-theme\/gc-icon\.png/,        'links the shared favicon (so the template must too)');
    all(/gx-theme\/gc-touch-icon\.png/,  'links the shared apple-touch-icon (so the template must too)');
  }
}

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped');
process.exit(fail ? 1 : 0);
