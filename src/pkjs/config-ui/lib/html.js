// src/pkjs/config-ui/lib/html.js — shared HTML primitives: the escape helper
// every renderer interpolates through, the sheet-header chrome the three modals
// share, and the colour readout the rgb control and a row's colour badge both
// print. A leaf: loaded before engine.js/date-picker.js/range-control.js
// in the page concat (build-page.js LIB_PAGE_FILES), required under Node.
// Dual-context export mirrors color.js: attached to the shared PConf global
// for the concatenated page (and the test bundle), module.exports under Node.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};

/**
 * HTML-escape author/user text interpolated into innerHTML. NOT applied to fields
 * documented as HTML (intro, hint, staticText.text, versionLabel) — intentional markup.
 *
 * @param {*} s Value to escape (coerced to string).
 * @returns {string} Escaped HTML-safe string.
 */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The shared sheet-header chrome: title span + the ONE close button, always
 * data-select-close (three modals used to hand-roll this, and the date modal
 * minted its own data-date-close attribute for a branch that routed to the
 * same closeModal anyway).
 * @param {string} titleId DOM id for the title span (aria-labelledby target).
 * @param {string} titleHtml Escaped/HTML title content.
 * @param {string} [afterTitleHtml] Optional markup seated directly after the title text
 *   (the edit sheet's reset button). It sits BESIDE the title rather than out at the
 *   right edge — the close button is the only thing that owns that corner, so the header
 *   packs from the left and the close pushes itself over with margin-left:auto.
 * @returns {string} Header markup.
 */
function sheetHeader(titleId, titleHtml, afterTitleHtml) {
  return '<div class="ssel-modal-hdr"><span class="ssel-modal-ttl" id="' + titleId + '">'
    + titleHtml + '</span>' + (afterTitleHtml || '')
    + '<button type="button" class="ssel-modal-close" data-select-close aria-label="Close">×</button></div>';
}

/**
 * The colour READOUT two surfaces share: the colour picker's swatch chrome
 * (.sw-wrap) reused to PRINT a colour rather than to open one — a chip and its
 * hex, with nothing to press (.sw-ro drops the pointer cursor).
 *
 * It renders in two places from this one builder: above the channel sliders in a
 * colour sheet (range-control.js renderRgb) and, at the same chip size, as a
 * row's colour badge (engine.js editSwatchHtml, via a resolver's badge.chip) —
 * so a row previews its value in exactly the vocabulary the sheet it opens uses.
 *
 * `live` is the ONLY difference between the two copies. The sheet's is repainted
 * IN PLACE mid-drag and so asks for the data-rgb-swatch / data-rgb-hex hooks
 * paintRgb writes through; a badge is re-rendered wholesale by the engine and
 * deliberately carries none — paintRgb scopes its lookups to the .rng.rgb root
 * it is handed, and a hookless badge keeps that safe even if a later caller
 * reaches for the document instead.
 *
 * @param {string} hex Colour to print as '#RRGGBB' (printed verbatim, escaped).
 * @param {boolean} [live] true to emit the paintRgb hooks — the sheet's copy only.
 * @returns {string} Readout markup: .sw-wrap.sw-ro wrapping the chip and the hex.
 */
function swatchReadout(hex, live) {
  var h = esc(String(hex));
  return '<span class="sw-wrap sw-ro">'
    + '<b' + (live ? ' data-rgb-swatch' : '') + ' style="background:' + h + '"></b>'
    + '<span' + (live ? ' data-rgb-hex' : '') + '>' + h + '</span></span>';
}

PConf.html = { esc: esc, sheetHeader: sheetHeader, swatchReadout: swatchReadout };
if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.html; }
