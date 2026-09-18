#!/usr/bin/env node
/* ─── gx-bugreport.js must not file a credential ─────────────────────────────────────────────────
 *   RUN:  node tests/bugreport_secret_redaction_test.js
 *
 * WHAT THIS GUARDS. Everything the reporter captures is written down TWICE: mailed to Sky in the
 * unfiled-bug notice, and stored in GX Core's bug_reports tab where it is read back later by people
 * who are not thinking about secrets. Until 2026-09-17 two of the captured fields were raw.
 *
 * THE PATH, traced by the pricecards session on 2026-09-17. An app that puts its session token in
 * the QUERY STRING — Price Cards' generator does, deliberately, with a comment accepting that it
 * lands in browser history — can throw a load error whose `filename` IS that signed URL. push()
 * kept `String(file).split('/').pop()` with no length cap, so the whole query string went into the
 * breadcrumb with the token intact. `location.href` had the same exposure through snapshot().
 *
 * CONFIDENCE, stated the way it was reported: mechanism traced, NOT reproduced. gx-client's own
 * rejections name the action and never the URL, and Chrome and Firefox say "Failed to fetch" with no
 * URL at all; the realistic case is Safari on the shop iPads. That is a reason to fix it at the
 * capture, which is here, rather than in the one spoke that noticed.
 *
 * WHY THE TESTS BELOW DRIVE THE REAL LISTENER rather than calling a helper: the redaction is only
 * worth anything at the point where the browser hands us a string. A unit test of redact() would
 * stay green if push() stopped calling it, which is the mistake this suite has made before.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };

const SRC = fs.readFileSync(path.join(__dirname, '..', 'gx-bugreport.js'), 'utf8');

// A token shaped like the real ones, and distinctive enough that finding it anywhere is proof.
const TOKEN = 'SKY.1758000000.abcdef0123456789deadbeef';
const SIGNED_URL = 'https://script.google.com/macros/s/AKfycbx/exec?action=grid&store=river-rd&token=' + TOKEN;

/* The component writes its controls with innerHTML, so ids auto-vivify — the same approach as
   tests/bugreport_test.js, kept deliberately small here because this file never opens the modal. */
function load(href, src) {
  const byId = {};
  /* #gxBugOverlay must read as ABSENT until build() appends it: build() uses exactly that check to
     stay idempotent, so a stub that auto-vivifies it makes build() skip all its listener wiring and
     every assertion below pass for the wrong reason. (It did, on the first run of this file.) */
  let overlayAppended = false;
  const mk = (tag) => {
    const n = { tagName: String(tag).toUpperCase(), className: '', value: '', textContent: '',
      innerHTML: '', hidden: false, disabled: false, children: [], _listeners: {}, _attrs: {}, _id: '',
      classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
        contains(c) { return this._s.has(c); }, toggle() {} },
      setAttribute(k, v) { this._attrs[k] = v; if (k === 'id') this.id = v; },
      getAttribute(k) { return this._attrs[k]; },
      appendChild(c) { this.children.push(c); if (c && c._id === 'gxBugOverlay') overlayAppended = true; return c; },
      addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
      querySelectorAll() { return []; }, closest() { return null; }, focus() {} };
    Object.defineProperty(n, 'id', { get() { return n._id; }, set(v) { n._id = v; if (v) byId[v] = n; } });
    return n;
  };
  const doc = { readyState: 'complete', _listeners: {}, createElement: mk,
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    getElementById(id) {
      if (id === 'gxBugOverlay' && !overlayAppended) return null;
      if (!byId[id]) { const n = mk('div'); n.id = id; }
      return byId[id];
    } };
  doc.body = mk('body');

  const winListeners = {};
  const win = {
    document: doc,
    location: { href: href },
    navigator: { userAgent: 'TestUA/1.0', onLine: true },
    screen: { width: 1920, height: 1080 },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 2,
    addEventListener(t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); },
    setTimeout: (fn) => { void fn; return 0; },
    console: { warn() {} },
  };
  win.window = win;
  new Function('window', (src || SRC) + '\n;window.__GXB = window.GXBugReport;')(win);
  return { GXB: win.__GXB, doc, byId, win, winListeners };
}

// Fire the real 'error' listener the component registered. Loud if it registered none — silence
// would make every assertion below pass for the wrong reason.
function throwAt(ctx, message, filename, lineno) {
  const fns = ctx.winListeners.error;
  if (!fns || !fns.length) throw new Error('gx-bugreport registered no window error listener');
  fns.forEach(fn => fn({ message: message, filename: filename, lineno: lineno }));
}

// init() is what registers the error listener, so it has to run BEFORE the page throws — which is
// also the real order: the reporter is wired at boot and the error happens later.
function arm(ctx) {
  ctx._sent = null;
  ctx.GXB.init({ app: 'pricecards', submit: (p) => { ctx._sent = p; return Promise.resolve({ ok: true }); } });
  return ctx;
}

// Submit a report and hand back the captured payload. ASYNC: submit() resolves the screenshot
// uploader first and only then calls cfg.submit, so the payload does not exist until the
// microtask queue drains. Reading it synchronously returns null and reads as "nothing was sent".
const tick = () => new Promise(r => setImmediate(r));
async function fileReport(ctx) {
  ctx.GXB.open();
  ctx.doc.getElementById('gxBugTitle').value = 'the grid will not load';
  ctx.doc.getElementById('gxBugDesc').value = 'it just spins';
  const btn = ctx.doc.getElementById('gxBugSubmit');
  const clicks = btn._listeners && btn._listeners.click;
  if (!clicks || !clicks.length) throw new Error('no submit listener bound — build() did not wire it');
  clicks.forEach(fn => fn({ target: btn }));
  await tick(); await tick(); await tick();
  return ctx._sent;
}

(async function () {

  console.log('gx-bugreport — a captured credential never reaches the report');

  // ── 1. the breadcrumb: a load error whose FILENAME is a signed URL ──────────────────────────────
  {
    const ctx = arm(load('https://greencrosscanna.github.io/greencross-price-cards/'));
    throwAt(ctx, 'Failed to load resource: the server responded with a status of 500', SIGNED_URL, 12);
    const sent = await fileReport(ctx);
    ok(sent && typeof sent.context === 'string', 'the report still carries its context blob');
    ok(sent.context.indexOf(TOKEN) === -1,
       'the session token does NOT survive in the error breadcrumb');
    ok(/redacted/.test(sent.context), 'it was redacted rather than dropped — the report still says a token was there');
    ok(/action=grid/.test(sent.context),
       'the non-secret query parameters survive, so the breadcrumb is still diagnostic');
  }

  // ── 2. the page address itself ──────────────────────────────────────────────────────────────────
  // Price Cards reads with the token in the query string, so location.href carries it on every page.
  {
    const ctx = arm(load(SIGNED_URL));
    const sent = await fileReport(ctx);
    ok(sent.context.indexOf(TOKEN) === -1, 'the session token does NOT survive in the captured page address');
  }

  // ── 3. redaction happens BEFORE the length cap ──────────────────────────────────────────────────
  // o.url slices to 300 characters. A token sitting at character 280 would otherwise survive the cut.
  {
    const padded = 'https://greencrosscanna.github.io/greencross-price-cards/?a='
      + 'x'.repeat(200) + '&token=' + TOKEN;
    const ctx = arm(load(padded));
    const sent = await fileReport(ctx);
    ok(sent.context.indexOf(TOKEN) === -1, 'a token near the 300-character cut is still redacted');
  }

  // ── 4. the parameter-name shapes that have bitten this suite ────────────────────────────────────
  // connector_secret is the one an anchored regex misses: `secret=` preceded by an underscore. It is
  // also the worst one to leak — it unlocks the Dutchie credentials.
  {
    const cases = [
      ['connector_secret', 'CS-aaaaaaaaaaaa'],
      ['deploy_secret',    'DS-bbbbbbbbbbbb'],
      ['api_key',          'AK-cccccccccccc'],
      ['sessionId',        'SI-dddddddddddd'],
      ['gx.auth.v2',       'AV-eeeeeeeeeeee'],
    ];
    for (const [param, secret] of cases) {
      const ctx = arm(load('https://greencrosscanna.github.io/app/'));
      throwAt(ctx, 'NetworkError', 'https://script.google.com/macros/s/A/exec?action=x&' + param + '=' + secret, 1);
      const sent = await fileReport(ctx);
      ok(sent.context.indexOf(secret) === -1, `${param}= is redacted`);
    }
  }

  // ── 5. the server's own failure reason must be redacted too ─────────────────────────────────────
  // A GX Core exception can carry the deploy secret inside a URL, and it reaches the screen through
  // this exact path: res.error is shown verbatim to whoever is filing the report, and people
  // screenshot this modal INTO bug reports — so an unredacted server message is a leak into the bug
  // board itself, not just into a log nobody reads.
  {
    const ctx = arm(load('https://greencrosscanna.github.io/greencross-price-cards/'));
    ctx.GXB.init({
      app: 'pricecards',
      submit: () => Promise.resolve({
        ok: false,
        error: 'GXCore exception at https://script.google.com/macros/s/A/exec?action=x&deploy_secret=' + TOKEN,
      }),
    });
    ctx.GXB.open();
    ctx.doc.getElementById('gxBugTitle').value = 'x';
    const btn = ctx.doc.getElementById('gxBugSubmit');
    (btn._listeners.click || []).forEach(fn => fn({ target: btn }));
    await tick(); await tick(); await tick();
    const shown = ctx.doc.getElementById('gxBugStatus').textContent;
    ok(shown.indexOf(TOKEN) === -1, "the server's own error message is redacted before it reaches the screen");
    ok(/redacted/.test(shown), 'redacted in place, not silently dropped');
  }
  // ── 5b. the control: removing redact() from the throw must make this fail ───────────────────────
  // A fixture that could not show the defect proves nothing — this rebuilds the throw path without
  // its redact() call and confirms THAT leaks, so the assertion above is known to be load-bearing.
  {
    const preFix = SRC.replace(
      "var err = new Error(svrMsg\n            ? redact(String(svrMsg)).slice(0, 200)",
      "var err = new Error(svrMsg\n            ? String(svrMsg).slice(0, 200)"
    );
    ok(preFix !== SRC, 'the control could be built (the throw is still where this test expects it)');

    const old = load('https://greencrosscanna.github.io/greencross-price-cards/', preFix);
    old.GXB.init({
      app: 'pricecards',
      submit: () => Promise.resolve({
        ok: false,
        error: 'GXCore exception at https://script.google.com/macros/s/A/exec?action=x&deploy_secret=' + TOKEN,
      }),
    });
    old.GXB.open();
    old.doc.getElementById('gxBugTitle').value = 'x';
    const btnOld = old.doc.getElementById('gxBugSubmit');
    (btnOld._listeners.click || []).forEach(fn => fn({ target: btnOld }));
    await tick(); await tick(); await tick();
    const shownOld = old.doc.getElementById('gxBugStatus').textContent;
    ok(shownOld.indexOf(TOKEN) !== -1,
       'the PRE-FIX throw DOES leak the token onto the screen — this test can see the bug it exists for');
  }

  // ── 6. the control: the pre-fix capture must leak ─────────────────────────────────
  // Without this the file would pass just as happily against the bug it exists for. The pre-fix text
  // is built by substituting the two redact() calls back out of the real source and running THAT
  // through the same harness — so a future edit that moves the capture fails here loudly rather than
  // leaving a control that silently tests nothing.
  {
    const preFix = SRC
      .replace("var at = file ? (redact(file).split('/').pop().slice(0, 160) + (line ? ':' + line : '')) : '';",
               "var at = file ? (String(file).split('/').pop() + (line ? ':' + line : '')) : '';")
      .replace('recentErrors.push(redact(msg).slice(0, 200)', 'recentErrors.push(String(msg).slice(0, 200)');
    ok(preFix !== SRC, 'the control could be built (the capture is still where this test expects it)');

    const old = arm(load('https://greencrosscanna.github.io/greencross-price-cards/', preFix));
    throwAt(old, 'Failed to load resource', SIGNED_URL, 12);
    const sentOld = await fileReport(old);
    ok(sentOld.context.indexOf(TOKEN) !== -1,
       'the PRE-FIX capture DOES leak the token — this test can see the bug it exists for');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
