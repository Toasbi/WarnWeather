// src/pkjs/config-ui/lib/html.js — shared HTML primitives: the escape helper
// every renderer interpolates through, and the sheet-header chrome the three
// modals share. A leaf: loaded before engine.js/date-picker.js/range-control.js
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
 * @returns {string} Header markup.
 */
function sheetHeader(titleId, titleHtml) {
  return '<div class="ssel-modal-hdr"><span class="ssel-modal-ttl" id="' + titleId + '">'
    + titleHtml + '</span>'
    + '<button type="button" class="ssel-modal-close" data-select-close aria-label="Close">×</button></div>';
}

PConf.html = { esc: esc, sheetHeader: sheetHeader };
if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.html; }
