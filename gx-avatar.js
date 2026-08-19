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

  function url(cfg, seed) {
    cfg = cfg || {};
    var params = ['seed=' + encodeURIComponent(seed || 'unknown')];
    var noAccessories = cfg.accessories === '_none';
    var noFacialHair  = cfg.facialHair  === '_none';
    var isGcHat       = cfg.top === '_gchat';
    var noHair        = cfg.top === '_none';
    var isHat         = !!(cfg.top && HAT_STYLES[cfg.top]);

    Object.keys(cfg).forEach(function (k) {
      var v = cfg[k];
      if (v == null || v === '_none') return;
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
    return '<img src="' + src + '" alt="" ' +
           'onerror="this.parentNode.textContent=' + JSON.stringify(ini).replace(/"/g, '&quot;') + '">';
  }

  global.GXAvatar = { url: url, chip: chip, initials: initials };
})(typeof window !== 'undefined' ? window : this);
