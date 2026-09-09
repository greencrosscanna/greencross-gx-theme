#!/usr/bin/env node
/* ─── gx-sync — the executable bit is set at WRITE time, not swept at the end ─────────────────────
 *   RUN:  node tests/sync_mode_at_write_test.js
 *
 * WHY
 * gx-sync writes every file through mktemp+mv, which lands 0600. The chmod that fixed that used to
 * run in a sweep at the END of the script, so between the mv and that sweep every file already
 * fetched was non-executable — and the window was the WHOLE REST OF THE SYNC. Anything that ended
 * the script inside it left them there: a Ctrl-C, a closed terminal, a killed curl, or piping the
 * output to `head` (SIGPIPE). No error, and a transcript that reads as a successful sync.
 *
 * THE COST: `./deploy.sh` exits 126, and whoever hits it works around it with `bash deploy.sh` and
 * moves on. Reported by spiff on 2026-09-09 across eight files at once.
 *
 * IT ALSO EXPLAINS AN INCIDENT THIS PROJECT HAD FILED AS UNSOLVED. gx-sync.sh's own comment recorded
 * gx-preflight.sh, deploy.sh and serve.py coming out 0600 "across four repos" on 2026-08-22 with the
 * cause unconfirmed, guessing at the self-update path or "Dropbox reverting modes asynchronously".
 * Neither. One interrupted run per repo produces exactly that set. A deferred chmod was blamed on
 * the filesystem for two and a half weeks, which is what an unreproducible bug buys you.
 *
 * WHAT IS PINNED, and why it is a source check rather than a live sync: the fix IS the call shape —
 * every executable passes its mode to fetch(), and fetch() applies it before the mv. A live run
 * would need the network and would only prove the happy path, which was never broken.
 *   1. fetch() chmods BEFORE the mv, so a file is never briefly on disk with the wrong mode.
 *   2. Every shell/python file in the fetch list asks for 755. A new executable added without a mode
 *      silently reintroduces the whole bug, and that is the likeliest way this regresses.
 *   3. The end-of-run verification loop still exists — it must stay a CHECK, never the mechanism.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'gx-sync.sh'), 'utf8');
let pass = 0, fail = 0;
const ok = (c, l) => { c ? (pass++, console.log('  PASS  ' + l)) : (fail++, console.log('  FAIL  ' + l)); };

console.log('\n1. fetch() sets the mode before the file lands');
{
  const body = SRC.slice(SRC.indexOf('fetch() {'), SRC.indexOf('\n}', SRC.indexOf('fetch() {')));
  const chmodAt = body.indexOf('chmod');
  const mvAt = body.indexOf('mv "$tmp"');
  ok(chmodAt !== -1, 'fetch() chmods at all');
  ok(mvAt !== -1 && chmodAt < mvAt,
     'and does it BEFORE the mv — after would leave a window, however short');
  ok(/chmod "\$\{3:-\d+\}" "\$tmp"/.test(body),
     'the mode comes from the call site, defaulting for non-executables like .claude/settings.json');
}

console.log('\n2. every executable in the fetch list asks for 755');
{
  const calls = SRC.split('\n').filter(l => /^fetch\s+\S/.test(l));
  ok(calls.length >= 10, 'found the fetch calls (' + calls.length + ')');
  const execish = calls.filter(l => /\.(sh|py|js)\s/.test(l.replace(/^fetch\s+\S+\s+/, 'x ')));
  const missing = execish.filter(l => !/\s755\s/.test(l));
  ok(missing.length === 0,
     'no executable is fetched without a mode' + (missing.length ? ':\n        ' + missing.join('\n        ') : ''));
  // Named individually so a NEW shared executable added without 755 fails here by name.
  ['deploy.sh', 'serve.py', 'serve.js', 'gx-preflight.sh', 'gxengine.sh', 'gxclaim.sh', 'gxdevlogin.sh', 'gx-usenglish.sh']
    .forEach(f => ok(new RegExp('^fetch\\s+' + f.replace('.', '\\.') + '\\s+\\S+\\s+755\\s', 'm').test(SRC),
                     f + ' is fetched 755'));
}

console.log('\n3. the end-of-run loop survives, as a check');
{
  ok(/chmod 755 "\$f"/.test(SRC), 'the verification sweep still chmods defensively');
  ok(/_notexec/.test(SRC), 'and still reports anything that somehow arrives non-executable');
  ok(/stays a check rather than the mechanism|CHECK -- it must not go back to being the mechanism/.test(SRC),
     'and says in the file that it is a check, so it is not "simplified" back into being the fix');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
