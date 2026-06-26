// src/pkjs/config-ui/lib/engine.js — ES5. PConf.engine/blocks/hooks + module.exports.
// Pure render helpers live at module scope (unit-testable); boot() owns live state + DOM wiring.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
(function () {
  // Shared single-source helpers: PConf.color / PConf.schemaWalk are concatenated before this
  // file in the page, and required first by the Node tests. No local re-implementation.
  var intToHex = PConf.color.intToHex;
  var eachItem = PConf.schemaWalk.eachItem;

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

  // --- block registry ---
  var blockMap = {};
  PConf.blocks = {
    register: function (id, fn) { blockMap[id] = fn; },
    get: function (id) { return blockMap[id]; }
  };

  // --- hook registry ---
  var loadFns = [], submitFns = [];
  PConf.hooks = {
    onLoad: function (fn) { loadFns.push(fn); },
    onSubmit: function (fn) { submitFns.push(fn); },
    runLoad: function (ctx) { loadFns.forEach(function (fn) { fn(ctx); }); },
    runSubmit: function (ctx) { submitFns.forEach(function (fn) { fn(ctx); }); }
  };

  /**
   * Build the initial settings state from a schema's defaults, with injected
   * (saved) values taking precedence. Number color defaults become hex strings.
   *
   * @param {Object} schema Config schema.
   * @param {Object} [injected] Saved settings overriding the defaults.
   * @returns {Object} Settings state keyed by messageKey.
   */
  function hydrate(schema, injected) {
    var S = {};
    eachItem(schema, function (it) {
      if (!it.messageKey || typeof it.defaultValue === 'undefined') { return; }
      S[it.messageKey] = (it.type === 'color' && typeof it.defaultValue === 'number') ? intToHex(it.defaultValue) : it.defaultValue;
    });
    return Object.assign(S, injected || {});
  }

  /**
   * Flatten settings state into the messageKey->value blob sent back to the
   * watch. staticText items (no real value) are skipped.
   *
   * @param {Object} schema Config schema.
   * @param {Object} S Settings state.
   * @returns {Object} Blob of messageKey -> value.
   */
  function serialize(schema, S) {
    var out = {};
    eachItem(schema, function (it) { if (it.messageKey && it.type !== 'staticText') { out[it.messageKey] = S[it.messageKey]; } });
    return out;
  }

  // 64-color Pebble palette (lifted from docs/superpowers/pebble-config/index.html:152)
  var PALETTE = (function () {
    var raw = ["000000","000055","0000AA","0000FF","005500","005555","0055AA","0055FF","00AA00","00AA55","00AAAA","00AAFF","00FF00","00FF55","00FFAA","00FFFF","550000","550055","5500AA","5500FF","555500","555555","5555AA","5555FF","55AA00","55AA55","55AAAA","55AAFF","55FF00","55FF55","55FFAA","55FFFF","AA0000","AA0055","AA00AA","AA00FF","AA5500","AA5555","AA55AA","AA55FF","AAAA00","AAAA55","AAAAAA","AAAAFF","AAFF00","AAFF55","AAFFAA","AAFFFF","FF0000","FF0055","FF00AA","FF00FF","FF5500","FF5555","FF55AA","FF55FF","FFAA00","FFAA55","FFAAAA","FFAAFF","FFFF00","FFFF55","FFFFAA","FFFFFF"];
    var out = [];
    for (var i = 0; i < raw.length; i++) { out.push('#' + raw[i]); }
    return out;
  })();

  // ---- control renderers: each takes (item, value[, openColor]) -> HTML string.
  // options are [label, value] pairs; read o[0]=label, o[1]=value.
  function optionButtons(item, v, isRadio) {
    var h = '', i, o;
    for (i = 0; i < item.options.length; i++) {
      o = item.options[i];
      var inner = isRadio ? '<span>' + esc(o[0]) + '</span><span class="dot"></span>' : esc(o[0]);
      h += '<button class="' + (v === o[1] ? 'on' : '') + '" data-k="' + item.messageKey + '" data-v="' + esc(o[1]) + '">' + inner + '</button>';
    }
    return h;
  }
  function renderToggle(item, v) {
    return '<button class="sw' + (v ? ' on' : '') + '" data-k="' + item.messageKey + '" data-toggle="1"><i></i></button>';
  }
  function renderSegmented(item, v) { return '<div class="seg">' + optionButtons(item, v, false) + '</div>'; }
  function renderRadio(item, v) { return '<div class="radio">' + optionButtons(item, v, true) + '</div>'; }
  // Format a minute count as a human label for interval-derived option lists.
  // 1440 is checked first because it is also a multiple of 60.
  function formatMinutesLabel(min) {
    if (min === 1440) { return '1 day'; }
    if (min < 60) { return min + ' minutes'; }
    if (min === 60) { return '1 hour'; }
    if (min % 60 === 0) { return (min / 60) + ' hours'; }
    return min + ' minutes';
  }

  /**
   * Resolve a select's options from current settings S. A static item.options passes
   * through. item.optionsFrom = { byKey, map } yields map[S[byKey]] || [] (a synchronous
   * lookup keyed off another setting's value). Otherwise { interval, ladder } yields
   * [interval] + ladder values strictly greater than the interval (so equal values
   * dedupe), each as [label, String(minutes)].
   *
   * @param {Object} item Schema item (options or optionsFrom).
   * @param {Object} S Settings state.
   * @returns {Array.<Array>} List of [label, value] option pairs.
   */
  function resolveOptionsFrom(item, S) {
    if (item.options) { return item.options; }
    var spec = item.optionsFrom;
    if (!spec) { return []; }
    if (spec.byKey && spec.map) { return spec.map[S[spec.byKey]] || []; }
    var ladder = spec.ladder || [];
    var interval = parseInt(S[spec.interval], 10);
    if (isNaN(interval) || interval <= 0) { interval = ladder.length ? ladder[0] : 0; }
    var values = [interval], i;
    for (i = 0; i < ladder.length; i += 1) {
      if (ladder[i] > interval) { values.push(ladder[i]); }
    }
    return values.map(function (min) { return [formatMinutesLabel(min), String(min)]; });
  }

  // True if any [label, value] option carries value v.
  function optionHasValue(options, v) {
    for (var i = 0; i < options.length; i += 1) { if (options[i][1] === v) { return true; } }
    return false;
  }

  function renderSelect(item, v) {
    var h = '<select data-k="' + item.messageKey + '">', i, o;
    for (i = 0; i < item.options.length; i++) {
      o = item.options[i];
      h += '<option value="' + esc(o[1]) + '"' + (v === o[1] ? ' selected' : '') + '>' + esc(o[0]) + '</option>';
    }
    return h + '</select>';
  }
  /**
   * Filtered option rows for an open searchSelect list. Case-insensitive substring
   * match on the option label OR its value code; '' query -> all. The current value's
   * row gets .on + a check. Yields a muted "No matches" row when nothing matches.
   *
   * @param {Object} item Schema item with options.
   * @param {*} value Current selected value.
   * @param {string} query Search query.
   * @returns {string} Option rows HTML.
   */
  function renderSelectOptions(item, value, query) {
    var q = String(query || '').toLowerCase(), h = '', i, o, lo, vo, shown = 0;
    for (i = 0; i < item.options.length; i++) {
      o = item.options[i];
      lo = o[0].toLowerCase(); vo = o[1].toLowerCase();
      if (q && lo.indexOf(q) === -1 && vo.indexOf(q) === -1) { continue; }
      h += '<button class="ssel-opt' + (value === o[1] ? ' on' : '') + '" data-select-pick="' + esc(o[1]) + '" data-k="' + esc(item.messageKey) + '">'
        + '<span>' + esc(o[0]) + '</span>' + (value === o[1] ? '<span class="ssel-chk">&#10003;</span>' : '') + '</button>';
      shown++;
    }
    return shown ? h : '<div class="ssel-none">No matches</div>';
  }
  // Current option's display label for a searchSelect trigger; falls back to the raw value.
  function currentLabel(item, value) {
    var i;
    for (i = 0; i < item.options.length; i++) { if (item.options[i][1] === value) { return item.options[i][0]; } }
    return String(value == null ? '' : value);
  }
  // searchSelect: closed -> a select-like trigger; open -> an (auto-focused) search box + a
  // scrollable list of all options. The search input is a SIBLING of .ssel-list so typing can
  // rebuild only the list (see boot's input handler) without destroying input focus.
  function renderSearchSelect(item, view) {
    if (view.openSelect !== item.messageKey) {
      return '<div class="sel-wrap" data-select="' + esc(item.messageKey) + '"><span>'
        + esc(currentLabel(item, view.value)) + '</span><i class="sel-chev"></i></div>';
    }
    return '<input type="text" class="ssel-search" data-select-search="' + esc(item.messageKey)
      + '" placeholder="Search…" value="' + esc(view.selectQuery || '') + '">'
      + '<div class="ssel-list" data-ssel-list="' + esc(item.messageKey) + '">'
      + renderSelectOptions(item, view.value, view.selectQuery) + '</div>';
  }
  function renderText(item, v) {
    var ph = (item.attributes && item.attributes.placeholder) ? esc(item.attributes.placeholder) : '';
    return '<input type="text" data-k="' + item.messageKey + '" value="' + esc(v || '') + '" placeholder="' + ph + '">';
  }
  function renderColor(item, v, openColor) {
    var disp = String(v).toUpperCase();
    var h = '<div class="sw-wrap" data-color="' + item.messageKey + '"><b style="background:' + esc(v) + '"></b><span>' + esc(disp) + '</span></div>';
    if (openColor === item.messageKey) {
      // excludeColors lets a picker drop specific swatches (e.g. white as the holiday color,
      // where white means "no highlight" rather than a real color) without touching the shared PALETTE.
      var excluded = {};
      if (item.excludeColors) { for (var e = 0; e < item.excludeColors.length; e++) { excluded[item.excludeColors[e].toUpperCase()] = true; } }
      h += '<div class="palette">';
      for (var i = 0; i < PALETTE.length; i++) {
        var hex = PALETTE[i];
        if (excluded[hex.toUpperCase()]) { continue; }
        h += '<button class="' + (disp === hex.toUpperCase() ? 'on' : '') + '" style="background:' + hex + '" data-k="' + item.messageKey + '" data-color-pick="' + hex + '"></button>';
      }
      h += '</div>';
    }
    return h;
  }
  var CONTROLS = {
    toggle: function (item, view) { return renderToggle(item, view.value); },
    segmented: function (item, view) { return renderSegmented(item, view.value); },
    radio: function (item, view) { return renderRadio(item, view.value); },
    select: function (item, view) { return renderSelect(item, view.value); },
    text: function (item, view) { return renderText(item, view.value); },
    color: function (item, view) { return renderColor(item, view.value, view.openColor); },
    searchSelect: function (item, view) { return renderSearchSelect(item, view); }
  };
  /**
   * Dispatch to the control renderer for item.type; '' for an unknown type.
   *
   * @param {Object} item Schema item.
   * @param {{value: *, openColor: ?string, openSelect: ?string, selectQuery: ?string}} view Render view state.
   * @returns {string} Control HTML.
   */
  function renderControl(item, view) {
    var fn = CONTROLS[item.type];
    return fn ? fn(item, view) : '';
  }

  /**
   * Wrap a control in a row with label/hint chrome. Stacked for
   * text/radio/open-color/open-searchSelect; otherwise inline (left/right).
   *
   * @param {Object} item Schema item.
   * @param {Object} view Render view state.
   * @param {boolean} [noDivider] Append the nb modifier so the row paints no
   *   bottom divider (used by joinPrevious).
   * @returns {string} Row HTML.
   */
  function renderRow(item, view, noDivider) {
    var hint = item.hintByValue ? (item.hintByValue[view.value] || item.hint) : item.hint;
    var stacked = item.type === 'text' || item.type === 'radio'
      || (item.type === 'color' && view.openColor === item.messageKey)
      || (item.type === 'searchSelect' && view.openSelect === item.messageKey);
    var hintHtml = hint ? '<div class="hint">' + hint + '</div>' : '';
    var label = '<div class="lbl">' + esc(item.label) + '</div>';
    var rowCls = 'row' + (stacked ? ' stack' : '') + (noDivider ? ' nb' : '');
    if (stacked) {
      return '<div class="' + rowCls + '">' + label + hintHtml + '<div>' + renderControl(item, view) + '</div></div>';
    }
    return '<div class="' + rowCls + '"><div class="lft">' + label + hintHtml + '</div><div class="rgt">' + renderControl(item, view) + '</div></div>';
  }

  // Render a registered block by id, wrapped in .blockrow ('.blockrow sticky' when sticky).
  // '' if unregistered or empty.
  function renderBlock(id, S, ENV, USERDATA, sticky) {
    if (!id) { return ''; }
    var fn = PConf.blocks.get(id);
    var html = fn ? fn(S, ENV, USERDATA) : '';
    return html ? '<div class="blockrow' + (sticky ? ' sticky' : '') + '">' + html + '</div>' : '';
  }

  // Resolve a select/searchSelect's concrete options and normalize its stored value.
  // For an optionsFrom item this materializes the derived options and, when the stored
  // value is no longer among them (e.g. the interval they depend on was raised), snaps
  // both view.value and cx.S to the first (lowest = interval) option so the rendered
  // control and the stored state stay in lockstep. This is the ONE place that mutates
  // cx.S during render — isolated here so renderItem stays a pure dispatcher. Returns
  // the row item to render (a derived-options clone, or the original item unchanged).
  function resolveRowItem(item, view, cx) {
    if ((item.type !== 'select' && item.type !== 'searchSelect') || !item.optionsFrom) {
      return item;
    }
    var derived = resolveOptionsFrom(item, cx.S);
    if (derived.length && !optionHasValue(derived, view.value)) {
      view.value = derived[0][1];
      cx.S[item.messageKey] = derived[0][1];
    }
    return Object.assign({}, item, { options: derived });
  }

  // Render one schema item honoring showWhen. Returns { html, kind } with kind in
  // 'control' | 'static' | 'hidden' so the section can decide if the card is empty.
  function renderItem(item, view, cx, noDivider) {
    if (!PConf.showWhen.isVisible(item, cx.evalCtx)) { return { html: '', kind: 'hidden' }; }
    if (item.type === 'staticText') {
      // a joinPrevious static acts as the control's description, so the join modifier tightens its
      // top spacing to hug the row above (like a hint) instead of standing off as a separate block.
      var staticCls = 'static' + (item.joinPrevious ? ' join' : '') + (noDivider ? ' nb' : '');
      return { html: '<div class="' + staticCls + '">' + (item.text || '') + '</div>', kind: 'static' };
    }
    var rowItem = resolveRowItem(item, view, cx);
    var html = renderBlock(item.blockBefore, cx.S, cx.ENV, cx.USERDATA, item.blockBeforeSticky)
      + renderRow(rowItem, view, noDivider)
      + renderBlock(item.block, cx.S, cx.ENV, cx.USERDATA);
    return { html: html, kind: 'control' };
  }

  // Render a run of consecutive items sharing the same inline group id as a single side-by-side
  // row (one bottom divider, no internal dividers). Each visible member becomes a compact
  // label+control cell. Inline members don't carry hints/blocks. Returns { html, controlCount };
  // controlCount is the number of visible cells (0 -> nothing rendered, group hidden).
  function renderInlineGroup(items, cx, noDivider) {
    var cells = '', visible = 0, i, item, view;
    for (i = 0; i < items.length; i++) {
      item = items[i];
      if (!PConf.showWhen.isVisible(item, cx.evalCtx)) { continue; }
      view = { value: cx.S[item.messageKey], openColor: cx.openColor, openSelect: cx.openSelect, selectQuery: cx.selectQuery };
      cells += '<div class="icell"><div class="lbl">' + esc(item.label) + '</div>' + renderControl(item, view) + '</div>';
      visible++;
    }
    if (!visible) { return { html: '', controlCount: 0 }; }
    return { html: '<div class="row inline' + (noDivider ? ' nb' : '') + '">' + cells + '</div>', controlCount: visible };
  }

  // Look-ahead from index "from": does the next *visible* item carry joinPrevious? Such an item
  // wants no divider between it and the row above, so the preceding visible row drops its divider.
  // Skips hidden items so the divider returns automatically when the joining group is hidden.
  function nextVisibleJoins(items, from, cx) {
    var j;
    for (j = from; j < items.length; j++) {
      if (PConf.showWhen.isVisible(items[j], cx.evalCtx)) { return Boolean(items[j].joinPrevious); }
    }
    return false;
  }

  function renderCardHeader(sec, secId, isCollapsible, isOpen) {
    if (!(sec.title || isCollapsible)) { return ''; }
    var chev = isCollapsible ? '<span class="chev">' + (isOpen ? '&#9662;' : '&#9656;') + '</span>' : '';
    var collAttr = isCollapsible ? ' data-coll="' + esc(secId) + '"' : '';
    return '<button class="cardHdr' + (isCollapsible ? ' coll' : '') + '"' + collAttr + '>'
      + '<span class="ttl">' + esc(sec.title || '') + '</span>' + chev + '</button>';
  }

  // Render one section card. '' when empty (no intro, no visible control/static items, no block).
  function renderSection(sec, cx) {
    var secId = sec.id || sec.title;
    var body = sec.intro ? '<div class="intro">' + sec.intro + '</div>' : '';
    var controlCount = 0, staticCount = 0, i;
    for (i = 0; i < sec.items.length; i++) {
      var item = sec.items[i];
      if (item.inline) {
        // gather the consecutive run sharing this inline group id, render it as one row
        var run = [item];
        while (i + 1 < sec.items.length && sec.items[i + 1].inline === item.inline) { run.push(sec.items[i + 1]); i++; }
        var g = renderInlineGroup(run, cx, nextVisibleJoins(sec.items, i + 1, cx));
        controlCount += g.controlCount;
        body += g.html;
        continue;
      }
      var view = { value: cx.S[item.messageKey], openColor: cx.openColor, openSelect: cx.openSelect, selectQuery: cx.selectQuery };
      var r = renderItem(item, view, cx, nextVisibleJoins(sec.items, i + 1, cx));
      if (r.kind === 'control') { controlCount++; }
      else if (r.kind === 'static') { staticCount++; }
      body += r.html;
    }
    var blockHtml = renderBlock(sec.block, cx.S, cx.ENV, cx.USERDATA);
    body += blockHtml;
    if (!sec.intro && controlCount === 0 && staticCount === 0 && blockHtml === '') { return ''; }
    var isCollapsible = Boolean(sec.collapsible);
    var isOpen = isCollapsible ? !cx.collapsed[secId] : true;
    var hdr = renderCardHeader(sec, secId, isCollapsible, isOpen);
    return '<div class="card' + (hdr ? '' : ' nohdr') + '">' + hdr + (isOpen ? '<div>' + body + '</div>' : '') + '</div>';
  }

  /**
   * Seed the collapsed-state map so collapsible sections start collapsed by default.
   * The toggle handler flips entries (true->open->true), so seeding true means the
   * first click expands.
   *
   * @param {Object} schema Config schema.
   * @returns {Object} Map of sectionId/title -> true for collapsible sections.
   */
  function initialCollapsed(schema) {
    var map = {}, ti, si, sec, tabs = schema.tabs || [];
    for (ti = 0; ti < tabs.length; ti++) {
      for (si = 0; si < tabs[ti].sections.length; si++) {
        sec = tabs[ti].sections[si];
        if (sec.collapsible) { map[sec.id || sec.title] = true; }
      }
    }
    return map;
  }

  /**
   * Render the tab-bar buttons, marking the active tab with the on class.
   *
   * @param {Object} schema Config schema (schema.tabs).
   * @param {string} activeTab Active tab id.
   * @returns {string} Tab-bar buttons HTML.
   */
  function renderTabBar(schema, activeTab) {
    var h = '', i, tab;
    for (i = 0; i < schema.tabs.length; i++) {
      tab = schema.tabs[i];
      h += '<button class="tab' + (activeTab === tab.id ? ' on' : '') + '" data-tab="' + esc(tab.id) + '">' + esc(tab.label) + '</button>';
    }
    return h;
  }

  /**
   * Build the full scroll-body HTML for the active tab (all its section cards
   * plus the version footer).
   *
   * @param {Object} schema Config schema.
   * @param {string} activeTab Active tab id.
   * @param {Object} cx Render context { S, ENV, USERDATA, openColor, openSelect,
   *   selectQuery, collapsed, evalCtx }.
   * @returns {string} Scroll-body HTML.
   */
  function renderBody(schema, activeTab, cx) {
    var h = '', ti, si;
    for (ti = 0; ti < schema.tabs.length; ti++) {
      var t = schema.tabs[ti];
      if (t.id !== activeTab) { continue; }
      for (si = 0; si < t.sections.length; si++) { h += renderSection(t.sections[si], cx); }
    }
    return h + '<div class="version">' + (schema.versionLabel || '') + '</div>';
  }

  /**
   * Page entry point (browser only): hydrate state from the injected schema/config,
   * wire the DOM event handlers, run onLoad hooks, and render. Never called from the
   * Node tests, which exercise the pure helpers above.
   *
   * @returns {void}
   */
  function boot() {
    var SCHEMA = INJECTED_SCHEMA, ENV = INJECTED_ENV || { color: true, round: false, platform: '' };
    var USERDATA = INJECTED_USERDATA || {}, RETURN_TO = INJECTED_RETURN || 'pebblejs://close#';
    var S = hydrate(SCHEMA, INJECTED_CFG), INITIAL = Object.assign({}, S);
    var activeTab = SCHEMA.tabs[0].id, openColor = null, openSelect = null, selectQuery = '', collapsed = initialCollapsed(SCHEMA);
    // Recover a schema item by messageKey so the input handler can re-filter its options in place.
    function findItem(key) { var f = null; eachItem(SCHEMA, function (it) { if (it.messageKey === key) { f = it; } }); return f; }
    // Only one searchSelect is open at a time; focus its freshly-rendered search box.
    function focusSearch() { var el = document.querySelector('[data-select-search]'); if (el) { el.focus(); } }
    // evalCtx(): the {settings..., env} object showWhen predicates evaluate against.
    function evalCtx() { var c = Object.assign({}, S); c.env = ENV; return c; }
    var hookCtx = { get: function (k) { return S[k]; }, set: function (k, v) { S[k] = v; }, getInitial: function (k) { return INITIAL[k]; } };

    // boot() requires the DOM; it is never called from Node tests (which exercise the pure
    // helpers above), so DOM access here is unguarded by design.
    function render() {
      var cx = { S: S, ENV: ENV, USERDATA: USERDATA, openColor: openColor, openSelect: openSelect, selectQuery: selectQuery, collapsed: collapsed, evalCtx: evalCtx() };
      document.getElementById('tabs').innerHTML = renderTabBar(SCHEMA, activeTab);
      document.getElementById('scroll').innerHTML = renderBody(SCHEMA, activeTab, cx);
    }

    // Tab bar: switch the active tab and close any open color/select overlays.
    function wireTabBar() {
      document.getElementById('tabs').addEventListener('click', function (e) {
        var b = e.target.closest('[data-tab]');
        if (b) { activeTab = b.getAttribute('data-tab'); openColor = null; openSelect = null; render(); }
      });
    }

    // Scroll body: click (control interactions), change (native select),
    // and input (searchSelect filter + text fields).
    function wireInputs() {
      var scroll = document.getElementById('scroll');
      scroll.addEventListener('click', function (e) {
        var t;
        if ((t = e.target.closest('[data-select-pick]'))) { S[t.getAttribute('data-k')] = t.getAttribute('data-select-pick'); openSelect = null; render(); return; }
        if ((t = e.target.closest('[data-select]'))) { var sk = t.getAttribute('data-select'); openSelect = (openSelect === sk ? null : sk); selectQuery = ''; render(); focusSearch(); return; }
        if ((t = e.target.closest('[data-toggle]'))) { S[t.getAttribute('data-k')] = !S[t.getAttribute('data-k')]; render(); return; }
        if ((t = e.target.closest('[data-color-pick]'))) { S[t.getAttribute('data-k')] = t.getAttribute('data-color-pick'); openColor = null; render(); return; }
        if ((t = e.target.closest('[data-color]'))) { var k = t.getAttribute('data-color'); openColor = (openColor === k ? null : k); render(); return; }
        if ((t = e.target.closest('[data-v]'))) { S[t.getAttribute('data-k')] = t.getAttribute('data-v'); render(); return; }
        if ((t = e.target.closest('[data-coll]'))) { var sid = t.getAttribute('data-coll'); collapsed[sid] = !collapsed[sid]; render(); return; }
      });
      scroll.addEventListener('change', function (e) {
        var sel = e.target.closest('select');
        if (sel) { S[sel.getAttribute('data-k')] = sel.value; render(); }
      });
      scroll.addEventListener('input', function (e) {
        var sb = e.target.closest('[data-select-search]');
        if (sb) {
          var sk = sb.getAttribute('data-select-search');
          selectQuery = sb.value;
          // Rebuild ONLY the list (a sibling of the search box) so the input keeps focus + cursor.
          var list = document.querySelector('[data-ssel-list="' + sk + '"]');
          if (list) { list.innerHTML = renderSelectOptions(findItem(sk), S[sk], selectQuery); }
          return;
        }
        var inp = e.target.closest('input[type=text]');
        if (inp) { S[inp.getAttribute('data-k')] = inp.value; }
      });
    }

    // Save: run submit hooks, serialize, flash the toast, then return to the watch.
    function wireSave() {
      document.getElementById('save').addEventListener('click', function () {
        PConf.hooks.runSubmit(hookCtx);
        var blob = serialize(SCHEMA, S);
        document.getElementById('toast').classList.add('show');
        setTimeout(function () { location.href = RETURN_TO + encodeURIComponent(JSON.stringify(blob)); }, 300);
      });
    }

    document.getElementById('appTitle').textContent = SCHEMA.appName;
    PConf.hooks.runLoad(hookCtx);
    wireTabBar();
    wireInputs();
    wireSave();
    render();
  }

  PConf.engine = {
    serialize: serialize, hydrate: hydrate, boot: boot, initialCollapsed: initialCollapsed,
    esc: esc, renderControl: renderControl, renderRow: renderRow, renderSelectOptions: renderSelectOptions,
    renderTabBar: renderTabBar, renderBody: renderBody, resolveOptionsFrom: resolveOptionsFrom
  };
})();
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    serialize: PConf.engine.serialize, hydrate: PConf.engine.hydrate, boot: PConf.engine.boot,
    initialCollapsed: PConf.engine.initialCollapsed,
    blocks: PConf.blocks, hooks: PConf.hooks,
    esc: PConf.engine.esc, renderControl: PConf.engine.renderControl, renderRow: PConf.engine.renderRow,
    renderSelectOptions: PConf.engine.renderSelectOptions,
    renderTabBar: PConf.engine.renderTabBar, renderBody: PConf.engine.renderBody,
    resolveOptionsFrom: PConf.engine.resolveOptionsFrom
  };
}
