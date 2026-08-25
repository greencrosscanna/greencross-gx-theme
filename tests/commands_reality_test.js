#!/usr/bin/env node
/* ─── commands/ — reality tests ───────────────────────────────────────────────────────────────────
 *   RUN:  node tests/commands_reality_test.js   (also run by theme-preflight.sh)
 *
 * WHY
 * The shared commands are prose, and prose rots silently. Three separate defects were found in one
 * pass on 2026-08-22, all the same shape — a confident factual claim that nothing compared to the
 * code:
 *
 *   · gxappstart.md  scaffolded a head block using a dev-guard tag and a GX_EMBED flag that NO live
 *                    app uses (fixed separately; pinned by app_template_drift_test.js)
 *   · gxwhatsnext.md listed the app keys as "…(plus future: spiff, incentive, review, heatmap)" —
 *                    `crew` was missing outright, `spiff` had shipped, and the other three have never
 *                    existed. Running /gxwhatsnext inside greencross-crew hit "ask which app this is".
 *   · gxbrain.md     still taught "SPIFF writes spiff_payouts; Performance reads it" — a contract that
 *                    does not exist. It was retracted in the hub's CLAUDE.md and in the SPIFF repo on
 *                    2026-08-22, but the correction never reached the shared command every app chat
 *                    loads, so the invented contract kept being taught.
 *
 * The last one is why this file exists rather than just fixing the three. A retraction that lands in
 * two places out of three is not a retraction. These assertions are the third place.
 *
 * Sibling-repo checks SKIP rather than pass when the repos aren't checked out — a test that cannot see
 * the evidence must not claim the evidence agrees.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CMD = path.join(ROOT, 'commands');
const files = fs.readdirSync(CMD).filter(f => f.endsWith('.md'));
const read = f => fs.readFileSync(path.join(CMD, f), 'utf8');
const ALL = files.map(f => ({ f: f, s: read(f) }));

let pass = 0, fail = 0, skip = 0;
const ok    = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };
const skipf = l => { skip++; console.log('  SKIP  ' + l); };

/* The canonical keys. core-admin is the hub and carries no .gx_app, so it is named here; every other
   key is verified against the repo that claims it below. */
const HUB_KEY = 'core-admin';
const SPOKE_KEYS = ['inventory', 'performance', 'sales', 'pricecards', 'spiff', 'crew'];
const REAL = [HUB_KEY].concat(SPOKE_KEYS);

console.log('\n1. the key list is real (verified against sibling .gx_app files)');
{
  const dir = path.join(ROOT, '..');
  const found = fs.existsSync(dir)
    ? fs.readdirSync(dir)
        .filter(d => d.startsWith('greencross-'))
        .map(d => ({ repo: d, f: path.join(dir, d, '.gx_app') }))
        .filter(x => fs.existsSync(x.f))
        .map(x => ({ repo: x.repo, key: fs.readFileSync(x.f, 'utf8').trim() }))
    : [];
  if (!found.length) skipf('no sibling repos with .gx_app — cannot verify the key list against disk');
  else {
    const onDisk = found.map(x => x.key).sort();
    console.log('       (on disk: ' + found.map(x => x.key + '←' + x.repo.replace('greencross-', '')).join(', ') + ')');
    ok(onDisk.join(',') === SPOKE_KEYS.slice().sort().join(','),
       'the spoke keys this test asserts are exactly the ones on disk');
  }
}

console.log('\n2. no command invents an app key');
{
  // Keys that have appeared in the commands but have never existed as apps.
  const GHOSTS = ['incentive', 'heatmap'];
  GHOSTS.forEach(g => {
    const hits = ALL.filter(x => new RegExp('`' + g + '`').test(x.s)).map(x => x.f);
    ok(hits.length === 0, 'no command names `' + g + '` as an app key' + (hits.length ? ' — in: ' + hits.join(', ') : ''));
  });
}

console.log('\n3. /gxwhatsnext names every real app, so it works in every repo');
{
  const s = read('gxwhatsnext.md');
  REAL.forEach(k => ok(new RegExp('`' + k + '`').test(s), 'gxwhatsnext lists `' + k + '`'));
  ok(!/plus future:/.test(s), 'no stale "plus future:" list (spiff and crew have shipped)');
}

console.log('\n4. spiff_payouts is never claimed as real, anywhere');
{
  /* Naming the tab is FINE — that is how someone who remembers the old claim finds the correction, and
     it is what the hub's CLAUDE.md and SPIFF's Code.gs both do. What must never survive is an
     UNQUALIFIED mention: the name present with no retraction near it reads as documentation of a real
     contract. So the rule is "mentioned ⇒ retracted", not "never mentioned".

     Whitespace is normalized before matching. The first cut of this test missed SPIFF's perfectly good
     retraction because "no such tab\nexists" was line-wrapped in a comment block — a brittle assertion
     that reports a real correction as missing is worse than no assertion, because the fix looks like
     re-writing a correction that was already there. */
  const RETRACTED = /(no such tab exists|does not exist|is not in `?GX_TABS|nothing writes it|do not reach|corrected 2026-08-2[25])/i;
  const flat = t => t.replace(/\s+/g, ' ');
  const check = (label, text) => {
    const t = flat(text);
    if (!/spiff_payouts/.test(t)) { ok(true, label + ' does not mention spiff_payouts'); return; }
    ok(RETRACTED.test(t), label + ' mentions spiff_payouts ONLY alongside an explicit retraction');
  };
  ALL.forEach(x => check('commands/' + x.f, x.s));

  /* The retraction is only trustworthy if every place it landed still agrees — and this list was TWO
     entries long while the claim survived, unqualified, in eight other files. The test passed the whole
     time. That is the worse failure: a guard that reports clean because it is looking somewhere else
     teaches you the problem is solved.
     Found 2026-08-25 by the spiff spoke, which noticed its own CLAUDE.md still asserted the contract as
     real and that this test did not read that file. The list now covers every file in the tree that has
     ever mentioned the tab: both CLAUDE.md layers, all three spoke agent definitions (the highest-
     leverage copy of all — an agent definition is loaded fresh into every session for that repo,
     so a false claim there outlives every doc fix), and the two hub design docs where the fake contract
     was cited as PRECEDENT for a real decision.
     Anything added here must either not mention the tab or mention it beside a retraction. */
  const R = (...p) => path.join(ROOT, '..', ...p);
  const also = [
    ['hub CLAUDE.md',          R('greencross-command-center', 'CLAUDE.md')],
    ['tree CLAUDE.md',         R('CLAUDE.md')],
    ['spiff Code.gs',          R('greencross-spiff', 'apps-script', 'Code.gs')],
    ['spiff CLAUDE.md',        R('greencross-spiff', 'CLAUDE.md')],
    ['leaderboard CLAUDE.md',  R('greencross-leaderboard', 'CLAUDE.md')],
    ['crew CLAUDE.md',         R('greencross-crew', 'CLAUDE.md')],
    ['gx-conventions.md',      R('greencross-command-center', 'gx-conventions.md')],
    ['GX_SALES_GOALS_COUPLING.md', R('greencross-command-center', 'GX_SALES_GOALS_COUPLING.md')],
    ['agent: spiff-spoke',       R('.claude', 'agents', 'spiff-spoke.md')],
    ['agent: leaderboard-spoke', R('.claude', 'agents', 'leaderboard-spoke.md')],
    ['agent: crew-spoke',        R('.claude', 'agents', 'crew-spoke.md')],
  ].filter(([, p]) => fs.existsSync(p));
  if (!also.length) skipf('hub/spiff not checked out — cannot confirm the retraction landed there too');
  else also.forEach(([label, p]) => check(label, fs.readFileSync(p, 'utf8')));
}

console.log('\n5. the ship policy covers every app, so no repo falls through it');
{
  const s = read('_ship-policy.md');
  REAL.forEach(k => ok(new RegExp('`' + k + '`').test(s), 'ship policy names `' + k + '`'));
}

console.log('\n6. partials are included, never pasted');
{
  const partials = files.filter(f => f.startsWith('_'));
  const commands = ALL.filter(x => !x.f.startsWith('_'));
  ok(partials.length > 0, 'partials exist');
  partials.forEach(p => {
    const first = read(p).split('\n').find(l => l.trim().length > 20);
    if (!first) return;
    const needle = first.trim().slice(0, 40);
    const pasted = commands.filter(c => c.s.includes(needle)).map(c => c.f);
    ok(pasted.length === 0,
       p + ' is included, not pasted into a command' + (pasted.length ? ' — pasted in: ' + pasted.join(', ') : ''));
  });
}

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed, ' + skip + ' skipped');
process.exit(fail ? 1 : 0);
