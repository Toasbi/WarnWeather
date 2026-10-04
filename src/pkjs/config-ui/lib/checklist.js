// src/pkjs/config-ui/lib/checklist.js — the `checklist` control (type: 'checklist'): a grid
// of ticks for ONE code, one row per option and one tick per column, each tick reading
// whether its list holds the code. Render only: a tap is engine.js's (controlClick's
// [data-check] case hands it to the writer the grid names, a PConf.checkWriters id), and
// the engine keeps the CONTROLS dispatch entry. A leaf over html.js (esc, nbClass): loaded
// after it and before engine.js in the page concat (build-page.js LIB_PAGE_FILES). Dual-
// context like the other lib files: PConf bridge in the concatenated page/test bundle,
// module.exports under Node.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
(function () {
  var htmlLib = (typeof require !== 'undefined') ? require('./html.js') : PConf.html;
  var esc = htmlLib.esc;
  var nbClass = htmlLib.nbClass;

  /**
   * The codes a stored list holds: its comma list split, blanks dropped.
   * @param {*} value Stored list, e.g. 'bt,qt,snooze' ('' when none).
   * @returns {string[]} The codes, in stored order.
   */
  function checklistCodes(value) {
    var parts = String(value == null ? '' : value).split(','), out = [], i;
    for (i = 0; i < parts.length; i++) { if (parts[i]) { out.push(parts[i]); } }
    return out;
  }

  /**
   * A `checklist` control, a grid of ticks for ONE code (item.check): under one sub-header
   * (item.label, in the .subhdr.grp look, carrying the columns' captions over their ticks),
   * one plain row per option, its name as the label and meta.desc as the hint, with one
   * tick per column on the right. Each option names the lists its ticks read and write in
   * meta.keys, one key per column, left to right; item.columns carries the captions. The
   * rows are joined (no divider, the tight rhythm of joinPrevious). A tick is on while its
   * list holds the code, and names its list (data-k), the code (data-check) and the writer
   * that stores a tap (data-write: item.writeWith, a PConf.checkWriters id). meta.disabled
   * renders a row's ticks inert WITH their state, so a gate never rewrites a stored list.
   * @param {Object} item Checklist item with its options materialized (resolveRowItem).
   * @param {{lists: Object}} view Render state: lists is the live settings the ticks read.
   * @returns {string} Control HTML.
   */
  function renderChecklist(item, view) {
    var cols = item.columns || [], opts = item.options || [], lists = view.lists || {};
    var code = String(item.check), label = esc(String(item.label || '')), write = esc(item.writeWith || '');
    var i, c, meta, key, on, gated;
    // captionsOnly: the grid sits in a card its name already titles (a "Shows on" card),
    // so its header row carries only the columns' captions; the label still names it.
    var h = '<div class="chk-list" role="group" aria-label="' + label + '">'
      + '<div class="subhdr grp chk-hdr' + (item.captionsOnly ? ' caps-only' : '') + '"><span>'
      + (item.captionsOnly ? '' : label) + '</span><span class="chk-caps" aria-hidden="true">';
    for (c = 0; c < cols.length; c++) { h += '<span>' + esc(String(cols[c].label || '')) + '</span>'; }
    h += '</span></div>';
    for (i = 0; i < opts.length; i++) {
      meta = opts[i][2] || {};
      gated = Boolean(meta.disabled);
      h += '<div class="row chk-opt' + nbClass(i < opts.length - 1 ? 'tight' : '') + (gated ? ' off' : '') + '">'
        + '<span class="lft"><span class="lbl">' + esc(opts[i][0]) + '</span>'
        + (meta.desc ? '<span class="hint">' + esc(meta.desc) + '</span>' : '') + '</span>'
        + '<span class="chk-ticks">';
      for (c = 0; c < cols.length; c++) {
        key = (meta.keys || [])[c];
        on = checklistCodes(lists[key]).indexOf(code) >= 0;
        h += '<button type="button" class="chk-tick' + (on ? ' on' : '') + '" role="checkbox" aria-checked="'
          + (on ? 'true' : 'false') + '" aria-label="' + esc(opts[i][0] + ', ' + cols[c].label)
          + '" data-k="' + esc(key) + '" data-check="' + esc(code) + '" data-write="' + write + '"'
          + (gated ? ' disabled aria-disabled="true"' : '') + '>'
          + '<span class="chk-box" aria-hidden="true"></span></button>';
      }
      h += '</span></div>';
    }
    return h + '</div>';
  }

  PConf.checklist = {
    renderChecklist: renderChecklist
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.checklist; }
})();
