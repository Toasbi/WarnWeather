// src/pkjs/config-ui/lib/rgb-control.js — the three-channel colour control (type:
// 'rgb'), whole: the "r,g,b" value rules, the renderer and the in-place repaint. Each
// channel is range-control.js's single-thumb track, and that file's createRangeWiring
// drags and nudges it, reading PConf.rgbControl when it is called (at boot), so this
// file loads AFTER range-control.js (build-page.js LIB_PAGE_FILES). The engine keeps
// the CONTROLS dispatch entry and re-exports these names. Dual-context like the other
// lib files: PConf bridge in the concatenated page/test bundle, module.exports under
// Node.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
(function () {
  var htmlLib = (typeof require !== 'undefined') ? require('./html.js') : PConf.html;
  var esc = htmlLib.esc;
  // The chip+hex readout above the channel sliders. It is NOT local to this file:
  // a row's colour badge prints the same fragment from the same builder (html.js),
  // so the card and the sheet cannot drift apart.
  var swatchReadout = htmlLib.swatchReadout;
  // The step rules and the single-thumb track this control shares with the sliders.
  var rangeControl = (typeof require !== 'undefined') ? require('./range-control.js') : PConf.rangeControl;
  var rangeStep = rangeControl.rangeStep;
  var snapToStep = rangeControl.snapToStep;
  var singleTrackHtml = rangeControl.singleTrackHtml;
  var paintSingleTrack = rangeControl.paintSingleTrack;

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
   * name is spelled, so every dispatch in range-control.js's createRangeWiring
   * (paint, commit, drag math) agrees on what an rgb item is.
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
   * one single-thumb track per channel — the one-thumb range's own track
   * (singleTrackHtml), so the drag, keyboard-nudge, focus and disabled-row rules
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
      var ch = RGB_CHANNELS[i], v = c[ch], chrome = RGB_CHROME[ch];
      h += '<div class="rgb-ch" style="--th-c:' + chrome.tint + ';--th-glow:' + chrome.glow + '">'
        + '<span class="rgb-ch-lbl" aria-hidden="true">' + chrome.short + '</span>'
        + singleTrackHtml(ch, rgbPct(v), v, RGB_MIN, RGB_MAX, label + ' ' + chrome.name,
          ' data-rgb-fill="' + ch + '"')
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
      var ch = RGB_CHANNELS[i], v = c[ch];
      root.setAttribute('data-' + ch, v);
      paintSingleTrack(root.querySelector('[data-rgb-fill=' + ch + ']'),
        root.querySelector('[data-range-thumb=' + ch + ']'), rgbPct(v), v);
      var val = root.querySelector('[data-rgb-val=' + ch + ']');
      if (val) { val.textContent = v; }
    }
  }

  PConf.rgbControl = {
    RGB_MIN: RGB_MIN,
    RGB_MAX: RGB_MAX,
    isRgbItem: isRgbItem,
    parseRgb: parseRgb,
    formatRgb: formatRgb,
    rgbHex: rgbHex,
    setRgbChannel: setRgbChannel,
    renderRgb: renderRgb,
    paintRgb: paintRgb
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.rgbControl; }
})();
