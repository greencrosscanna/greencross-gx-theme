/* GX Avatar — one DiceBear URL builder for the whole suite.
 * Canonical source: greencross-gx-theme/gx-avatar.js. Lifted from Leaderboard's GC.buildAvatarUrl,
 * which was the only correct implementation; every other app was about to grow its own.
 *
 * WHY IT IS NOT A ONE-LINER
 * avatar_config is not a straight query string. Four cases need special handling, and getting any of
 * them wrong produces a subtly wrong face rather than an error:
 *   _none        on accessories / facialHair / top means "omit", NOT a value to send
 *   _gchat       is the Green Cross hat: DiceBear renders shortFlat underneath and the hat SVG goes
 *                on top as an overlay, so hair peeks out from under it
 *   hat styles   (hat, winterHat1) take hatColor and must NOT be sent hairColor
 *   probabilities must be pinned to 0/100 explicitly, or DiceBear randomises them per seed
 *
 * USAGE
 *   GXAvatar.url(cfg, seed)            -> the DiceBear SVG URL
 *   GXAvatar.chip(cfg, name)           -> inner HTML for .gx-user-ava (image, or initials fallback)
 *   GXAvatar.initials('Sky Pinnick')   -> 'SP'
 */
(function (global) {
  if (global.GXAvatar) return;

  var HAT_STYLES = { hat: true, winterHat1: true };

  /* The Green Cross hat is NOT a DiceBear option: _gchat renders shortFlat underneath and this
     SVG is laid over the top, so hair shows beneath the brim. Copied byte-for-byte from Crew,
     which took it from Leaderboard -- a face must be identical in every app, and this markup was
     already living in three places. Rendering the URL without the overlay is exactly the bug it
     causes: a bare head where a hat belongs.
     Do not reformat the path data. */
  var GC_HAT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 280.01"><g><g><path d="M86.239,62.287c48.508-3.223,59.204-3.223,107.712,0,2.156,9.668,18.16,23.768,9.425,19.336-13.835-7.019-113.784-7.302-125.645.412-6.37,4.143,6.352-10.08,8.507-19.748Z" fill="#2c302d" stroke="#000" stroke-linejoin="round" stroke-width="4"/><path d="M86.7,67.121c-6.468-46.192,32.82-57.199,53.6-57.199,23.549,0,59.586,11.007,53.119,57.199h-106.718Z" fill="#2c302d" stroke="#000" stroke-linejoin="round" stroke-width="4"/><path d="M140.3,4.3c2.679,0,4.851.598,4.851,3.268s-1.931,2.341-4.61,2.341-5.091.329-5.091-2.341,2.172-3.268,4.851-3.268Z"/></g><path d="M146.709,23.878l.003,4.438c0,1.872-1.514,3.387-3.387,3.387l-.003-6.751c0-.578-.468-1.074-1.074-1.074h-4.02c-.578,0-1.074.496-1.074,1.074l-.029,6.405c0,1.873-1.514,3.387-3.359,3.387h-6.334c-.578,0-1.074.496-1.074,1.074v4.02c0,.606.496,1.074,1.074,1.074h4.998c.579,0,1.074-.468,1.074-1.074v-.22c0-1.983,1.597-3.58,3.58-3.58v4.681c0,1.983-1.597,3.58-3.58,3.58h-7.146c-1.982,0-3.58-1.597-3.58-3.58v-5.755c0-1.982,1.597-3.607,3.58-3.607h7.418s0-.748,0-.748l-.008-6.731c0-1.982,1.625-3.58,3.607-3.58h5.755c1.983,0,3.58,1.597,3.58,3.58ZM133.769,51.891l-.003-4.438c0-1.872,1.514-3.387,3.387-3.387l.003,6.751c0,.578.468,1.074,1.074,1.074h4.02c.578,0,1.074-.496,1.074-1.074l-.008-6.751c1.873,0,3.387,1.515,3.387,3.387l.008,4.438c0,1.982-1.625,3.58-3.607,3.58h-5.755c-1.983,0-3.58-1.597-3.58-3.58ZM157.192,44.365h-10.415c-1.982,0-3.58-1.597-3.58-3.58v-5.755c0-1.982,1.597-3.607,3.58-3.607h10.446c0,1.873-1.515,3.387-3.387,3.387h-5.985c-.578,0-1.074.496-1.074,1.074v4.02c0,.606.496,1.074,1.074,1.074h5.954c1.872,0,3.387,1.515,3.387,3.387Z" fill="#93d500"/></g></svg>';

  /* THE SEED ONLY DECIDES WHAT THE CONFIG DOES NOT PIN. Our configs pin 12-13 attributes (top, hair,
     hairColor, eyes, eyebrows, mouth, skinColor, facialHair, facialHairColor, clothing, clothesColor,
     accessories, hatColor), so for almost everyone the seed changes nothing at all -- measured: 10 of
     the 12 stamped avatars in Core render byte-identical under deliberately different seeds.
     THE EXCEPTION IS clothingGraphic. Anyone with clothing=graphicShirt gets a seed-derived design on
     the shirt, because the editor never offered it as a choice. That is the one part of an avatar that
     is still random, and it is why a seed change is visible for those people and nobody else. If the
     editor ever pins it, avatars become fully deterministic. */
  function url(cfg, seed) {
    cfg = cfg || {};
    /* A stamped cfg.seed WINS over the caller's seed, and is emitted once.
       Crew pins seed to employee_number so a rename cannot scramble a face; the caller's seed is
       derived from the name and is exactly what that pinning exists to stop mattering.
       Emitting both is not harmless: DiceBear honours the FIRST occurrence of a duplicated param
       (measured, not assumed), so while the attribute loop below re-emitted cfg.seed as a second
       seed=, the stamped value silently lost to the name every time and the pinning did nothing. */
    var params = ['seed=' + encodeURIComponent(cfg.seed || seed || 'unknown')];
    var noAccessories = cfg.accessories === '_none';
    var noFacialHair  = cfg.facialHair  === '_none';
    var isGcHat       = cfg.top === '_gchat';
    var noHair        = cfg.top === '_none';
    var isHat         = !!(cfg.top && HAT_STYLES[cfg.top]);

    Object.keys(cfg).forEach(function (k) {
      var v = cfg[k];
      if (v == null || v === '_none') return;
      if (k === 'seed') return;   // already emitted above — re-emitting it duplicates the param
      if (k === 'top' && isGcHat) { params.push('top=shortFlat'); return; }
      if (k === 'accessoriesColor' && noAccessories) return;
      if (k === 'facialHairColor'  && noFacialHair)  return;
      if (k === 'hairColor'        && (noHair || isHat)) return;   // hats use hatColor
      if (k === 'hatColor'         && !isHat)         return;
      params.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });

    params.push('accessoriesProbability=' + (noAccessories ? '0' : '100'));
    params.push('facialHairProbability='  + (noFacialHair  ? '0' : '100'));
    params.push('topProbability='         + ((noHair && !isGcHat) ? '0' : '100'));
    return 'https://api.dicebear.com/9.x/avataaars/svg?' + params.join('&');
  }

  function initials(name) {
    return String(name || '').trim().split(/[\s._-]+/)
      .map(function (w) { return w.charAt(0); }).join('').slice(0, 2).toUpperCase() || 'GX';
  }

  /* Inner HTML for a .gx-user-ava. Falls back to initials when there is no config, and ALSO on image
     error: DiceBear is a third-party host, and a header that renders a broken-image icon because an
     external service is down looks like the app is broken. */
  function chip(cfg, name, seed) {
    var ini = initials(name);
    if (!cfg || typeof cfg !== 'object' || !Object.keys(cfg).length) return ini;
    var src = url(cfg, seed || name);
    // _gchat needs the overlay on top of the DiceBear image, or the avatar renders hatless.
    var hat = (cfg.top === '_gchat') ? '<span class="gx-ava-hat">' + GC_HAT_SVG + '</span>' : '';
    return '<img src="' + src + '" alt="" ' +
           'onerror="this.parentNode.textContent=' + JSON.stringify(ini).replace(/"/g, '&quot;') + '">' + hat;
  }

  /* hatSvg is exported for the PICKER, which lays the overlay over a live preview image rather
     than building a chip. Without it the picker needs its own copy of this markup, which is the
     duplication this file exists to end — the hat already lived in three places once. */
  /* ─── loadPicker — fetch the BUILDER on demand ─────────────────────────────────────────────────
   * The picker's js+css were loaded eagerly by every page that might ever open one. That is two
   * render/parser-blocking cross-origin requests (~29KB, ~185ms warm, ~1.2s on a cold CDN edge) on
   * every single load — including the kiosk, which runs all day and never opens a picker at all.
   * Making the files opt-in PER APP was only half the job; they were still eager PER PAGE.
   *
   * This lives in gx-avatar.js on purpose: both apps already load THIS file eagerly, because the small
   * avatar chip renders on every screen. So the loader costs no new request while removing two. A
   * separate loader file would have re-added one of the requests it exists to remove.
   *
   * Idempotent and concurrency-safe: every caller shares one promise, so double-clicking the avatar
   * circle does not start two downloads or inject two <script> tags.
   *
   *   GXAvatar.loadPicker().then(function () { GXAvatarPicker.mount(el, opts); });
   */
  var BASE = 'https://greencrosscanna.github.io/greencross-gx-theme/';
  var pickerPromise = null;
  function loadPicker() {
    if (global.GXAvatarPicker) return Promise.resolve(global.GXAvatarPicker);
    if (pickerPromise) return pickerPromise;
    pickerPromise = new Promise(function (resolve, reject) {
      var doc = global.document;
      if (!doc) return reject(new Error('no document'));
      if (!doc.querySelector('link[data-gxava-css]')) {
        var link = doc.createElement('link');
        link.rel = 'stylesheet'; link.href = BASE + 'gx-avatar-picker.css';
        link.setAttribute('data-gxava-css', '1');
        doc.head.appendChild(link);
      }
      var el = doc.createElement('script');
      el.src = BASE + 'gx-avatar-picker.js';
      el.onload = function () {
        global.GXAvatarPicker ? resolve(global.GXAvatarPicker)
                              : reject(new Error('gx-avatar-picker.js loaded but defined nothing'));
      };
      /* A failed load must REJECT, not hang. The caller is mid-interaction — somebody tapped an avatar
         and is waiting — so a promise that never settles is a dead button with no explanation. */
      el.onerror = function () {
        pickerPromise = null;   // let a retry actually retry
        reject(new Error('could not load the avatar builder (gx-theme)'));
      };
      doc.head.appendChild(el);
    });
    return pickerPromise;
  }

  global.GXAvatar = { url: url, chip: chip, initials: initials, hatSvg: GC_HAT_SVG, loadPicker: loadPicker };
})(typeof window !== 'undefined' ? window : this);
