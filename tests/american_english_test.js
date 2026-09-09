#!/usr/bin/env node
/* ─── THE AMERICAN-ENGLISH GATE ──────────────────────────────────────────────────────────────────
 *   RUN:  node tests/american_english_test.js
 *
 * WHY THE GATE EXISTS, in one sentence: Sky's rule loads at the start of every session and a session
 * still wrote "coloured" into gx-theme.css an hour after reading it, on 2026-09-07, and he caught it
 * on screen rather than a check catching it at push time.
 *
 * WHY THIS TEST EXISTS is the other half. A gate is only worth having if it fires on the thing it was
 * written for AND stays quiet on everything else — this repo has three separate write-ups of gates
 * that reported success while testing nothing. So both directions are asserted here, and the quiet
 * direction gets more cases than the loud one, because a noisy gate is the failure mode that ends
 * with people bypassing it.
 *
 * It runs the REAL script over diffs on stdin. Nothing is reimplemented.
 */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'gx-usenglish.sh');
let pass = 0, fail = 0;
const ok = (msg, cond) => { cond ? (pass++, console.log('  ok   ' + msg)) : (fail++, console.log('  FAIL ' + msg)); };

/* A minimal unified diff with the given ADDED lines, plus a removed line and a context line, so the
   script has to actually distinguish them rather than grepping the whole text. */
function diff(added, removed = [], context = []) {
  return ['diff --git a/f.js b/f.js', '--- a/f.js', '+++ b/f.js', '@@ -1,3 +1,4 @@']
    .concat(context.map(l => ' ' + l), removed.map(l => '-' + l), added.map(l => '+' + l))
    .join('\n');
}
function run(text) {
  try { execFileSync(SCRIPT, ['-'], { input: text, encoding: 'utf8' }); return { code: 0, out: '' }; }
  catch (e) { return { code: e.status, out: String(e.stdout || '') }; }
}

console.log('\n1. it fires on what it was written for');
{
  // The exact line that shipped on 2026-09-07.
  const r = run(diff(['   COLOURED --gx-text-mute, NOT --gx-border-strong. The border token is what dividers use']));
  ok('the real "coloured" line is caught', r.code === 1);
  ok('and it says what to write instead', /"colour" -> "color"/.test(r.out));
  ok('and names the file', /f\.js/.test(r.out));
}
{
  const words = ['behaviour', 'whilst', 'amongst', 'summarise', 'authorised', 'normalising',
                 'prioritise', 'organised', 'recognised', 'analyse', 'centred', 'cancelled',
                 'modelling', 'travelled', 'optimise', 'utilised', 'initialise', 'favour', 'honour'];
  let caught = 0;
  words.forEach(w => { if (run(diff([`// a comment that says ${w} in it`])).code === 1) caught++;
                       else console.log('       missed: ' + w); });
  ok(`every word in the list is caught (${caught}/${words.length})`, caught === words.length);
}

console.log('\n2. it stays quiet — the direction that decides whether anyone keeps it');
{
  ok('an American spelling passes', run(diff(['// the color is normalized and prioritized'])).code === 0);
  // REMOVED lines are somebody deleting British text, which is the good direction.
  ok('a REMOVED British line is not flagged', run(diff([], ['// the colour was wrong'])).code === 0);
  // CONTEXT lines are existing text. Flagging those would demand the mass rewrite Sky ruled out.
  ok('an untouched CONTEXT line is not flagged', run(diff([], [], ['// this colour has been here for months'])).code === 0);
  ok('an empty diff passes', run('').code === 0);
}
{
  // aria-labelledby is a platform attribute. It appears in spiff's index.html today, so a gate that
  // flagged it would fail a real push on its first day.
  const r = run(diff(['    <div role="dialog" aria-labelledby="signInTitle">']));
  ok('aria-labelledby is not mistaken for prose', r.code === 0);
}
{
  /* The words deliberately LEFT OUT, each because it is a real identifier or keyword somewhere in
     this suite. If a later change adds them to the list, these fail and force the noise question to
     be answered on purpose rather than by accident. */
  const allowed = [
    ['grey is a CSS color keyword',         '.x{color:grey}'],
    ['centre appears in store vocabulary',  'const CENTRE_STORE = "Center";'],
    ['licence/defence show up in vendor',   '// see the licence header'],
    ['catalogue is domain language here',   '// measuring the wrong catalogue'],
  ];
  let quiet = 0;
  allowed.forEach(([why, line]) => { if (run(diff([line])).code === 0) quiet++; else console.log('       now flagged: ' + why); });
  ok(`the deliberately-omitted words stay quiet (${quiet}/${allowed.length})`, quiet === allowed.length);
}
{
  /* THE STEM IS NOT THE WORD. Every entry used to be a bare substring test, so "optimis" reported a
     British spelling inside "optimistic" -- which is how it is spelled in American English too. It
     blocked a real push in greencross-crew on 2026-09-08 (the attendance-lag fix, whose test file is
     named tests/incentive_optimistic_test.js) and the author bypassed the whole hook with --no-verify,
     skipping the credential scan and the tests along with it.

     That is the one failure mode this gate cannot survive: every other entry names a word that really
     is British, so obeying the gate improves the text. Here obeying it would have produced
     "optimiztic". A rule a correct author cannot satisfy gets bypassed habitually, and then it is not
     a gate. The same substring shape hid three more, found by sweeping the rest of the list. */
  const correctAmerican = [
    ['optimistic — the live false positive',  '// an optimistic read of the attendance lag'],
    ['optimism / optimist',                   '// cautious optimism from the optimist in the room'],
    ['organism — "organis" is inside it',      '// the suite behaves like a single organism'],
    ['organist',                              '// the organist plays on Sundays'],
    ['apologist',                             '// not an apologist for the old design'],
    ['analyses — American plural of analysis','// the analyses agree'],
  ];
  let quiet = 0;
  correctAmerican.forEach(([why, line]) => { if (run(diff([line])).code === 0) quiet++;
                                             else console.log('       falsely flagged: ' + why); });
  ok(`correct American words containing a British stem are NOT flagged (${quiet}/${correctAmerican.length})`,
     quiet === correctAmerican.length);
}
{
  // The other half of the same change: narrowing the stems must not let the real British forms
  // through. These are the endings that make a stem genuinely British.
  const british = ['optimise', 'optimised', 'optimising', 'optimisation', 'organise', 'organisation',
                   'organisational', 'organiser', 'apologise', 'apologised', 'recognisable',
                   'analysed', 'analysing', 'utilisation', 'initialised', 'fulfilment'];
  let caught = 0;
  british.forEach(w => { if (run(diff([`// a comment that says ${w} in it`])).code === 1) caught++;
                         else console.log('       missed: ' + w); });
  ok(`the real British forms are still caught (${caught}/${british.length})`, caught === british.length);
}
{
  // Case: the word inside a longer identifier. `colourPicker` is a name, not prose — but this check
  // cannot tell, and flagging it is the safer error here because a NEW identifier is still ours to
  // spell correctly. Asserted so the behavior is a decision rather than a surprise.
  ok('a NEW identifier carrying a British word is flagged, deliberately',
     run(diff(['const colourPicker = 1;'])).code === 1);
}

console.log('\n3. the checker and its own test are exempt — a word list is data, not prose');
{
  /* Without this the gate fails on itself the moment anyone edits it, which is how a check gets
     deleted rather than fixed. Named by exact path so the hole stays two files wide. */
  const self = ['diff --git a/gx-usenglish.sh b/gx-usenglish.sh', '--- a/gx-usenglish.sh',
                '+++ b/gx-usenglish.sh', '@@ -1 +1 @@', '+    ("colour", "color"), ("whilst", "while"),'].join('\n');
  ok('the checker itself is not flagged', run(self).code === 0);
  const spec = ['diff --git a/tests/american_english_test.js b/tests/american_english_test.js',
                '--- a/tests/american_english_test.js', '+++ b/tests/american_english_test.js',
                '@@ -1 +1 @@', "+  const words = ['behaviour', 'whilst', 'colour'];"].join('\n');
  ok('its test is not flagged either', run(spec).code === 0);
  // And the exemption must not leak to a file that merely mentions them.
  const other = ['diff --git a/notes.md b/notes.md', '--- a/notes.md', '+++ b/notes.md',
                 '@@ -1 +1 @@', '+the gx-usenglish.sh gate checks for colour'].join('\n');
  ok('a DIFFERENT file naming the checker is still flagged', run(other).code === 1);
}

console.log('\n4. it reports every hit, not just the first');
{
  const r = run(diff(['// colour one', '// behaviour two', '// whilst three']));
  const lines = (r.out.match(/ -> /g) || []).length;
  ok(`all three are listed (${lines})`, lines === 3);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
