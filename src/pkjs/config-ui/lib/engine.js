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

  // --- options-resolver registry --- a select/searchSelect/radio item opts into a
  // multi-key derived option list by name (item.optionsFrom.resolver: id) without the
  // engine knowing what the derivation logic is — mirrors the block registry above.
  // fn(S, env, args) returns [[label, value], ...]; see resolveOptionsFrom below.
  var optionsResolverMap = {};
  PConf.optionsResolvers = {
    register: function (name, fn) { optionsResolverMap[name] = fn; },
    get: function (name) { return optionsResolverMap[name]; }
  };

  // --- defaults-resolver registry --- a select item opts into a platform-aware default
  // by name (item.defaultFrom.resolver: id), resolved at hydrate + snap time. Separate
  // from optionsResolvers because a defaults resolver returns a single value, not a list.
  // fn(env, args) -> defaultValue; see resolveDefaultFrom below.
  var defaultsResolverMap = {};
  PConf.defaultsResolvers = {
    register: function (name, fn) { defaultsResolverMap[name] = fn; },
    get: function (name) { return defaultsResolverMap[name]; }
  };

  // --- recommend-resolver registry --- a select item flags its "best for you" option by name
  // (item.recommendFrom: id); the resolver fn(S, env) returns the recommended option VALUE and the
  // matching row in the open sheet gets a "(Recommended)" marker. Derived, like defaults, but read at
  // render time (so it tracks another key, e.g. the country selector) and yields a value, not a list.
  var recommendResolverMap = {};
  PConf.recommendResolvers = {
    register: function (name, fn) { recommendResolverMap[name] = fn; },
    get: function (name) { return recommendResolverMap[name]; }
  };

  // --- onChange registry --- a schema item opts into a post-change side effect by
  // name (item.onChange: id) without the engine knowing what that side effect is —
  // mirrors the block registry above. fn(S, oldValue, newValue, env) runs synchronously,
  // right after the click handler sets the new value and before the next render(). env is the platform env (INJECTED_ENV).
  var onChangeMap = {};
  PConf.onChange = {
    register: function (id, fn) { onChangeMap[id] = fn; },
    get: function (id) { return onChangeMap[id]; }
  };

  // --- hook registry ---
  var loadFns = [], submitFns = [], readyFns = [];
  PConf.hooks = {
    onLoad: function (fn) { loadFns.push(fn); },
    onSubmit: function (fn) { submitFns.push(fn); },
    // onReady runs at the end of boot() (after the first render) with a rich ctx that
    // exposes render()/save() so an overlay (e.g. the onboarding wizard) can push state
    // into the visible form or save-and-close.
    onReady: function (fn) { readyFns.push(fn); },
    runLoad: function (ctx) { loadFns.forEach(function (fn) { fn(ctx); }); },
    runSubmit: function (ctx) { submitFns.forEach(function (fn) { fn(ctx); }); },
    runReady: function (ctx) { readyFns.forEach(function (fn) { fn(ctx); }); }
  };

  // --- action registry: type:'button' items dispatch here by their action id ---
  PConf.actions = PConf.actions || {};

  /**
   * The effective default for a schema item: a defaultFrom item resolves through the
   * named defaults-resolver (env-aware); everything else uses its static defaultValue.
   * @param {Object} item Schema item.
   * @param {Object} [env] Platform env, passed to the resolver.
   * @returns {*} The default value (undefined if the item has neither).
   */
  function resolveDefaultFrom(item, env) {
    if (item.defaultFrom) {
      var fn = PConf.defaultsResolvers.get(item.defaultFrom.resolver);
      return fn ? fn(env, item.defaultFrom.args || {}) : undefined;
    }
    return item.defaultValue;
  }

  /**
   * Build the initial settings state from a schema's defaults, with injected
   * (saved) values taking precedence. Number color defaults become hex strings.
   *
   * @param {Object} schema Config schema.
   * @param {Object} [injected] Saved settings overriding the defaults.
   * @param {Object} [env] Platform env, threaded to any defaultFrom resolver.
   * @returns {Object} Settings state keyed by messageKey.
   */
  function hydrate(schema, injected, env) {
    var S = {};
    eachItem(schema, function (it) {
      if (!it.messageKey) { return; }
      var dv = resolveDefaultFrom(it, env);
      if (typeof dv === 'undefined') { return; }
      S[it.messageKey] = (it.type === 'color' && typeof dv === 'number') ? intToHex(dv) : dv;
    });
    return Object.assign(S, injected || {});
  }

  /**
   * Resolve the effective theme class from the theme setting.
   *
   * @param {Object} schema Config schema (reads schema.themeKey).
   * @param {Object} S Settings state.
   * @param {boolean} prefersLight Result of the prefers-color-scheme: light media query.
   * @returns {string} 'light' or 'dark' — the class applied to <body> ('dark' = class absent).
   */
  function resolveTheme(schema, S, prefersLight) {
    if (!schema || !schema.themeKey) { return 'dark'; }
    var v = S ? S[schema.themeKey] : undefined;
    if (v === 'light') { return 'light'; }
    if (v === 'dark') { return 'dark'; }
    return prefersLight ? 'light' : 'dark';
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
   * lookup keyed off another setting's value). item.optionsFrom = { resolver, args }
   * dispatches to a named fn registered via PConf.optionsResolvers, called as
   * fn(S, env, args) so it can derive its list from multiple settings keys and/or the
   * platform env (e.g. health/radar/emery). Otherwise { interval, ladder } yields
   * [interval] + ladder values strictly greater than the interval (so equal values
   * dedupe), each as [label, String(minutes)].
   *
   * @param {Object} item Schema item (options or optionsFrom).
   * @param {Object} S Settings state.
   * @param {Object} [env] Platform env (as read by show-when's env.* predicates); passed
   *   through to a registered resolver.
   * @returns {Array.<Array>} List of [label, value] option pairs.
   */
  function resolveOptionsFrom(item, S, env) {
    if (item.options) { return item.options; }
    var spec = item.optionsFrom;
    if (!spec) { return []; }
    if (spec.byKey && spec.map) { return spec.map[S[spec.byKey]] || []; }
    if (spec.resolver) {
      var fn = PConf.optionsResolvers.get(spec.resolver);
      return fn ? fn(S, env, spec.args || {}) : [];
    }
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

  /**
   * The recommended option value for a select whose item.recommendFrom names a recommend-resolver
   * (fn(S, env) -> value). The matching option gets a "(Recommended)" marker in the sheet. Returns
   * null when the item doesn't opt in or the resolver is missing.
   * @param {Object} item Schema item.
   * @param {Object} S Settings state.
   * @param {Object} [env] Platform env.
   * @returns {*} Recommended option value, or null.
   */
  function resolveRecommended(item, S, env) {
    if (!item || !item.recommendFrom) { return null; }
    var fn = PConf.recommendResolvers.get(item.recommendFrom);
    return fn ? fn(S, env) : null;
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
  function renderSelectOptions(item, value, query, recommended) {
    var q = String(query || '').toLowerCase(), h = '', i, o, lo, vo, meta, classes, labelCell, rec, shown = 0;
    for (i = 0; i < item.options.length; i++) {
      o = item.options[i];
      lo = o[0].toLowerCase(); vo = o[1].toLowerCase();
      if (q && lo.indexOf(q) === -1 && vo.indexOf(q) === -1) { continue; }
      meta = o[2] || {};
      if (meta.groupHeader) {
        if (q) { continue; }
        h += '<div class="ssel-group" role="presentation"><span>' + esc(o[0]) + '</span></div>';
        shown++;
        continue;
      }
      classes = 'ssel-opt' + (!q && meta.groupChild ? ' group-child' : '')
        + (!q && meta.groupEnd ? ' group-end' : '') + (value === o[1] ? ' on' : '');
      // A recommend-resolver may mark one option as best for the current context (e.g. the
      // country-matched weather/radar provider) — appended in bold after the name (labels are
      // esc()'d, so the marker can't ride in the option text itself).
      rec = (recommended != null && o[1] === recommended) ? ' <b class="ssel-rec">(Recommended)</b>' : '';
      // An option may carry a one-line description (meta.desc) rendered under its name — the
      // weather-provider picker uses it to say what each provider is best at while choosing.
      // Options without a desc keep the original single-span layout untouched.
      labelCell = meta.desc
        ? '<span class="ssel-opt-txt"><span class="ssel-opt-name">' + esc(o[0]) + rec + '</span>'
          + '<span class="ssel-opt-desc">' + esc(meta.desc) + '</span></span>'
        : '<span>' + esc(o[0]) + rec + '</span>';
      h += '<button type="button" class="' + classes + '" role="option" aria-selected="'
        + (value === o[1] ? 'true' : 'false') + '" data-select-pick="' + esc(o[1])
        + '" data-k="' + esc(item.messageKey) + '">' + labelCell
        + (value === o[1] ? '<span class="ssel-chk">&#10003;</span>' : '') + '</button>';
      shown++;
    }
    return shown ? h : '<div class="ssel-none">No matches</div>';
  }
  // Current option's display label for the collapsed trigger; falls back to the raw value.
  // Honors an optional meta.short (o[2].short) so a long full name (shown in the bottom sheet)
  // can collapse to a compact label in the trigger — e.g. "Deutscher Wetterdienst" -> "DWD" —
  // without overlapping the row's field label on the left.
  function currentLabel(item, value) {
    var i, o;
    for (i = 0; i < item.options.length; i++) {
      o = item.options[i];
      if (o[1] === value) { return (o[2] && o[2].short) || o[0]; }
    }
    return String(value == null ? '' : value);
  }
  /**
   * Shared trigger for both `select` and `searchSelect`: a select-like button that opens
   * the modal popup. aria-controls points at the option list the modal renders into #modal.
   *
   * @param {Object} item Schema item (select or searchSelect).
   * @param {{value: *, openSelect: ?string}} view Render view state.
   * @returns {string} Trigger button HTML.
   */
  function renderSelectTrigger(item, view) {
    var key = esc(item.messageKey), label = currentLabel(item, view.value);
    var listId = 'ssel-list-' + key, open = view.openSelect === item.messageKey;
    var accessibleLabel = String(item.label || 'Selection') + ': ' + label;
    return '<button type="button" class="sel-wrap" data-select="' + key
      + '" aria-label="' + esc(accessibleLabel) + '" aria-haspopup="listbox" aria-expanded="'
      + (open ? 'true' : 'false') + '" aria-controls="' + listId + '"><span>'
      + esc(label) + '</span><i class="sel-chev"></i></button>';
  }

  /**
   * The open select/searchSelect modal: a dim overlay + a centered card holding an optional
   * search box (searchSelect only) and the scrollable option list. Returns '' when nothing is
   * open. optionsFrom items are resolved through resolveRowItem so derived lists (status slots,
   * Holiday Region) render — the row already normalized cx.S this render pass, so the call is
   * idempotent. This also fixes live search on optionsFrom items: the old inline handler passed
   * the raw (option-less) item to renderSelectOptions and threw.
   *
   * @param {Object} schema Config schema.
   * @param {{S: Object, ENV: Object, openSelect: ?string, selectQuery: ?string}} cx Render context.
   * @returns {string} Overlay + modal HTML, or ''.
   */
  function renderSelectModal(schema, cx) {
    if (!cx.openSelect) { return ''; }
    // Prefer the item that is actually VISIBLE for the current platform — two items can
    // share a messageKey with mutually-exclusive showWhen (e.g. the color vs B/W `theme`
    // blocks), and the open picker must mirror the same block whose trigger was tapped, not
    // just the last match. Fall back to any match if none resolves visible (belt-and-braces:
    // a hidden trigger can't be opened, so this only guards degenerate schemas).
    var found = null, fallback = null;
    eachItem(schema, function (it) {
      if (it.messageKey === cx.openSelect) {
        fallback = it;
        if (PConf.showWhen.isVisible(it, cx.evalCtx)) { found = it; }
      }
    });
    found = found || fallback;
    if (!found) { return ''; }
    var item = resolveRowItem(found, { value: cx.S[found.messageKey] }, cx);
    var key = esc(item.messageKey), value = cx.S[item.messageKey];
    var listId = 'ssel-list-' + key, titleId = 'ssel-ttl-' + key;
    var title = esc(String(item.label || 'Selection'));
    var search = item.type === 'searchSelect'
      ? '<input type="text" class="ssel-search" data-select-search="' + key
        + '" aria-controls="' + listId + '" placeholder="Search…" value="'
        + esc(cx.selectQuery || '') + '">'
      : '';
    // Inner content only — the host <dialog id="modal"> is the sheet, and its ::backdrop
    // replaces the old dim overlay. The dialog carries role/modal semantics natively;
    // boot() copies titleId onto the dialog's aria-labelledby when it opens.
    return '<div class="ssel-modal-hdr"><span class="ssel-modal-ttl" id="' + titleId + '">' + title + '</span>'
      + '<button type="button" class="ssel-modal-close" data-select-close aria-label="Close">×</button></div>'
      + search
      + '<div id="' + listId + '" class="ssel-list" role="listbox" aria-label="' + title
      + ' options" data-ssel-list="' + key + '">'
      + renderSelectOptions(item, value, cx.selectQuery, resolveRecommended(item, cx.S, cx.ENV)) + '</div>';
  }
  function renderText(item, v) {
    var ph = (item.attributes && item.attributes.placeholder) ? esc(item.attributes.placeholder) : '';
    var input = '<input type="text" data-k="' + item.messageKey + '" value="' + esc(v || '') + '" placeholder="' + ph + '">';
    if (!item.suffixAction) { return input; }
    // Optional inline action button to the RIGHT of the input (e.g. "Test" a key),
    // plus an empty result line the action fills — targeted by
    // data-action-result="<messageKey>". Dispatches via the shared [data-action] handler.
    return '<div class="txt-act">' + input
      + '<button class="txt-act-btn" data-action="' + esc(item.suffixAction) + '">'
      + esc(item.suffixLabel || 'Go') + '</button></div>'
      + '<div class="hint txt-act-result" data-action-result="' + esc(item.messageKey) + '"></div>';
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
    select: function (item, view) { return renderSelectTrigger(item, view); },
    text: function (item, view) { return renderText(item, view.value); },
    color: function (item, view) { return renderColor(item, view.value, view.openColor); },
    searchSelect: function (item, view) { return renderSelectTrigger(item, view); }
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
   * text/radio/open-color; otherwise inline (left/right).
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
      || (item.type === 'color' && view.openColor === item.messageKey);
    var hintHtml = hint ? '<div class="hint">' + hint + '</div>' : '';
    var label = '<div class="lbl">' + esc(item.label) + '</div>';
    // Status-line slot pickers are compact rows: the .slot modifier tightens the vertical
    // rhythm so consecutive slot rows sit closer together. Status slots are plain selects
    // (matched via the statusSlot resolver, since they carry no distinguishing type), while
    // the Holiday searchSelects keep the same compact treatment. A stacked (open color/etc.)
    // row keeps normal padding so its expanded content isn't cramped.
    var isStatusSlot = item.optionsFrom && item.optionsFrom.resolver === 'statusSlot';
    var rowCls = 'row' + (stacked ? ' stack' : '') + (noDivider ? ' nb' : '')
      + ((item.type === 'searchSelect' || isStatusSlot) && !stacked ? ' slot' : '');
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

  // Resolve a select/searchSelect/radio's concrete options and normalize its stored value.
  // For an optionsFrom item this materializes the derived options and, when the stored
  // value is no longer among them (e.g. the interval they depend on was raised, or a
  // preset was hidden for the current mode), snaps both view.value and cx.S into a valid
  // option so the rendered control and stored state stay in lockstep — preferring the
  // item's resolved default (via resolveDefaultFrom, which is env-aware and may be
  // defaultFrom-derived) when it survived (e.g. Compact-dense → the default Compact when
  // health turns off), else the first (lowest = interval) option. This is the ONE place
  // that mutates cx.S during render — isolated here so renderItem stays a pure dispatcher.
  // Returns the row item to render (a derived-options clone, or the original unchanged).
  function resolveRowItem(item, view, cx) {
    if ((item.type !== 'select' && item.type !== 'searchSelect' && item.type !== 'radio') || !item.optionsFrom) {
      return item;
    }
    var derived = resolveOptionsFrom(item, cx.S, cx.ENV);
    if (derived.length && !optionHasValue(derived, view.value)) {
      var dflt = resolveDefaultFrom(item, cx.ENV);
      var snap = (dflt != null && optionHasValue(derived, dflt)) ? dflt : derived[0][1];
      view.value = snap;
      cx.S[item.messageKey] = snap;
    }
    return Object.assign({}, item, { options: derived });
  }

  // Render one schema item honoring showWhen. Returns { html, kind } with kind in
  // 'control' | 'static' | 'hidden' so the section can decide if the card is empty.
  function renderItem(item, view, cx, noDivider) {
    if (!PConf.showWhen.isVisible(item, cx.evalCtx)) { return { html: '', kind: 'hidden' }; }
    // A persisted-but-invisible key (hydrated + serialized, never drawn) — e.g. onboardingDone.
    if (item.type === 'hidden') { return { html: '', kind: 'hidden' }; }
    // A tappable action row: dispatches to PConf.actions[item.action] via the scroll click handler.
    if (item.type === 'button') {
      var bHint = item.hint ? '<div class="hint">' + item.hint + '</div>' : '';
      return { kind: 'control', html:
        '<div class="row' + (noDivider ? ' nb' : '') + '" data-action="' + esc(item.action) + '" style="cursor:pointer">'
        + '<div class="lft"><div class="lbl">' + esc(item.label) + '</div>' + bHint + '</div>'
        + '<div class="rgt"><span style="color:#FF6A52;font-size:16px;font-weight:700;line-height:1">&#9656;</span></div></div>' };
    }
    if (item.type === 'staticText') {
      // a joinPrevious static acts as the control's description, so the join modifier tightens its
      // top spacing to hug the row above (like a hint) instead of standing off as a separate block.
      // hinted: render in the dimmer/smaller hint style WITHOUT the pull-up — for a standalone note
      // (e.g. below a preview block) that should still read as secondary, hint-coloured text.
      var staticCls = 'static' + (item.joinPrevious ? ' join' : '') + (item.hinted ? ' hinted' : '') + (noDivider ? ' nb' : '');
      // A staticText may host preview blocks too (blockBefore/block) — e.g. the Layout tab's
      // after-flick preview rides a caption. renderBlock() no-ops when the id is absent.
      var staticHtml = renderBlock(item.blockBefore, cx.S, cx.ENV, cx.USERDATA, item.blockBeforeSticky)
        + '<div class="' + staticCls + '">' + (item.text || '') + '</div>'
        + renderBlock(item.block, cx.S, cx.ENV, cx.USERDATA);
      return { html: staticHtml, kind: 'static' };
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

  // Build a section's inner body HTML (intro + items + block) and whether it's empty
  // (no intro, no visible control/static items, no block). Shared by renderSection (a
  // standalone card) and renderSectionGroup (a section merged into a shared card), so the
  // "hide when everything is gated off" rule stays in one place.
  function buildSectionBody(sec, cx) {
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
    var isEmpty = !sec.intro && controlCount === 0 && staticCount === 0 && blockHtml === '';
    return { body: body, isEmpty: isEmpty };
  }

  // Render one section card. '' when empty (no intro, no visible control/static items, no block).
  function renderSection(sec, cx) {
    var secId = sec.id || sec.title;
    var built = buildSectionBody(sec, cx);
    if (built.isEmpty) { return ''; }
    var isCollapsible = Boolean(sec.collapsible);
    var isOpen = isCollapsible ? !cx.collapsed[secId] : true;
    var hdr = renderCardHeader(sec, secId, isCollapsible, isOpen);
    return '<div class="card' + (hdr ? '' : ' nohdr') + '">' + hdr + (isOpen ? '<div>' + built.body + '</div>' : '') + '</div>';
  }

  // Render a run of consecutive sections that share a groupCard id as ONE card: each
  // section's title becomes an in-card sub-header (.subhdr) instead of its own card header,
  // and their intros/items stack inside a single card. An empty sub-section (all items
  // gated off — e.g. a disabled feature) drops out entirely, sub-header and all, via the
  // same emptiness rule renderSection uses, so the group collapses cleanly. '' if all empty.
  function renderSectionGroup(sections, cx) {
    var inner = '', i, sec, built;
    for (i = 0; i < sections.length; i++) {
      sec = sections[i];
      built = buildSectionBody(sec, cx);
      if (built.isEmpty) { continue; }
      if (sec.title) { inner += '<div class="subhdr">' + esc(sec.title) + '</div>'; }
      inner += built.body;
    }
    return inner ? '<div class="card nohdr">' + inner + '</div>' : '';
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
   * @param {Object} [cx] Render context; when given, tabs whose showWhen resolves
   *   false against cx.evalCtx are skipped.
   * @returns {string} Tab-bar buttons HTML.
   */
  function renderTabBar(schema, activeTab, cx) {
    var h = '', i, tab;
    for (i = 0; i < schema.tabs.length; i++) {
      tab = schema.tabs[i];
      if (cx && !PConf.showWhen.isVisible(tab, cx.evalCtx)) { continue; }
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
      if (cx && !PConf.showWhen.isVisible(t, cx.evalCtx)) { continue; }
      if (t.id !== activeTab) { continue; }
      for (si = 0; si < t.sections.length; si++) {
        var sec = t.sections[si];
        // Consecutive sections sharing a groupCard id render into one card (titles become
        // in-card sub-headers); everything else stays a card of its own.
        if (sec.groupCard) {
          var group = [sec];
          while (si + 1 < t.sections.length && t.sections[si + 1].groupCard === sec.groupCard) {
            group.push(t.sections[si + 1]); si++;
          }
          h += renderSectionGroup(group, cx);
        } else {
          h += renderSection(sec, cx);
        }
      }
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
    var SCHEMA = INJECTED_SCHEMA, ENV = INJECTED_ENV || { color: true, round: false, platform: '', health: true };
    var USERDATA = INJECTED_USERDATA || {}, RETURN_TO = INJECTED_RETURN || 'pebblejs://close#';
    var S = hydrate(SCHEMA, INJECTED_CFG, ENV), INITIAL = Object.assign({}, S);
    var activeTab = SCHEMA.tabs[0].id, openColor = null, openSelect = null, selectQuery = '', collapsed = initialCollapsed(SCHEMA);
    // Recover a schema item by messageKey so the input handler can re-filter its options in place.
    function findItem(key) { var f = null; eachItem(SCHEMA, function (it) { if (it.messageKey === key) { f = it; } }); return f; }
    // The messageKey of the trigger to restore focus to when the modal closes. Stored by key
    // (not the DOM node) because render() replaces #scroll's innerHTML, detaching any node
    // captured at open time; re-querying by key after render finds the fresh trigger.
    var lastSelectKey = null;
    // Optional one-shot callback fired after the sheet closes, set by openSheet() so an external
    // caller (the onboarding wizard, which lives in its own overlay) can react to a pick/dismiss.
    var onSheetClose = null;
    // On open, focus the search box (searchSelect) or the selected/first option (select).
    function focusModal() {
      var modal = document.getElementById('modal');
      var el = modal.querySelector('[data-select-search]')
        || modal.querySelector('.ssel-opt.on') || modal.querySelector('.ssel-opt');
      if (el) { el.focus(); }
    }
    // Open/close the native <dialog> to match openSelect. showModal()/close() fire only on the
    // state edges (calling showModal() on an already-open dialog throws), and no-op in the
    // pure-render test harness, which shims a plain #modal element without the dialog methods.
    function syncDialog() {
      var dlg = document.getElementById('modal');
      if (!dlg || !dlg.showModal) { return; }
      if (openSelect && !dlg.open) {
        dlg.showModal();
        var ttl = dlg.querySelector('.ssel-modal-ttl');
        if (ttl && ttl.id) { dlg.setAttribute('aria-labelledby', ttl.id); }
        // searchSelect filters as you type; pin a fixed height so a shrinking list can't
        // resize the sheet and make it jump. Plain select stays content-sized.
        if (dlg.querySelector('[data-select-search]')) { dlg.classList.add('search'); }
        else { dlg.classList.remove('search'); scheduleSelectPeek(dlg); }
      } else if (!openSelect && dlg.open) {
        dlg.classList.remove('search');
        dlg.style.bottom = '';
        dlg.style.maxHeight = '';
        dlg.style.transform = '';
        dlg.style.transition = '';
        dlg.close();
      }
    }
    // searchSelect summons the on-screen keyboard, which overlays the bottom-anchored sheet.
    // While an input in the sheet is focused and the visual viewport has shrunk (keyboard up),
    // lift the sheet to sit just above the keyboard and let it grow past the 80dvh cap into the
    // freed space; otherwise clear the overrides and fall back to the CSS cap. On iOS the
    // keyboard overlays the layout viewport (bottom:0/dvh stay behind it), so window.innerHeight
    // stays full while visualViewport.height shrinks — their difference is the keyboard height.
    // No-op unless window.visualViewport exists (modern phone webview only; never runs on watch).
    function fitToKeyboard() {
      var dlg = document.getElementById('modal');
      if (!dlg || !dlg.open) { return; }
      var vv = window.visualViewport, ae = document.activeElement;
      var typing = Boolean(vv && ae && ae.tagName === 'INPUT' && dlg.contains(ae));
      // Gate on focus, not on a keyboard-height threshold: while the search stays focused the
      // keyboard is up, so keep the sheet lifted even if a transient viewport reading (momentum
      // rubber-band) would otherwise look like the keyboard closed. Tearing down mid-scroll is
      // what unpinned the header and dropped the spacer.
      if (typing) {
        var kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        dlg.style.bottom = kb + 'px';
        dlg.style.maxHeight = (vv.height - 12) + 'px';
      } else {
        dlg.style.bottom = '';
        dlg.style.maxHeight = '';
      }
    }
    // Fraction of the peek row left visible below the fold. A bit over half: enough of the last
    // item shows to read it, while the clipped remainder still advertises "there's more — scroll".
    var PEEK_ROW_FRACTION = 0.66;
    // Plain select is content-sized up to the 80dvh cap. When the option list overflows, the
    // last visible row can land flush (or as a too-thin sliver) against the sheet's bottom edge,
    // so nothing meaningful peeks out and the sheet reads as un-scrollable. Clamp the list so its
    // bottom edge cuts a row partway down (PEEK_ROW_FRACTION), always leaving a partial-row peek
    // that advertises the scroll. Rows vary in height (group headers vs options), so accumulate
    // real heights and pick the deepest row whose cut point still fits under the cap — the tallest
    // sheet that still shows a peek. Idempotent: resets its own clamp and re-measures the clean
    // 80dvh-capped height each call, so it's safe to run repeatedly (see scheduleSelectPeek).
    function fitSelectPeek(dlg) {
      if (!dlg.open || dlg.classList.contains('search')) { return; }
      var list = dlg.querySelector('.ssel-list');
      if (!list) { return; }
      list.style.maxHeight = '';                  // reset → measure the clean, capped height
      var H = list.clientHeight;
      // Bail until the dialog is actually laid out under its cap. On a mobile webview clientHeight
      // reads a pre-layout value right after showModal() (the whole content height, not yet capped),
      // so scrollHeight <= H and we'd wrongly no-op — scheduleSelectPeek re-runs us once layout
      // settles (rAF + the sheet-up animationend), when H is the real capped height and overflows.
      if (!H || list.scrollHeight <= H + 1) { return; }
      var rows = list.children, top = 0, target = 0, i, h, cut;
      for (i = 0; i < rows.length; i++) {
        h = rows[i].offsetHeight;
        cut = top + h * PEEK_ROW_FRACTION;        // bottom edge lands here → row shown at that fraction
        if (cut > H) { break; }                   // past the fold — the previous row is the peek
        target = cut;                             // deepest row whose cut point still fits so far
        top += h;
      }
      if (target >= 24) { list.style.maxHeight = Math.round(target) + 'px'; }
    }
    // Run fitSelectPeek now and again after the sheet's open layout settles. The synchronous call
    // covers desktop/no-animation; the double-rAF and sheet-up animationend cover mobile webviews
    // that lay the capped dialog out a frame (or the animation) late. All runs are idempotent.
    function scheduleSelectPeek(dlg) {
      fitSelectPeek(dlg);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () { requestAnimationFrame(function () { fitSelectPeek(dlg); }); });
      }
      dlg.addEventListener('animationend', function once() {
        dlg.removeEventListener('animationend', once);
        fitSelectPeek(dlg);
      });
    }
    // Close the open modal and return focus to the trigger that opened it.
    function closeSelect() {
      openSelect = null; render();
      if (lastSelectKey) {
        var trg = document.querySelector('[data-select="' + lastSelectKey + '"]');
        if (trg) { trg.focus(); }
        lastSelectKey = null;
      }
      if (onSheetClose) { var cb = onSheetClose; onSheetClose = null; cb(); }
    }
    // evalCtx(): the {settings..., env} object showWhen predicates evaluate against.
    function evalCtx() { var c = Object.assign({}, S); c.env = ENV; return c; }
    var hookCtx = {
      env: ENV,
      get: function (k) { return S[k]; },
      set: function (k, v) { S[k] = v; },
      getInitial: function (k) { return INITIAL[k]; }
    };

    // boot() requires the DOM; it is never called from Node tests (which exercise the pure
    // helpers above), so DOM access here is unguarded by design.

    // Toggle body.light from the theme setting; re-run on every render + on OS theme change.
    // Guarded for the pure-render Node test harness, which shims `document` without a
    // `window`/`body` — real browser boot always has both.
    function applyTheme() {
      if (typeof window === 'undefined' || !document.body) { return; }
      var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
      var prefersLight = Boolean(mq && mq.matches);
      if (resolveTheme(SCHEMA, S, prefersLight) === 'light') {
        document.body.classList.add('light');
      } else {
        document.body.classList.remove('light');
      }
    }

    function render() {
      var cx = { S: S, ENV: ENV, USERDATA: USERDATA, openColor: openColor, openSelect: openSelect, selectQuery: selectQuery, collapsed: collapsed, evalCtx: evalCtx() };
      document.getElementById('tabs').innerHTML = renderTabBar(SCHEMA, activeTab, cx);
      document.getElementById('scroll').innerHTML = renderBody(SCHEMA, activeTab, cx);
      document.getElementById('modal').innerHTML = renderSelectModal(SCHEMA, cx);
      syncDialog();
      document.getElementById('scroll').className = 'scroll' + (openSelect ? ' locked' : '');
      applyTheme();
    }

    // Tab bar: switch the active tab and close any open color/select overlays.
    function wireTabBar() {
      document.getElementById('tabs').addEventListener('click', function (e) {
        var b = e.target.closest('[data-tab]');
        if (b) { activeTab = b.getAttribute('data-tab'); openColor = null; openSelect = null; render(); }
      });
    }

    // Scroll body: click (control interactions incl. opening a select/searchSelect,
    // handled by #modal once open) and input (text fields).
    function wireInputs() {
      var scroll = document.getElementById('scroll');
      scroll.addEventListener('click', function (e) {
        var t;
        if ((t = e.target.closest('[data-select]'))) {
          var sk = t.getAttribute('data-select');
          if (openSelect === sk) { closeSelect(); return; }
          openSelect = sk; selectQuery = ''; lastSelectKey = sk; render(); focusModal(); return;
        }
        if ((t = e.target.closest('[data-toggle]'))) { S[t.getAttribute('data-k')] = !S[t.getAttribute('data-k')]; render(); return; }
        if ((t = e.target.closest('[data-color-pick]'))) { S[t.getAttribute('data-k')] = t.getAttribute('data-color-pick'); openColor = null; render(); return; }
        if ((t = e.target.closest('[data-color]'))) { var k = t.getAttribute('data-color'); openColor = (openColor === k ? null : k); render(); return; }
        if ((t = e.target.closest('[data-v]'))) {
          var vk = t.getAttribute('data-k'), oldV = S[vk], newV = t.getAttribute('data-v');
          S[vk] = newV;
          var vItem = findItem(vk);
          var onChangeFn = vItem && vItem.onChange && PConf.onChange.get(vItem.onChange);
          if (onChangeFn) { onChangeFn(S, oldV, newV, ENV, vk); }
          render();
          return;
        }
        if ((t = e.target.closest('[data-coll]'))) { var sid = t.getAttribute('data-coll'); collapsed[sid] = !collapsed[sid]; render(); return; }
        if ((t = e.target.closest('[data-copy]'))) { copyText(t.getAttribute('data-copy')); return; }
        if ((t = e.target.closest('[data-action]'))) { var act = t.getAttribute('data-action'); if (PConf.actions[act]) { PConf.actions[act](); } return; }
      });
      scroll.addEventListener('input', function (e) {
        var inp = e.target.closest('input[type=text]');
        if (inp) { S[inp.getAttribute('data-k')] = inp.value; }
      });
    }

    // The #modal overlay lives outside #scroll, so it needs its own delegated handlers:
    // pick an option (set value + fire onChange + close), close (backdrop / X), and the
    // searchSelect live filter (rebuild only the list so the input keeps focus + cursor).
    function wireModal() {
      var modal = document.getElementById('modal');
      modal.addEventListener('click', function (e) {
        var t;
        if ((t = e.target.closest('[data-select-pick]'))) {
          var k = t.getAttribute('data-k'), oldV = S[k], newV = t.getAttribute('data-select-pick');
          S[k] = newV;
          var it = findItem(k);
          var onChangeFn = it && it.onChange && PConf.onChange.get(it.onChange);
          if (onChangeFn) { onChangeFn(S, oldV, newV, ENV, k); }
          closeSelect(); return;
        }
        // Backdrop light-dismiss: a ::backdrop click targets the dialog element itself.
        if (e.target.closest('[data-select-close]') || e.target === modal) {
          closeSelect(); return;
        }
      });
      // Escape fires the dialog's native `cancel`; route it through closeSelect (the single
      // close path via render → syncDialog) instead of letting the dialog self-close and
      // desync openSelect.
      modal.addEventListener('cancel', function (e) { e.preventDefault(); closeSelect(); });
      modal.addEventListener('input', function (e) {
        var sb = e.target.closest('[data-select-search]');
        if (!sb) { return; }
        var sk = sb.getAttribute('data-select-search');
        selectQuery = sb.value;
        var list = document.querySelector('[data-ssel-list="' + sk + '"]');
        if (list) {
          var item = resolveRowItem(findItem(sk), { value: S[sk] }, { S: S, ENV: ENV });
          list.innerHTML = renderSelectOptions(item, S[sk], selectQuery, resolveRecommended(item, S, ENV));
        }
      });
      // Swipe-down-to-dismiss: only arms when the list is already at the top, so a downward
      // swipe mid-list still scrolls the list. Once armed, dragging down follows the finger
      // (translateY) and closes past a threshold; a shorter drag snaps back.
      var dragY = null, dragging = false;
      modal.addEventListener('touchstart', function (e) {
        var list = modal.querySelector('.ssel-list');
        dragY = (list && list.scrollTop <= 0) ? e.touches[0].clientY : null;
        dragging = false;
        modal.style.transition = '';
      }, { passive: true });
      modal.addEventListener('touchmove', function (e) {
        if (dragY == null) { return; }
        var dy = e.touches[0].clientY - dragY;
        if (dy <= 0) { if (dragging) { modal.style.transform = ''; dragging = false; } return; }
        dragging = true;
        e.preventDefault();            // hold the list still while the sheet follows the finger
        modal.style.transform = 'translateY(' + dy + 'px)';
      }, { passive: false });
      modal.addEventListener('touchend', function (e) {
        if (dragY != null && dragging) {
          if (e.changedTouches[0].clientY - dragY > 90) { closeSelect(); }
          else { modal.style.transition = 'transform .2s ease'; modal.style.transform = ''; }
        }
        dragY = null; dragging = false;
      }, { passive: true });
    }

    // Copy `text` to the clipboard from a [data-copy] control. Prefer the async Clipboard API (works
    // in the Core Devices app's WKWebView); fall back to a hidden-textarea execCommand for older
    // webviews or when the promise rejects (e.g. no permission). No in-app confirmation toast — the
    // phone shows its own "Copied" notification.
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {}, function () { legacyCopy(text); });
        return;
      }
      legacyCopy(text);
    }
    function legacyCopy(text) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select(); ta.setSelectionRange(0, text.length);
        var done = document.execCommand('copy');
        document.body.removeChild(ta);
        return done;
      } catch (e) { return false; }
    }
    // Expose the copy handler so overlays outside #scroll (the onboarding wizard) can wire their own
    // [data-copy] clicks through the same clipboard + toast path.
    PConf.copyText = copyText;

    // Save: run submit hooks, serialize, flash the toast, then return to the watch.
    function save() {
      PConf.hooks.runSubmit(hookCtx);
      var blob = serialize(SCHEMA, S);
      var el = document.getElementById('toast');
      el.textContent = 'Settings saved ✓';
      el.classList.add('show');
      setTimeout(function () { location.href = RETURN_TO + encodeURIComponent(JSON.stringify(blob)); }, 300);
    }
    function wireSave() {
      document.getElementById('save').addEventListener('click', save);
    }

    document.getElementById('appTitle').textContent = SCHEMA.appName;
    PConf.hooks.runLoad(hookCtx);
    wireTabBar();
    wireInputs();
    wireModal();
    wireSave();
    // Re-fit the sheet whenever the on-screen keyboard opens/closes or the viewport shifts.
    if (typeof window !== 'undefined' && window.visualViewport) {
      // Only react to keyboard open/close (resize). NOT visualViewport 'scroll' — that fires when
      // iOS pans the visual viewport during momentum/rubber-band list scrolling and would resize
      // the sheet mid-scroll, making it jump and flicker the header/spacer.
      window.visualViewport.addEventListener('resize', fitToKeyboard);
    }
    render();
    PConf.hooks.runReady({
      S: S, ENV: ENV, USERDATA: USERDATA, schema: SCHEMA, cfg: INJECTED_CFG || {},
      get: hookCtx.get, set: hookCtx.set, render: render, save: save,
      // Open a schema select/searchSelect in the shared bottom-sheet dialog. Used by the wizard,
      // which lives in its own overlay: the sheet is a showModal() top-layer dialog, so it renders
      // above that overlay. The engine sets S[key] on pick; onClose fires after any close.
      openSheet: function (key, onClose) {
        openSelect = key; selectQuery = ''; lastSelectKey = null;
        onSheetClose = onClose || null;
        render(); focusModal();
      }
    });

    if (SCHEMA.themeKey && typeof window !== 'undefined' && window.matchMedia) {
      var mqLight = window.matchMedia('(prefers-color-scheme: light)');
      if (mqLight.addListener) { mqLight.addListener(applyTheme); }
    }
  }

  PConf.engine = {
    serialize: serialize, hydrate: hydrate, boot: boot, initialCollapsed: initialCollapsed,
    esc: esc, renderControl: renderControl, renderRow: renderRow, renderSelectOptions: renderSelectOptions,
    renderSelectModal: renderSelectModal,
    renderTabBar: renderTabBar, renderBody: renderBody, resolveOptionsFrom: resolveOptionsFrom,
    resolveDefaultFrom: resolveDefaultFrom,
    resolveTheme: resolveTheme
  };
})();
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    serialize: PConf.engine.serialize, hydrate: PConf.engine.hydrate, boot: PConf.engine.boot,
    initialCollapsed: PConf.engine.initialCollapsed,
    blocks: PConf.blocks, hooks: PConf.hooks, onChange: PConf.onChange,
    esc: PConf.engine.esc, renderControl: PConf.engine.renderControl, renderRow: PConf.engine.renderRow,
    renderSelectOptions: PConf.engine.renderSelectOptions,
    renderSelectModal: PConf.engine.renderSelectModal,
    renderTabBar: PConf.engine.renderTabBar, renderBody: PConf.engine.renderBody,
    resolveOptionsFrom: PConf.engine.resolveOptionsFrom,
    resolveDefaultFrom: PConf.engine.resolveDefaultFrom,
    resolveTheme: PConf.engine.resolveTheme
  };
}
