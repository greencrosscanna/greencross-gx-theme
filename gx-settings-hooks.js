#!/usr/bin/env node
/* gx-settings-hooks — make sure a repo's .claude/settings.json carries the shared GX hooks.
 *   RUN:  node gx-settings-hooks.js <path/to/.claude/settings.json>
 *
 * gx-sync.sh fetches this to a temp path and runs it; it is not left in the spoke.
 *
 * WHY A MERGE AND NOT A SYNCED FILE. settings.json is per repo on purpose: each repo adds its own
 * permissions and env, and spiff's carries SessionStart + PostToolUse blocks that must survive. Until
 * 2026-11-24 gx-sync only CREATED the file when it was missing and otherwise printed advice, so a new
 * shared hook never reached an existing repo. This ADDS the shared hooks that are missing and touches
 * nothing else: no hook, matcher, permission or key that is already there is changed or removed.
 *
 * Idempotent: a hook is "present" when any command under that event already runs the same script,
 * so a hand-written variant (different flags, a guard in front) is respected, not duplicated.
 * Exit 0 = file is correct (changed or not); prints "added <Event>" per addition. Exit 1 = could not
 * parse or write — the file is left exactly as it was.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// The shared hooks every GX repo carries. `needle` is what counts as already present.
const SHARED = [
  { event: 'SessionStart', command: 'sh .claude/gx-brain-notes.sh', needle: 'gx-brain-notes.sh' },
  { event: 'PostToolUse', matcher: 'Edit|Write', command: 'sh .claude/gx-posttool-tests.sh', needle: 'gx-posttool-tests.sh' },
  // Releases this chat's gxclaim when the chat ends — see gx-session-end.sh.
  { event: 'SessionEnd', command: 'sh .claude/gx-session-end.sh', needle: 'gx-session-end.sh' },
];

function ensure(settings) {
  const added = [];
  if (settings.hooks == null) settings.hooks = {};
  if (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) throw new Error('"hooks" is not an object');
  for (const h of SHARED) {
    const groups = Array.isArray(settings.hooks[h.event]) ? settings.hooks[h.event] : [];
    const present = groups.some(g => Array.isArray(g && g.hooks) && g.hooks.some(x => String(x && x.command || '').includes(h.needle)));
    if (present) continue;
    const group = h.matcher ? { matcher: h.matcher, hooks: [{ type: 'command', command: h.command }] }
                            : { hooks: [{ type: 'command', command: h.command }] };
    settings.hooks[h.event] = groups.concat([group]);
    added.push(h.event);
  }
  return added;
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node gx-settings-hooks.js <settings.json>'); process.exit(1); }
  let settings = {};
  if (fs.existsSync(file)) {
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { console.error('gx-settings-hooks: ' + file + ' is not valid JSON — left untouched (' + e.message + ')'); process.exit(1); }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) { console.error('gx-settings-hooks: ' + file + ' is not a JSON object — left untouched'); process.exit(1); }
  }
  let added;
  try { added = ensure(settings); }
  catch (e) { console.error('gx-settings-hooks: ' + file + ' — ' + e.message + '; left untouched'); process.exit(1); }
  if (!added.length) process.exit(0);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.gxtmp';
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
    fs.renameSync(tmp, file);
  } catch (e) { console.error('gx-settings-hooks: could not write ' + file + ' (' + e.message + ')'); process.exit(1); }
  added.forEach(ev => console.log('added ' + ev));
  process.exit(0);
}

module.exports = { ensure, SHARED };
