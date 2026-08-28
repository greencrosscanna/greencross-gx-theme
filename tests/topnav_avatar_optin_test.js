#!/usr/bin/env node
/* ─── the Avatar row is OPT-IN — the property that makes this safe to push ────────────────────────
 *   RUN:  node tests/topnav_avatar_optin_test.js
 *
 * WHY THIS TEST EXISTS AT ALL
 * gx-topnav.js is loaded by URL from Pages by seven apps. A change here reaches every one of them
 * inside the ten-minute cache — no deploy, no version pin, no review in between. When the Avatar row
 * was added, three apps had someone actively working in them, and the decision was that each app
 * would adopt it on its own schedule instead of having it appear mid-task.
 *
 * That decision is only honoured if the row is genuinely INERT until an app asks for it. "I designed
 * it to be opt-in" is a claim; this is the check. If a later edit ever makes the row unconditional,
 * it stops being an opt-in component and starts being a change to six live apps at once.
 *
 * The second property matters just as much and is easier to lose: an Avatar row with no way to SAVE
 * opens an editor whose Save button cannot work. That is the SPIFF gear — a control wired to no
 * handler, which looked functional and was not — and gx-topnav.js's own comments cite it as the
 * reason to omit a slot rather than ship a dead one.
 *
 * No jsdom here, so this drives renderUser against a stub just rich enough for it and asserts on the
 * HTML it produces.
 */
'use strict';
const fs = require('fs');

/* Minimal DOM. renderUser sets innerHTML, looks up .gx-user to stash options on, then calls init(),
   which sweeps querySelectorAll('.gx-user') — returning [] there keeps the wiring out of the way of
   what is being measured, which is the MARKUP. */
function makeSlot() {
  const wrap = { __gxAvatarEdit: undefined };
  return {
    innerHTML: '',
    querySelector: sel => (sel === '.gx-user' ? wrap : null),
    querySelectorAll: () => [],
    _wrap: wrap,
  };
}
const documentStub = { addEventListener() {}, querySelectorAll: () => [] };
const globalStub = { document: documentStub, addEventListener() {} };

let T;
try {
  const src = fs.readFileSync(__dirname + '/../gx-topnav.js', 'utf8');
  new Function('window', 'document', src)(globalStub, documentStub);
  T = globalStub.GXTopNav;
} catch (e) { console.error('LOAD FAILED: ' + e.message); process.exit(2); }

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };

const BASE = {
  name: 'Sky Pinnick', role: 'admin', avatar: 'SP',
  items: [
    { action: 'settings', label: 'Settings' },
    { action: 'version', label: 'Version', value: 'v18' },
    { action: 'logout', label: 'Sign out', danger: true },
  ],
};
const render = extra => {
  const slot = makeSlot();
  T.renderUser(slot, Object.assign({}, BASE, extra || {}));
  return slot;
};

console.log('\n1. exports survive');
{
  ok(!!T && typeof T.renderUser === 'function', 'GXTopNav.renderUser is exported');
}

console.log('\n2. WITHOUT avatarEdit the row does not exist — every app that has not opted in');
{
  const slot = render();
  ok(!/data-gx-action="avatar"/.test(slot.innerHTML), 'no Avatar row in the markup');
  ok(!/>Avatar\s/.test(slot.innerHTML), 'and no Avatar label anywhere');
  ok(slot._wrap.__gxAvatarEdit === null, 'nothing stashed for the click handler to act on');
  // The rest of the menu must be untouched: this is the "changes nothing" half of inert.
  ok(/data-gx-action="settings"/.test(slot.innerHTML), 'Settings still renders');
  ok(/data-gx-action="version"/.test(slot.innerHTML), 'Version still renders');
  ok(/data-gx-action="logout"/.test(slot.innerHTML), 'Sign out still renders');
  ok((slot.innerHTML.match(/gx-user-item/g) || []).length === 3, 'exactly the three rows it had before');
}

console.log('\n3. WITH avatarEdit the row appears, above Settings');
{
  const slot = render({ avatarEdit: { token: 't', app: 'inventory' } });
  ok(/data-gx-action="avatar"/.test(slot.innerHTML), 'the Avatar row renders');
  ok(slot.innerHTML.indexOf('data-gx-action="avatar"') <
     slot.innerHTML.indexOf('data-gx-action="settings"'), 'and it sits ABOVE Settings');
  ok((slot.innerHTML.match(/gx-user-item/g) || []).length === 4, 'four rows now');
  ok(slot._wrap.__gxAvatarEdit && slot._wrap.__gxAvatarEdit.token === 't', 'options stashed for the handler');
  ok(slot._wrap.__gxAvatarEdit.app === 'inventory', 'including the app key the grant is re-checked against');
}

console.log('\n4. the name is carried through, so the editor can title itself');
{
  const slot = render({ avatarEdit: { token: 't', app: 'sales' } });
  ok(slot._wrap.__gxAvatarEdit.name === 'Sky Pinnick', "renderUser's name reaches openEditor");
  // An explicit name in avatarEdit must still win — the app knows better than the chip label.
  const s2 = render({ avatarEdit: { token: 't', app: 'sales', name: 'Skyler P.' } });
  ok(s2._wrap.__gxAvatarEdit.name === 'Skyler P.', 'an explicit name overrides it');
}

console.log('\n5. an app that already supplies its own avatar item is not given a second one');
{
  const slot = render({
    avatarEdit: { token: 't', app: 'crew' },
    items: [{ action: 'avatar', label: 'My face' }].concat(BASE.items),
  });
  ok((slot.innerHTML.match(/data-gx-action="avatar"/g) || []).length === 1, 'exactly one Avatar row');
  ok(/>My face\s/.test(slot.innerHTML), "and it is the APP's, label intact");
}

console.log('\n6. the label is overridable without touching this file');
{
  const slot = render({ avatarEdit: { token: 't', app: 'spiff', label: 'Change my face' } });
  ok(/>Change my face\s/.test(slot.innerHTML), 'avatarEdit.label is honoured');
}

console.log('\n7. the source keeps the row conditional — a guard against a "simplifying" edit');
{
  const src = fs.readFileSync(__dirname + '/../gx-topnav.js', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok(/if\s*\(\s*opts\.avatarEdit/.test(src), 'the Avatar row is still added behind an opts.avatarEdit check');
  ok(/wrap\.__gxAvatarEdit\s*&&/.test(src), 'and the click handler still refuses to open without it');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
