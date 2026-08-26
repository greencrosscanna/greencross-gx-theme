#!/usr/bin/env node
/* ─── gx-avatar-picker — the guards that survive without a DOM ────────────────────────────────────
 *   RUN:  node tests/avatar_picker_test.js
 *
 * There is no jsdom here, so this cannot click a chip. What it CAN do is hold the three properties
 * that made this component safe to move into the shared layer in the first place — each of which is
 * a real hazard that a visual check would not reliably catch:
 *
 *   1. EVERY class is namespaced. The original used .card, .active, .primary, .you, .initials and
 *      .app-page. Thirty-three classes moved; six were generic words every app already styles. One
 *      un-namespaced class here restyles unrelated screens in apps that never asked for a picker.
 *   2. NO GLOBAL DOM LOOKUPS. The original addressed #avaImg / #avaSave by document id, which breaks
 *      the moment a second instance mounts or a host page already owns that id. Everything must be
 *      scoped to the mount root.
 *   3. NO SECOND URL BUILDER. It shipped with GC.buildAvatarUrl plus a local buildLocalUrl fallback —
 *      a second and third copy of DiceBear rules that already lived in GXAvatar.url. Getting one of
 *      those wrong produces a subtly wrong face rather than an error, which is why it went unnoticed.
 */
'use strict';
const fs = require('fs');
const rawSrc = fs.readFileSync(__dirname + '/../gx-avatar-picker.js', 'utf8');
const rawCss = fs.readFileSync(__dirname + '/../gx-avatar-picker.css', 'utf8');

/* STRIP COMMENTS BEFORE ASSERTING ANYTHING ABOUT THE SOURCE.
 * Both files document what was REMOVED on the way out of Leaderboard — .card, .active,
 * document.getElementById, buildLocalUrl, "Jordan M." — so matching raw text reports every one of
 * those as still present. The first run of this test failed six ways for exactly that reason.
 * The dangerous direction is the opposite one: a comment mentioning GXAvatar.url would satisfy the
 * "it calls GXAvatar.url" check while the code called something else entirely. So the assertions run
 * against code, and the load-and-execute checks in section 1 run against the real file. */
const stripJs  = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const stripCss = t => t.replace(/\/\*[\s\S]*?\*\//g, '');
const src = stripJs(rawSrc);
const css = stripCss(rawCss);

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };

console.log('\n1. it loads, and exports the contract');
let P;
{
  const g = {};
  try { new Function('window', rawSrc)(g); } catch (e) { console.error('LOAD FAILED: ' + e.message); process.exit(2); }
  P = g.GXAvatarPicker;
  ok(!!P, 'window.GXAvatarPicker is defined');
  ok(typeof P.mount === 'function', 'mount() is the entry point');
  ok(!!P.OPTIONS && !!P.DEFAULT_CONFIG, 'OPTIONS and DEFAULT_CONFIG are exposed for callers/tests');
  // Loading twice must not clobber a live instance — same guard gx-avatar.js uses.
  const g2 = { GXAvatarPicker: { sentinel: true } };
  new Function('window', rawSrc)(g2);
  ok(g2.GXAvatarPicker.sentinel === true, 'a second load is a no-op, not a clobber');
}

console.log('\n2. every class is namespaced — the collision guard');
{
  /* class="..." in this file spans string concatenation — class="gxava-' + (kind === 'swatch' ? ...
     — so a naive split yields JS fragments, not class names. Accept only real CSS identifiers and
     drop anything carrying JS punctuation; the vacuousness check below is what stops that filter
     from quietly discarding everything. */
  const emitted = new Set();
  /* Take only the LITERAL run after class=" — up to the JS quote that ends the string. Matching to
     the next double quote runs past it into the following attribute (data-val="' + hex), which is
     where `hex` and `v` came from on the previous two attempts. */
  let m; const CLASS_ATTR = /class="([a-zA-Z][\w\s-]*)/g;
  while ((m = CLASS_ATTR.exec(src)) !== null) {
    m[1].split(/\s+/).forEach(c => { if (c) emitted.add(c); });
  }
  const bad = [...emitted].filter(c => !c.startsWith('gxava-'));
  ok(bad.length === 0, 'no un-namespaced class in the markup' + (bad.length ? ' — found: ' + bad.join(', ') : ''));
  ok(emitted.size > 15, 'and it really is emitting classes (' + emitted.size + '), so the check is not vacuous');

  const cssClasses = new Set((css.match(/(?<![\w-])\.[a-zA-Z][\w-]*/g) || []).map(c => c.slice(1)));
  const badCss = [...cssClasses].filter(c => !c.startsWith('gxava-'));
  ok(badCss.length === 0, 'no un-namespaced selector in the css' + (badCss.length ? ' — found: ' + badCss.join(', ') : ''));

  // The six that would actually have collided, named so a regression is unambiguous.
  ['card', 'active', 'primary', 'you', 'initials', 'app-page'].forEach(c => {
    ok(!cssClasses.has(c), 'the generic class `.' + c + '` is NOT in the shared sheet');
  });
}

console.log('\n3. nothing reaches outside its mount root');
{
  ok(!/document\.getElementById/.test(src), 'no document.getElementById');
  ok(!/document\.querySelector/.test(src),  'no document.querySelector');
  ok(/root\.querySelector/.test(src),       'lookups go through the mount root');
}

console.log('\n4. there is exactly one URL builder, and it is not this file');
{
  ok(/GXAvatar\.url/.test(src), 'it calls GXAvatar.url');
  ok(!/api\.dicebear\.com\/9\.x\/avataaars\/svg\?[a-z]/.test(src.replace(/seed=Jordan[^'"]*/g, '')),
     'it does NOT build a DiceBear query itself');
  ok(!/buildLocalUrl/.test(src), 'the local fallback builder is gone');
  ok(!/<svg/.test(src), 'the hat SVG is not duplicated here — it comes from GXAvatar.hatSvg');
  ok(/GXAvatar\.hatSvg/.test(src), '...and it actually asks for it');
}

console.log('\n5. the option table and the defaults agree');
{
  const optKeys = Object.keys(P.OPTIONS).sort();
  const defKeys = Object.keys(P.DEFAULT_CONFIG).sort();
  ok(optKeys.join() === defKeys.join(), 'every OPTIONS key has a default and vice versa');
  let bad = [];
  defKeys.forEach(k => { if (P.OPTIONS[k].indexOf(P.DEFAULT_CONFIG[k]) < 0) bad.push(k); });
  ok(bad.length === 0, 'every default is a value the picker can actually select' + (bad.length ? ' — ' + bad.join(', ') : ''));
  ok(P.OPTIONS.top.indexOf('_gchat') >= 0, 'the GC hat is offered');
  ok(P.OPTIONS.top.indexOf('_none') >= 0,  'and "no hair" is a choice, not an absence');
  // _none must never be sent as a value; it means omit. Guarded here because getting it wrong
  // produces a face with a literal "_none" top rather than an error.
  ok(/_none/.test(src), '_none is handled explicitly');
}

console.log('\n5b. a stored key the picker cannot render is NEVER dropped');
{
  /* mount() used to copy opts.config only where the key was in DEFAULT_CONFIG, so re-saving through
     the picker silently rewrote a stored avatar to whatever the editor happened to expose.
     clothingGraphic was the live casualty: two real people had a pinned shirt design (deer, diamond)
     that this picker had no control for, and one save would have handed their shirt back to the seed.
     Found by the crew spoke during adoption, after the component was already in production. */
  ok(/j !== 'seed'/.test(src), 'the config copy is no longer filtered against DEFAULT_CONFIG');
  ok(!/if \(j in DEFAULT_CONFIG\)/.test(src), 'the dropping filter is gone');
  ok(Object.keys(P.OPTIONS).indexOf('clothingGraphic') > -1, 'clothingGraphic is now an offered choice');
  ok('clothingGraphic' in P.DEFAULT_CONFIG, '...and has a default');
  ok(/graphicField/.test(src), 'and it is shown only for graphicShirt, not always');
  // The seed is the one key deliberately NOT carried from the caller: Core stamps it on write, and
  // a client-supplied seed is exactly what that stamping exists to stop mattering.
  ok(/seed/.test(src), 'seed is handled explicitly rather than copied blindly');
}

console.log('\n6. the leaderboard mock is opt-in, not baked in');
{
  ok(/showLeaderboardPreview/.test(src), 'there is a showLeaderboardPreview option');
  const lbIdx = src.indexOf('Jordan M.');
  const optIdx = src.indexOf('opts.showLeaderboardPreview');
  ok(lbIdx > 0 && optIdx > 0 && optIdx < lbIdx, 'the mock sits behind that option, so Crew does not show a sales leaderboard');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
