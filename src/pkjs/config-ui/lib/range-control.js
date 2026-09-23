// src/pkjs/config-ui/lib/range-control.js — the dual-thumb range and the
// threshold slider, whole: every numeric rule (step snapping, bounds, minimum
// span, no crossing), the track/zone/chip renderers, and (via
// createRangeWiring) the pointer/keyboard drag machinery plus the inline
// scale-max editor. Extracted from engine.js, which had grown two complete
// widget subsystems; the engine keeps only the CONTROLS dispatch entry and
// re-exports the helper names its consumers already import. Dual-context like
// the other lib files: PConf bridge in the concatenated page/test bundle,
// module.exports under Node.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
(function () {
  var htmlLib = (typeof require !== 'undefined') ? require('./html.js') : PConf.html;
  var esc = htmlLib.esc;
  // The chip+hex readout above the channel sliders. It is NOT local to this file:
  // a row's colour badge prints the same fragment from the same builder (html.js),
  // so the card and the sheet cannot drift apart.
  var swatchReadout = htmlLib.swatchReadout;

  // Pencil glyph for the slider's inline scale-max editor (rng-max-edit).
  var PEN_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

  // ---- range (dual-thumb) value helpers ------------------------------------
  // A range item stores BOTH values in ONE messageKey as "lo-hi" (the same
  // one-key-composite-string shape type 'date' uses for "YYYY-MM-DD"), so
  // hydration / serialization / showWhen stay untouched. Every numeric rule
  // (step snapping, bounds, minimum span, no crossing) lives here so the DOM
  // glue below can stay dumb and this stays unit-testable without a DOM.

  /**
   * Read an item's step, defaulting to 1.
   * @param {Object} item Range schema item.
   * @returns {number} Step size (>= 1).
   */
  function rangeStep(item) {
    var s = (item && item.step) ? Number(item.step) : 1;
    return (isFinite(s) && s > 0) ? s : 1;
  }

  /**
   * Read an item's minimum span between the thumbs, defaulting to 1.
   * @param {Object} item Range schema item.
   * @returns {number} Minimum hi - lo.
   */
  function rangeMinSpan(item) {
    var m = (item && item.minSpan) ? Number(item.minSpan) : 1;
    return (isFinite(m) && m > 0) ? m : 1;
  }

  /**
   * Snap a value to the item's step grid (measured from min) and clamp it to
   * [min, max].
   * @param {number} v Raw value.
   * @param {number} min Lower bound.
   * @param {number} max Upper bound.
   * @param {number} step Step size.
   * @returns {number} Snapped, bounded value.
   */
  function snapToStep(v, min, max, step) {
    var st = (isFinite(step) && step > 0) ? step : 1;
    var n = Math.round((Number(v) - min) / st);
    var out = min + n * st;
    if (out < min) { out = min; }
    if (out > max) { out = max; }
    return out;
  }

  /**
   * Serialize a range to its stored form.
   * @param {{lo:number, hi:number}} range Range.
   * @returns {string} "lo-hi".
   */
  function formatRange(range) { return range.lo + '-' + range.hi; }

  /**
   * Parse a stored "lo-hi" string. An unparseable, inverted or too-narrow pair
   * falls back to the item's defaultValue, then to its bounds — a stored value
   * can predate a change to min/max/minSpan, and a control rendered from a
   * broken pair would strand a thumb outside the track.
   * @param {*} value Stored value.
   * @param {Object} item Range schema item (min/max/minSpan/defaultValue).
   * @returns {{lo:number, hi:number}} Valid range.
   */
  function parseRange(value, item) {
    var min = Number(item.min), max = Number(item.max);
    var span = rangeMinSpan(item);
    var m = /^(-?\d+)-(-?\d+)$/.exec(String(value == null ? '' : value));
    if (m) {
      var lo = parseInt(m[1], 10), hi = parseInt(m[2], 10);
      if (lo >= min && hi <= max && hi - lo >= span) { return { lo: lo, hi: hi }; }
    }
    // One level of fallback only: recursing on defaultValue would loop if the
    // default itself is broken, so a bad default lands on the bounds.
    if (item.defaultValue != null && String(item.defaultValue) !== String(value)) {
      var d = /^(-?\d+)-(-?\d+)$/.exec(String(item.defaultValue));
      if (d) {
        var dlo = parseInt(d[1], 10), dhi = parseInt(d[2], 10);
        if (dlo >= min && dhi <= max && dhi - dlo >= span) { return { lo: dlo, hi: dhi }; }
      }
    }
    return { lo: min, hi: max };
  }

  /**
   * Move one thumb. Snaps to the step grid, clamps to [min, max], and stops the
   * moved thumb minSpan away from the other one instead of letting them cross.
   * @param {{lo:number, hi:number}} range Current range (not mutated).
   * @param {string} which 'lo' or 'hi'.
   * @param {number} value Requested new value for that thumb.
   * @param {Object} item Range schema item (min/max/step/minSpan).
   * @returns {{lo:number, hi:number}} The new range.
   */
  function moveThumb(range, which, value, item) {
    var min = Number(item.min), max = Number(item.max);
    var step = rangeStep(item), span = rangeMinSpan(item);
    var v = snapToStep(value, min, max, step);
    if (which === 'lo') {
      var loCap = range.hi - span;
      if (v > loCap) { v = loCap; }
      if (v < min) { v = min; }
      return { lo: v, hi: range.hi };
    }
    var hiFloor = range.lo + span;
    if (v < hiFloor) { v = hiFloor; }
    if (v > max) { v = max; }
    return { lo: range.lo, hi: v };
  }

  // ---- rgb (three-channel colour) value helpers ----------------------------
  // An rgb item stores ALL THREE channels in ONE messageKey as "r,g,b" — the same
  // one-key-composite-string shape `range` uses for "lo-hi" and `date` for
  // "YYYY-MM-DD" — so hydration / serialization / showWhen stay untouched. Unlike
  // `range` the schema item carries no min/max: the bounds come from the hardware
  // the value feeds (one byte per channel, e.g. the watch's backlight LED via
  // light_set_color_rgb888) and can never change, so they live here.
  var RGB_MIN = 0, RGB_MAX = 255;
  var RGB_CHANNELS = ['r', 'g', 'b'];
  // Per-channel chrome: the one-letter track label, the aria wording, and the
  // thumb/fill tint — carried inline as --th-c/--th-glow, the same custom
  // properties the threshold slider's coloured knobs ride on.
  var RGB_CHROME = {
    r: { short: 'R', name: 'red', tint: '#FA4A35', glow: 'rgba(250,74,53,0.4)' },
    g: { short: 'G', name: 'green', tint: '#34C05A', glow: 'rgba(52,192,90,0.4)' },
    b: { short: 'B', name: 'blue', tint: '#4A8BFA', glow: 'rgba(74,139,250,0.4)' }
  };

  /**
   * Is this schema item the three-channel colour control? The one place the type
   * name is spelled, so every dispatch below (render, paint, commit, drag math)
   * agrees on what an rgb item is.
   * @param {Object} item Schema item.
   * @returns {boolean} True for type 'rgb'.
   */
  function isRgbItem(item) { return Boolean(item && item.type === 'rgb'); }

  /**
   * Is this a channel name? An explicit three-way test, not an RGB_CHROME lookup:
   * a plain-object lookup answers truthy for inherited names like 'constructor'.
   * @param {*} which Candidate channel name.
   * @returns {boolean} True for 'r', 'g' or 'b'.
   */
  function isRgbChannel(which) {
    return which === 'r' || which === 'g' || which === 'b';
  }

  /**
   * Clamp one channel into [0, 255] and round it to an integer.
   * @param {*} v Raw channel value.
   * @returns {number} Integer in [0, 255]; 0 for anything unparseable.
   */
  function clampChannel(v) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) { return RGB_MIN; }
    if (n < RGB_MIN) { return RGB_MIN; }
    if (n > RGB_MAX) { return RGB_MAX; }
    return n;
  }

  /**
   * One channel's track offset as a percentage, one decimal (the thumb's `left`
   * and the fill's `right`), so the control needs no measured width at render time.
   * @param {number} v Channel value.
   * @returns {number} Percentage in [0, 100].
   */
  function rgbPct(v) { return Math.round((clampChannel(v) * 1000) / RGB_MAX) / 10; }

  /**
   * Parse a stored "r,g,b" string STRICTLY: exactly three integer channels, with
   * surrounding whitespace tolerated. An out-of-range channel is CLAMPED rather
   * than rejected — 0-255 is fixed by the hardware, so 300 is a bruised value and
   * not a stale one — but anything that is not three integers (a hex string, two
   * channels, an empty string) is rejected so the caller can fall back.
   * @param {*} value Stored value.
   * @returns {?{r:number, g:number, b:number}} The colour, or null if unparseable.
   */
  function parseRgbStrict(value) {
    var parts = String(value == null ? '' : value).split(',');
    if (parts.length !== 3) { return null; }
    var out = {}, i, s;
    for (i = 0; i < 3; i++) {
      s = parts[i].replace(/\s/g, '');
      if (!/^-?\d+$/.test(s)) { return null; }
      out[RGB_CHANNELS[i]] = clampChannel(parseInt(s, 10));
    }
    return out;
  }

  /**
   * Parse a stored "r,g,b" string, falling back to the item's defaultValue and
   * then to black. One level of fallback only (parseRange's rule): recursing on
   * defaultValue would loop if the default itself is broken.
   * @param {*} value Stored value.
   * @param {Object} [item] Rgb schema item (defaultValue).
   * @returns {{r:number, g:number, b:number}} A valid colour.
   */
  function parseRgb(value, item) {
    var got = parseRgbStrict(value);
    if (got) { return got; }
    if (item && item.defaultValue != null && String(item.defaultValue) !== String(value)) {
      var d = parseRgbStrict(item.defaultValue);
      if (d) { return d; }
    }
    return { r: RGB_MIN, g: RGB_MIN, b: RGB_MIN };
  }

  /**
   * Serialize a colour to its stored form.
   * @param {{r:number, g:number, b:number}} c Colour.
   * @returns {string} "r,g,b".
   */
  function formatRgb(c) { return c.r + ',' + c.g + ',' + c.b; }

  /**
   * The resolved colour as CSS hex — what the live swatch paints and the hex
   * readout prints. Uppercase, matching the colour picker's own readout.
   * @param {{r:number, g:number, b:number}} c Colour.
   * @returns {string} "#RRGGBB".
   */
  function rgbHex(c) {
    var out = '#', i, s;
    for (i = 0; i < 3; i++) {
      s = clampChannel(c ? c[RGB_CHANNELS[i]] : 0).toString(16).toUpperCase();
      out += (s.length < 2 ? '0' : '') + s;
    }
    return out;
  }

  /**
   * Move one channel's thumb: snap to the item's step grid, clamp to [0, 255].
   * The rgb counterpart of moveThumb — no crossing or minimum-span rules, the
   * three channels are independent — and like it, it does not mutate its input.
   * An unknown channel name is a no-op.
   * @param {{r:number, g:number, b:number}} c Current colour (not mutated).
   * @param {string} which 'r', 'g' or 'b'.
   * @param {number} value Requested new value for that channel.
   * @param {Object} [item] Rgb schema item (step).
   * @returns {{r:number, g:number, b:number}} The new colour.
   */
  function setRgbChannel(c, which, value, item) {
    var next = { r: c.r, g: c.g, b: c.b };
    if (isRgbChannel(which)) {
      next[which] = snapToStep(value, RGB_MIN, RGB_MAX, rangeStep(item));
    }
    return next;
  }

  /**
   * Three-channel colour control (type: 'rgb'): a live swatch + hex readout above
   * one single-thumb track per channel. Composed from the range slider's OWN
   * track/thumb markup, so the drag, keyboard-nudge, focus and disabled-row rules
   * in createRangeWiring serve it unchanged; only the value shape differs, and it
   * rides on the root as data-r/data-g/data-b the way a range rides data-lo/data-hi.
   * @param {Object} item Rgb schema item (messageKey/label/step/defaultValue).
   * @param {{value:*}} view Render state.
   * @returns {string} Control HTML.
   */
  function renderRgb(item, view) {
    var c = parseRgb(view.value, item);
    var hex = rgbHex(c);
    var label = String(item.label || 'Color');
    var h = '<div class="rng rgb" data-range="' + esc(item.messageKey) + '" data-r="' + c.r
      + '" data-g="' + c.g + '" data-b="' + c.b + '">'
      + '<div class="rgb-head">' + swatchReadout(hex, true) + '</div>';
    for (var i = 0; i < RGB_CHANNELS.length; i++) {
      var ch = RGB_CHANNELS[i], v = c[ch], chrome = RGB_CHROME[ch], pct = rgbPct(v);
      h += '<div class="rgb-ch" style="--th-c:' + chrome.tint + ';--th-glow:' + chrome.glow + '">'
        + '<span class="rgb-ch-lbl" aria-hidden="true">' + chrome.short + '</span>'
        + '<div class="rng-track">'
        + '<div class="rng-fill" data-rgb-fill="' + ch + '" style="left:0;right:'
        + (Math.round((100 - pct) * 10) / 10) + '%"></div>'
        + '<button type="button" class="rng-th" data-range-thumb="' + ch
        + '" style="left:' + pct + '%" role="slider" aria-label="'
        + esc(label + ' ' + chrome.name) + '" aria-valuemin="' + RGB_MIN
        + '" aria-valuemax="' + RGB_MAX + '" aria-valuenow="' + v + '"></button>'
        + '</div>'
        + '<span class="rgb-ch-val" data-rgb-val="' + ch + '">' + v + '</span>'
        + '</div>';
    }
    return h + '</div>';
  }

  /**
   * Repaint one rgb control in place during a drag or keyboard nudge (no
   * re-render, same contract as paintThresholdRange): swatch, hex readout, each
   * channel's fill/thumb/value, and the data-r/data-g/data-b state the pointer
   * handler reads back on the next frame.
   * @param {Element} root .rng.rgb element.
   * @param {Object} item Rgb schema item (unused — kept so paintRange can dispatch
   *   on type with one signature).
   * @param {{r:number, g:number, b:number}} c New colour.
   * @returns {void}
   */
  function paintRgb(root, item, c) {
    var hex = rgbHex(c);
    var sw = root.querySelector('[data-rgb-swatch]');
    var tx = root.querySelector('[data-rgb-hex]');
    if (sw) { sw.style.background = hex; }
    if (tx) { tx.textContent = hex; }
    for (var i = 0; i < RGB_CHANNELS.length; i++) {
      var ch = RGB_CHANNELS[i], v = c[ch], pct = rgbPct(v);
      root.setAttribute('data-' + ch, v);
      var fill = root.querySelector('[data-rgb-fill=' + ch + ']');
      var th = root.querySelector('[data-range-thumb=' + ch + ']');
      var val = root.querySelector('[data-rgb-val=' + ch + ']');
      if (fill) { fill.style.right = (Math.round((100 - pct) * 10) / 10) + '%'; }
      if (th) { th.style.left = pct + '%'; th.setAttribute('aria-valuenow', v); }
      if (val) { val.textContent = v; }
    }
  }


  /**
   * Resolve a threshold slider's two stored values (display-unit strings; comma
   * decimals tolerated) into track order. Roles map to thumbs by the kind's
   * direction: the WORSE end owns the danger thumb — below-is-worse puts danger
   * on the left (lo) and warn on the right (hi); above-is-worse the reverse.
   * Unset/garbage values fall back to the item's seeds and everything is clamped
   * into [min, max] so a stale stored value can't strand a thumb off the track.
   * @param {Object} item Resolved range item (rangeFrom config merged).
   * @param {*} warnRaw Stored warn value.
   * @param {*} dangerRaw Stored danger value.
   * @returns {{lo:number, hi:number, warn:number, danger:number}}
   */
  function thresholdValues(item, warnRaw, dangerRaw) {
    var min = Number(item.min), max = Number(item.max);
    function num(v, dflt) {
      var s = String(v == null ? '' : v).replace(/,/g, '.').replace(/\s/g, '');
      var n = s === '' ? NaN : Number(s);
      if (!isFinite(n)) { n = dflt; }
      if (n < min) { n = min; }
      if (n > max) { n = max; }
      return n;
    }
    var warn = num(warnRaw, item.seedWarn), danger = num(dangerRaw, item.seedDanger);
    var below = item.dir === 'below';
    var lo = below ? danger : warn, hi = below ? warn : danger;
    // Repair a legacy pair closer than the minimum span (the old text UI accepted
    // warn == danger): stacked thumbs put the danger knob on top (z-index) and a
    // stack pinned at a track end could never be separated again. Push the WARN
    // thumb inward first (danger keeps its stored position), and only shift the
    // danger thumb when the pair is pinned at the warn thumb's own bound. Display/
    // interaction-only — the stored pair changes on the next drag, not before.
    var span = rangeMinSpan(item);
    if (hi - lo < span) {
      if (below) {
        hi = Math.min(max, lo + span);
        lo = Math.min(lo, hi - span);
      } else {
        lo = Math.max(min, hi - span);
        hi = Math.max(hi, lo + span);
      }
    }
    return below
      ? { lo: lo, hi: hi, warn: hi, danger: lo }
      : { lo: lo, hi: hi, warn: lo, danger: hi };
  }

  /**
   * The readout chip pair above a threshold slider — warn outlined in the warn
   * color, danger filled with the danger color, echoing how the watch draws the
   * two levels on the status slot itself.
   * @param {Object} item Resolved range item (colors + unit).
   * @param {{warn:number, danger:number}} r Current values.
   * @returns {string} Chips row HTML.
   */
  function thresholdChipsHtml(item, r) {
    return '<div class="rng-chips">'
      + '<span class="rng-chip warn" style="--th-c:' + esc(item.warnColor)
      + '">' + esc(thresholdChipText(item, 'warn', r.warn)) + '</span>'
      + '<span class="rng-chip danger" style="--th-c:' + esc(item.dangerColor)
      + ';--th-tx:' + esc(item.dangerText) + '">'
      + esc(thresholdChipText(item, 'danger', r.danger)) + '</span>'
      + '</div>';
  }

  /**
   * The role wording for one threshold level: the resolved range item's
   * warnLabel/dangerLabel — Close/Goal on the celebratory goal kinds — with the
   * weather-kind fallback Warn/Danger. The SINGLE source of that fallback,
   * shared by the readout chips and the slider-thumb aria-labels so they cannot
   * drift.
   * @param {Object} item Resolved range item (labels).
   * @param {string} which 'warn' | 'danger'.
   * @returns {string} Role label, e.g. 'Warn' or 'Close'.
   */
  function thresholdRoleLabel(item, which) {
    return which === 'warn'
      ? (item.warnLabel || 'Warn') : (item.dangerLabel || 'Danger');
  }

  /**
   * One threshold chip's text. The SINGLE source of the chip wording: the
   * initial render and the drag repaint both go through here, so they cannot
   * drift (they did — the repaint hardcoded Warn/Danger and the first drag on a
   * goal kind relabelled its Close/Goal chips).
   * @param {Object} item Resolved range item (labels + unit).
   * @param {string} which 'warn' | 'danger'.
   * @param {number} value The value to show.
   * @returns {string} Chip text, e.g. 'Close 8000' or 'Warn 40 kph'.
   */
  function thresholdChipText(item, which, value) {
    return thresholdRoleLabel(item, which) + ' ' + value + (item.unit ? ' ' + item.unit : '');
  }

  /**
   * Threshold slider (item.rangeFrom): semantic-zone track — danger color at the
   * kind's worse end up to the danger thumb, warn color between the thumbs, plain
   * track for the normal zone — plus the outlined-warn / filled-danger thumbs and
   * an optional inline scale-max editor on unbounded kinds.
   * @param {Object} item Resolved range item.
   * @param {{value:*, dangerValue:*}} view Render state (warn rides value, danger
   *   rides dangerValue — set by resolveRowItem).
   * @returns {string} Control HTML.
   */
  function renderThresholdRange(item, view) {
    var r = thresholdValues(item, view.value, view.dangerValue);
    var min = Number(item.min), max = Number(item.max);
    var span = (max - min) || 1;
    /**
     * @param {number} v Value.
     * @returns {string} Track offset from the left as a percentage, one decimal.
     */
    function pct(v) { return (Math.round(((v - min) * 1000) / span) / 10) + '%'; }
    /**
     * @param {number} v Value.
     * @returns {string} Track offset from the RIGHT as a percentage, one decimal.
     */
    function rpc(v) { return (Math.round(1000 - ((v - min) * 1000) / span) / 10) + '%'; }
    var below = item.dir === 'below';
    // Zone rects: warn always spans the thumbs; danger hugs the worse end.
    var zones = (below
      ? '<div class="rng-zone" data-zone="danger" style="--th-c:' + esc(item.dangerColor)
        + ';left:0;right:' + rpc(r.lo) + '"></div>'
      : '<div class="rng-zone" data-zone="danger" style="--th-c:' + esc(item.dangerColor)
        + ';left:' + pct(r.hi) + ';right:0"></div>')
      + '<div class="rng-zone" data-zone="warn" style="--th-c:' + esc(item.warnColor)
      + ';left:' + pct(r.lo) + ';right:' + rpc(r.hi) + '"></div>';
    /**
     * @param {string} which 'lo' | 'hi' (track role for the drag machinery).
     * @param {string} role 'warn' | 'danger' (visual + aria role).
     * @param {number} value Current value.
     * @returns {string} Thumb button HTML.
     */
    function thumb(which, role, value) {
      var color = role === 'warn' ? item.warnColor : item.dangerColor;
      var glow = role === 'warn' ? item.warnGlow : item.dangerGlow;
      return '<button type="button" class="rng-th th-' + role + '" data-range-thumb="' + which
        + '" style="left:' + pct(value) + ';--th-c:' + esc(color) + ';--th-glow:' + esc(glow)
        + '" role="slider" aria-label="' + esc(thresholdRoleLabel(item, role)) + ' threshold'
        + '" aria-valuemin="' + min + '" aria-valuemax="' + max
        + '" aria-valuenow="' + (role === 'warn' ? r.warn : r.danger) + '"></button>';
    }
    var maxLabel = item.maxEditable
      ? '<span class="rng-max"><span>' + max + '</span>'
        + '<button type="button" class="rng-max-edit" data-max-edit="' + esc(item.maxKey)
        + '" data-max-current="' + max + '" aria-label="Adjust the scale maximum">'
        + PEN_SVG + '</button></span>'
      : '<span>' + max + '</span>';
    return '<div class="rng" data-range="' + esc(item.messageKey) + '" data-lo="' + r.lo
      + '" data-hi="' + r.hi + '">'
      + thresholdChipsHtml(item, r)
      + '<div class="rng-track">' + zones
      + thumb(below ? 'hi' : 'lo', 'warn', r.warn)
      + thumb(below ? 'lo' : 'hi', 'danger', r.danger)
      + '</div>'
      + '<div class="rng-ends"><span>' + min + '</span>' + maxLabel + '</div>'
      + '</div>';
  }

  /**
   * Repaint one threshold slider in place during a drag (no re-render): chips,
   * zone rects, thumbs and the data-lo/data-hi state the pointer handler reads.
   * @param {Element} root .rng element.
   * @param {Object} item Resolved range item.
   * @param {{lo:number, hi:number}} r New range (track order).
   * @returns {void}
   */
  function paintThresholdRange(root, item, r) {
    var min = Number(item.min), max = Number(item.max);
    var span = (max - min) || 1;
    var loPct = ((r.lo - min) * 100) / span, hiPct = ((r.hi - min) * 100) / span;
    var below = item.dir === 'below';
    var warn = below ? r.hi : r.lo, danger = below ? r.lo : r.hi;
    root.setAttribute('data-lo', r.lo);
    root.setAttribute('data-hi', r.hi);
    var chips = root.querySelectorAll('.rng-chip');
    if (chips.length === 2) {
      chips[0].textContent = thresholdChipText(item, 'warn', warn);
      chips[1].textContent = thresholdChipText(item, 'danger', danger);
    }
    var wz = root.querySelector('[data-zone="warn"]');
    var dz = root.querySelector('[data-zone="danger"]');
    wz.style.left = loPct + '%';
    wz.style.right = (100 - hiPct) + '%';
    if (below) { dz.style.right = (100 - loPct) + '%'; } else { dz.style.left = hiPct + '%'; }
    var lo = root.querySelector('[data-range-thumb=lo]');
    var hi = root.querySelector('[data-range-thumb=hi]');
    lo.style.left = loPct + '%';
    hi.style.left = hiPct + '%';
    lo.setAttribute('aria-valuenow', below ? danger : warn);
    hi.setAttribute('aria-valuenow', below ? warn : danger);
  }

  /**
   * Dual-thumb range track. Renders from the stored "lo-hi" string; the drag
   * handler in wireInputs() moves the thumbs through moveThumb(). The current
   * values ride on the root as data-lo/data-hi so the pointer handler can read
   * them without re-parsing, and the thumbs are positioned as a percentage of
   * the track so the control needs no measured width at render time.
   * A rangeFrom item renders the threshold variant instead (semantic zones, two
   * independent storage keys) — see renderThresholdRange.
   * @param {Object} item Range schema item (min/max/step/minSpan/unit).
   * @param {{value:*}} view Render state.
   * @returns {string} Control HTML.
   */
  function renderRange(item, view) {
    if (item.rangeFrom) { return renderThresholdRange(item, view); }
    var r = parseRange(view.value, item);
    var min = Number(item.min), max = Number(item.max);
    var span = (max - min) || 1;
    var unit = item.unit ? ' ' + esc(item.unit) : '';
    /**
     * @param {number} v Value.
     * @returns {string} Track offset as a percentage, one decimal.
     */
    function pct(v) { return (Math.round(((v - min) * 1000) / span) / 10) + '%'; }
    var key = esc(item.messageKey);
    return '<div class="rng" data-range="' + key + '" data-lo="' + r.lo
      + '" data-hi="' + r.hi + '">'
      + '<div class="rng-val">' + r.lo + ' &ndash; ' + r.hi + unit + '</div>'
      + '<div class="rng-track">'
      + '<div class="rng-fill" style="left:' + pct(r.lo)
      + ';right:' + (Math.round((1000 - ((r.hi - min) * 1000) / span)) / 10) + '%"></div>'
      + '<button type="button" class="rng-th" data-range-thumb="lo" style="left:' + pct(r.lo)
      + '" role="slider" aria-label="' + esc(String(item.label || 'Range') + ' minimum')
      + '" aria-valuemin="' + min + '" aria-valuemax="' + max + '" aria-valuenow="' + r.lo + '"></button>'
      + '<button type="button" class="rng-th" data-range-thumb="hi" style="left:' + pct(r.hi)
      + '" role="slider" aria-label="' + esc(String(item.label || 'Range') + ' maximum')
      + '" aria-valuemin="' + min + '" aria-valuemax="' + max + '" aria-valuenow="' + r.hi + '"></button>'
      + '</div>'
      + '<div class="rng-ends"><span>' + min + '</span><span>' + max + '</span></div>'
      + '</div>';
  }

  /**
   * The boot-scoped half: one drag state + handler set serving BOTH #scroll
   * and #modal (threshold sliders live in the edit sheet; the plain range in
   * the tab body). One instance per page boot; ctx hands in the live accessors
   * — and the engine's swipe-dismiss reads the drag state back through
   * isDragging(), so a sheet drag never fights a thumb drag.
   *
   * @param {Object} ctx
   *   {Object} ctx.S Live settings state.
   *   {Object} ctx.ENV Platform env.
   *   {function(string): ?Object} ctx.findItem Schema item by messageKey.
   *   {function(Object, Object, Object): ?Object} ctx.resolveRangeItem The
   *     engine's rangeFrom resolver dispatch.
   *   {function(): void} ctx.render Full re-render.
   * @returns {{wireRangeEvents: Function, openMaxEdit: Function,
   *   commitMaxEdit: Function, isDragging: Function}}
   */
  function createRangeWiring(ctx) {
    // --- shared range-slider wiring --- one drag state + handler set serves BOTH
    // #scroll and #modal: threshold sliders live in the edit sheet (a dialog outside
    // #scroll) while the plain dual-thumb range lives in the tab body. render()
    // replaces the host's innerHTML wholesale, so a re-render mid-gesture would
    // destroy the element being dragged and drop pointer capture — the same hazard
    // the text input avoids by writing S on `input` and only re-rendering on
    // `change`. So: mutate the DOM directly for the duration of the drag, then
    // render() ONCE on release, which lets any dependent showWhen/blocks catch up.
    var drag = null;   // { root, thumb, which, item, pointerId } while a thumb is held
    /**
     * Map a client x within the track to a value on the control's scale — the
     * item's [min, max] for a range/threshold slider, the fixed [0, 255] of one
     * channel byte for the rgb control.
     * @param {Element} track .rng-track element.
     * @param {Object} item Range or rgb schema item.
     * @param {number} clientX Pointer x.
     * @returns {number} Unsnapped value at that position.
     */
    function rangeValueAt(track, item, clientX) {
      var min = isRgbItem(item) ? RGB_MIN : Number(item.min);
      var max = isRgbItem(item) ? RGB_MAX : Number(item.max);
      var box = track.getBoundingClientRect();
      var frac = box.width > 0 ? (clientX - box.left) / box.width : 0;
      if (frac < 0) { frac = 0; }
      if (frac > 1) { frac = 1; }
      return min + frac * (max - min);
    }
    /**
     * Repaint one control in place (no re-render) from a new value state.
     * @param {Element} root .rng element.
     * @param {Object} item Resolved range or rgb schema item.
     * @param {Object} r New state — {r,g,b} for rgb, {lo,hi} for a slider.
     * @returns {void}
     */
    function paintRange(root, item, r) {
      if (isRgbItem(item)) { paintRgb(root, item, r); return; }
      if (item.rangeFrom) { paintThresholdRange(root, item, r); return; }
      var min = Number(item.min), max = Number(item.max);
      var span = (max - min) || 1;
      var loPct = ((r.lo - min) * 100) / span, hiPct = ((r.hi - min) * 100) / span;
      root.setAttribute('data-lo', r.lo);
      root.setAttribute('data-hi', r.hi);
      root.querySelector('.rng-val').innerHTML = r.lo + ' &ndash; ' + r.hi
        + (item.unit ? ' ' + esc(item.unit) : '');
      var fill = root.querySelector('.rng-fill');
      fill.style.left = loPct + '%';
      fill.style.right = (100 - hiPct) + '%';
      var lo = root.querySelector('[data-range-thumb=lo]');
      var hi = root.querySelector('[data-range-thumb=hi]');
      lo.style.left = loPct + '%';
      hi.style.left = hiPct + '%';
      lo.setAttribute('aria-valuenow', r.lo);
      hi.setAttribute('aria-valuenow', r.hi);
    }
    /**
     * Write a moved value into S. A threshold slider stores its two thumbs in the
     * warn/danger keys (track order mapped back through the kind's direction); the
     * plain range keeps its single "lo-hi" string and the rgb control its single
     * "r,g,b" one.
     * @param {Object} item Resolved range or rgb item.
     * @param {Object} r New state — {r,g,b} for rgb, {lo,hi} for a slider.
     * @returns {void}
     */
    function commitRange(item, r) {
      if (isRgbItem(item)) { ctx.S[item.messageKey] = formatRgb(r); return; }
      if (item.rangeFrom) {
        var below = item.dir === 'below';
        ctx.S[item.messageKey] = String(below ? r.hi : r.lo);
        ctx.S[item.dangerKey] = String(below ? r.lo : r.hi);
        return;
      }
      ctx.S[item.messageKey] = formatRange(r);
    }
    /**
     * The resolved item for a live .rng root — rangeFrom config merged for a
     * threshold slider, the raw schema item otherwise.
     * @param {Element} root .rng element.
     * @returns {?Object} Resolved item, or null when unknown.
     */
    function liveRangeItem(root) {
      var item = ctx.findItem(root.getAttribute('data-range'));
      return item ? ctx.resolveRangeItem(item, ctx.S, ctx.ENV) : null;
    }
    /**
     * End a drag: one render() so dependent rows/blocks refresh.
     * @returns {void}
     */
    function endRangeDrag() {
      if (!drag) { return; }
      drag = null;
      ctx.render();
    }
    /**
     * Current value state off a .rng root: data-r/data-g/data-b for the rgb
     * control, data-lo/data-hi for a slider. Parsed as floats: threshold kinds may
     * step in halves (sleep hours, pollen bands, km).
     * @param {Element} root .rng element.
     * @param {Object} [item] Resolved range or rgb schema item.
     * @returns {Object} {r,g,b} for rgb, {lo,hi} otherwise.
     */
    function rangeState(root, item) {
      if (isRgbItem(item)) {
        return {
          r: parseFloat(root.getAttribute('data-r')),
          g: parseFloat(root.getAttribute('data-g')),
          b: parseFloat(root.getAttribute('data-b'))
        };
      }
      return {
        lo: parseFloat(root.getAttribute('data-lo')),
        hi: parseFloat(root.getAttribute('data-hi'))
      };
    }
    /**
     * Apply a thumb move to a control's value state: one independent channel for
     * the rgb control, one non-crossing thumb for a slider.
     * @param {Object} state Current state ({r,g,b} or {lo,hi}).
     * @param {string} which Channel ('r'|'g'|'b') or thumb ('lo'|'hi') name.
     * @param {number} value Requested value for it.
     * @param {Object} item Resolved range or rgb schema item.
     * @returns {Object} The new state.
     */
    function moveControl(state, which, value, item) {
      return isRgbItem(item)
        ? setRgbChannel(state, which, value, item) : moveThumb(state, which, value, item);
    }
    /**
     * Do two value states carry the same numbers? Guards the drag repaint so a
     * frame that moved nothing does no DOM work.
     * @param {Object} a One state.
     * @param {Object} b The other state.
     * @param {Object} item Resolved range or rgb schema item.
     * @returns {boolean} True when nothing moved.
     */
    function sameState(a, b, item) {
      return isRgbItem(item)
        ? (a.r === b.r && a.g === b.g && a.b === b.b) : (a.lo === b.lo && a.hi === b.hi);
    }
    /**
     * Attach the range pointer/keyboard handlers to a host container.
     * @param {Element} host #scroll or #modal.
     * @returns {void}
     */
    function wireRangeEvents(host) {
      host.addEventListener('pointerdown', function (e) {
        var th = e.target.closest && e.target.closest('[data-range-thumb]');
        if (!th) { return; }
        // A disabled row's slider is inert (CSS blocks pointers; this guard covers
        // whatever slips through, and mirrors the keyboard guard below).
        if (th.closest('.dis')) { return; }
        // A render() elsewhere can detach a mid-gesture slider (the drag's pointerup
        // then lands on nodes no host sees) — a wedged stale drag must not block the
        // next grab forever.
        if (drag && drag.root && drag.root.isConnected === false) { drag = null; }
        // A drag is already in flight: a second finger landing on the other thumb of
        // the same (or another) slider must not hijack it — ignore the second pointer
        // entirely rather than clobbering `drag`.
        if (drag) { return; }
        var root = th.closest('.rng');
        var item = liveRangeItem(root);
        if (!item) { return; }
        drag = { root: root, thumb: th, which: th.getAttribute('data-range-thumb'),
          item: item, pointerId: e.pointerId };
        th.setPointerCapture(e.pointerId);
        // preventDefault() (needed to stop text selection / page scroll mid-drag) also
        // suppresses the browser's implicit focus-on-mousedown for the button in some
        // browsers, which would otherwise silently break arrow-key nudging right after
        // a drag — so take the focus back explicitly.
        th.focus();
        e.preventDefault();
      });
      host.addEventListener('pointermove', function (e) {
        if (!drag || e.pointerId !== drag.pointerId) { return; }
        // The dragged slider was detached by a render() mid-gesture (e.g. the inline
        // scale-max field committing on the grab's focus shift): its rect is 0-wide,
        // so the math would slam the value to the track start — end the drag instead.
        if (drag.root.isConnected === false) { drag = null; ctx.render(); return; }
        // The thumb's OWN track, not the root's first one: an rgb control stacks
        // three tracks under one root, and measuring the R track while dragging B
        // would map the pointer onto the wrong rect.
        var track = (drag.thumb.closest && drag.thumb.closest('.rng-track'))
          || drag.root.querySelector('.rng-track');
        var current = rangeState(drag.root, drag.item);
        var next = moveControl(current, drag.which,
          rangeValueAt(track, drag.item, e.clientX), drag.item);
        if (sameState(next, current, drag.item)) { return; }
        paintRange(drag.root, drag.item, next);
        commitRange(drag.item, next);
      });
      host.addEventListener('pointerup', endRangeDrag);
      host.addEventListener('pointercancel', endRangeDrag);
      // Keyboard: arrows nudge the focused thumb one step. This deliberately does NOT
      // call render() — render() rebuilds the host's DOM, which would drop focus from
      // the thumb the user is arrowing — so it paints the move in place instead, same
      // as a drag frame. (Enter in the inline scale-max field commits via blur →
      // focusout, that field's single commit path.)
      host.addEventListener('keydown', function (e) {
        var mi = e.target.closest && e.target.closest('[data-max-input]');
        if (mi) { if (e.key === 'Enter') { mi.blur(); } return; }
        var th = e.target.closest && e.target.closest('[data-range-thumb]');
        if (!th) { return; }
        // Keyboard can still focus a disabled row's thumb (pointer-events doesn't
        // block tabbing) — nudges must not edit an inert slider.
        if (th.closest('.dis')) { return; }
        var delta = 0;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { delta = -1; }
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { delta = 1; }
        if (!delta) { return; }
        var root = th.closest('.rng');
        var item = liveRangeItem(root);
        if (!item) { return; }
        var which = th.getAttribute('data-range-thumb');
        var current = rangeState(root, item);
        var next = moveControl(current, which, current[which] + delta * rangeStep(item), item);
        paintRange(root, item, next);
        commitRange(item, next);
        e.preventDefault();
      });
    }
    /**
     * Swap a threshold slider's max bound label for an inline numeric field
     * (data-max-edit click). Committed by commitMaxEdit on focusout.
     * @param {Element} btn .rng-max-edit button.
     * @returns {void}
     */
    function openMaxEdit(btn) {
      var wrap = btn.closest('.rng-max');
      if (!wrap) { return; }
      var mk = btn.getAttribute('data-max-edit');
      var current = btn.getAttribute('data-max-current') || '';
      wrap.innerHTML = '<input type="text" inputmode="decimal" class="rng-max-input"'
        + ' data-max-input="' + esc(mk) + '" data-max-seed="' + esc(current)
        + '" value="' + esc(current) + '" aria-label="Scale maximum">';
      var inp = wrap.querySelector('input');
      inp.focus();
      if (inp.select) { inp.select(); }
    }
    /**
     * Commit the inline scale-max field (focusout): store the raw request — the
     * range resolver clamps/grows it against the current thresholds at the next
     * resolve — then fold the field back into its label by rebuilding THIS
     * slider's .rng root in place. No data-k on the field keeps it out of the
     * shared text plumbing.
     * Only the slider, never the whole host: on a tap, focus moves on the
     * mousedown, before the click, so a full render() here replaced the node the
     * user was tapping (the sheet's X, a Bold option …) and the click never
     * arrived — every first tap after the editor was swallowed. The whole root
     * is rebuilt, not just the label: the resolver grows or clamps the max, and
     * the thumb, zone and chip positions all hang off it. Nothing outside the
     * slider reads the max, so there is nothing else to refresh.
     * An UNTOUCHED field (opened, then blurred) writes nothing: the seed it was
     * opened with is the RESOLVED max, and storing that would silently pin an
     * override where none existed — but it still folds back. And while a thumb
     * drag is in flight (grabbing a thumb blurs the field via th.focus()), the
     * fold-back is skipped — it would detach the dragged nodes mid-gesture and
     * slam the value to the track start; endRangeDrag's render on release folds
     * the field back instead.
     * @param {Event} e focusout event.
     * @returns {void}
     */
    function commitMaxEdit(e) {
      var inp = e.target.closest && e.target.closest('[data-max-input]');
      if (!inp) { return; }
      if (String(inp.value) !== String(inp.getAttribute('data-max-seed'))) {
        var s = String(inp.value).replace(/,/g, '.').replace(/\s/g, '');
        var n = s === '' ? NaN : Number(s);
        ctx.S[inp.getAttribute('data-max-input')] = (isFinite(n) && n > 0) ? String(n) : '';
      }
      if (drag) { return; }
      var root = inp.closest('.rng');
      var item = (root && root.parentNode) ? liveRangeItem(root) : null;
      if (!item) { ctx.render(); return; }
      root.outerHTML = renderRange(item,
        { value: ctx.S[item.messageKey], dangerValue: ctx.S[item.dangerKey] });
    }
    return {
      wireRangeEvents: wireRangeEvents,
      openMaxEdit: openMaxEdit,
      commitMaxEdit: commitMaxEdit,
      isDragging: function () { return Boolean(drag); }
    };
  }

  PConf.rangeControl = {
    rangeStep: rangeStep,
    snapToStep: snapToStep,
    formatRange: formatRange,
    parseRange: parseRange,
    moveThumb: moveThumb,
    thresholdValues: thresholdValues,
    renderThresholdRange: renderThresholdRange,
    paintThresholdRange: paintThresholdRange,
    renderRange: renderRange,
    parseRgb: parseRgb,
    formatRgb: formatRgb,
    rgbHex: rgbHex,
    setRgbChannel: setRgbChannel,
    renderRgb: renderRgb,
    paintRgb: paintRgb,
    createRangeWiring: createRangeWiring
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.rangeControl; }
})();
