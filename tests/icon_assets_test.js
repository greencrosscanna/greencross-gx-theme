#!/usr/bin/env node
/* ─── shared icon assets — opacity, size, and the tags that claim them — tests ────────────────────
 *   RUN:  node tests/icon_assets_test.js   (also run by theme-preflight.sh)
 *
 * WHY THIS EXISTS, and why it is worth a whole suite for five PNGs.
 * iOS DISCARDS the alpha channel on an apple-touch-icon, composites what is left on BLACK, then
 * applies its own squircle mask. That failure is invisible everywhere a developer looks: Chrome,
 * Safari, the local preview and every screenshot honour alpha correctly, and the icon is only wrong
 * once someone adds the app to a home screen — which nobody does while shipping.
 *
 * BUT ALPHA IS NOT ITSELF THE BUG, and an earlier version of this file said it was. The touch icons
 * ARE the GC-3D-Button pack shipped as designed, alpha and all (~52% of each is transparent), and
 * they render correctly: the button body is near-black, so the black iOS composites behind it
 * disappears into the tile and the squircle trims the rest. Banning alpha here would have rejected
 * the artwork for a problem it does not have.
 *
 * WHAT ACTUALLY BREAKS is a transparent inset around a LIGHT button — the Green, White and Glass
 * variants of the same pack put a bright tile inside a black frame — or the GC-3D-ICON pack, whose
 * 74%-alpha bare cross has no tile at all. Both look perfect in a browser. So section 1 asserts the
 * real property rather than a proxy for it: composite on black the way iOS does, and require the
 * edge to blend with the interior. Dark-on-dark passes; bright-in-a-black-frame fails.
 *
 * The favicons are asserted the other way round on purpose. A browser tab strip is light or dark
 * depending on browser and OS theme, so a favicon with a baked-in background tile matches exactly
 * one of them — the old dark tile disappeared into dark chrome. Alpha is the FEATURE there. The two
 * surfaces want opposite things, which is exactly how someone "fixing the inconsistency" breaks one.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  PASS  ' + l); } else { fail++; console.log('  FAIL  ' + l); } };

/* Enough PNG to answer "how big is it and does any pixel have alpha". Only the IHDR is needed for
   the size; for alpha, colour type 6/4 means an alpha channel EXISTS, and we inflate to see whether
   it is actually used — a fully-opaque RGBA file is fine, an RGB one trivially is. */
/* Enough PNG to answer "how big is it, does any pixel have alpha, and what are the pixels".
   8-bit, non-interlaced, colour types 0/2/3/4/6 — which is everything in this repo. */
function readPng(file, wantPixels) {
  const d = fs.readFileSync(file);
  if (d.slice(0, 8).toString('binary') !== '\x89PNG\r\n\x1a\n') throw new Error(file + ': not a PNG');
  const w = d.readUInt32BE(16), h = d.readUInt32BE(20);
  const depth = d[24], ctype = d[25], interlace = d[28];
  if (depth !== 8 || interlace !== 0) throw new Error(file + ': need 8-bit non-interlaced');
  let idat = [], plte = null, trns = null;
  for (let i = 8; i < d.length;) {
    const len = d.readUInt32BE(i), typ = d.slice(i + 4, i + 8).toString('ascii');
    const body = d.slice(i + 8, i + 8 + len);
    if (typ === 'IDAT') idat.push(body);
    else if (typ === 'PLTE') plte = body;
    else if (typ === 'tRNS') trns = body;
    i += 12 + len;
  }
  const nch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * nch;
  const flat = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride), p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const cur = Buffer.alloc(stride);
    raw.copy(cur, 0, p, p + stride); p += stride;
    for (let x = 0; x < stride; x++) {          // undo the row filter
      const a = x >= nch ? cur[x - nch] : 0, b = prev[x], c = x >= nch ? prev[x - nch] : 0;
      if (f === 1) cur[x] = (cur[x] + a) & 255;
      else if (f === 2) cur[x] = (cur[x] + b) & 255;
      else if (f === 3) cur[x] = (cur[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        cur[x] = (cur[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    cur.copy(flat, y * stride); prev = cur;
  }
  const px = Buffer.alloc(w * h * 4);
  let translucent = false;
  for (let i = 0; i < w * h; i++) {
    let r, g, b, a = 255;
    if (ctype === 6) { r = flat[i*4]; g = flat[i*4+1]; b = flat[i*4+2]; a = flat[i*4+3]; }
    else if (ctype === 2) { r = flat[i*3]; g = flat[i*3+1]; b = flat[i*3+2]; }
    else if (ctype === 0) { r = g = b = flat[i]; }
    else if (ctype === 4) { r = g = b = flat[i*2]; a = flat[i*2+1]; }
    else { const k = flat[i]; r = plte[k*3]; g = plte[k*3+1]; b = plte[k*3+2];
           a = (trns && k < trns.length) ? trns[k] : 255; }
    if (a !== 255) translucent = true;
    px[i*4] = r; px[i*4+1] = g; px[i*4+2] = b; px[i*4+3] = a;
  }
  return { w, h, ctype, translucent, px: wantPixels ? px : null };
}

/* THE RULE, and it is settled by a photograph rather than by reasoning.
   iOS composites an apple-touch-icon's alpha on WHITE. Not black — WHITE. Sky's home screen,
   2026-08-26: the GC-3D-Button art shipped as-is rendered as a small dark button sitting inside a
   white rounded square, because the artwork is inset ~14% with a drop shadow and that entire inset
   turned white. So a touch icon must be FULL-BLEED and FULLY OPAQUE. No inset, no alpha.

   THIS FILE HAS NOW ASSERTED THREE DIFFERENT RULES. Worth keeping the history, because two of them
   were confidently argued and wrong:
     1. "must be fully opaque"          — right answer, wrong reason (assumed a BLACK composite).
     2. "alpha is fine if the body is dark" — I simulated the composite on black, the raw file looked
        correct, and I reverted to it. The simulation encoded the same wrong assumption as the claim
        it was supposed to be testing, so it confirmed it. A test built on the belief it is checking
        cannot fail.
     3. this one — same assertion as (1), but grounded in what the device actually did.
   The lesson is not "alpha bad". It is that the composite colour was never verified against a real
   device until a screenshot arrived, and every argument built on top of the guess inherited it. */

console.log('\n1. apple-touch icons must be FULL-BLEED — iOS composites alpha on WHITE');
[['gc-touch-icon.png', 180], ['gc-touch-icon-167.png', 167], ['gc-touch-icon-152.png', 152]]
  .forEach(([f, size]) => {
    const p = path.join(ROOT, f);
    ok(fs.existsSync(p), f + ' exists');
    if (!fs.existsSync(p)) return;
    const img = readPng(p);
    ok(img.w === size && img.h === size, f + ' is ' + size + 'x' + size + ' (got ' + img.w + 'x' + img.h + ')');
    ok(img.translucent === false,
       f + ' has NO transparent pixels — any inset becomes a WHITE frame on the home screen');
  });

console.log('\n2. favicons must KEEP their alpha (a tab strip is light or dark, not ours to guess)');
[['gc-icon.png', 256], ['gc-icon-96.png', 96]].forEach(([f, size]) => {
  const p = path.join(ROOT, f);
  ok(fs.existsSync(p), f + ' exists');
  if (!fs.existsSync(p)) return;
  const img = readPng(p);
  ok(img.translucent === true, f + ' is transparent — flattening it would pin one browser theme');
  ok(img.w === size && img.h === size, f + ' is ' + size + 'x' + size + ' (got ' + img.w + 'x' + img.h + ')');
});

console.log('\n3. every sizes="" the template CLAIMS matches the file it points at');
{
  const TPL = fs.readFileSync(path.join(ROOT, 'gx-app-template.html'), 'utf8');
  const re = /<link rel="apple-touch-icon" sizes="(\d+)x\1"[^>]*gx-theme\/([A-Za-z0-9._-]+\.png)"/g;
  let m, seen = 0;
  while ((m = re.exec(TPL))) {
    seen++;
    const declared = Number(m[1]), file = path.join(ROOT, m[2]);
    if (!fs.existsSync(file)) { ok(false, 'template points at ' + m[2] + ' which does not exist'); continue; }
    const img = readPng(file);
    ok(img.w === declared,
       'sizes="' + declared + 'x' + declared + '" matches ' + m[2] + ' (' + img.w + 'x' + img.h + ')');
  }
  // A wrong-but-plausible sizes= is a silent hint to the OS, so prove the loop actually ran.
  ok(seen === 3, 'template declares all three apple-touch sizes (found ' + seen + ')');
}

console.log('\n4. What\'s New points at an icon that exists');
{
  const CL = fs.readFileSync(path.join(ROOT, 'gx-changelog.js'), 'utf8');
  const m = CL.match(/gx-cl-icon"><img src="[^"]*gx-theme\/([A-Za-z0-9._-]+\.png)"/);
  ok(!!m, 'gx-changelog.js references a shared icon file');
  if (m) {
    ok(fs.existsSync(path.join(ROOT, m[1])), 'the file it names (' + m[1] + ') is in this repo');
    // It renders in a 26px slot; the 256px favicon was ~5x the pixels for no visible gain.
    const img = readPng(path.join(ROOT, m[1]));
    ok(img.w <= 128, m[1] + ' is <=128px — sized for the 26px slot it renders in, not the tab strip');
  }
}

console.log('\n' + (fail ? 'FAILED' : 'ok') + ' — ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
