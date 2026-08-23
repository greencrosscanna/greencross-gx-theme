#!/usr/bin/env node
/* gx-dev.js — the blocked-action tally.
 * Regression guard for: a consumer's FALLBACK try/catch swallowed the gate's throw, the fallback
 * served the same numbers from the old path, and the test reported success while the new Core route
 * had never run. The throw alone is not enough when every app has fallbacks by design.
 */
'use strict';
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log('  PASS  ' + l)) : (fail++, console.log('  FAIL  ' + l)); };

// Pretend to be localhost with a DOM stub just rich enough for paint().
const el = () => ({ style: { cssText: '', setProperty(){} }, children: [],
  appendChild(c){ this.children.push(c); }, set innerHTML(v){ this._h = v; this.children = []; },
  get innerHTML(){ return this._h || ''; }, textContent: '', title: '', onclick: null });
const banner = el();
const g = {
  location: { hostname: 'localhost', search: '', protocol: 'http:' },
  document: { body: el(), documentElement: el(), readyState: 'complete',
    createElement: el, getElementById: () => ({ onclick: null }),
    addEventListener(){}, styleSheets: [] },
  addEventListener(){}, localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
  console: { warn(){}, error(){}, log(){} }, fetch: () => Promise.resolve({}),
};
g.window = g; g.self = g; g.top = g;
new Function('window','self','top','global','location','document','localStorage','console','fetch','setTimeout',
  fs.readFileSync(__dirname + '/../gx-dev.js', 'utf8'))
  (g, g, g, g, g.location, g.document, g.localStorage, g.console, g.fetch, (f)=>f);
const D = g.GXDev;

console.log('\n1. the gate still behaves as before');
ok(D.isDev === true, 'detects localhost as dev');
ok(Object.keys(D.blocked()).length === 0, 'nothing blocked before anything is tried');

console.log('\n2. a blocked action is RECORDED, not only thrown');
let threw = false;
try { D.check('published_goals'); } catch (e) { threw = true; }
ok(threw, 'still THROWS — the loud behaviour is unchanged');
ok(D.blocked().published_goals === 1, '...and is now also recorded where a try/catch cannot reach it');

console.log('\n3. this is the exact shape that fooled a real verification');
let served = null;
try { D.check('published_goals'); served = 'core'; }
catch (e) { served = 'fallback'; }           // the app's own fallback chain, swallowing the throw
ok(served === 'fallback', 'a fallback catch makes a blocked call look like a successful one');
ok(D.blocked().published_goals === 2, 'the tally still counted it — this is what a test must assert on');

console.log('\n4. declared reads are unaffected');
D.declareReads(['published_goals']);
let ok2 = false;
try { ok2 = D.check('published_goals'); } catch (e) {}
ok(ok2 === true, 'once declared, the same action passes');
ok(D.blocked().published_goals === 2, 'and passing does not increment the tally');

console.log('\n5. distinct actions are tracked separately, and clearable');
try { D.check('some_other_route'); } catch (e) {}
ok(Object.keys(D.blocked()).sort().join(',') === 'published_goals,some_other_route', 'tracks each action');
D.clearBlocked();
ok(Object.keys(D.blocked()).length === 0, 'clearBlocked() empties it');

console.log('\n6. blocked() hands back a COPY');
try { D.check('x'); } catch (e) {}
const snap = D.blocked(); snap.x = 999;
ok(D.blocked().x === 1, 'mutating the returned object cannot corrupt the tally');

console.log('\n──────────────────────────────');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
