#!/usr/bin/env node
/* A synced file must not MENTION gx-sync's keep-local marker — mentioning it pins the file.
 *
 * THE BUG THIS EXISTS FOR, 2026-09-13. gxengine.sh gained a guard that detects a self-deploying
 * spoke by grepping that spoke's deploy.sh for the keep-local marker. Written as a plain literal,
 * the marker was then IN gxengine.sh — and gx-sync decides whether to overwrite a file by grepping
 * THAT FILE for the same literal. So the first sync gave a spoke a copy, and every sync afterwards
 * skipped it as "kept local". Five spokes took that copy within a minute of each other; leaderboard
 * had already missed an update by the time anyone looked.
 *
 * WHAT MAKES IT WORTH A TEST rather than a comment: every symptom reads as success. gx-sync prints
 * "• gxengine.sh (kept local — marked ...)", which is a NORMAL line for a legitimately pinned file,
 * and the shared layer would have frozen in place across the suite while every sync reported clean.
 * A file that stops updating is invisible until you need the update.
 *
 * The fix in the source is to match the marker without containing it (a bracketed character class).
 * This test is what keeps someone from "simplifying" that back.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log('  PASS  ' + label); } else { fail++; console.log('  FAIL  ' + label); } };

/* The files gx-sync.sh fetches into spokes — read from gx-sync.sh itself, never typed here.
   A typed list would go stale the day a file is added, and this test would keep reporting clean. */
const sync = fs.readFileSync(path.join(ROOT, 'gx-sync.sh'), 'utf8');
const synced = [...sync.matchAll(/^fetch\s+(\S+)\s+(\S+)/gm)].map(m => m[1]);
ok(synced.length >= 8, `found the synced file list in gx-sync.sh (${synced.length} files)`);

/* Assembled so THIS file does not trip its own check. */
const MARKER = 'gx-sync:keep' + '-' + 'local';

for (const f of synced) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) { ok(false, `${f} is fetched by gx-sync but missing from gx-theme`); continue; }
  const txt = fs.readFileSync(abs, 'utf8');
  ok(!txt.includes(MARKER),
     `${f} does not contain the keep-local marker (containing it would pin the file in every spoke)`);
}

/* And the mechanism itself must still work: gx-sync has to honour a REAL marker in a spoke's file. */
ok(new RegExp(MARKER).test(sync),
   'gx-sync.sh itself still looks for the marker (it is the one file that must name it)');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
