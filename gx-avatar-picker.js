/* GX Avatar Picker — the one avatar builder for the suite.
 * Canonical source: greencross-gx-theme/gx-avatar-picker.js. Lifted from Leaderboard's
 * GC.views.renderAvatar, which was the better of the two implementations by a wide margin (494 lines
 * against Crew's 105). Crew's compact panel is retired rather than merged — Sky, 2026-08-25: "I like
 * the LB picker better... the current simplified version in Crew is efficient but not intuitive and
 * just adds noise."
 *
 * OPT-IN, NOT SHARED CHROME. This ships as its own js/css pair rather than folding into gx-theme.css
 * precisely because gx-theme reaches five apps on next load with no deploy gate. An app that does not
 * load these two files is completely unaffected by anything in them.
 *
 * WHAT CHANGED ON THE WAY OUT OF LEADERBOARD, and each of these was a real hazard:
 *   · EVERY class is namespaced gxava-. The original used .card, .active, .primary, .you, .initials
 *     and .app-page — generic words that every app in the suite already styles. Thirty-three classes
 *     moved; six of them would have collided on arrival.
 *   · NO GLOBAL IDS. The original addressed #avaImg / #avaSave / #avatarBack by document id, which is
 *     fine for a routed full-page view and breaks the moment two instances mount, or one mounts
 *     inside a panel that already has an element by that name. Everything is scoped to the mount root.
 *   · THE LEADERBOARD MOCK IS OPT-IN. The original hardcoded a fake standings row ("Jordan M. $4,820")
 *     to preview how a face reads in context. That is Leaderboard chrome; in Crew's roster panel it
 *     is a sales leaderboard appearing inside an HR screen. Off unless asked for.
 *   · ONE SAVE PATH. The original called saveavatar and clearavatar as separate endpoints with their
 *     own error handling. Here save(config) does both — a null config means clear — because Core's
 *     setAvatar already treats them as one operation and two paths drift.
 *   · NO URL BUILDER. It used GC.buildAvatarUrl with a local buildLocalUrl fallback, a second and
 *     third copy of rules that already lived in GXAvatar.url. Both are gone.
 *
 * USAGE
 *   var handle = GXAvatarPicker.mount(el, {
 *     name:   'Sky Pinnick',        // shown in the header
 *     seed:   '00',                 // employee_number — the face is generated from this, so it must
 *                                   //   be stable. Falls back to name, which is NOT stable across a
 *                                   //   rename; pass the number wherever you have it.
 *     config: {...} || null,        // current avatar, null for someone who has none
 *     save:   function (cfg) { return Promise; },   // cfg === null means REMOVE
 *     close:  function () {},       // optional — back button is hidden when omitted
 *     showLeaderboardPreview: false,
 *     onSaved: function (cfg) {}    // optional — fires after a successful save/clear
 *   });
 *   handle.destroy();
 */
(function (global) {
  if (global.GXAvatarPicker) return;

  var HAT_TOPS = { hat: true, winterHat1: true };   // take hatColor, never hairColor

  var OPTIONS = {
    skinColor:    ['ffdbb4','f8d25c','fd9841','edb98a','d08b5b','ae5d29','614335'],
    top: ['_none','_gchat','hat','winterHat1',
      'bigHair','bob','bun','curly','curvy','dreads','dreads01','dreads02','frida','frizzle','fro','froBand','longButNotTooLong','miaWallace','shaggy','shaggyMullet','shavedSides','shortCurly','shortFlat','shortRound','shortWaved','sides','straight01','straight02','straightAndStrand','theCaesar','theCaesarAndSidePart'],
    hairColor:    ['2c1b18','4a312c','724133','a55728','b58143','c93305','d6b370','e8e1e1','ecdcbf','f59797'],
    hatColor:     ['3c4f5c','65c9ff','262e33','5199e4','25557c','929598','a7ffc4','b1e2ff','e6e6e6','ff5c5c','ff488e','ffafb9','ffdeb5','ffffb1','ffffff'],
    eyes:         ['default','eyeRoll','happy','hearts','side','squint','surprised','wink'],
    eyebrows:     ['default','defaultNatural','flatNatural','frownNatural','raisedExcited','raisedExcitedNatural','upDown','upDownNatural'],
    mouth:        ['default','smile','twinkle','tongue','serious','disbelief'],
    facialHair:   ['_none','beardLight','beardMajestic','beardMedium','moustacheFancy','moustacheMagnum'],
    facialHairColor: ['2c1b18','4a312c','724133','a55728','b58143','c93305','d6b370','e8e1e1','ecdcbf','f59797'],
    clothing:     ['blazerAndShirt','blazerAndSweater','collarAndSweater','graphicShirt','hoodie','shirtCrewNeck','shirtScoopNeck','shirtVNeck'],
    clothesColor: ['3c4f5c','65c9ff','262e33','5199e4','25557c','929598','a7ffc4','b1e2ff','e6e6e6','ff5c5c','ff488e','ffafb9','ffdeb5','ffffb1','ffffff'],
    clothingGraphic: ['bat','bear','cumbia','deer','diamond','hola','pizza','resist','skull','skullOutline'],
    accessories:  ['_none','prescription01','prescription02','round','sunglasses','wayfarers'],
    accessoriesColor: ['3c4f5c','65c9ff','262e33','5199e4','25557c','929598','a7ffc4','b1e2ff','e6e6e6','ff5c5c','ff488e','ffafb9','ffdeb5','ffffb1','ffffff']
  };

  var DEFAULT_CONFIG = {
    skinColor: 'f8d25c', top: '_none', hairColor: '2c1b18', hatColor: '262e33',
    eyes: 'wink', eyebrows: 'upDown', mouth: 'default',
    facialHair: '_none', facialHairColor: '2c1b18',
    clothing: 'shirtCrewNeck', clothesColor: '929598', clothingGraphic: 'bear',
    accessories: '_none', accessoriesColor: '3c4f5c'
  };

  var PANELS = [
    { id: 'face',   label: 'Face',   fields: [
      ['Skin tone','swatch','skinColor'], ['Eyes','chip','eyes'], ['Eyebrows','chip','eyebrows'], ['Mouth','chip','mouth'] ] },
    { id: 'hair',   label: 'Hair',   fields: [
      ['Hair / hat style','chip','top'], ['Hair color','swatch','hairColor','hairColorField'],
      ['Hat color','swatch','hatColor','hatColorField'], ['Facial hair','chip','facialHair'],
      ['Facial hair color','swatch','facialHairColor'] ] },
    { id: 'extras', label: 'Extras', fields: [
      ['Clothing','chip','clothing'], ['Clothing color','swatch','clothesColor'],
      ['Shirt graphic','chip','clothingGraphic','graphicField'],
      ['Accessories','chip','accessories'], ['Accessory color','swatch','accessoriesColor'] ] }
  ];

  // Fields that only apply in some configurations. Hidden at render, resolved by hatColorVisibility().
  var CONDITIONAL_SLOTS = { hatColorField: 1, graphicField: 1 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function humanize(s) {
    if (s === '_none')  return 'None';
    if (s === '_gchat') return 'GC Hat';
    return String(s).replace(/([A-Z])/g, ' $1').replace(/^./, function (c) { return c.toUpperCase(); })
                    .replace(/(\d+)/, ' $1').trim();
  }

  function avatarUrl(cfg, seed) {
    if (global.GXAvatar && global.GXAvatar.url) return global.GXAvatar.url(cfg, seed);
    return '';   // gx-avatar.js is a hard dependency; a blank preview is louder than a wrong face
  }
  function hatSvg() { return (global.GXAvatar && global.GXAvatar.hatSvg) || ''; }

  function mount(root, opts) {
    if (!root) throw new Error('GXAvatarPicker.mount: no element');
    opts = opts || {};
    var name = String(opts.name || '');
    var seed = String(opts.seed || name || '');
    var hasExisting = !!(opts.config && typeof opts.config === 'object' && Object.keys(opts.config).length);

    /* CARRY FORWARD EVERY STORED KEY, not just the ones this table knows.
     * This used to be `if (j in DEFAULT_CONFIG)`, which silently DROPPED any attribute the picker did
     * not offer — so re-saving through it quietly rewrote the stored avatar to whatever the editor
     * happened to expose. clothingGraphic was the live casualty: two people had a pinned shirt design
     * (deer, diamond) that the picker had no control for, and a single save would have handed their
     * shirt back to the seed. Crew's retired panel pinned it; this one did not, so the shared
     * component was briefly a downgrade for exactly those two records.
     * clothingGraphic is now a real control, but the filter was the actual bug: a picker must never
     * lose data it cannot render. Unknown keys ride through untouched. */
    var config = {};
    for (var k in DEFAULT_CONFIG) config[k] = DEFAULT_CONFIG[k];
    if (hasExisting) for (var j in opts.config) if (j !== 'seed') config[j] = opts.config[j];

    // ── markup ────────────────────────────────────────────────────────────────────────────────
    function fieldHtml(f) {
      var label = f[0], kind = f[1], key = f[2], slot = f[3];
      var attr = kind === 'swatch' ? 'data-gxava-swatches' : 'data-gxava-chips';
      return '<div class="gxava-field"' + (slot ? ' data-gxava-slot="' + slot + '"' : '')
           // Conditional fields start hidden and are revealed by hatColorVisibility() on first
           // paint, rather than rendering visible and blinking out a frame later.
           + (CONDITIONAL_SLOTS[slot] ? ' style="display:none"' : '') + '>'
           +   '<div class="gxava-field-label">' + esc(label) + '</div>'
           +   '<div class="gxava-' + (kind === 'swatch' ? 'swatches' : 'chips') + '" ' + attr + '="' + key + '"></div>'
           + '</div>';
    }

    var lbPreview = !opts.showLeaderboardPreview ? '' :
        '<div class="gxava-lbprev">'
      +   '<h4>How it&rsquo;ll look on the leaderboard</h4>'
      +   '<div class="gxava-lbrow"><div class="gxava-lbrank">1</div>'
      +     '<div class="gxava-lbava"><img src="' + avatarUrl({ skinColor:'edb98a', top:'straight01', hairColor:'2c1b18', clothing:'hoodie', clothesColor:'ff5c5c', accessories:'_none', facialHair:'_none' }, 'Jordan') + '" alt=""></div>'
      +     '<div class="gxava-lbname">Jordan M.</div><div class="gxava-lbval">$4,820</div></div>'
      +   '<div class="gxava-lbrow gxava-lbyou"><div class="gxava-lbrank">2</div>'
      +     '<div class="gxava-lbava" data-gxava-lbava><img data-gxava-imglb alt=""></div>'
      +     '<div class="gxava-lbname">' + esc((name.split(' ')[0]) || name) + '</div><div class="gxava-lbval">$4,210</div></div>'
      +   '<div class="gxava-lbrow"><div class="gxava-lbrank">3</div>'
      +     '<div class="gxava-lbava gxava-lbinitials">DT</div>'
      +     '<div class="gxava-lbname">Devon T.</div><div class="gxava-lbval">$3,945</div></div>'
      + '</div>';

    root.innerHTML =
        '<div class="gxava-root">'
      +   '<header class="gxava-header">'
      +     (opts.close ? '<button class="gxava-back" data-gxava-back>&larr; Back</button>' : '')
      +     '<h1>' + esc(opts.title || 'Build your avatar') + '</h1>'
      +     '<div class="gxava-crumb">' + esc(name) + ' &middot; Avatar</div>'
      +   '</header>'
      +   '<div class="gxava-grid">'
      +     '<div class="gxava-preview">'
      +       '<h3>Preview</h3>'
      +       '<div class="gxava-frame" data-gxava-frame><img data-gxava-img alt="' + esc(name) + ' avatar"></div>'
      +       '<div class="gxava-actions">'
      +         '<button class="gxava-btn" data-gxava-random>&#8635; Surprise me</button>'
      +         '<button class="gxava-btn gxava-primary" data-gxava-save>Save</button>'
      +       '</div>'
      +       (hasExisting ? '<div class="gxava-clear-wrap"><button class="gxava-clear" data-gxava-clear>Remove avatar &mdash; revert to initials</button></div>' : '')
      +       lbPreview
      +     '</div>'
      +     '<div class="gxava-controls">'
      +       '<div class="gxava-tabs">' + PANELS.map(function (p, i) {
              return '<div class="gxava-tab' + (i === 0 ? ' gxava-on' : '') + '" data-gxava-tab="' + p.id + '">' + esc(p.label) + '</div>'; }).join('') + '</div>'
      +       PANELS.map(function (p, i) {
              return '<div class="gxava-panel' + (i === 0 ? ' gxava-on' : '') + '" data-gxava-panel="' + p.id + '">'
                   + p.fields.map(fieldHtml).join('') + '</div>'; }).join('')
      +     '</div>'
      +   '</div>'
      +   '<div class="gxava-status" data-gxava-status></div>'
      + '</div>';

    // ── everything below is scoped to `root`. No document.getElementById. ──────────────────────
    var q  = function (sel) { return root.querySelector(sel); };
    var qa = function (sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };
    var imgEl    = q('[data-gxava-img]');
    var frameEl  = q('[data-gxava-frame]');
    var statusEl = q('[data-gxava-status]');
    var saveBtn  = q('[data-gxava-save]');
    var clearBtn = q('[data-gxava-clear]');

    function status(msg, kind) {
      if (!statusEl) return;
      statusEl.textContent = msg || '';
      statusEl.className = 'gxava-status' + (kind ? ' gxava-' + kind : '');
    }

    function paintHat(wrap) {
      if (!wrap) return;
      var old = wrap.querySelector('.gxava-hat');
      if (old) old.parentNode.removeChild(old);
      if (config.top === '_gchat') wrap.insertAdjacentHTML('beforeend', '<div class="gxava-hat">' + hatSvg() + '</div>');
    }

    function renderImg() {
      var url = avatarUrl(config, seed);
      if (imgEl) { imgEl.src = url; paintHat(frameEl); }
      var lb = q('[data-gxava-imglb]');
      if (lb) { lb.src = url; paintHat(q('[data-gxava-lbava]')); }
    }

    function hatColorVisibility() {
      var isHat = !!HAT_TOPS[config.top];
      var hair = q('[data-gxava-slot="hairColorField"]');
      var hat  = q('[data-gxava-slot="hatColorField"]');
      if (hair) hair.style.display = isHat ? 'none' : '';
      if (hat)  hat.style.display  = isHat ? '' : 'none';
      // The shirt graphic only exists on graphicShirt; offering it otherwise implies it does something.
      var gfx = q('[data-gxava-slot="graphicField"]');
      if (gfx) gfx.style.display = (config.clothing === 'graphicShirt') ? '' : 'none';
    }

    function buildSwatches(key) {
      var c = q('[data-gxava-swatches="' + key + '"]'); if (!c) return;
      c.innerHTML = OPTIONS[key].map(function (hex) {
        return '<div class="gxava-swatch' + (config[key] === hex ? ' gxava-sel' : '') + '"'
             + ' data-val="' + hex + '" style="background:#' + hex + '" title="#' + hex + '"></div>';
      }).join('');
    }
    function buildChips(key) {
      var c = q('[data-gxava-chips="' + key + '"]'); if (!c) return;
      c.innerHTML = OPTIONS[key].map(function (v) {
        return '<div class="gxava-chip' + (config[key] === v ? ' gxava-sel' : '') + '" data-val="' + esc(v) + '">'
             + esc(humanize(v)) + '</div>';
      }).join('');
    }
    function buildAll() {
      Object.keys(OPTIONS).forEach(function (key) {
        if (q('[data-gxava-swatches="' + key + '"]')) buildSwatches(key);
        if (q('[data-gxava-chips="' + key + '"]'))    buildChips(key);
      });
      hatColorVisibility();
      renderImg();
    }

    function onClick(ev) {
      var t = ev.target;

      var tab = t.closest && t.closest('[data-gxava-tab]');
      if (tab && root.contains(tab)) {
        var id = tab.getAttribute('data-gxava-tab');
        qa('[data-gxava-tab]').forEach(function (x) { x.classList.toggle('gxava-on', x === tab); });
        qa('[data-gxava-panel]').forEach(function (x) { x.classList.toggle('gxava-on', x.getAttribute('data-gxava-panel') === id); });
        return;
      }

      var sw = t.closest && t.closest('.gxava-swatch');
      if (sw && root.contains(sw)) {
        var swKey = sw.parentNode.getAttribute('data-gxava-swatches');
        config[swKey] = sw.getAttribute('data-val');
        buildSwatches(swKey); renderImg(); return;
      }

      var chip = t.closest && t.closest('.gxava-chip');
      if (chip && root.contains(chip)) {
        var chKey = chip.parentNode.getAttribute('data-gxava-chips');
        config[chKey] = chip.getAttribute('data-val');
        buildChips(chKey); hatColorVisibility(); renderImg(); return;
      }

      if (t.closest && t.closest('[data-gxava-random]')) {
        Object.keys(OPTIONS).forEach(function (key) {
          config[key] = OPTIONS[key][Math.floor(Math.random() * OPTIONS[key].length)];
        });
        buildAll(); return;
      }

      if (t.closest && t.closest('[data-gxava-back]')) { if (opts.close) opts.close(); return; }

      if (t.closest && t.closest('[data-gxava-save]'))  { doSave(); return; }
      if (t.closest && t.closest('[data-gxava-clear]')) { doClear(); return; }
    }

    function settle(btn, label) { if (btn) { btn.disabled = false; btn.textContent = label; } }

    function doSave() {
      if (!opts.save) return status('No save handler wired', 'err');
      if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
      status('');
      Promise.resolve(opts.save(config)).then(function (res) {
        settle(saveBtn, 'Save');
        if (res && res.ok === false) return status('✗ ' + (res.error || 'Save failed'), 'err');
        status('✓ Saved', 'ok');
        if (opts.onSaved) opts.onSaved(config);
        /* SAVE CLOSES, same as Remove already did. Sky, 2026-08-26: "Tapping the Save button within
           the Avatar Builder should close out the window and take you back to where you came from."
           The two exits behaved differently before — Remove navigated back after 1200ms while Save sat
           on "✓ Saved" for three seconds and left you on a form with nothing left to do, so the only
           way out was the Back button you had already stopped looking at.
           The pause is deliberate and matches Remove: closing instantly makes a successful save
           indistinguishable from a click that missed, because the confirmation would be gone before it
           was read. A caller with no close() keeps the old behaviour — the status clears and the
           picker stays put, which is correct when it IS the page. */
        if (opts.close) setTimeout(function () { opts.close(); }, 1200);
        else setTimeout(function () { status(''); }, 3000);
      }, function (err) {
        settle(saveBtn, 'Save');
        status('✗ ' + ((err && err.message) || 'Save failed'), 'err');
      });
    }

    function doClear() {
      if (!opts.save) return status('No save handler wired', 'err');
      if (!global.confirm('Remove ' + (name || 'this employee') + "'s avatar? They'll show initials instead.")) return;
      if (clearBtn) { clearBtn.disabled = true; clearBtn.textContent = 'Removing…'; }
      status('');
      Promise.resolve(opts.save(null)).then(function (res) {
        if (res && res.ok === false) {
          settle(clearBtn, 'Remove avatar — revert to initials');
          return status('✗ ' + (res.error || 'Remove failed'), 'err');
        }
        if (clearBtn && clearBtn.parentNode) clearBtn.parentNode.removeChild(clearBtn);
        status('✓ Avatar removed', 'ok');
        if (opts.onSaved) opts.onSaved(null);
        if (opts.close) setTimeout(function () { opts.close(); }, 1200);
      }, function (err) {
        settle(clearBtn, 'Remove avatar — revert to initials');
        status('✗ ' + ((err && err.message) || 'Remove failed'), 'err');
      });
    }

    root.addEventListener('click', onClick);
    buildAll();

    return {
      destroy: function () { root.removeEventListener('click', onClick); root.innerHTML = ''; },
      config:  function () { var out = {}; for (var c in config) out[c] = config[c]; return out; }
    };
  }

  global.GXAvatarPicker = { mount: mount, OPTIONS: OPTIONS, DEFAULT_CONFIG: DEFAULT_CONFIG };
})(typeof window !== 'undefined' ? window : this);
