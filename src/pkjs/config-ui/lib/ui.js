// src/pkjs/config-ui/lib/ui.js — the page's shared parts: one builder for each piece that more
// than one place draws, so a tab's rows, a block's list, a dialog and the screen editor read the
// same (the owner's ask, 2026-11-09: no copies of a part in the pages, the part in the engine).
// The red arrow of anything that opens a screen of its own, the red ▸/▾ of anything that folds
// open in place, Delete (the last thing under what it deletes), the Undo after it and the timer
// that takes it away, a list's New row, a chip, a dropdown, an Edit button, the pencil that
// renames, the name field with its OK, a note, the line icons, the header of a full-screen view
// (a dialog's, the screen editor's) and the header of a popup over the page (News, Support).
// Markup here, the look in shell.html (the .ui-* rules, and the engine's .chev and .dlg-* rules
// these parts share). A leaf over html.js (esc): loaded after it and before engine.js in the
// page concat (build-page.js LIB_PAGE_FILES); engine.js draws its nav rows, its folding cards,
// its dropdowns, its Edit buttons, its dialogs' headers and their Delete with it, and an app's
// page modules draw theirs with it.
// Dual-context like the other lib files: PConf bridge in the concatenated page/test bundle,
// module.exports under Node.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
(function () {
  var esc = ((typeof require !== 'undefined') ? require('./html.js') : PConf.html).esc;

  // The line icons, 24-unit paths stroked in the text colour (.ui-ic).
  var ICONS = {
    plus: 'M12 5v14M5 12h14',
    pen: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    x: 'M6 6l12 12M18 6L6 18',
    grip: 'M5 8.5h14M5 12h14M5 15.5h14',
    swap: 'M5 8h13M14 4.5L18 8l-4 3.5M19 16H6M10 12.5L6 16l4 3.5'
  };

  /**
   * A tag's attributes from a map: each value escaped, true for a bare attribute, null, undefined
   * and false left out.
   * @param {?Object} map Attribute name → value.
   * @returns {string} ' name="value"…' ('' for none)
   */
  function attrs(map) {
    var out = '', k, v;
    for (k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) { continue; }
      v = map[k];
      if (v === null || v === undefined || v === false) { continue; }
      out += v === true ? ' ' + k : ' ' + k + '="' + esc(String(v)) + '"';
    }
    return out;
  }

  /**
   * A line icon, in the text colour around it.
   * @param {string} name One of ICONS' names.
   * @returns {string} SVG markup ('' for an unknown name)
   */
  function icon(name) {
    if (!ICONS[name]) { return ''; }
    return '<svg class="ui-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + ICONS[name]
      + '"/></svg>';
  }

  /**
   * The red arrow at the end of anything that opens a screen of its own: a nav row (engine
   * chevronRow), a list's row (the Screens card, Your status bars).
   * @returns {string} Markup
   */
  function navArrow() {
    return '<span class="chev nav" aria-hidden="true">&#8250;</span>';
  }

  /**
   * The red ▸ of anything that folds open in place, ▾ while it is open: a collapsible card's
   * header (engine cardHeaderHtml). What it opens says aria-expanded on the button that carries
   * it.
   * @param {boolean} open Whether it is open.
   * @returns {string} Markup
   */
  function foldChev(open) {
    return '<span class="chev fold" aria-hidden="true">' + (open ? '&#9662;' : '&#9656;') + '</span>';
  }

  /**
   * Delete: the last thing under what it deletes, outside its cards, centred in the accent (a
   * dialog's delete item, engine buildCards; the screen editor's Delete screen; Graphs' Delete).
   * @param {string} label What it says ("Delete status bar").
   * @param {Object} at Its attributes (what a tap does: data-action, data-se, …).
   * @returns {string} Markup
   */
  function deleteButton(label, at) {
    return '<button type="button" class="ui-del"' + attrs(at) + '>' + esc(label) + '</button>';
  }

  /**
   * The Undo after a delete, in the list the thing went from, for as long as its flash lasts.
   * @param {string} text What went ("Flick 1 deleted.").
   * @param {Object} at Undo's attributes.
   * @returns {string} Markup
   */
  function undoToast(text, at) {
    return '<div class="ui-toast" role="status"><span>' + esc(text) + '</span>'
      + '<button type="button" class="ui-undo"' + attrs(at) + '>Undo</button></div>';
  }

  /**
   * A list's New row at its foot: the plus and what it makes in the accent, how many there are
   * on the right.
   * @param {string} label What it makes ("New status bar").
   * @param {string} note How many there are ("4 of 6 status bars"), '' for nothing.
   * @param {Object} at Its attributes.
   * @returns {string} Markup
   */
  function newRow(label, note, at) {
    return '<button type="button" class="ui-row ui-new"' + attrs(at) + '>' + icon('plus') + '<span class="ui-n">'
      + esc(label) + '</span>' + (note ? '<span class="ui-d">' + esc(note) + '</span>' : '') + '</button>';
  }

  /**
   * A chip: an Add chip (the screen editor's Add row: the plus in the accent before what it
   * adds) or a toggle chip (Graphs' Show on: on, tinted and ticked). Its group carries the
   * caption (a .ui-cap) and the role. A disabled chip takes no tap; a dim one looks greyed out
   * and is marked so (aria-disabled) but still takes a tap (the screen editor's graph chip that
   * says why it cannot be added).
   * @param {string} label What it says.
   * @param {Object} at Its attributes (what a tap does, aria-pressed, aria-disabled, disabled).
   * @param {{icon: ?string, on: boolean, dim: boolean}} [o] An icon before the label, whether it
   *   is on, and whether it looks greyed out.
   * @returns {string} Markup
   */
  function chip(label, at, o) {
    var opt = o || {};
    var all = opt.dim ? Object.assign({}, at, { 'aria-disabled': 'true' }) : at;
    return '<button type="button" class="ui-chip' + (opt.on ? ' on' : '') + (opt.dim ? ' dim' : '') + '"' + attrs(all) + '>'
      + (opt.icon ? icon(opt.icon) : '') + esc(label) + '</button>';
  }

  /**
   * A dropdown: what is picked, then the ▾ that says a tap opens its picker (an engine select's
   * trigger; the screen editor's Rows and Size).
   * @param {string} label What it shows.
   * @param {Object} at Its attributes (what a tap does, its accessible name, aria-haspopup).
   * @returns {string} Markup
   */
  function dropdown(label, at) {
    return '<button type="button" class="sel-wrap"' + attrs(at) + '><span>' + esc(label)
      + '</span><i class="sel-chev"></i></button>';
  }

  /**
   * An Edit button: the outlined text button beside a value that opens what changes it (an
   * engine row's edit sheet).
   * @param {string} label What it says ("Edit").
   * @param {Object} at Its attributes (what a tap does, its accessible name).
   * @returns {string} Markup
   */
  function editButton(label, at) {
    return '<button type="button" class="thr-btn"' + attrs(at) + '><span>' + esc(label) + '</span></button>';
  }

  /**
   * The pencil that renames something, after its name.
   * @param {string} name The name it renames (said to a screen reader).
   * @param {Object} at Its attributes.
   * @returns {string} Markup
   */
  function penButton(name, at) {
    return '<button type="button" class="ui-pen"' + attrs(at) + ' aria-label="Rename ' + esc(name) + '">'
      + icon('pen') + '</button>';
  }

  /**
   * A name being typed, OK beside it (in the place of the name it renames, and of Done).
   * @param {{at: Object, okAt: Object, label: string, maxlength: number, placeholder: string,
   *   value: string}} o The field's attributes, OK's, the field's accessible name, its length
   *   cap, what it says empty and the name it opens on.
   * @returns {string} Markup
   */
  function renameField(o) {
    return '<input type="text" class="ui-rn-in"' + attrs(o.at) + ' maxlength="' + (Number(o.maxlength) || 40)
      + '" autocomplete="off" aria-label="' + esc(o.label) + '" placeholder="' + esc(o.placeholder || '')
      + '" value="' + esc(o.value) + '"><button type="button" class="dlg-done"' + attrs(o.okAt) + '>OK</button>';
  }

  /**
   * A note about what shows (nothing on a screen yet, why a move went back), in the page's
   * info look.
   * @param {string} text Plain text.
   * @returns {string} Markup
   */
  function note(text) {
    return '<div class="ui-note" role="status">' + esc(text) + '</div>';
  }

  /**
   * A full-screen view's header (an engine dialog's, the screen editor's): the way out on the
   * left, the kicker over the title with the pencil after it and what else rides it, Done on
   * the right. While renamed the title is a name field with OK in Done's place, the title
   * kept for assistive tech as the view's label. The title carries ssel-modal-ttl, so a
   * dialog's aria-labelledby finds it like every sheet's.
   * @param {{titleId: string, title: string, titleHtml: string, kicker: string,
   *   way: {glyph: string, label: string, at: Object}, pen: ?Object, afterTitle: string,
   *   done: ?Object, rename: ?Object}} o titleHtml the title as markup (its '?' glued on;
   *   the escaped title when absent); way the way out (× closes and discards, ‹ goes back
   *   keeping the changes); pen the pencil's attributes (null: no rename); done Done's
   *   attributes (null: none, a view that only picks); rename the name field (renameField's
   *   o) while it is renamed, else null.
   * @returns {string} Markup
   */
  function header(o) {
    var way = '<button type="button" class="dlg-x"' + attrs(o.way.at) + ' aria-label="' + esc(o.way.label) + '">'
      + o.way.glyph + '</button>';
    if (o.rename) {
      return '<div class="dlg-hdr renaming">' + way + '<span class="ssel-modal-ttl sr-only" id="' + esc(o.titleId) + '">'
        + esc(o.title) + '</span>' + renameField(o.rename) + '</div>';
    }
    return '<div class="dlg-hdr">' + way + '<div class="dlg-ttlwrap">'
      + (o.kicker ? '<span class="dlg-kick">' + esc(o.kicker) + '</span>' : '')
      + '<span class="dlg-ttlline"><span class="ssel-modal-ttl dlg-ttl" id="' + esc(o.titleId) + '">'
      + (o.titleHtml !== undefined ? o.titleHtml : esc(o.title)) + '</span>'
      + (o.pen ? penButton(o.title, o.pen) : '') + (o.afterTitle || '') + '</span></div>'
      + (o.done ? '<button type="button" class="dlg-done"' + attrs(o.done) + '>Done</button>' : '') + '</div>';
  }

  /**
   * A popup's header (the News and Support popups): its title, the × that closes it on the
   * right. The popup is a .ui-pop over the page holding a .ui-pop-card; it closes on a tap on
   * the × or on the dimmed page (each popup wires its own close attribute).
   * @param {string} title Plain text.
   * @param {Object} closeAt The ×'s attributes (what a tap does).
   * @returns {string} Markup
   */
  function popupHeader(title, closeAt) {
    return '<div class="ui-pop-hdr"><h2>' + esc(title) + '</h2><button type="button" class="ui-pop-x"' + attrs(closeAt)
      + ' aria-label="Close">&#10005;</button></div>';
  }

  /**
   * Show a message for a while (an Undo, why a move went back): kept in its box, which a
   * repaint draws from, and taken away after ms, a repaint after it.
   * @param {{v: *, t: *}} box Where it is kept, and its timer.
   * @param {*} v The message.
   * @param {number} ms How long it stays.
   * @param {function(): void} repaint What draws it.
   * @returns {void}
   */
  function flash(box, v, ms, repaint) {
    box.v = v;
    if (box.t) { clearTimeout(box.t); }
    box.t = setTimeout(function () {
      box.v = null;
      box.t = null;
      repaint();
    }, ms);
  }

  /**
   * A message gone before its time: the message and its timer.
   * @param {{v: *, t: *}} box Its box.
   * @returns {void}
   */
  function unflash(box) {
    box.v = null;
    if (box.t) { clearTimeout(box.t); box.t = null; }
  }

  PConf.ui = {
    attrs: attrs, icon: icon, navArrow: navArrow, foldChev: foldChev, deleteButton: deleteButton,
    undoToast: undoToast, newRow: newRow, chip: chip, dropdown: dropdown, editButton: editButton, penButton: penButton,
    renameField: renameField, note: note, header: header, popupHeader: popupHeader, flash: flash, unflash: unflash
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.ui; }
})();
