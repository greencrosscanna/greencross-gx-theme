#!/usr/bin/env node
/* ─── shared icon assets — opacity, size, and the tags that claim them — tests ────────────────────
 *   RUN:  node tests/icon_assets_test.js   (also run by theme-preflight.sh)
 *
 * WHY THIS EXISTS, and why it is worth a whole suite for five PNGs.
 * iOS DISCARDS the alpha channel on an apple-touch-icon and composites what is left on BLACK. The
 * GC-3D-Icon packs ship every variant on a transparent background — 74% of the 180x180 is alpha —
 * so dropping a pack file straight in as the touch icon puts a green cross on a black square on
 * every iPhone and iPad home screen in the company.
 *
 * The reason to TEST it rather than trust the comment: that failure is invisible everywhere a
 * developer would look. Chrome, Safari, the local preview and every screenshot render alpha
 * correctly; the icon is only wrong once someone adds the app to a home screen, which nobody does
 * while shipping. It is also a silent REGRESSION risk forever after — these five files sit next to
 * eleven pack exports with almost identical names, and a future "just use the pack's version"
 * looks obviously right in review.
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
function readPng(file) {
  const d = fs.readFileSync(file);
  if (d.slice(0, 8).toString('binary') !== '\x89PNG\r\n\x1a\n') throw new Error(file + ': not a PNG');
  const w = d.readUInt32BE(16), h = d.readUInt32BE(20);
  const depth = d[24], ctype = d[25], interlace = d[28];
  let idat = [];
  for (let i = 8; i < d.length;) {
    const len = d.readUInt32BE(i), typ = d.slice(i + 4, i + 8).toString('ascii');
    if (typ === 'IDAT') idat.push(d.slice(i + 8, i + 8 + len));
    i += 12 + len;
  }
  let translucent = null;                       // null = not determined
  if ((ctype === 6 || ctype === 4) && depth === 8 && interlace === 0) {
    const nch = ctype === 6 ? 4 : 2;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * nch;
    const cur = Buffer.alloc(stride); let prev = Buffer.alloc(stride); let p = 0;
    translucent = false;
    for (let y = 0; y < h; y++) {
      const f = raw[p++];
      raw.copy(cur, 0, p, p + stride); p += stride;
      for (let x = 0; x < stride; x++) {        // undo the row filter
        const a = x >= nch ? cur[x - nch] : 0, b = prev[x], c = x >= nch ? prev[x - nch] : 0;
        if (f === 1) cur[x] = (cur[x] + a) & 255;
        else if (f === 2) cur[x] = (cur[x] + b) & 255;
        else if (f === 3) cur[x] = (cur[x] + ((a + b) >> 1)) & 255;
        else if (f === 4) {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          cur[x] = (cur[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
        }
      }
      for (let x = nch - 1; x < stride; x += nch) if (cur[x] !== 255) { translucent = true; }
      cur.copy(prev);
    }
  } else if (ctype === 2 || ctype === 0) {
    translucent = false;                        // no alpha channel at all
  }
  return { w, h, ctype, translucent };
}

console.log('\n1. apple-touch icons must be FULLY OPAQUE (iOS composites alpha on black)');
[['gc-touch-icon.png', 180], ['gc-touch-icon-167.png', 167], ['gc-touch-icon-152.png', 152]]
  .forEach(([f, size]) => {
    const p = path.join(ROOT, f);
    ok(fs.existsSync(p), f + ' exists');
    if (!fs.existsSync(p)) return;
    const img = readPng(p);
    ok(img.translucent === false,
       f + ' has NO translucent pixels — a pack file dropped in raw would fail here');
    ok(img.w === size && img.h === size, f + ' is ' + size + 'x' + size + ' (got ' + img.w + 'x' + img.h + ')');
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
