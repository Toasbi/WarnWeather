// src/pkjs/config-ui/lib/engine.js — ES5. PConf.engine/blocks/hooks + module.exports.
// Pure render helpers live at module scope (unit-testable); boot() owns live state + DOM wiring.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
(function () {
  // esc + the shared sheet header live in lib/html.js (concatenated before
  // this file, attaching PConf.html — the color.js bridge pattern; required
  // under Node).
  var htmlLib = (typeof require !== 'undefined') ? require('./html.js') : PConf.html;
  var esc = htmlLib.esc;
  var sheetHeader = htmlLib.sheetHeader;
  // The chip+hex colour readout a badge's `chip` prints — the SAME builder the rgb
  // control renders above its sliders (rgb-control.js renderRgb), so a row and the
  // sheet it opens show one colour in one vocabulary.
  var swatchReadout = htmlLib.swatchReadout;
  // A joined row's no-divider class (' nb' / ' nbl'), shared with the checklist's rows.
  var nbClass = htmlLib.nbClass;
  // The date control (value helpers + renderers + wheel wiring) lives in
  // lib/date-picker.js; the aliases keep this file's call sites and export
  // surface unchanged.
  var datePicker = (typeof require !== 'undefined') ? require('./date-picker.js') : PConf.datePicker;
  // The range/threshold slider (numeric rules + renderers + drag wiring) lives
  // in lib/range-control.js; same alias discipline as the date picker above.
  var rangeControl = (typeof require !== 'undefined') ? require('./range-control.js') : PConf.rangeControl;
  var snapToStep = rangeControl.snapToStep;
  var formatRange = rangeControl.formatRange;
  var parseRange = rangeControl.parseRange;
  var moveThumb = rangeControl.moveThumb;
  var thresholdValues = rangeControl.thresholdValues;
  var paintThresholdRange = rangeControl.paintThresholdRange;
  var renderRange = rangeControl.renderRange;
  // The three-channel colour control (type: 'rgb') lives in lib/rgb-control.js: the
  // slider's single-thumb track, composed three times. Same alias discipline.
  var rgbControl = (typeof require !== 'undefined') ? require('./rgb-control.js') : PConf.rgbControl;
  var parseRgb = rgbControl.parseRgb;
  var formatRgb = rgbControl.formatRgb;
  var rgbHex = rgbControl.rgbHex;
  var setRgbChannel = rgbControl.setRgbChannel;
  var renderRgb = rgbControl.renderRgb;
  var paintRgb = rgbControl.paintRgb;
  // The checklist control (type: 'checklist', a grid of ticks for one code) renders in
  // lib/checklist.js; its tap stays here (controlClick's [data-check] case). Same alias
  // discipline.
  var checklist = (typeof require !== 'undefined') ? require('./checklist.js') : PConf.checklist;
  var renderChecklist = checklist.renderChecklist;
  var formatDateValue = datePicker.formatDateValue;
  var parseDateParts = datePicker.parseDateParts;
  var dateValueFromParts = datePicker.dateValueFromParts;
  var renderDateTrigger = datePicker.renderDateTrigger;
  var renderDateModal = datePicker.renderDateModal;
  // Shared single-source helpers: PConf.color / PConf.schemaWalk are concatenated before this
  // file in the page, and required first by the Node tests. No local re-implementation.
  var intToHex = PConf.color.intToHex;
  var eachItem = PConf.schemaWalk.eachItem;

  /**
   * One register/get pair backed by a private map — the shape every extension
   * registry below shares. Eight hand-copied closures used to spell it out.
   * @returns {{register: Function, get: Function}} A fresh registry.
   */
  function makeRegistry() {
    var map = {};
    return {
      register: function (id, fn) { map[id] = fn; },
      get: function (id) { return map[id]; }
    };
  }

  // --- block registry --- fn(S, env, userData) -> htmlString for a schema block.
  PConf.blocks = makeRegistry();

  // --- icon registry --- a row opts into a small leading glyph by id (item.icon: id);
  // register(id, svgString) stores an inline-SVG fragment, printed before the row's label
  // by labelIconHtml below. Fn-less: the entry IS the markup, not a renderer. TRUST
  // BOUNDARY: like a block's HTML the fragment is printed UNESCAPED, so only page code
  // registers here — never a string built from settings, userData or a fetched value.
  // Draw with currentColor so the glyph follows the label chrome's colour and the theme.
  PConf.icons = makeRegistry();

  // --- options-resolver registry --- a select/searchSelect/radio item opts into a
  // multi-key derived option list by name (item.optionsFrom.resolver: id) without the
  // engine knowing what the derivation logic is.
  // fn(S, env, args) returns [[label, value], ...]; see resolveOptionsFrom below.
  PConf.optionsResolvers = makeRegistry();

  // --- defaults-resolver registry --- a keyed item opts into a platform-aware default
  // by name (item.defaultFrom.resolver: id), resolved at hydrate + snap time. Separate
  // from optionsResolvers because a defaults resolver returns a single value, not a list.
  // fn(env, args) -> defaultValue; see resolveDefaultFrom below. defaultFrom.sticky:
  // false keeps a value equal to that default OUT of the save blob (serialize), so the
  // key stays absent and resolves per watch again instead of freezing the saving one's.
  PConf.defaultsResolvers = makeRegistry();

  // --- recommend-resolver registry --- a select item flags its "best for you" option by name
  // (item.recommendFrom: id); the resolver fn(S, env) returns the recommended option VALUE and the
  // matching row in the open sheet gets a "(Recommended)" marker. Derived, like defaults, but read at
  // render time (so it tracks another key, e.g. the country selector) and yields a value, not a list.
  PConf.recommendResolvers = makeRegistry();

  // --- sheet-resolver registry --- a row opts into a per-value edit sheet by name
  // (item.editSheetFrom: {resolver, args}); the resolver fn(S, env, args) returns the
  // sheetId of a sheetOnly section to open for the row's CURRENT value, or null for
  // "this value has nothing to edit" (no pencil). Read at render time, like recommend.
  // args always carries the row's messageKey (schema args merge over it), so a resolver
  // shared by many rows needs no per-row args at all.
  PConf.sheetResolvers = makeRegistry();

  // --- range-resolver registry --- a range item opts into settings-derived geometry and
  // zone styling by name (item.rangeFrom: {resolver, args}); the resolver fn(S, env, args)
  // returns the effective config (min/max/step/minSpan, dir, zone colors, seeds — see
  // thresholdRange in blocks.js), merged over the item at render AND drag time so unit
  // switches, a stored scale-max override and live color edits all take effect immediately.
  PConf.rangeResolvers = makeRegistry();

  // --- badge-resolver registry --- a row with an edit-sheet trigger opts into a state badge
  // (item.editBadgeFrom: {resolver, args}); fn(S, env, args) returns null (no badge) or
  // {label?, ariaNote?, chip?, dots: [{color, ring?}]} — an app-neutral colour preview that
  // LEADS the control: `chip` is ONE colour printed the way a colour sheet prints it (a
  // swatch and its '#RRGGBB', html.js swatchReadout), `dots` are small outlined (`ring`) or
  // filled pips for a row that previews SEVERAL colours at once; `label` is the trigger
  // button's text and `ariaNote` a parenthesised state word appended to its aria-label.
  // The library prints what it is given and knows nothing of what the colours mean — a
  // resolver picks chip or dots by how many colours the row owns, not by what they are.
  // Read at render time like the sheet resolver, and only consulted when a sheet
  // actually resolved.
  PConf.badgeResolvers = makeRegistry();

  // --- display-resolver registry --- a keyed item opts into a DERIVED display value by
  // name (item.displayFrom: {resolver, args}); fn(S, env, args) returns the value to
  // PAINT while the stored value stays untouched, so a key whose effective value is
  // resolved elsewhere (from other keys, the theme or the platform) still shows what it
  // actually renders as. Read at render time, like the badge resolver. Two ways in:
  // `color` items via displayFrom (args get the item's messageKey merged under them) and
  // collapsible sections via titleFrom (the collapsed card header's value; args pass
  // through verbatim — sections have no messageKey). Writes are unaffected: a control
  // still stores under its own messageKey, so picking the shown value pins it.
  PConf.displayResolvers = makeRegistry();

  // --- hint-resolver registry --- a value row opts into a DERIVED hint by name
  // (item.hintFrom: {resolver, args}); fn(S, env, args) returns the hint HTML, or
  // null/undefined for "use the row's static hint" (hintByValue for the shown value,
  // else hint). '' is a real answer: no hint. For a hint that depends on OTHER keys
  // than the row's own value (hintByValue covers that one) — e.g. a line-style
  // picker explaining the scale of its line's metric. Read at render time, after the
  // display-snap, like the badge resolver; the page re-renders its whole body after
  // every change, so the hint follows any key the resolver reads with no dependency
  // list. args carries the row's messageKey and its shown value, merged UNDER
  // hintFrom.args.
  PConf.hintResolvers = makeRegistry();

  // --- attention-resolver registry --- a row opts into "needs attention" by name
  // (item.attentionFrom: {resolver, args}); fn(S, env, args) returns null (nothing to
  // fix) or {note, title, body, actionLabel, confirmLabel?, sheet?}: something the user
  // should fix before saving (e.g. a picked source whose API key is still empty, or
  // known to be refused). The engine reads it in two places. The label of the tab
  // that holds the row carries a small dot (`note` is appended to its aria-label), and
  // the Save button first opens a confirm dialog in the shared sheet: `title`, `body`,
  // then `actionLabel`, which opens the fix (`sheet`, else the row's editSheetFrom sheet,
  // else the sheetOnly section the row sits in) on the row's tab WITHOUT saving, and
  // `confirmLabel` ("Save anyway" when omitted), which saves exactly as Save does. It
  // never blocks saving: no answer, no title, or a page that cannot open a <dialog>
  // saves at once. args carries the row's messageKey and its stored value, merged UNDER
  // attentionFrom.args. Read at render time (every render repaints the tab bar), like the
  // hint resolver.
  PConf.attentionResolvers = makeRegistry();

  // --- when-resolver registry --- a showWhen (or disabledWhen / optionDisabledWhen) leaf
  // asks a rule by name (show-when.js { when: id, args }); fn(S, env, args) answers
  // whether it holds. S is the evaluation context (the settings, plus their env), so a
  // resolver reads any key, and the page re-renders after every change, as for the hint
  // resolver. An unregistered id reads false.
  PConf.whenResolvers = makeRegistry();

  // --- onChange registry --- a schema item opts into a post-change side effect by
  // name (item.onChange: id) without the engine knowing what that side effect is.
  // fn(S, oldValue, newValue, env) runs synchronously, right after the click handler
  // sets the new value and before the next render(). env is the platform env (INJECTED_ENV).
  PConf.onChange = makeRegistry();

  // --- check-writer registry --- a `checklist` grid names the writer of its lists
  // (item.writeWith: id), so a tap stores what the lists' own contract stores: the grid
  // keeps no option order and runs no onChange of its own. fn(S, key, code, on) ticks
  // `code` into the list stored at S[key] (on) or out of it, and may move it elsewhere
  // too; it runs synchronously on the tap, before the next render().
  PConf.checkWriters = makeRegistry();

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
   * A schema item's default in the shape the page holds it in S: resolveDefaultFrom
   * (env-aware), with a number color default as '#RRGGBB'. hydrate seeds S with it,
   * serialize compares a non-sticky defaultFrom value against it, and boot hands it to
   * reset-style actions (defaultAsStored) — one shape, so the three always agree.
   * @param {Object} item Schema item.
   * @param {Object} [env] Platform env, passed to any defaultFrom resolver.
   * @returns {*} The stored-shape default (undefined if the item has none).
   */
  function storedDefault(item, env) {
    var dv = resolveDefaultFrom(item, env);
    return (item.type === 'color' && typeof dv === 'number') ? intToHex(dv) : dv;
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
      var dv = storedDefault(it, env);
      if (typeof dv === 'undefined') { return; }
      S[it.messageKey] = dv;
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
   * watch. staticText items (no real value) are skipped, and so is a
   * `defaultFrom: {sticky: false}` item whose value equals its default resolved
   * for THIS env: hydrate put that default into S, so writing it back would store
   * the saving watch's default as though it were a pick, and the host that saves
   * the blob wholesale would then serve it to every watch. Left absent, the key
   * resolves per watch again; a value that differs is a pick and is kept.
   *
   * @param {Object} schema Config schema.
   * @param {Object} S Settings state.
   * @param {Object} [env] Platform env — the one hydrate resolved S with.
   * @returns {Object} Blob of messageKey -> value.
   */
  function serialize(schema, S, env) {
    var out = {};
    eachItem(schema, function (it) {
      if (!it.messageKey || it.type === 'staticText') { return; }
      if (it.defaultFrom && it.defaultFrom.sticky === false
          && S[it.messageKey] === storedDefault(it, env)) { return; }
      out[it.messageKey] = S[it.messageKey];
    });
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
  // `off` (optional) lists option VALUES to render inert. Disabling rather than
  // dropping an option keeps the stored value intact: an option removed from the
  // list is snapped away by resolveOptionsFrom, which would silently rewrite a
  // setting the user never touched.
  function optionButtons(item, v, isRadio, off) {
    var h = '', i, o;
    for (i = 0; i < item.options.length; i++) {
      o = item.options[i];
      var inner = isRadio ? '<span>' + esc(o[0]) + '</span><span class="dot"></span>' : esc(o[0]);
      var isOff = Boolean(off) && off.indexOf(o[1]) !== -1;
      h += '<button class="' + (v === o[1] ? 'on' : '') + '" data-k="' + item.messageKey
        + '" data-v="' + esc(o[1]) + '"' + (isOff ? ' disabled' : '') + '>' + inner + '</button>';
    }
    return h;
  }

  /**
   * Option values to render inert, from item.optionDisabledWhen: a map of option
   * value -> showWhen-style condition. [] when the item declares none.
   * @param {Object} item Schema item.
   * @param {Object} evalCtx showWhen evaluation context.
   * @returns {string[]} Disabled option values.
   */
  function disabledOptionValues(item, evalCtx) {
    var map = item.optionDisabledWhen, out = [], k;
    if (!map) { return out; }
    for (k in map) {
      if (Object.prototype.hasOwnProperty.call(map, k)
        && PConf.showWhen.evaluate(map[k], evalCtx)) { out.push(k); }
    }
    return out;
  }
  /**
   * The .sw switch control — the ONLY producer of the switch markup; row toggles
   * and subheader-hosted toggles both render through here.
   * @param {Object} item Toggle schema item.
   * @param {*} v Current value (truthy renders the switch on).
   * @param {string} [ariaLabel] Accessible name for a switch rendered away from
   *   its text label (a subheader-hosted toggle); omitted for row toggles, whose
   *   row label names them.
   * @param {boolean} [disabled] Render the switch inert (a subheader-hosted toggle
   *   whose item.disabledWhen holds — a row toggle mutes through its row's .dis
   *   instead). The `disabled` attribute is what controlClick checks, so a switch
   *   that CSS cannot stop (keyboard, a synthetic click) still does not flip.
   * @returns {string} Switch button HTML.
   */
  function renderToggle(item, v, ariaLabel, disabled) {
    return '<button class="sw' + (v ? ' on' : '') + '" data-k="' + esc(item.messageKey)
      + '" data-toggle="1"' + (ariaLabel ? ' aria-label="' + esc(ariaLabel) + '"' : '')
      + (disabled ? ' disabled' : '') + '><i></i></button>';
  }
  function renderSegmented(item, v, off) { return '<div class="seg">' + optionButtons(item, v, false, off) + '</div>'; }
  function renderRadio(item, v, off) { return '<div class="radio">' + optionButtons(item, v, true, off) + '</div>'; }
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
  // `off` — values gated inert by the item's optionDisabledWhen, computed by the
  // CALLER (disabledOptionValues needs an evalCtx this pure renderer doesn't hold).
  // Without it the sheet path ignored the declared gates entirely: the tab-body
  // radio/segmented renderers got them via view.disabledOptions, but a select
  // opened AS A SHEET (openSheet — the custom-layout editor's only surface)
  // rendered every gated option fully pickable.
  function renderSelectOptions(item, value, query, recommended, off) {
    var q = String(query || '').toLowerCase(), h = '', i, o, lo, vo, meta, gated, classes, labelCell, rec, recLead, shown = 0;
    var offVals = off || [];
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
      // A name that already ends in a parenthesis ("Foo (beta)") would read
      // "Foo (beta) (Recommended)", so where a desc line exists the marker leads
      // that line instead ("Recommended · <desc>"). Every other option renders as before.
      recLead = Boolean(rec) && Boolean(meta.desc) && o[0].charAt(o[0].length - 1) === ')';
      // An option may carry a one-line description (meta.desc) rendered under its name — the
      // weather-provider picker uses it to say what each provider is best at while choosing.
      // Options without a desc keep the original single-span layout untouched.
      labelCell = meta.desc
        ? '<span class="ssel-opt-txt"><span class="ssel-opt-name">' + esc(o[0]) + (recLead ? '' : rec) + '</span>'
          + '<span class="ssel-opt-desc">' + (recLead ? '<b class="ssel-rec">Recommended</b> · ' : '')
          + esc(meta.desc) + '</span></span>'
        : '<span>' + esc(o[0]) + rec + '</span>';
      // A non-header disabled option — per-option meta.disabled (a provider-gated
      // slot item, e.g. "Pollen (DWD)" under another provider) or an
      // optionDisabledWhen gate resolved by the caller — stays visible but inert:
      // no data-select-pick, so the delegated pick handler can never match, plus
      // the disabled attribute against taps/keyboard. Muted inline — .ssel-opt
      // has no [disabled] rule of its own — mirroring .seg button[disabled].
      gated = meta.disabled || offVals.indexOf(o[1]) !== -1;
      h += '<button type="button" class="' + classes + '" role="option" aria-selected="'
        + (value === o[1] ? 'true' : 'false') + '"'
        + (gated
          ? ' disabled aria-disabled="true" style="opacity:.38;cursor:not-allowed"'
          : ' data-select-pick="' + esc(o[1]) + '" data-k="' + esc(item.messageKey) + '"')
        + '>' + labelCell
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
   * The sheetId this row's current value offers for editing, via the item's named
   * sheet resolver — null when the item opts out or the resolver offers nothing.
   *
   * @param {Object} item Schema item (editSheetFrom: {resolver, args}).
   * @param {Object} S Live settings state.
   * @param {Object} env Platform env.
   * @returns {?string} sheetId of a sheetOnly section, or null.
   */
  function resolveEditSheet(item, S, env) {
    if (!item.editSheetFrom) { return null; }
    var fn = PConf.sheetResolvers.get(item.editSheetFrom.resolver);
    if (!fn) { return null; }
    var args = Object.assign({ messageKey: item.messageKey }, item.editSheetFrom.args || {});
    var id = fn(S, env, args);
    return id == null ? null : String(id);
  }

  /**
   * The effective item for a range row: a rangeFrom item resolves its settings-derived
   * config through the named range-resolver and returns a merged clone; a plain range
   * item passes through unchanged. Resolved at render time AND again at drag/keyboard
   * time, so the pointer math always uses the current units/colors/scale max.
   *
   * @param {Object} item Range schema item (rangeFrom: {resolver, args}).
   * @param {Object} S Live settings state.
   * @param {Object} env Platform env.
   * @returns {Object} The item to render/drag with.
   */
  function resolveRangeItem(item, S, env) {
    if (!item.rangeFrom) { return item; }
    var fn = PConf.rangeResolvers.get(item.rangeFrom.resolver);
    if (!fn) { return item; }
    var args = Object.assign({ messageKey: item.messageKey }, item.rangeFrom.args || {});
    return Object.assign({}, item, fn(S, env, args));
  }

  /**
   * The state badge for a row's edit-sheet trigger, via the item's named badge
   * resolver — null when the item opts out or the resolver reports nothing to show.
   *
   * `args` gets the item's own messageKey merged UNDER editBadgeFrom.args, so a keyless
   * row (a `sheet` item) must carry its identity in editBadgeFrom.args instead.
   *
   * @param {Object} item Schema item (editBadgeFrom: {resolver, args}).
   * @param {Object} S Live settings state.
   * @param {Object} env Platform env.
   * @returns {?{label: (string|undefined), ariaNote: (string|undefined),
   *   chip: (string|undefined),
   *   dots: Array<{color: string, ring: (boolean|undefined)}>}} Badge, or null.
   */
  function resolveEditBadge(item, S, env) {
    if (!item.editBadgeFrom) { return null; }
    var fn = PConf.badgeResolvers.get(item.editBadgeFrom.resolver);
    if (!fn) { return null; }
    var args = Object.assign({ messageKey: item.messageKey }, item.editBadgeFrom.args || {});
    return fn(S, env, args) || null;
  }

  /**
   * The value a row should PAINT, via the item's named display resolver — undefined when
   * the item opts out or the resolver is missing, in which case the control falls back to
   * the stored value. The stored value is never rewritten: this is a display override for
   * a key whose effective value is resolved elsewhere, and picking the shown value through
   * the normal control still writes it.
   *
   * `args` gets the item's own messageKey merged UNDER displayFrom.args, matching the
   * sheet/badge resolvers, so a resolver shared by many rows needs no per-row args.
   *
   * @param {Object} item Schema item (displayFrom: {resolver, args}).
   * @param {Object} S Live settings state.
   * @param {Object} env Platform env.
   * @returns {*} The value to display, or undefined for "use the stored value".
   */
  function resolveDisplayValue(item, S, env) {
    if (!item.displayFrom) { return undefined; }
    var fn = PConf.displayResolvers.get(item.displayFrom.resolver);
    if (!fn) { return undefined; }
    var args = Object.assign({ messageKey: item.messageKey }, item.displayFrom.args || {});
    return fn(S, env, args);
  }

  /**
   * The hint a row derives from the live settings, via the item's named hint resolver —
   * undefined when the item opts out, the resolver is missing or it answers
   * null/undefined, in which case the row falls back to its static hintByValue/hint.
   * An empty string is honoured: the resolver saying "no hint here".
   *
   * `args` gets the row's messageKey and its SHOWN value (after the display-snap, so a
   * stored value the options no longer carry is described as what the row displays)
   * merged UNDER hintFrom.args.
   *
   * @param {Object} item Schema item (hintFrom: {resolver, args}).
   * @param {Object} S Live settings state.
   * @param {Object} env Platform env.
   * @param {*} value The value the row shows.
   * @returns {(string|undefined)} Hint HTML, or undefined for "use the static hint".
   */
  function resolveHint(item, S, env, value) {
    if (!item.hintFrom) { return undefined; }
    var fn = PConf.hintResolvers.get(item.hintFrom.resolver);
    if (!fn) { return undefined; }
    var args = Object.assign({ messageKey: item.messageKey, value: value }, item.hintFrom.args || {});
    var hint = fn(S, env, args);
    return hint == null ? undefined : String(hint);
  }

  /**
   * A staticText's HTML: its `text`, or a text DERIVED from the live settings by a named
   * hint resolver (item.textFrom: {resolver, args}) — for a note whose words, or whether
   * it shows at all, depend on more than a showWhen can test (e.g. "this key is still
   * empty", where a blank of only spaces counts as empty). The resolver gets
   * textFrom.args verbatim (a staticText has no messageKey or value to merge); a
   * null/undefined answer falls back to `text`, and '' means "no note now": the item
   * renders nothing, its blocks included, and the row above keeps its divider
   * (nextVisibleJoins skips it).
   *
   * @param {Object} item staticText item (text, optional textFrom).
   * @param {Object} S Live settings state.
   * @param {Object} env Platform env.
   * @returns {string} The note's HTML ('' for none).
   */
  function resolveStaticText(item, S, env) {
    if (!item.textFrom) { return item.text || ''; }
    var fn = PConf.hintResolvers.get(item.textFrom.resolver);
    var t = fn ? fn(S, env, Object.assign({}, item.textFrom.args || {})) : null;
    return t == null ? (item.text || '') : String(t);
  }

  /**
   * Whether a staticText whose text is derived (textFrom) has nothing to say right now,
   * so it renders nothing although its showWhen holds.
   * @param {Object} item Schema item.
   * @param {Object} cx Render context ({S, ENV}).
   * @returns {boolean} True for a textFrom staticText resolving to ''.
   */
  function derivedTextEmpty(item, cx) {
    return item.type === 'staticText' && Boolean(item.textFrom) && resolveStaticText(item, cx.S, cx.ENV) === '';
  }

  /**
   * What a row needs fixed, via the item's named attention resolver — null when the item
   * opts out, the resolver is missing or it reports nothing. See PConf.attentionResolvers.
   * @param {Object} item Schema item (attentionFrom: {resolver, args}).
   * @param {Object} S Live settings state.
   * @param {Object} env Platform env.
   * @returns {?{note: (string|undefined), title: (string|undefined), body: (string|undefined),
   *   actionLabel: (string|undefined), confirmLabel: (string|undefined),
   *   sheet: (string|undefined)}} The resolver's answer, or null.
   */
  function resolveAttention(item, S, env) {
    if (!item.attentionFrom) { return null; }
    var fn = PConf.attentionResolvers.get(item.attentionFrom.resolver);
    if (!fn) { return null; }
    var args = Object.assign({ messageKey: item.messageKey, value: (S || {})[item.messageKey] },
      item.attentionFrom.args || {});
    return fn(S, env, args) || null;
  }

  /**
   * The first row that needs attention, in schema order: a visible attentionFrom row in a
   * visible section (a sheetOnly section counts for the tab whose sections hold it) of a
   * visible tab — or, given `tabId`, of that tab only. Drives the tab bar's dots and the
   * Save button's confirm dialog.
   * @param {Object} schema Config schema.
   * @param {{S: Object, ENV: Object, evalCtx: Object}} cx Render context.
   * @param {string} [tabId] Only look at this tab.
   * @returns {?{tab: string, item: Object, section: Object, attention: Object}} The row, or null.
   */
  function findAttention(schema, cx, tabId) {
    var tabs = schema.tabs || [], ti, si, ii, tab, secs, sec, item, att;
    for (ti = 0; ti < tabs.length; ti++) {
      tab = tabs[ti];
      if ((tabId && tab.id !== tabId) || !PConf.showWhen.isVisible(tab, cx.evalCtx)) { continue; }
      secs = tab.sections || [];
      for (si = 0; si < secs.length; si++) {
        sec = secs[si];
        if (sec.showWhen && !PConf.showWhen.isVisible(sec, cx.evalCtx)) { continue; }
        for (ii = 0; ii < (sec.items || []).length; ii++) {
          item = sec.items[ii];
          if (!item.attentionFrom || !PConf.showWhen.isVisible(item, cx.evalCtx)) { continue; }
          att = resolveAttention(item, cx.S, cx.ENV);
          if (att) { return { tab: tab.id, item: item, section: sec, attention: att }; }
        }
      }
    }
    return null;
  }

  /**
   * The Save button's confirm dialog (a row needs attention, see PConf.attentionResolvers),
   * rendered into the shared sheet like the select and edit sheets: the title in the sheet
   * header (with its close button), one plain sentence, then the fix (`actionLabel`, when
   * the attention offers one) and "Save anyway" (`confirmLabel`). Both texts are escaped.
   * Buttons sit side by side with a margin rather than a flex gap, which old Android
   * WebViews do not lay out.
   * @param {?{title: string, body: (string|undefined), actionLabel: (string|undefined),
   *   confirmLabel: (string|undefined)}} confirm The open dialog, or null.
   * @returns {string} Sheet header + body HTML, or '' when no dialog is open.
   */
  function renderConfirmModal(confirm) {
    if (!confirm) { return ''; }
    return sheetHeader('cfm-ttl', esc(String(confirm.title || '')))
      + '<div class="cfm">'
      + (confirm.body ? '<p class="cfm-body">' + esc(String(confirm.body)) + '</p>' : '')
      + '<div class="cfm-btns">'
      + (confirm.actionLabel
        ? '<button type="button" class="cfm-btn pri" data-confirm="action">' + esc(String(confirm.actionLabel)) + '</button>'
        : '')
      + '<button type="button" class="cfm-btn" data-confirm="save">'
      + esc(String(confirm.confirmLabel || 'Save anyway')) + '</button>'
      + '</div></div>';
  }

  // Rotate-ccw glyph for a label's reset-to-defaults button (item.labelAction).
  var RESET_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';

  /**
   * The small icon button beside a label or sub-header (item.labelAction:
   * {action, arg, label}), dispatching through the shared [data-action] path —
   * e.g. the threshold group's reset-to-defaults. '' when the item has none.
   * @param {Object} item Schema item.
   * @returns {string} Button HTML, or ''.
   */
  function labelActionHtml(item) {
    if (!item.labelAction) { return ''; }
    return '<button type="button" class="lbl-act" data-action="' + esc(item.labelAction.action)
      + '" data-action-arg="' + esc(item.labelAction.arg == null ? '' : item.labelAction.arg)
      + '" aria-label="' + esc(item.labelAction.label || 'Reset') + '">' + RESET_SVG + '</button>';
  }

  /**
   * A `subheader` item: an in-body group header (the .subhdr the grouped cards
   * already use) that can host the group's master toggle and a labelAction. It
   * lets ONE section hold more than one group — the threshold sheets keep a
   * slot-level Bold row outside the threshold group, so the group needs a header
   * of its own and the master switch belongs on it rather than in the sheet's
   * title row.
   *
   * The hosted toggle keeps its normal place in sec.items (hydrate, serialize,
   * findItem and its onChange hook all still see it); only its row is suppressed
   * (the isHostedRow predicate, consulted by every row-emitting path).
   *
   * @param {Object} item The subheader item ({text, toggleKey?, labelAction?}).
   * @param {Object} sec The section holding it (searched for the toggle item).
   * @param {Object} cx Render context.
   * @returns {string} Sub-header HTML.
   */
  function renderSubheader(item, sec, cx) {
    var toggle = '', i, it = null;
    if (item.toggleKey) {
      for (i = 0; i < (sec.items || []).length; i++) {
        if (sec.items[i].messageKey === item.toggleKey && sec.items[i].type === 'toggle') {
          it = sec.items[i];
        }
      }
      // A gated-off toggle leaves the header bare rather than drawing a switch
      // the platform can't honour. The toggle's text label stays behind in the
      // body, so the accessible name must ride the switch itself.
      if (it && PConf.showWhen.isVisible(it, cx.evalCtx)) {
        toggle = renderToggle(it, cx.S[it.messageKey], String(it.label || 'Enable'),
          Boolean(it.disabledWhen) && PConf.showWhen.evaluate(it.disabledWhen, cx.evalCtx));
      }
    }
    // item.intro is the group's own explanatory copy — the section-level `intro`
    // moved down here for the threshold sheets, where it describes the group
    // rather than the whole sheet. HTML, like every other intro/hint.
    return '<div class="subhdr grp"><span>' + esc(item.text || '') + '</span>'
      + labelActionHtml(item) + toggle + '</div>'
      + (item.intro ? '<div class="intro">' + item.intro + '</div>' : '');
  }

  /**
   * The edit-sheet trigger for a row whose value resolved a sheet, or ''. A proper
   * outlined text button (was a pencil icon): the badge resolver supplies its label,
   * defaulting to "Edit" when the row has no badge at all. The same label LEADS the
   * aria-label ("Edit settings for the … value"), so the announced text tracks the
   * visible button without repeating it, and the badge's optional `ariaNote` is
   * appended in parentheses so a state the swatch shows visually is also announced.
   *
   * @param {Object} item Schema item (for the aria label).
   * @param {{editSheet: ?string, editBadge: ?Object}} view Render view state.
   * @returns {string} Trigger button HTML, or ''.
   */
  function editPenHtml(item, view) {
    if (!view.editSheet) { return ''; }
    var badge = view.editBadge;
    var label = (badge && badge.label) || 'Edit';
    return '<button type="button" class="thr-btn" data-edit-sheet="' + esc(view.editSheet)
      + '" aria-label="' + esc(label) + ' settings for the '
      + esc(String(item.label || 'selected'))
      + ' value' + esc((badge && badge.ariaNote) ? ' (' + String(badge.ariaNote) + ')' : '') + '">'
      + '<span>' + esc(label) + '</span></button>';
  }

  /**
   * The badge's state preview — badge.chip first when the row previews ONE colour (the
   * full swatch+hex readout a colour sheet prints, built by html.js swatchReadout so the
   * row and the sheet cannot drift), then a bold "B" when badge.bold is set (the slot's
   * value renders always-bold on the watch), then one dot per entry in badge.dots,
   * outlined when the entry sets `ring` and filled otherwise — or '' when the row has
   * none of the three.
   * It sits BEFORE the control as a passive preview, not inside the edit button:
   * carried inside, the swatches widened the button by ~29px exactly on the rows that
   * had them, so the Edit buttons could never line up down the right edge. Out here
   * the button is one fixed width and the swatch reads as what it is — a preview,
   * with nothing to press. aria-hidden like the dots: the badge's ariaNote already
   * announces the state on the Edit button itself.
   *
   * @param {{editSheet: ?string, editBadge: ?Object}} view Render view state.
   * @returns {string} Swatch HTML, or ''.
   */
  function editSwatchHtml(view) {
    var badge = view.editBadge;
    var dots = (badge && badge.dots) || [];
    var bold = Boolean(badge && badge.bold);
    var chip = (badge && badge.chip) ? String(badge.chip) : '';
    if (!view.editSheet || (!dots.length && !bold && !chip)) { return ''; }
    var h = '<span class="thr-swatch" aria-hidden="true">', i;
    if (chip) { h += swatchReadout(chip); }
    if (bold) { h += '<span class="pen-b">B</span>'; }
    for (i = 0; i < dots.length; i++) {
      h += '<span class="pen-dot ' + (dots[i].ring ? 'ring' : 'fill')
        + '" style="--th-c:' + esc(String(dots[i].color)) + '"></span>';
    }
    return h + '</span>';
  }

  /**
   * Shared trigger for both `select` and `searchSelect`: a select-like button that opens
   * the modal popup — or, for a `select` inside an edit sheet, expands its options in
   * place under the row (view.openInline, renderInlineList). aria-controls points at the
   * option list either surface renders; both use the same id.
   *
   * @param {Object} item Schema item (select or searchSelect).
   * @param {{value: *, openSelect: ?string, openInline: ?string}} view Render view state.
   * @returns {string} Trigger button HTML.
   */
  function renderSelectTrigger(item, view) {
    var key = esc(item.messageKey), label = currentLabel(item, view.value);
    var listId = 'ssel-list-' + key;
    var open = view.openSelect === item.messageKey || view.openInline === item.messageKey;
    var accessibleLabel = selectTriggerAria(item, label);
    return '<button type="button" class="sel-wrap" data-select="' + key
      + '" aria-label="' + esc(accessibleLabel) + '" aria-haspopup="listbox" aria-expanded="'
      + (open ? 'true' : 'false') + '" aria-controls="' + listId + '"><span>'
      + esc(label) + '</span><i class="sel-chev"></i></button>';
  }

  /**
   * A select trigger's accessible name: the row's field label, then the shown option.
   * Shared by the render path and the in-place relabel after a text commit, so the two
   * can't announce different things.
   *
   * @param {Object} item Schema item (select or searchSelect).
   * @param {string} label The option label the trigger shows.
   * @returns {string} The aria-label text (unescaped).
   */
  function selectTriggerAria(item, label) {
    return String(item.label || 'Selection') + ': ' + label;
  }

  /**
   * The label a select/searchSelect trigger shows for the live settings: the stored
   * value's option label from the item's CURRENT option list (optionsFrom resolved
   * against S, so a resolver whose labels read other keys answers for their current
   * values). Null when the stored value is not among those options — the render path
   * snaps such a value (resolveRowItem), which this pure lookup must not do.
   *
   * @param {Object} item Schema item (select or searchSelect).
   * @param {Object} S Live settings state.
   * @param {Object} [env] Platform env, threaded to an options resolver.
   * @returns {?string} The trigger label, or null.
   */
  function selectTriggerLabel(item, S, env) {
    var options = resolveOptionsFrom(item, S, env), value = S[item.messageKey];
    if (!optionHasValue(options, value)) { return null; }
    return currentLabel({ options: options }, value);
  }

  /**
   * The schema item a key's control renders from: two items can share a messageKey with
   * mutually-exclusive showWhen (e.g. the color vs B/W `theme` blocks), so the VISIBLE one
   * wins; any match is the fallback (a hidden trigger can't be tapped, so that only guards
   * degenerate schemas). Null when no item carries the key.
   *
   * @param {Object} schema Config schema.
   * @param {string} key messageKey.
   * @param {Object} ctx Show-when context ({<settings>, env}).
   * @returns {?Object} The schema item, or null.
   */
  function findShownItem(schema, key, ctx) {
    var found = null, fallback = null;
    eachItem(schema, function (it) {
      if (it.messageKey === key) {
        fallback = it;
        if (PConf.showWhen.isVisible(it, ctx)) { found = it; }
      }
    });
    return found || fallback;
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
    // The open picker must mirror the same block whose trigger was tapped, not just the
    // last item carrying the key — findShownItem prefers the visible one.
    var found = findShownItem(schema, cx.openSelect, cx.evalCtx);
    if (!found) { return ''; }
    var item = resolveRowItem(found, { value: cx.S[found.messageKey] }, cx);
    var key = esc(item.messageKey), value = cx.S[item.messageKey];
    var listId = 'ssel-list-' + key, titleId = 'ssel-ttl-' + key;
    var title = esc(String(item.label || 'Selection'));
    // The search box sits in a wrapper that owns the spacing as PADDING. A margin on the
    // input itself exposed the dialog's own box in the strips beside/under it, and a tap
    // there targets the <dialog> — which the click handler reads as a ::backdrop tap and
    // closes the sheet (dropping the query). No sheet child may carry an outer margin.
    var search = item.type === 'searchSelect'
      ? '<div class="ssel-search-wrap"><input type="text" class="ssel-search" data-select-search="'
        + key + '" aria-controls="' + listId + '" placeholder="Search…" value="'
        + esc(cx.selectQuery || '') + '"></div>'
      : '';
    // Inner content only — the host <dialog id="modal"> is the sheet, and its ::backdrop
    // replaces the old dim overlay. The dialog carries role/modal semantics natively;
    // boot() copies titleId onto the dialog's aria-labelledby when it opens.
    return sheetHeader(titleId, title)
      + search
      + '<div id="' + listId + '" class="ssel-list" role="listbox" aria-label="' + title
      + ' options" data-ssel-list="' + key + '">'
      + renderSelectOptions(item, value, cx.selectQuery, resolveRecommended(item, cx.S, cx.ENV),
          disabledOptionValues(item, cx.evalCtx)) + '</div>';
  }

  /**
   * The option list a `select` row expands IN PLACE inside an edit sheet: the colour
   * palette's in-place pattern, applied to a dropdown, so picking a value never takes the
   * sheet off the screen. The rows are the select modal's own (renderSelectOptions: .on
   * with a check, the recommended marker, gated options inert), under the id the
   * trigger's aria-controls already names. The class is isel-list, never ssel-list:
   * render(), fitSelectPeek and the swipe handler all query .ssel-list for the sheet's
   * own scroll container.
   *
   * @param {Object} item The row's item with its options materialized (resolveRowItem).
   * @param {*} value The value the row shows.
   * @param {{S: Object, ENV: Object, evalCtx: Object}} cx Render context.
   * @returns {string} The list HTML.
   */
  function renderInlineList(item, value, cx) {
    var title = esc(String(item.label || 'Selection'));
    return '<div id="ssel-list-' + esc(item.messageKey) + '" class="isel-list" role="listbox" aria-label="'
      + title + ' options">'
      + renderSelectOptions(item, value, '', resolveRecommended(item, cx.S, cx.ENV),
          disabledOptionValues(item, cx.evalCtx))
      + '</div>';
  }

  /**
   * The open edit sheet: a sheetOnly section rendered into the shared bottom-sheet
   * dialog — header from the section title, then the section's rows (intro, text
   * fields, color pickers …) through the same item renderer the tab body uses, so
   * showWhen/joins/hints and the color-palette state all behave identically.
   * '' when nothing is open, the sheetId is unknown, or the section is gated off.
   * The rows render with cx.inSheet set, which is what lets a select in the sheet expand
   * inline (cx.openInline) while the same key in the tab body behind stays collapsed.
   *
   * @param {Object} schema Config schema.
   * @param {{S: Object, ENV: Object, openEdit: ?string, openInline: ?string}} cx Render context.
   * @returns {string} Sheet header + body HTML, or ''.
   */
  function renderEditModal(schema, cx) {
    if (!cx.openEdit) { return ''; }
    var sec = null, ti, si, tabs = schema.tabs || [];
    for (ti = 0; ti < tabs.length; ti++) {
      var secs = tabs[ti].sections || [];
      for (si = 0; si < secs.length; si++) {
        if (secs[si].sheetOnly && secs[si].sheetId === cx.openEdit) { sec = secs[si]; }
      }
    }
    if (!sec) { return ''; }
    // The sheet honors its section gate even when forced open — on aplite
    // (env.thresholds false) it must stay empty regardless of how it was opened.
    if (sec.showWhen && !PConf.showWhen.isVisible(sec, cx.evalCtx)) { return ''; }
    var built = buildSectionBody(sec, Object.assign({}, cx, { inSheet: true }));
    if (built.isEmpty) { return ''; }
    var titleId = 'esheet-ttl-' + esc(String(cx.openEdit));
    // A sheet-level labelAction rides the TITLE, beside the text. Same shape as an item's
    // (labelActionHtml reads `.labelAction` off whatever it is handed), so a sheet whose
    // reset covers everything in it needs no group sub-header to hang the button on.
    return sheetHeader(titleId, esc(String(sec.title || 'Edit')), labelActionHtml(sec))
      + '<div class="ssel-list esheet">' + built.body + '</div>';
  }

  function renderText(item, v) {
    var ph = (item.attributes && item.attributes.placeholder) ? esc(item.attributes.placeholder) : '';
    // attributes.maxlength lands verbatim on the <input>. Note the browser counts
    // UTF-16 code units, not bytes — byte-capped keys (e.g. radarNoRainText) are
    // re-truncated UTF-8-safely phone-side at pack time; this is the soft UI cap.
    var ml = (item.attributes && item.attributes.maxlength)
      ? ' maxlength="' + esc(String(item.attributes.maxlength)) + '"' : '';
    var input = '<input type="text" data-k="' + item.messageKey + '" value="' + esc(v || '') + '" placeholder="' + ph + '"' + ml + '>';
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
    // Every picker offers the shared 64 Pebble swatches; excludeColors subtracts specific
    // ones (e.g. white as the holiday color, where white means "no highlight" rather than
    // a real color). A value the palette cannot represent — '' — is just an empty chip.
    var disp = String(v).toUpperCase();
    var chip = '<b style="background:' + esc(v) + '"></b>';
    var h = '<div class="sw-wrap" data-color="' + item.messageKey + '">' + chip + '<span>' + esc(disp) + '</span></div>';
    if (openColor === item.messageKey) {
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
    segmented: function (item, view) { return renderSegmented(item, view.value, view.disabledOptions); },
    radio: function (item, view) { return renderRadio(item, view.value, view.disabledOptions); },
    select: function (item, view) { return renderSelectTrigger(item, view); },
    date: function (item, view) { return renderDateTrigger(item, view); },
    text: function (item, view) { return renderText(item, view.value); },
    // view.displayValue (item.displayFrom) paints a derived colour — the chip AND the
    // palette's current-swatch marker follow it; the write path stays on the messageKey.
    color: function (item, view) { return renderColor(item, view.displayValue == null ? view.value : view.displayValue, view.openColor); },
    searchSelect: function (item, view) { return renderSelectTrigger(item, view); },
    range: function (item, view) { return renderRange(item, view); },
    // Three single-thumb channel sliders + a live swatch, storing "r,g,b" in one
    // messageKey. This table is CLOSED — renderControl returns '' for a type that
    // is missing from it, so a new control type renders as an empty row until it
    // is listed here.
    rgb: function (item, view) { return renderRgb(item, view); },
    // A grid of ticks for one code (item.check), each tick its row's list for its column.
    checklist: function (item, view) { return renderChecklist(item, view); }
  };
  /**
   * Dispatch to the control renderer for item.type; '' for an unknown type.
   *
   * @param {Object} item Schema item.
   * @param {{value: *, displayValue: *, openColor: ?string, openSelect: ?string,
   *   openDate: ?string, selectQuery: ?string}} view Render view state
   *   (displayValue overrides what a `color` control paints; see resolveDisplayValue).
   * @returns {string} Control HTML.
   */
  function renderControl(item, view) {
    var fn = CONTROLS[item.type];
    return fn ? fn(item, view) : '';
  }

  /**
   * The row's leading glyph (item.icon, resolved through PConf.icons), or '' when the
   * item names none or the id is unregistered — a missing icon drops out silently,
   * exactly like an unregistered block. The fragment is trusted page markup and goes
   * out unescaped (see the registry); the wrapper is aria-hidden because the label
   * beside it already says what the row is.
   *
   * @param {Object} item Schema item (icon: registered icon id).
   * @returns {string} '<span class="lbl-ico" …>fragment</span>', or ''.
   */
  function labelIconHtml(item) {
    var svg = item.icon && PConf.icons.get(item.icon);
    return svg ? '<span class="lbl-ico" aria-hidden="true">' + svg + '</span>' : '';
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
    if (item.type === 'date') {
      return '<div class="row date-row' + nbClass(noDivider)
        + '"><div class="date-cell">' + renderControl(item, view)
        + '</div></div>';
    }
    // view.hint is a hintFrom resolver's answer (renderItem); without one the static
    // per-value hint, else the plain one.
    var hint = view.hint != null ? view.hint
      : item.hintByValue ? (item.hintByValue[view.value] || item.hint) : item.hint;
    // A segmented control with many options is a wide pill row that can't float beside the
    // label without stranding it above (2-3-option segmenteds stay narrow and keep the
    // inline/float layouts). It gets its own flex row (.segwide): the control keeps the
    // label's line and the label wraps into the width the control leaves, then the hint
    // drops to a full-width line below.
    var wideSegmented = item.type === 'segmented' && item.options && item.options.length > 3;
    var stacked = item.type === 'text' || item.type === 'radio' || item.type === 'range'
      || item.type === 'rgb' || item.type === 'checklist'
      || (item.type === 'color' && view.openColor === item.messageKey);
    // A derived (hintFrom) hint carries its row's key, so a commit that skips render()
    // can still re-resolve it in place (boot's repaintDerivedHints). Static hints
    // never change without a render, so they stay unmarked — and so does a keyless
    // `sheet` row's derived hint: repaintDerivedHints finds a hint by its key, and such
    // a row sits under the very sheet whose commit would repaint it (closing the sheet
    // renders anyway).
    var hintHtml = hint ? '<div class="hint"'
      + (item.hintFrom && item.messageKey ? ' data-hint-for="' + esc(item.messageKey) + '"' : '')
      + '>' + hint + '</div>' : '';
    // An optional small icon button beside the label (item.labelAction: {action, arg,
    // label}) dispatching through the shared [data-action] path — e.g. the threshold
    // slider's reset-to-defaults.
    var labelAct = labelActionHtml(item);
    // A row may legitimately carry no label — the threshold slider's title lives
    // on its group sub-header instead, and repeating it here read as a stutter.
    // Drop the whole box then (esc(undefined) used to print "undefined"), unless
    // a labelAction still needs somewhere to sit. An item.icon leads the label text
    // (labelIconHtml) on every row shape that keeps the box.
    var labelIco = labelIconHtml(item);
    // A checklist's label heads its grid (the sub-header and the list's aria-label,
    // checklist.js renderChecklist) rather than the row.
    var shownLabel = item.type === 'checklist' ? '' : item.label;
    var label = (shownLabel || labelAct || labelIco)
      ? '<div class="lbl">' + labelIco + (shownLabel ? esc(shownLabel) : '') + labelAct + '</div>'
      : '';
    // Status-line slot pickers are compact rows: the .slot modifier tightens the vertical
    // rhythm so consecutive slot rows sit closer together. Status slots are plain selects
    // (matched via the statusSlot resolver, since they carry no distinguishing type), while
    // the Holiday searchSelects keep the same compact treatment. A stacked (open color/etc.)
    // row keeps normal padding so its expanded content isn't cramped.
    var isStatusSlot = item.optionsFrom && item.optionsFrom.resolver === 'statusSlot';
    // item.compact asks for the same tight rhythm on any row (e.g. the Alerts row
    // that follows a bar's three slot rows).
    var isCompact = isStatusSlot || item.compact === true;
    // A select expanded in place inside an edit sheet (renderItem builds view.inlineList):
    // the list is the row's LAST child in every shape below, and .isel-open lets the flex
    // row wrap it onto a full-width line of its own. The row does NOT become .stack, so
    // the trigger stays exactly where it was.
    var inlineList = view.inlineList || '';
    // A checklist's grid carries its own header and rows: its row is only their frame.
    var rowCls = 'row' + (stacked ? ' stack' : '') + (item.type === 'checklist' ? ' chk-row' : '')
      + (wideSegmented ? ' segwide' : '') + nbClass(noDivider)
      + ((item.type === 'searchSelect' || isCompact) && !stacked ? ' slot' : '')
      + (inlineList ? ' isel-open' : '')
      // A disabled row (item.disabledWhen) stays visible — showing what WOULD be
      // configurable — but muted and inert (CSS pointer-events; the range handlers
      // also guard on .dis for keyboard focus that CSS can't block).
      + (view.disabled ? ' dis' : '');
    if (stacked) {
      return '<div class="' + rowCls + '">' + label + hintHtml + '<div>' + renderControl(item, view) + '</div>'
        + inlineList + '</div>';
    }
    // A resolved edit sheet splits its two affordances around the control: the passive
    // colour swatch leads, the Edit button trails. The control cell is right-aligned and
    // the button is one fixed width, so every row's Edit lands on the same right edge
    // however wide its dropdown's current value happens to be — which is the whole point
    // of the arrangement. rgtClose is what closes .rgt, so all three row shapes below
    // pick the button up without repeating it.
    var rgtOpen = view.editSheet
      ? '<div class="rgt has-pen">' + editSwatchHtml(view) : '<div class="rgt">';
    var rgtClose = (view.editSheet ? editPenHtml(item, view) : '') + '</div>';
    // Wide segmented (.segwide): control on the label's line, label wraps into the leftover
    // width (.lft flex), hint on its own full-width line below (.segwide .hint flex-basis).
    if (wideSegmented) {
      return '<div class="' + rowCls + '"><div class="lft">' + label + '</div>' + rgtOpen + renderControl(item, view) + rgtClose + hintHtml + inlineList + '</div>';
    }
    // Rows with a multi-line hint float the control right (.wrap layout) so the
    // hint flows around it and reclaims the full width below the control instead
    // of staying confined to a narrow left column; the float sits between label
    // and hint so the control's top aligns with the hint's first line. Line count
    // isn't measurable at render time, so "multi-line" is a plain-text length
    // heuristic — short one-liners keep the centered two-column row.
    if (hintHtml && String(hint).replace(/<[^>]*>/g, '').length > 64) {
      return '<div class="' + rowCls + ' wrap">' + label + rgtOpen + renderControl(item, view) + rgtClose + hintHtml + inlineList + '</div>';
    }
    return '<div class="' + rowCls + '"><div class="lft">' + label + hintHtml + '</div>' + rgtOpen + renderControl(item, view) + rgtClose + inlineList + '</div>';
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
    // A rangeFrom range renders from its resolved config (geometry/zones/colors); the
    // companion danger value rides the view, since the control renderer receives only
    // (item, view) — the warn value is the row's ordinary view.value.
    if (item.type === 'range' && item.rangeFrom) {
      view.dangerValue = cx.S[item.dangerKey];
      return resolveRangeItem(item, cx.S, cx.ENV);
    }
    // A checklist's derived options (its rows) are materialized WITHOUT the single-value
    // snap below: it has no value of its own, and a row the resolver gates is rendered
    // inert (meta.disabled) rather than dropped, so nothing here ever rewrites cx.S. Its
    // ticks read their rows' lists (meta.keys) from the live state, which the view
    // carries (the control renderer receives only the view).
    if (item.type === 'checklist') {
      view.lists = cx.S;
      return item.optionsFrom
        ? Object.assign({}, item, { options: resolveOptionsFrom(item, cx.S, cx.ENV) }) : item;
    }
    if ((item.type !== 'select' && item.type !== 'searchSelect' && item.type !== 'radio') || !item.optionsFrom) {
      return item;
    }
    var derived = resolveOptionsFrom(item, cx.S, cx.ENV);
    if (derived.length && !optionHasValue(derived, view.value)) {
      var dflt = resolveDefaultFrom(item, cx.ENV);
      var snap = (dflt != null && optionHasValue(derived, dflt)) ? dflt : derived[0][1];
      view.value = snap;
      // A DORMANT value (declared in item.dormantValues) is a valid choice the current
      // mode merely hides — e.g. compactDense while neither health nor radar shows a
      // status row: render the fallback but leave cx.S untouched, so the stored choice
      // returns when the mode re-enables it. Anything else is truly invalid and snaps
      // into state so the control and state stay in lockstep.
      var stored = cx.S[item.messageKey];
      if (!(item.dormantValues && item.dormantValues.indexOf(stored) >= 0)) {
        cx.S[item.messageKey] = snap;
      }
    }
    return Object.assign({}, item, { options: derived });
  }

  /**
   * A whole-row tap target that leads somewhere: a `button` item's action or a `sheet`
   * item's sheetOnly section. Both rows are the same chrome — label, optional hint, a
   * chevron on the right — and differ only in the data attribute the click delegate
   * matches on, so they share one builder. The chevron takes its color from the .chev
   * rule in shell.html (var(--link)), which the card-header chevron uses too: hard-coded
   * here it stayed at the DARK link color when the page flipped to the light theme.
   *
   * @param {Object} item Schema item; uses `label` and the optional `hint` / `icon`.
   * @param {string} attr Data attribute the click delegate matches ('data-action' or
   *   'data-edit-sheet').
   * @param {string} value That attribute's value — the action id or the sheet id.
   * @param {(string|boolean)} noDivider Join mode from nextVisibleJoins(), for nbClass().
   * @returns {string} Row HTML.
   */
  function chevronRow(item, attr, value, noDivider) {
    var hint = item.hint ? '<div class="hint">' + item.hint + '</div>' : '';
    return '<div class="row' + nbClass(noDivider) + '" ' + attr + '="' + esc(value) + '" style="cursor:pointer">'
      + '<div class="lft"><div class="lbl">' + labelIconHtml(item) + esc(item.label) + '</div>' + hint + '</div>'
      + '<div class="rgt"><span class="chev">&#9656;</span></div></div>';
  }

  // Render one schema item honoring showWhen. Returns { html, kind } with kind in
  // 'control' | 'static' | 'hidden' so the section can decide if the card is empty.
  function renderItem(item, view, cx, noDivider) {
    if (!PConf.showWhen.isVisible(item, cx.evalCtx)) { return { html: '', kind: 'hidden' }; }
    // A persisted-but-invisible key (hydrated + serialized, never drawn) — e.g. onboardingDone.
    if (item.type === 'hidden') { return { html: '', kind: 'hidden' }; }
    // A tappable action row: dispatches to PConf.actions[item.action] via the scroll click handler.
    if (item.type === 'button') {
      return { kind: 'control', html: chevronRow(item, 'data-action', item.action, noDivider) };
    }
    // A row whose only job is to open a sheetOnly section — the button row's shape,
    // dispatching to the edit-sheet handler instead of PConf.actions. Use it for a sheet
    // that belongs to no single control, where the per-value pencil chip would read wrong.
    if (item.type === 'sheet') {
      var sId = item.sheetId || resolveEditSheet(item, cx.S, cx.ENV);
      if (!sId) { return { html: '', kind: 'hidden' }; }
      // A sheet row that declares a badge renders as an ordinary row with the preview +
      // Edit pair instead (renderControl yields '' for type 'sheet', so the control cell
      // holds only those two); without one it stays a chevron row. resolveEditBadge
      // merges the item's messageKey UNDER editBadgeFrom.args and a sheet row has none,
      // so such a row identifies itself through those args. It honours hintFrom the
      // same way: the resolver gets no row value (a sheet row stores nothing) and reads
      // what it describes from S — e.g. an Alert settings card row printing its item's live
      // state ("Not in any status bar", or its levels) under the label.
      if (item.editBadgeFrom) {
        view.editSheet = sId;
        view.editBadge = resolveEditBadge(item, cx.S, cx.ENV);
        if (item.hintFrom) { view.hint = resolveHint(item, cx.S, cx.ENV, undefined); }
        return { kind: 'control', html: renderRow(item, view, noDivider) };
      }
      return { kind: 'control', html: chevronRow(item, 'data-edit-sheet', sId, noDivider) };
    }
    if (item.type === 'staticText') {
      // a joinPrevious static acts as the control's description, so the join modifier tightens its
      // top spacing to hug the row above (like a hint) instead of standing off as a separate block.
      // hinted: render in the dimmer/smaller hint style WITHOUT the pull-up — for a standalone note
      // (e.g. below a preview block) that should still read as secondary, hint-coloured text.
      // Only a tight join (joinPrevious: true) gets the .join pull-up that hugs the row above; a
      // loose join keeps the static's normal standoff (the row above just drops its divider).
      // style 'info': the note is boxed like the General tab's fetch-notice panel (its
      // tinted, left-ruled .notice-item) in the page's info amber — a pointer the reader
      // should not scroll past as body copy (e.g. "this is set on another tab").
      var isInfo = item.style === 'info';
      // textFrom: a note derived from the live settings; '' renders nothing at all.
      var staticText = resolveStaticText(item, cx.S, cx.ENV);
      if (item.textFrom && staticText === '') { return { html: '', kind: 'hidden' }; }
      var staticCls = 'static' + (item.joinPrevious === true ? ' join' : '') + (item.hinted ? ' hinted' : '')
        + (isInfo ? ' info' : '') + nbClass(noDivider);
      // A staticText may host preview blocks too (blockBefore/block) — e.g. the Layout tab's
      // after-flick preview rides a caption. renderBlock() no-ops when the id is absent.
      var staticHtml = renderBlock(item.blockBefore, cx.S, cx.ENV, cx.USERDATA, item.blockBeforeSticky)
        + '<div class="' + staticCls + '">'
        + (isInfo ? '<div class="info-box">' + staticText + '</div>' : staticText) + '</div>'
        + renderBlock(item.block, cx.S, cx.ENV, cx.USERDATA);
      return { html: staticHtml, kind: 'static' };
    }
    // A `readout` (a read-only row: label + icon and a live hint, no key) takes the
    // generic path below too: it has no CONTROLS entry, so its control cell stays empty,
    // and with no messageKey hydrate/serialize never see it.
    var rowItem = resolveRowItem(item, view, cx);
    // After resolveRowItem: an invalid stored value has been snapped into cx.S, so the
    // pencil reflects the value the row actually shows.
    if (item.editSheetFrom) {
      view.editSheet = resolveEditSheet(item, cx.S, cx.ENV);
      if (view.editSheet) { view.editBadge = resolveEditBadge(item, cx.S, cx.ENV); }
    }
    // disabledWhen: the row renders but muted + inert (vs showWhen, which removes it) —
    // a feature that is OFF still shows what turning it on would offer.
    if (item.disabledWhen) {
      view.disabled = PConf.showWhen.evaluate(item.disabledWhen, cx.evalCtx);
    }
    // optionDisabledWhen: individual options go inert while the row stays live —
    // e.g. "bold on warn" is unreachable until the slot's thresholds are on.
    if (item.optionDisabledWhen) {
      view.disabledOptions = disabledOptionValues(item, cx.evalCtx);
    }
    // displayFrom: the row paints a DERIVED value while storing under its own key —
    // for a setting whose effective value is resolved elsewhere, so it shows what renders.
    if (item.displayFrom) {
      view.displayValue = resolveDisplayValue(item, cx.S, cx.ENV);
    }
    // hintFrom: a hint derived from the live settings — after resolveRowItem, so it
    // describes the value the row actually shows.
    if (item.hintFrom) {
      view.hint = resolveHint(item, cx.S, cx.ENV, view.value);
    }
    // A muted row never shows its list: .dis makes the trigger untappable, so an expanded
    // list could not be collapsed again. The row draws collapsed (trigger included), and
    // render() drops the open key once the sheet has no list for it.
    if (view.disabled) { view.openInline = null; }
    // A select expanded in place inside an edit sheet (view.openInline is only ever set
    // there — buildSectionBody gates it on cx.inSheet). rowItem, so an optionsFrom list and
    // the per-option meta.disabled gates apply exactly as in the select modal.
    if (item.type === 'select' && view.openInline === item.messageKey) {
      view.inlineList = renderInlineList(rowItem, view.value, cx);
    }
    var html = renderBlock(item.blockBefore, cx.S, cx.ENV, cx.USERDATA, item.blockBeforeSticky)
      + renderRow(rowItem, view, noDivider)
      + renderBlock(item.block, cx.S, cx.ENV, cx.USERDATA);
    return { html: html, kind: 'control' };
  }

  /**
   * Map of this section's toggle messageKeys hosted by a VISIBLE subheader
   * (subheader.toggleKey): their switches render on that header, so their own
   * rows must not. Collected up front because the subheader may sit after the
   * toggle in the item list.
   * @param {Object} sec Section whose items to scan.
   * @param {Object} cx Render context.
   * @returns {Object} messageKey -> true map.
   */
  function hostedToggleKeys(sec, cx) {
    var hosted = {}, i;
    for (i = 0; i < sec.items.length; i++) {
      if (sec.items[i].type === 'subheader' && sec.items[i].toggleKey
        && PConf.showWhen.isVisible(sec.items[i], cx.evalCtx)) {
        hosted[sec.items[i].toggleKey] = true;
      }
    }
    return hosted;
  }

  /**
   * True when this item's own row is suppressed because a subheader hosts its
   * toggle. THE predicate for the hosted-row rule: the main item loop, the
   * inline-group renderer and the join look-ahead all consult it, so the rule
   * cannot drift between render paths.
   * @param {Object} item Schema item.
   * @param {Object} hosted hostedToggleKeys() map for the item's section.
   * @returns {boolean} Whether to suppress the item's row.
   */
  function isHostedRow(item, hosted) {
    return item.type === 'toggle' && Boolean(hosted && hosted[item.messageKey]);
  }

  // Render a run of consecutive items sharing the same inline group id as a single side-by-side
  // row (one bottom divider, no internal dividers). Each visible member becomes a compact
  // label+control cell. Inline members don't carry hints/blocks. Returns { html, controlCount };
  // controlCount is the number of visible cells (0 -> nothing rendered, group hidden).
  // A member select expanded in place inside an edit sheet (cx.openInline) lists its options
  // under the whole row, the same full-width list a plain row gets (renderRow).
  function renderInlineGroup(items, cx, noDivider, hosted) {
    var cells = '', visible = 0, i, item, view, inlineList = '', muted;
    for (i = 0; i < items.length; i++) {
      item = items[i];
      if (isHostedRow(item, hosted) || !PConf.showWhen.isVisible(item, cx.evalCtx)) { continue; }
      // A member under its disabledWhen never expands, the same rule as renderItem's.
      muted = Boolean(item.disabledWhen) && PConf.showWhen.evaluate(item.disabledWhen, cx.evalCtx);
      view = {
        value: cx.S[item.messageKey],
        openColor: cx.openColor,
        openSelect: cx.openSelect,
        openInline: cx.inSheet && !muted ? cx.openInline : null,
        openDate: cx.openDate,
        selectQuery: cx.selectQuery
      };
      if (item.type === 'select' && view.openInline === item.messageKey) {
        inlineList = renderInlineList(item, view.value, cx);
      }
      cells += '<div class="icell"><div class="lbl">' + esc(item.label) + '</div>' + renderControl(item, view) + '</div>';
      visible++;
    }
    if (!visible) { return { html: '', controlCount: 0 }; }
    return { html: '<div class="row inline' + nbClass(noDivider) + (inlineList ? ' isel-open' : '') + '">'
      + cells + inlineList + '</div>', controlCount: visible };
  }

  // Look-ahead from index "from": the join mode of the next *rendered* item — '' when it doesn't
  // join, 'loose' for a roomy join (joinPrevious: 'loose'), else 'tight' (joinPrevious: true). A
  // joining item wants no divider between it and the row above, so the preceding visible row drops
  // its divider; 'tight' also tightens the padding, 'loose' keeps the normal row spacing. Skips
  // hidden items — so the divider returns automatically when the joining group is hidden — and
  // hosted-suppressed toggles (isHostedRow), whose rows never render at all. A `subheader` item
  // always reads as 'loose' (see below): it draws its own line above. A staticText whose
  // derived text (textFrom) is empty right now renders nothing, so it is skipped too.
  function nextVisibleJoins(items, from, cx, hosted) {
    var j, jp;
    for (j = from; j < items.length; j++) {
      if (isHostedRow(items[j], hosted)) { continue; }
      if (derivedTextEmpty(items[j], cx)) { continue; }
      if (PConf.showWhen.isVisible(items[j], cx.evalCtx)) {
        // A `subheader` ITEM opens a new group and paints the separating line ITSELF
        // (.subhdr.grp's border-top in shell.html) rather than borrowing the preceding
        // row's divider — its group may render no rows at all (master switch off), and
        // then there is no divider to borrow. It always joins LOOSELY: the row above only
        // drops its own line (so the two 1px borders don't stack into one thick rule) and
        // keeps its normal padding, since the header brings its own standoff.
        if (items[j].type === 'subheader') { return 'loose'; }
        jp = items[j].joinPrevious;
        return jp === 'loose' ? 'loose' : (jp ? 'tight' : '');
      }
    }
    return '';
  }

  function renderCardHeader(sec, secId, isCollapsible, isOpen, cx) {
    if (!(sec.title || isCollapsible)) { return ''; }
    var chev = isCollapsible ? '<span class="chev">' + (isOpen ? '&#9662;' : '&#9656;') + '</span>' : '';
    var collAttr = isCollapsible ? ' data-coll="' + esc(secId) + '"' : '';
    // titleFrom (sections only): a display resolver paints the section's CURRENT
    // pick next to the title while the card is collapsed, so a closed card still
    // says what is selected inside it. Open cards show the plain title — the
    // rows themselves carry the values there. Resolver grammar matches
    // displayFrom: fn(S, env, args) from PConf.displayResolvers.
    var val = '';
    if (sec.titleFrom && isCollapsible && !isOpen && cx) {
      var fn = PConf.displayResolvers.get(sec.titleFrom.resolver);
      var v = fn ? fn(cx.S, cx.ENV, sec.titleFrom.args || {}) : null;
      if (v !== null && v !== undefined && v !== '') {
        val = '<span class="ttlval">' + esc(String(v)) + '</span>';
      }
    }
    return '<button class="cardHdr' + (isCollapsible ? ' coll' : '') + '"' + collAttr + '>'
      + '<span class="ttl">' + esc(sec.title || '') + '</span>' + val + chev + '</button>';
  }

  // Build a section's inner body HTML (intro + items + block) and whether it's empty
  // (no intro, no visible control/static items, no block). Shared by
  // renderSection (a standalone card) and renderSectionGroup (a section merged into a
  // shared card), so the "hide when everything is gated off" rule stays in one place.
  function buildSectionBody(sec, cx) {
    // A section may carry its own showWhen, for a whole feature card that a platform
    // cannot render (e.g. threshold highlighting on aplite). Reporting it as empty is
    // enough for both callers to drop it — card, sub-header, intro and all — without
    // duplicating the rule. Item-level showWhen/capabilities still apply inside.
    if (sec.showWhen && !PConf.showWhen.isVisible(sec, cx.evalCtx)) {
      return { body: '', isEmpty: true };
    }
    var body = sec.intro ? '<div class="intro">' + sec.intro + '</div>' : '';
    var controlCount = 0, staticCount = 0, i;
    var hosted = hostedToggleKeys(sec, cx);
    for (i = 0; i < sec.items.length; i++) {
      var item = sec.items[i];
      if (item.type === 'subheader') {
        if (!PConf.showWhen.isVisible(item, cx.evalCtx)) { continue; }
        body += renderSubheader(item, sec, cx);
        staticCount++;
        continue;
      }
      if (isHostedRow(item, hosted)) { continue; }
      if (item.inline) {
        // gather the consecutive run sharing this inline group id, render it as one row
        var run = [item];
        while (i + 1 < sec.items.length && sec.items[i + 1].inline === item.inline) { run.push(sec.items[i + 1]); i++; }
        var g = renderInlineGroup(run, cx, nextVisibleJoins(sec.items, i + 1, cx, hosted), hosted);
        controlCount += g.controlCount;
        body += g.html;
        continue;
      }
      var view = {
        value: cx.S[item.messageKey],
        openColor: cx.openColor,
        openSelect: cx.openSelect,
        // Only the edit sheet's rows expand in place: the same key rendered in the tab
        // body behind the sheet keeps its collapsed trigger.
        openInline: cx.inSheet ? cx.openInline : null,
        openDate: cx.openDate,
        selectQuery: cx.selectQuery
      };
      var r = renderItem(item, view, cx, nextVisibleJoins(sec.items, i + 1, cx, hosted));
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
    var hdr = renderCardHeader(sec, secId, isCollapsible, isOpen, cx);
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
   * Render the tab-bar buttons, marking the active tab with the on class. A tab holding
   * a row that needs attention (findAttention) carries a small dot after its label
   * (.tab-dot, aria-hidden) and the attention's note in its aria-label.
   *
   * @param {Object} schema Config schema (schema.tabs).
   * @param {string} activeTab Active tab id.
   * @param {Object} [cx] Render context; when given, tabs whose showWhen resolves
   *   false against cx.evalCtx are skipped and attention dots are drawn.
   * @returns {string} Tab-bar buttons HTML.
   */
  function renderTabBar(schema, activeTab, cx) {
    var h = '', i, tab, att, aria;
    for (i = 0; i < schema.tabs.length; i++) {
      tab = schema.tabs[i];
      if (cx && !PConf.showWhen.isVisible(tab, cx.evalCtx)) { continue; }
      att = cx ? findAttention(schema, cx, tab.id) : null;
      aria = (att && att.attention.note)
        ? ' aria-label="' + esc(String(tab.label) + ' (' + String(att.attention.note) + ')') + '"' : '';
      h += '<button class="tab' + (activeTab === tab.id ? ' on' : '') + '" data-tab="' + esc(tab.id) + '"' + aria + '>'
        + esc(tab.label) + (att ? '<span class="tab-dot" aria-hidden="true"></span>' : '') + '</button>';
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
        // A sheetOnly section renders only inside the edit-sheet dialog (renderEditModal);
        // its items still hydrate/serialize like any other, they just have no card.
        if (sec.sheetOnly) { continue; }
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
  // Fraction of the peek row left visible below the fold. A bit over half: enough of the last
  // item shows to read it, while the clipped remainder still advertises "there's more — scroll".
  var PEEK_ROW_FRACTION = 0.66;
  // The capped bottom edge already reads as a peek when at least this much of the fold row
  // shows (readable) ...
  var MIN_PEEK_PX = 20;
  // ... AND at least this much of it is clipped (visibly cut off, so it advertises the scroll).
  var MIN_CLIP_PX = 12;
  // Plain select is content-sized up to the 80dvh cap. When the option list overflows, the
  // last visible row can land flush (or as a too-thin sliver) against the sheet's bottom edge,
  // so nothing meaningful peeks out and the sheet reads as un-scrollable. Find the row the
  // capped edge lands in (the fold row): when the natural edge already shows a readable,
  // clearly-clipped slice of it, the full capped height IS the peek — leave it alone. This
  // matters for the edit sheets, whose "rows" can be whole stacked radio groups hundreds of
  // px tall (the Date-format sheet): the old always-align-to-PEEK_ROW_FRACTION rule cut back
  // to a fraction of such a row and collapsed the sheet far below its cap. Only when the edge
  // lands flush on a boundary (or leaves a sliver) pull back: clip a nearly-complete fold row
  // by MIN_CLIP_PX, or cut the classic row fraction when only a sliver shows. Idempotent:
  // resets its own clamp and re-measures the clean 80dvh-capped height each call, so it's
  // safe to run repeatedly (see scheduleSelectPeek in boot). .picking is excluded too: the
  // point of the raised cap is to show the whole palette, so clamping the list to leave a
  // peek row would undo it. Top-level (not inside boot) so the test harness can drive it
  // against a stub dialog (select-peek.test.js).
  function fitSelectPeek(dlg) {
    if (!dlg.open || dlg.classList.contains('search') || dlg.classList.contains('picking')) { return; }
    var list = dlg.querySelector('.ssel-list');
    if (!list) { return; }
    list.style.maxHeight = '';                  // reset → measure the clean, capped height
    var H = list.clientHeight;
    // Bail until the dialog is actually laid out under its cap. On a mobile webview clientHeight
    // reads a pre-layout value right after showModal() (the whole content height, not yet capped),
    // so scrollHeight <= H and we'd wrongly no-op — scheduleSelectPeek re-runs us once layout
    // settles (rAF + the sheet-up animationend), when H is the real capped height and overflows.
    if (!H || list.scrollHeight <= H + 1) { return; }
    // Walk to the fold row — the row the capped bottom edge lands inside.
    var rows = list.children, top = 0, i, h = 0, prevH = 0;
    for (i = 0; i < rows.length; i++) {
      h = rows[i].offsetHeight;
      if (top + h > H) { break; }
      prevH = h;
      top += h;
    }
    if (i >= rows.length) { return; }           // content ends at the cap — nothing to peek
    var shown = H - top;                        // slice of the fold row visible un-clamped
    if (shown >= MIN_PEEK_PX && h - shown >= MIN_CLIP_PX) { return; }   // natural peek already
    var target;
    if (shown >= MIN_PEEK_PX) {
      // The fold row is nearly complete — clip it by MIN_CLIP_PX instead of collapsing
      // to its row fraction (that is the giant-row trap the fold-walk exists to avoid).
      target = top + h - MIN_CLIP_PX;
    } else {
      // Flush boundary or an unreadable sliver — the classic cut: PEEK_ROW_FRACTION of
      // the fold row, or of the row above when the fold row's fraction doesn't fit.
      target = top + h * PEEK_ROW_FRACTION;
      if (target > H && prevH) { target = (top - prevH) + prevH * PEEK_ROW_FRACTION; }
    }
    if (target > H || target < 24) { return; }
    list.style.maxHeight = Math.round(target) + 'px';
  }

  /**
   * The tab the page opens on. Tab ORDER is the bar's business; which tab
   * greets the user is a setting, so a tab may claim the opening slot with
   * an `openWhen` predicate over the stored values, and one tab may declare
   * itself the standing default. Neither given, the first tab opens.
   * @param {Object} schema Config schema (schema.tabs).
   * @param {Object} values Hydrated setting values, keyed by messageKey.
   * @returns {string} The id of the tab to open.
   */
  function initialTab(schema, values) {
    var tabs = (schema && schema.tabs) || [], i;
    for (i = 0; i < tabs.length; i += 1) {
      if (tabs[i].openWhen && PConf.showWhen.evaluate(tabs[i].openWhen, values)) { return tabs[i].id; }
    }
    for (i = 0; i < tabs.length; i += 1) {
      if (tabs[i].openDefault) { return tabs[i].id; }
    }
    return tabs.length ? tabs[0].id : '';
  }

  function boot() {
    var SCHEMA = INJECTED_SCHEMA, ENV = INJECTED_ENV || { color: true, round: false, platform: '', health: true };
    var USERDATA = INJECTED_USERDATA || {}, RETURN_TO = INJECTED_RETURN || 'pebblejs://close#';
    var S = hydrate(SCHEMA, INJECTED_CFG, ENV), INITIAL = Object.assign({}, S);
    var activeTab = initialTab(SCHEMA, S);
    var openColor = null, openSelect = null, openDate = null, openEdit = null;
    // The Save button's confirm dialog while it is open (requestSave): {title, body,
    // actionLabel, confirmLabel, tab, sheet} — a row needs attention
    // (PConf.attentionResolvers). Shares the one sheet with the others, one at a time.
    var openConfirm = null;
    // The messageKey of the `select` expanded in place inside the open edit sheet
    // (renderInlineList), or null. One expander at a time: opening a list clears
    // openColor and opening a palette clears this, and every path that clears openColor
    // for a closing sheet clears it too.
    var openInline = null;
    var selectQuery = '', collapsed = initialCollapsed(SCHEMA);
    // Recover a schema item by messageKey so the input handler can re-filter its options in place.
    function findItem(key) { var f = null; eachItem(SCHEMA, function (it) { if (it.messageKey === key) { f = it; } }); return f; }
    /**
     * A key's schema default in the SAME shape hydrate() stores it (env-aware
     * defaultFrom resolution; number color defaults as '#RRGGBB'). Handed to
     * [data-action] handlers so a reset can land on what a fresh install actually
     * resolves instead of hand-mirroring schema defaults — mirrored literals
     * drift when the schema changes.
     * @param {string} key Schema item messageKey.
     * @returns {*} The stored-shape default, or undefined for a key with no schema item.
     */
    function defaultAsStored(key) {
      var item = findItem(key);
      return item ? storedDefault(item, ENV) : undefined;
    }
    // The messageKey of the trigger to restore focus to when the modal closes. Stored by key
    // (not the DOM node) because render() replaces #scroll's innerHTML, detaching any node
    // captured at open time; re-querying by key after render finds the fresh trigger.
    var lastSelectKey = null;
    // Same, for an edit sheet: the sheetId whose pencil trigger regains focus on close.
    var lastEditSheet = null;
    // Optional one-shot callback fired after the sheet closes, set by openSheet() so an external
    // caller (the onboarding wizard, which lives in its own overlay) can react to a pick/dismiss.
    var onSheetClose = null;
    // The date wheel-settle machinery lives with the picker (createDateWiring);
    // the engine hands it the live accessors and calls in through this instance.
    var dateWiring = datePicker.createDateWiring({
      S: S,
      getOpenDateKey: function () { return openDate; },
      render: render
    });
    // Same shape for the slider's drag machinery (createRangeWiring); the
    // swipe-dismiss below reads isDragging() so a sheet drag never hijacks a
    // thumb drag.
    var rangeWiring = rangeControl.createRangeWiring({
      S: S,
      ENV: ENV,
      // Two sliders may share a key under mutually exclusive gates (the Battery warn
      // level's 5 % and 10 % rows): a drag reads the one on screen, its min and step.
      findItem: function (key) { return findShownItem(SCHEMA, key, evalCtx()); },
      resolveRangeItem: resolveRangeItem,
      render: render,
      repaintHints: repaintDerivedHints
    });
    // On open, focus the search box (searchSelect) or the selected/first option (select).
    function focusModal() {
      var modal = document.getElementById('modal');
      var el = modal.querySelector('[data-select-search]')
        || modal.querySelector('.ssel-opt.on') || modal.querySelector('.ssel-opt');
      if (el) { el.focus(); }
    }
    // Open/close the native <dialog> to match the shared select/date sheet state.
    // showModal()/close() fire only on the state edges (calling showModal() on an already-open
    // dialog throws), and no-op in the pure-render test harness, which shims a plain #modal.
    function syncDialog() {
      var dlg = document.getElementById('modal');
      if (!dlg || !dlg.showModal) { return; }
      var sheetOpen = openSelect || openDate || openEdit || openConfirm;
      var opening = Boolean(sheetOpen && !dlg.open);
      if (sheetOpen) {
        if (opening) { dlg.showModal(); }
        var ttl = dlg.querySelector('.ssel-modal-ttl');
        if (ttl && ttl.id) { dlg.setAttribute('aria-labelledby', ttl.id); }
        var editShown = Boolean(openEdit);
        if (editShown) { dlg.classList.add('edit'); } else { dlg.classList.remove('edit'); }
        // An expanded palette or in-place option list needs more room than the 80dvh cap
        // allows (.picking raises it to 94dvh, and fitSelectPeek leaves a .picking sheet
        // unclamped, so the peek can never clip the list it just opened). syncDialog runs on
        // EVERY render, not just the open edge, so this tracks an expander opening and
        // closing inside an already-open sheet. add/remove, never the two-argument
        // classList.toggle — unsafe in old Android WebViews.
        // openColor is shared with the tab body, and only the EDIT sheet ever renders a
        // palette; without the openEdit half, a palette left expanded in the body would
        // also grow (and un-peek) an unrelated select sheet opened from the same card.
        if (editShown && (openColor || openInline)) {
          dlg.classList.add('picking');
        } else {
          dlg.classList.remove('picking');
        }
        if (openDate) {
          dlg.classList.remove('search');
          dlg.classList.add('date');
          dateWiring.scheduleAlign(dlg, opening);
        } else {
          dlg.classList.remove('date');
          // searchSelect filters as you type; pin a fixed height so a shrinking list can't
          // resize the sheet and make it jump. Plain select stays content-sized — as does
          // the edit sheet, which shares the same peek clamp when its rows overflow.
          // The peek runs on EVERY render pass, not just the open edge: interacting inside
          // an edit sheet re-renders it (innerHTML rebuild), which discards the previous
          // inline clamp — gated on `opening`, the first tap on any control visibly grew
          // the sheet to the raw cap. Idempotent, so the repeat runs are free.
          if (dlg.querySelector('[data-select-search]')) {
            dlg.classList.add('search');
          } else {
            dlg.classList.remove('search');
            scheduleSelectPeek(dlg, opening);
          }
        }
      } else if (dlg.open) {
        dlg.classList.remove('search');
        dlg.classList.remove('date');
        dlg.classList.remove('edit');
        dlg.classList.remove('picking');
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
    // Run fitSelectPeek now and again after the sheet's open layout settles. The synchronous call
    // covers desktop/no-animation; the double-rAF and sheet-up animationend cover mobile webviews
    // that lay the capped dialog out a frame (or the animation) late. All runs are idempotent.
    // `opening` gates the animationend hook: re-render calls (every render while a sheet stays
    // open — the innerHTML rebuild drops the previous inline clamp) run on an already-settled
    // layout, and re-adding the listener each render would stack one per interaction.
    function scheduleSelectPeek(dlg, opening) {
      fitSelectPeek(dlg);
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(function () { requestAnimationFrame(function () { fitSelectPeek(dlg); }); });
      }
      if (!opening) { return; }
      dlg.addEventListener('animationend', function once() {
        dlg.removeEventListener('animationend', once);
        fitSelectPeek(dlg);
      });
    }

        // Close the shared modal and return focus to the fresh trigger rendered in its place.
    function closeModal() {
      var selectKey = lastSelectKey;
      var dateKey = openDate;
      var editKey = lastEditSheet;
      var confirmShown = Boolean(openConfirm);
      dateWiring.flushPending();
      openSelect = null;
      openDate = null;
      openEdit = null;
      openConfirm = null;
      // openColor is one variable serving palettes in BOTH surfaces — the tab body and an
      // edit sheet — so clear it only when a sheet is what's closing. A palette expanded
      // inside the sheet is going away with it (and would come back expanded on reopen);
      // one expanded in the tab body is untouched by closing a select/date modal that
      // happens to sit in the same card. An in-place option list only ever lives in a
      // sheet, and goes with it the same way.
      if (editKey) { openColor = null; openInline = null; }
      render();
      // A dismissed Save dialog hands focus back to Save.
      var selector = selectKey ? '[data-select="' + selectKey + '"]'
        : dateKey ? '[data-date="' + dateKey + '"]'
        : editKey ? '[data-edit-sheet="' + editKey + '"]'
        : confirmShown ? '#save' : null;
      var trigger = selector ? document.querySelector(selector) : null;
      if (trigger) { trigger.focus(); }
      lastSelectKey = null;
      lastEditSheet = null;
      if (onSheetClose) {
        var cb = onSheetClose;
        onSheetClose = null;
        cb();
      }
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
      var cx = {
        S: S, ENV: ENV, USERDATA: USERDATA, openColor: openColor,
        openSelect: openSelect, openDate: openDate, openEdit: openEdit,
        openInline: openInline,
        selectQuery: selectQuery,
        collapsed: collapsed, evalCtx: evalCtx()
      };
      document.getElementById('tabs').innerHTML = renderTabBar(SCHEMA, activeTab, cx);
      document.getElementById('scroll').innerHTML = renderBody(SCHEMA, activeTab, cx);
      var modalEl = document.getElementById('modal');
      var prevList = modalEl.querySelector ? modalEl.querySelector('.ssel-list') : null;
      var keepTop = prevList ? prevList.scrollTop : 0;
      var editShown = Boolean(openEdit);
      var modalHtml = openConfirm ? renderConfirmModal(openConfirm)
        : openDate ? renderDateModal(SCHEMA, cx)
        : editShown ? renderEditModal(SCHEMA, cx) : renderSelectModal(SCHEMA, cx);
      // An open list lives only while its row renders live. A row hidden by its showWhen
      // or muted by its disabledWhen (one tap away, in the same sheet) draws no list, and
      // a key left open would keep .picking on, the scroll nudge hunting, and Escape's
      // first press collapsing a list that isn't there — or bring it back pre-opened.
      // Read off the HTML, not the DOM, so the check holds in the Node DOM shims too.
      if (openInline && modalHtml.indexOf('id="ssel-list-' + esc(openInline) + '" class="isel-list"') < 0) {
        openInline = null;
      }
      modalEl.innerHTML = modalHtml;
      // The edit sheet's scroll container is a NEW node after every render, so a swatch
      // or option tap would otherwise snap the sheet back to the top. Restore the offset,
      // then nudge a freshly opened palette or option list into view. Rect math, not
      // offsetTop (.ssel-list is not positioned, so it is not the offsetParent) and not
      // scrollIntoView({block:…}) (the options-object form is unsafe in old Android WebViews).
      var list = (editShown && modalEl.querySelector) ? modalEl.querySelector('.ssel-list') : null;
      if (list) {
        list.scrollTop = keepTop;
        var sw = openColor ? list.querySelector('[data-color="' + openColor + '"]')
          : openInline ? list.querySelector('[data-select="' + openInline + '"]') : null;
        var row = (sw && sw.closest) ? sw.closest('.row') : null;
        if (row && row.getBoundingClientRect && list.getBoundingClientRect) {
          var over = row.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom;
          if (over > 0) { list.scrollTop += over + 8; }
        }
      }
      syncDialog();
      document.getElementById('scroll').className =
        'scroll' + (openSelect || openDate || openEdit || openConfirm ? ' locked' : '');
      applyTheme();
    }

    // Each tab keeps its own scroll offset (in-memory only, per page load) so
    // switching away and back returns to where the user left off instead of
    // wherever the previous tab's offset happened to clamp.
    var tabScroll = {};
    /**
     * THE tab switch: a tab-bar tap, and a [data-goto-tab] link in an intro, a hint, a note
     * or an open sheet. It closes whatever is open (a sheet included: render() closes the
     * dialog on that edge), keeps the old tab's scroll offset, restores the new one's, and
     * scrolls the tab bar so the new tab shows.
     * @param {string} id The tab to bring to the front.
     * @returns {void}
     */
    function switchTab(id) {
      dateWiring.flushPending();
      var scroll = document.getElementById('scroll');
      tabScroll[activeTab] = scroll.scrollTop;
      activeTab = id;
      openColor = null;
      openInline = null;
      openSelect = null;
      openDate = null;
      openEdit = null;
      openConfirm = null;
      lastEditSheet = null;
      render();
      scroll.scrollTop = tabScroll[activeTab] || 0;
      revealActiveTab();
    }
    /**
     * A tab bar wider than the screen scrolls sideways with its scrollbar hidden, so a
     * switch the bar did not make (a tab link, the Save dialog's fix) can land on a tab
     * that is off screen. Scroll the bar until the active tab shows, as far from the edge
     * as the bar's own side padding (so the first and last tabs land where they rest);
     * a tab already that far in (most taps) leaves the bar where it is. Rect math, not
     * scrollIntoView({…}), which old webviews lack.
     * @returns {void}
     */
    function revealActiveTab() {
      var bar = document.getElementById('tabs');
      var on = (bar && bar.querySelector) ? bar.querySelector('.tab.on') : null;
      if (!on || !on.getBoundingClientRect || !bar.getBoundingClientRect) { return; }
      var b = bar.getBoundingClientRect(), r = on.getBoundingClientRect();
      var pad = (typeof getComputedStyle === 'function' && parseFloat(getComputedStyle(bar).paddingLeft)) || 16;
      if (r.left < b.left + pad) {
        bar.scrollLeft -= b.left + pad - r.left;
      } else if (r.right > b.right - pad) {
        bar.scrollLeft += r.right - (b.right - pad);
      }
    }
    /**
     * Put focus on the active tab's button in the tab bar. A tab link re-renders the page
     * under the link that had focus, which would leave focus on <body>: a keyboard or
     * screen-reader user lands on the tab the link brought up instead.
     * @returns {void}
     */
    function focusActiveTab() {
      var bar = document.getElementById('tabs');
      var on = (bar && bar.querySelector) ? bar.querySelector('.tab.on') : null;
      if (on && on.focus) { on.focus(); }
    }
    /**
     * Whether a tab is in the bar right now: it exists and its showWhen holds (an env gate
     * hides a tab a platform lacks). A tab link never opens a tab the bar does not show.
     * @param {string} id Tab id.
     * @returns {boolean} True when the tab exists and shows.
     */
    function tabShown(id) {
      var tabs = SCHEMA.tabs || [], i;
      for (i = 0; i < tabs.length; i++) {
        if (tabs[i].id === id) { return PConf.showWhen.isVisible(tabs[i], evalCtx()); }
      }
      return false;
    }
    // Tab bar: a tap switches to its tab.
    function wireTabBar() {
      document.getElementById('tabs').addEventListener('click', function (e) {
        var b = e.target.closest('[data-tab]');
        if (b) { switchTab(b.getAttribute('data-tab')); }
      });
    }

    // --- shared text-field wiring --- one set of live-input / pre-edit-capture / commit
    // handlers serves BOTH #scroll and #modal: the edit sheet renders ordinary text rows
    // inside the dialog, and they must behave exactly like their old in-card selves
    // (S live per keystroke; onChange only on commit; repaint only on a correction).
    // Guarded on data-k so the searchSelect's search box (data-select-search, no data-k)
    // never writes into S.
    var textPreEdit = {};
    function liveTextInput(e) {
      var inp = e.target.closest && e.target.closest('input[type=text]');
      if (inp && inp.getAttribute('data-k') != null) { S[inp.getAttribute('data-k')] = inp.value; }
    }
    // The pre-edit value has to be sampled on focusin, because `input` has already
    // overwritten S[key] by the time `change` fires (so oldValue would be the new value).
    function captureTextPreEdit(e) {
      var inp = e.target.closest && e.target.closest('input[type=text]');
      if (inp && inp.getAttribute('data-k') != null) {
        textPreEdit[inp.getAttribute('data-k')] = S[inp.getAttribute('data-k')];
      }
    }
    // THE value-mutation ritual every control shares: write S, then dispatch the
    // item's onChange as (S, old, new, ENV, key). This used to be copy-pasted at
    // six sites across the #scroll and #modal handlers — a changed onChange
    // contract needed six synchronized edits.
    function setValue(key, newV, optOldV) {
      var oldV = arguments.length > 2 ? optOldV : S[key];
      S[key] = newV;
      var item = findItem(key);
      var fn = item && item.onChange && PConf.onChange.get(item.onChange);
      if (fn) { fn(S, oldV, newV, ENV, key); }
    }

    // The delegated control cases #scroll and the edit sheet share — ONE matcher,
    // so "which controls work inside the sheet" stops being an implicit
    // hand-curated duplicate of #scroll's list. Returns true when handled.
    // (The two hosts used to check these in different orders; no element matches
    // two of the selectors — data-action rides button rows, .lbl-act, .txt-act-btn
    // and the intros' .txt-link, data-goto-tab the copy's tab links (.txt-link too),
    // data-copy the hints' .copybtn, none nested in toggle/data-v/color controls — so
    // one canonical order serves both.)
    function controlClick(e) {
      var t;
      if ((t = e.target.closest('[data-max-edit]'))) { rangeWiring.openMaxEdit(t); return true; }
      // A hint's tap-to-copy button (.copybtn): a key field's hint carries one, and that
      // field can sit in an edit sheet (a weather provider's key sheet) as well as a tab.
      if ((t = e.target.closest('[data-copy]'))) { copyText(t.getAttribute('data-copy')); return true; }
      if ((t = e.target.closest('[data-toggle]'))) {
        // A disabled switch (a hosted toggle under its disabledWhen, renderToggle)
        // swallows the tap: the setting is held by another one for now.
        if (t.getAttribute('disabled') != null) { return true; }
        // Toggles fire their onChange like any other control (e.g. themeAutoPreset
        // seeding the night theme when the automatic switch comes on).
        var tgK = t.getAttribute('data-k');
        setValue(tgK, !S[tgK]);
        render(); return true;
      }
      if ((t = e.target.closest('[data-color-pick]'))) {
        setValue(t.getAttribute('data-k'), t.getAttribute('data-color-pick'));
        openColor = null; render(); return true;
      }
      if ((t = e.target.closest('[data-color]'))) {
        var ck = t.getAttribute('data-color');
        // One expander at a time: a palette opening in a sheet collapses an open option list.
        openInline = null;
        openColor = (openColor === ck ? null : ck); render(); return true;
      }
      if ((t = e.target.closest('[data-check]'))) {
        // A gated tick keeps its state and ignores the tap.
        if (t.getAttribute('disabled') != null) { return true; }
        // The grid's writer (data-write, a PConf.checkWriters id) stores the tap: it ticks
        // the code (data-check) into the list (data-k) or out of it, the opposite of what
        // the tick shows, by the list's own rules (its order, what else moves with it).
        var chK = t.getAttribute('data-k'), chV = t.getAttribute('data-check');
        var chWrite = PConf.checkWriters.get(t.getAttribute('data-write'));
        if (!chWrite) { return true; }
        chWrite(S, chK, chV, t.getAttribute('aria-checked') !== 'true');
        render();
        var hosts = [document.getElementById('modal'), document.getElementById('scroll')], hi, again;
        for (hi = 0; hi < hosts.length; hi++) {
          again = (hosts[hi] && hosts[hi].querySelector)
            ? hosts[hi].querySelector('[data-k="' + chK + '"][data-check="' + chV + '"]') : null;
          if (again && again.focus) { again.focus(); break; }
        }
        return true;
      }
      if ((t = e.target.closest('[data-v]'))) {
        setValue(t.getAttribute('data-k'), t.getAttribute('data-v'));
        render(); return true;
      }
      // A tab link (.txt-link data-goto-tab) in copy: brings its tab to the front, from the
      // tab body or from inside an open sheet (which closes). A tab the bar hides stays put.
      if ((t = e.target.closest('[data-goto-tab]'))) {
        var gt = t.getAttribute('data-goto-tab');
        if (tabShown(gt)) { switchTab(gt); focusActiveTab(); }
        return true;
      }
      if ((t = e.target.closest('[data-action]'))) {
        var act = t.getAttribute('data-action');
        // Actions receive (arg, S, ENV, defaultAsStored); returning true asks for
        // a re-render (e.g. resetThresholds rewrites several keys). Legacy
        // actions ignore all of it.
        if (PConf.actions[act]
            && PConf.actions[act](t.getAttribute('data-action-arg'), S, ENV, defaultAsStored) === true) {
          render();
        }
        return true;
      }
      return false;
    }

    // A text item's onChange hook fires on COMMIT (change = blur / Enter), not on the
    // per-keystroke `input` above: a hook that rejects a value by reverting it (e.g.
    // validateThresholdPair) would otherwise fight the user mid-typing — "100" can't be
    // typed if the interim "1" is momentarily invalid.
    function commitTextChange(e) {
      var inp = e.target.closest && e.target.closest('input[type=text]');
      if (!inp || inp.getAttribute('data-k') == null) { return; }
      var tk = inp.getAttribute('data-k'), newV = inp.value;
      var tItem = findItem(tk);
      var onChangeFn = tItem && tItem.onChange && PConf.onChange.get(tItem.onChange);
      if (!onChangeFn) { S[tk] = newV; relabelSelectTriggers(); return; }
      // No focusin seen (programmatic value + change): fall back to the new value so a
      // revert is a no-op rather than restoring something that was never in the field.
      var oldV = Object.prototype.hasOwnProperty.call(textPreEdit, tk)
        ? textPreEdit[tk] : newV;
      delete textPreEdit[tk];
      setValue(tk, newV, oldV);
      // Repaint ONLY when the hook actually corrected the value: a correction has
      // to become visible (focus has already left the field). On the common
      // accepted-value path the input already shows what the user typed, and an
      // unconditional render() here would swallow their next tap — in a webview
      // focus moves on mousedown, so `change` fires BEFORE mouseup, and replacing
      // the subtree's innerHTML detaches the node the click was about to land on.
      if (S[tk] !== newV) { render(); return; }
      relabelSelectTriggers();
    }

    /**
     * The one thing a text commit repaints without render(): select-trigger labels. An
     * optionsFrom resolver may NAME its options from a text key (e.g. a provider picker
     * that calls one provider "limited" until an API key is typed into a field below it),
     * and the collapsed trigger would otherwise keep the old name until the next full
     * render. So after every commit, each trigger rendered in #scroll and #modal (an edit
     * sheet hosts triggers too) is relabelled IN PLACE — only its label span's text and
     * its aria-label change, no node is replaced, so the tap the commit ran ahead of
     * still lands (see above). Per keystroke (`input`) nothing repaints; the option list
     * itself is rebuilt whenever a sheet opens. A trigger whose stored value dropped out
     * of its derived options is left alone: the next full render snaps it
     * (resolveRowItem) — this path never writes S. Everything else a text key feeds
     * (hints, showWhen, blocks) still waits for that next render.
     *
     * @returns {void}
     */
    function relabelSelectTriggers() {
      var hosts = [document.getElementById('scroll'), document.getElementById('modal')];
      var ctx = evalCtx(), h, i, trigs, item, label, span, aria;
      for (h = 0; h < hosts.length; h++) {
        trigs = (hosts[h] && hosts[h].querySelectorAll)
          ? hosts[h].querySelectorAll('.sel-wrap[data-select]') : [];
        for (i = 0; i < trigs.length; i++) {
          item = findShownItem(SCHEMA, trigs[i].getAttribute('data-select'), ctx);
          label = item ? selectTriggerLabel(item, S, ENV) : null;
          span = (label == null || !trigs[i].querySelector) ? null : trigs[i].querySelector('span');
          if (!span) { continue; }
          if (span.textContent !== label) { span.textContent = label; }
          aria = selectTriggerAria(item, label);
          if (trigs[i].getAttribute('aria-label') !== aria) { trigs[i].setAttribute('aria-label', aria); }
        }
      }
    }

    /**
     * Re-resolve every derived (hintFrom) hint rendered in #scroll and #modal IN PLACE —
     * only the hint element's markup changes, no node around it is replaced. For a commit
     * that deliberately skips render(): a keyboard nudge on a range thumb (range-control.js)
     * must keep focus on the thumb, yet a hint elsewhere in the sheet may read the value it
     * just wrote (e.g. a day-max kind's hint quoting its warn level). Each hint is found by
     * its data-hint-for key (renderRow marks derived hints only) and resolved the way
     * renderItem does — the resolver's answer, else the static hintByValue/hint for the
     * stored value. A hint that rendered empty has no element to find and waits for the
     * next render, as do showWhen and blocks; the row's wrap layout, chosen from the hint's
     * length at render time, is likewise left as it was.
     *
     * @returns {void}
     */
    function repaintDerivedHints() {
      var hosts = [document.getElementById('scroll'), document.getElementById('modal')];
      var ctx = evalCtx(), h, i, els, key, item, hint;
      for (h = 0; h < hosts.length; h++) {
        els = (hosts[h] && hosts[h].querySelectorAll)
          ? hosts[h].querySelectorAll('.hint[data-hint-for]') : [];
        for (i = 0; i < els.length; i++) {
          key = els[i].getAttribute('data-hint-for');
          item = findShownItem(SCHEMA, key, ctx);
          if (!item || !item.hintFrom) { continue; }
          hint = resolveHint(item, S, ENV, S[key]);
          if (hint === undefined) {
            hint = item.hintByValue ? (item.hintByValue[S[key]] || item.hint) : item.hint;
          }
          hint = hint == null ? '' : String(hint);
          if (els[i].innerHTML !== hint) { els[i].innerHTML = hint; }
        }
      }
    }

    // Scroll body: click (control interactions incl. opening a select/searchSelect,
    // handled by #modal once open) and input (text fields).
    function wireInputs() {
      var scroll = document.getElementById('scroll');
      scroll.addEventListener('click', function (e) {
        var t;
        if ((t = e.target.closest('[data-edit-sheet]'))) {
          var ek = t.getAttribute('data-edit-sheet');
          dateWiring.flushPending();
          openSelect = null;
          openDate = null;
          lastSelectKey = null;
          // The sheet opens with nothing expanded. A palette left open in the tab body
          // would otherwise count as the sheet's own (it closes with the sheet anyway, see
          // closeModal): Escape would spend its first press collapsing it and the sheet
          // would open at the raised .picking cap.
          openColor = null;
          openInline = null;
          openEdit = ek;
          lastEditSheet = ek;
          render();
          return;
        }
        if ((t = e.target.closest('[data-select]'))) {
          var sk = t.getAttribute('data-select');
          if (openSelect === sk) { closeModal(); return; }
          dateWiring.flushPending();
          openDate = null;
          openSelect = sk;
          selectQuery = '';
          lastSelectKey = sk;
          render();
          focusModal();
          return;
        }
        if ((t = e.target.closest('[data-date]'))) {
          var dk = t.getAttribute('data-date');
          if (openDate === dk) { closeModal(); return; }
          dateWiring.flushPending();
          openSelect = null;
          lastSelectKey = null;
          openDate = dk;
          render();
          return;
        }
        if ((t = e.target.closest('[data-coll]'))) { var sid = t.getAttribute('data-coll'); collapsed[sid] = !collapsed[sid]; render(); return; }
        // Everything else a tab body can host is a shared control case.
        controlClick(e);
      });
      scroll.addEventListener('input', liveTextInput);
      scroll.addEventListener('focusin', captureTextPreEdit);
      scroll.addEventListener('change', commitTextChange);
      scroll.addEventListener('focusout', rangeWiring.commitMaxEdit);
      rangeWiring.wireRangeEvents(scroll);
    }

    /**
     * Move focus to the first element in the dialog matching one of the selectors, in
     * order — the stand-in for a trigger or option node a render() just replaced.
     * @param {Array<string>} selectors Candidate selectors, most wanted first.
     * @returns {void}
     */
    function focusInModal(selectors) {
      var modal = document.getElementById('modal'), el = null, i;
      if (!modal || !modal.querySelector) { return; }
      for (i = 0; i < selectors.length && !el; i++) { el = modal.querySelector(selectors[i]); }
      if (el && el.focus) { el.focus(); }
    }

    /**
     * Collapse whatever is expanded in place inside the open edit sheet — an option list
     * or a palette — and hand focus back to the row's trigger. The first answer to
     * Escape: only a sheet with nothing expanded closes on it.
     * @returns {boolean} True when something was collapsed.
     */
    function collapseSheetExpander() {
      if (!openEdit || !(openInline || openColor)) { return false; }
      var sel = openInline ? '[data-select="' + openInline + '"]' : '[data-color="' + openColor + '"]';
      openInline = null;
      openColor = null;
      render();
      focusInModal([sel]);
      return true;
    }

    // The #modal overlay lives outside #scroll, so it needs its own delegated handlers:
    // pick an option (set value + fire onChange + close), close (backdrop / X), and the
    // searchSelect live filter (rebuild only the list so the input keeps focus + cursor).
    function wireModal() {
      var modal = document.getElementById('modal');
      modal.addEventListener('click', function (e) {
        var t;
        // The Save dialog's two buttons (renderConfirmModal); its close button and the
        // backdrop fall through to the shared close below and save nothing.
        if (openConfirm && e.target.closest && (t = e.target.closest('[data-confirm]'))) {
          confirmChoice(t.getAttribute('data-confirm'));
          return;
        }
        if (e.target.closest && (t = e.target.closest('[data-select-pick]'))) {
          var k = t.getAttribute('data-k'), v = t.getAttribute('data-select-pick');
          setValue(k, v);
          // A pick in a list expanded inside an edit sheet collapses that list and
          // leaves the sheet open, focus back on the row's trigger (the node render()
          // just rebuilt). Anywhere else a pick closes the select sheet.
          if (openEdit && !openSelect && openInline) {
            openInline = null;
            render();
            focusInModal(['[data-select="' + k + '"]']);
            return;
          }
          closeModal(); return;
        }
        // Edit-sheet controls: the sheet renders ordinary rows inside the dialog,
        // so the SAME shared control cases #scroll dispatches must work here —
        // one matcher (controlClick) instead of a hand-curated duplicate list.
        // render() repaints the dialog's innerHTML in place (openEdit is
        // unchanged), so the sheet stays open throughout. The openEdit gate keeps
        // clicks inside date/select sheets out of the control cases.
        // A select row in the sheet expands its options in place, under the row
        // (renderInlineList); a second tap on its trigger collapses them.
        if (openEdit && !openSelect && e.target.closest && (t = e.target.closest('[data-select]'))) {
          var sk = t.getAttribute('data-select');
          openColor = null;
          openInline = (openInline === sk ? null : sk);
          render();
          // [data-select-pick] on the current option too: a gated current value renders a
          // disabled button, which cannot take focus — fall through to the first pickable one.
          // A tap that opened nothing (render() dropped the key) lands back on the trigger.
          focusInModal(openInline
            ? ['.isel-list .ssel-opt.on[data-select-pick]', '.isel-list [data-select-pick]']
            : ['[data-select="' + sk + '"]']);
          return;
        }
        if (openEdit && !openSelect && e.target.closest && controlClick(e)) { return; }
        if (e.target.closest && (t = e.target.closest('.date-opt')) && openDate) {
          var wheel = t.closest('[data-date-wheel]');
          if (!wheel) { return; }
          var dateKey = openDate;
          dateWiring.flushPending();
          var parts = parseDateParts(S[dateKey]);
          parts[wheel.getAttribute('data-date-wheel')] =
            parseInt(t.getAttribute('data-date-value'), 10);
          S[dateKey] = dateValueFromParts(parts);
          render();
          return;
        }
        // Backdrop light-dismiss: a ::backdrop click targets the dialog element itself. So
        // does a tap on any bare patch of the sheet, which is why no sheet child may carry
        // an outer margin (see .ssel-search-wrap in renderSelectModal).
        if ((e.target.closest && e.target.closest('[data-select-close]'))
            || e.target === modal) {
          closeModal(); return;
        }
      });
      // Escape fires the dialog's native `cancel`; route it through closeModal (the single
      // close path via render → syncDialog) instead of letting the dialog self-close.
      // Inside an edit sheet the first press collapses an expanded option list or palette;
      // the next one closes the sheet.
      modal.addEventListener('cancel', function (e) {
        e.preventDefault();
        if (collapseSheetExpander()) { return; }
        closeModal();
      });
      // Edit-sheet text fields (warn/danger thresholds …) get the same live-input /
      // pre-edit / commit path as #scroll's text rows; liveTextInput's data-k guard
      // keeps the searchSelect's search box out of S.
      modal.addEventListener('input', liveTextInput);
      modal.addEventListener('focusin', captureTextPreEdit);
      modal.addEventListener('change', commitTextChange);
      modal.addEventListener('input', function (e) {
        var sb = e.target.closest('[data-select-search]');
        if (!sb) { return; }
        var sk = sb.getAttribute('data-select-search');
        selectQuery = sb.value;
        var list = document.querySelector('[data-ssel-list="' + sk + '"]');
        if (list) {
          var item = resolveRowItem(findItem(sk), { value: S[sk] }, { S: S, ENV: ENV });
          list.innerHTML = renderSelectOptions(item, S[sk], selectQuery, resolveRecommended(item, S, ENV),
            disabledOptionValues(item, evalCtx()));
        }
      });
      // The wheel settle/commit lives with the date picker (createDateWiring).
      modal.addEventListener('scroll', dateWiring.onModalScroll, true);
      // Swipe-down-to-dismiss: only arms when the list is already at the top, so a downward
      // swipe mid-list still scrolls the list. Once armed, dragging down follows the finger
      // (translateY) and closes past a threshold; a shorter drag snaps back.
      var dragY = null, dragging = false;
      modal.addEventListener('touchstart', function (e) {
        // A date wheel must not settle (and re-render) under a finger that is still down.
        dateWiring.onModalTouch(e);
        // A touch that lands on a slider is a value adjustment, never a sheet
        // dismissal — arming here would drag the whole sheet along with every
        // slightly-diagonal thumb gesture (and close it past the threshold). Same
        // for an open palette or in-place option list: each is a block of tap
        // targets, and with the raised .picking cap the sheet often still sits at
        // scrollTop 0, which is exactly what canDragSelect below arms on.
        if (e.target.closest && e.target.closest('.rng, .palette, .isel-list')) {
          dragY = null; dragging = false; modal.style.transition = '';
          return;
        }
        var list = modal.querySelector('.ssel-list');
        var wheel = e.target.closest && e.target.closest('[data-date-wheel]');
        var header = e.target.closest && e.target.closest('.ssel-modal-hdr');
        var canDragDate = Boolean(openDate
          && (header || (wheel && wheel.scrollTop <= 0)));
        var canDragSelect = Boolean((openSelect || openEdit) && list && list.scrollTop <= 0);
        dragY = (canDragDate || canDragSelect) ? e.touches[0].clientY : null;
        dragging = false;
        modal.style.transition = '';
      }, { passive: true });
      modal.addEventListener('touchmove', function (e) {
        if (dragY == null || rangeWiring.isDragging()) { return; }
        var dy = e.touches[0].clientY - dragY;
        if (dy <= 0) { if (dragging) { modal.style.transform = ''; dragging = false; } return; }
        dragging = true;
        e.preventDefault();            // hold the list still while the sheet follows the finger
        modal.style.transform = 'translateY(' + dy + 'px)';
      }, { passive: false });
      modal.addEventListener('touchend', function (e) {
        dateWiring.onModalTouch(e);   // the release re-arms a wheel's held-back settle
        if (dragY != null && dragging) {
          if (e.changedTouches[0].clientY - dragY > 90) { closeModal(); }
          else { modal.style.transition = 'transform .2s ease'; modal.style.transform = ''; }
        }
        dragY = null; dragging = false;
      }, { passive: true });
      modal.addEventListener('touchcancel', dateWiring.onModalTouch, { passive: true });
      // Threshold sliders live in the edit sheet: the same shared range drag/keyboard
      // handlers (and the scale-max commit) #scroll carries must work here too.
      modal.addEventListener('focusout', rangeWiring.commitMaxEdit);
      rangeWiring.wireRangeEvents(modal);
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
      var blob = serialize(SCHEMA, S, ENV);
      var el = document.getElementById('toast');
      el.textContent = 'Settings saved ✓';
      el.classList.add('show');
      setTimeout(function () { location.href = RETURN_TO + encodeURIComponent(JSON.stringify(blob)); }, 300);
    }
    /**
     * The Save button: saves at once, unless a row needs attention
     * (PConf.attentionResolvers, findAttention) — then the confirm dialog opens first,
     * offering the fix and "Save anyway". It never stands between the user and a save:
     * no attention, an attention without a title, a resolver that throws, or a page that
     * cannot open a <dialog> (no showModal) all save straight away. Only the Save
     * button asks; the setup wizard's own finish saves directly (runReady's save).
     * @returns {void}
     */
    function requestSave() {
      var dlg = document.getElementById('modal');
      var found = null;
      try { found = findAttention(SCHEMA, { S: S, ENV: ENV, evalCtx: evalCtx() }); } catch (err) { found = null; }
      if (!found || !found.attention.title || !dlg || typeof dlg.showModal !== 'function') { save(); return; }
      var att = found.attention;
      dateWiring.flushPending();
      openSelect = null;
      openDate = null;
      openEdit = null;
      openColor = null;
      openInline = null;
      lastSelectKey = null;
      lastEditSheet = null;
      openConfirm = {
        title: att.title,
        body: att.body,
        actionLabel: att.actionLabel,
        confirmLabel: att.confirmLabel,
        tab: found.tab,
        sheet: att.sheet || resolveEditSheet(found.item, S, ENV)
          || (found.section.sheetOnly ? found.section.sheetId : null)
      };
      render();
      focusInModal(['[data-confirm="action"]', '[data-confirm="save"]']);
    }

    /**
     * A tap on one of the Save dialog's buttons. "save" closes it and saves exactly as
     * Save does; "action" closes it WITHOUT saving and opens the fix on the row's tab:
     * that tab comes to the front (its scroll offset kept as a tab tap keeps it, the tab
     * bar scrolled so it shows) and the row's sheet opens over it, so closing the sheet
     * lands on the row it belongs to. Not switchTab: that one closes every sheet.
     * @param {string} which 'save' | 'action'.
     * @returns {void}
     */
    function confirmChoice(which) {
      var cf = openConfirm;
      openConfirm = null;
      if (which === 'save') { render(); save(); return; }
      var scroll = document.getElementById('scroll');
      var switching = Boolean(cf && cf.tab && cf.tab !== activeTab);
      if (switching) {
        tabScroll[activeTab] = scroll.scrollTop;
        activeTab = cf.tab;
      }
      if (cf && cf.sheet) {
        openEdit = cf.sheet;
        lastEditSheet = cf.sheet;
      }
      render();
      if (switching) {
        scroll.scrollTop = tabScroll[activeTab] || 0;
        revealActiveTab();
      }
    }

    function wireSave() {
      document.getElementById('save').addEventListener('click', requestSave);
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
      // The id of the tab on screen right now. render() rebuilds only that tab, so a
      // block repainting from an async completion can skip a repaint no one would see
      // (and that would tear down a field the user is typing in on another tab).
      activeTab: function () { return activeTab; },
      // Open a schema select/searchSelect in the shared bottom-sheet dialog. Used by the wizard,
      // which lives in its own overlay: the sheet is a showModal() top-layer dialog, so it renders
      // above that overlay. The engine sets S[key] on pick; onClose fires after any close.
      openSheet: function (key, onClose) {
        dateWiring.flushPending();
        openDate = null;
        openSelect = key;
        selectQuery = '';
        lastSelectKey = null;
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
    initialTab: initialTab,
    esc: esc, renderControl: renderControl, renderRow: renderRow, renderSelectOptions: renderSelectOptions,
    renderSelectModal: renderSelectModal, renderDateModal: renderDateModal,
    renderEditModal: renderEditModal,
    formatDateValue: formatDateValue, parseDateParts: parseDateParts,
    dateValueFromParts: dateValueFromParts,
    parseRange: parseRange, formatRange: formatRange,
    snapToStep: snapToStep, moveThumb: moveThumb, renderRange: renderRange,
    thresholdValues: thresholdValues, resolveRangeItem: resolveRangeItem,
    paintThresholdRange: paintThresholdRange,
    parseRgb: parseRgb, formatRgb: formatRgb, rgbHex: rgbHex,
    setRgbChannel: setRgbChannel, renderRgb: renderRgb, paintRgb: paintRgb,
    renderTabBar: renderTabBar, renderBody: renderBody, resolveOptionsFrom: resolveOptionsFrom,
    selectTriggerLabel: selectTriggerLabel, findShownItem: findShownItem,
    resolveDefaultFrom: resolveDefaultFrom, resolveHint: resolveHint,
    resolveTheme: resolveTheme,
    fitSelectPeek: fitSelectPeek,
    resolveStaticText: resolveStaticText, resolveAttention: resolveAttention,
    findAttention: findAttention, renderConfirmModal: renderConfirmModal
  };
})();
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    serialize: PConf.engine.serialize, hydrate: PConf.engine.hydrate, boot: PConf.engine.boot,
    initialCollapsed: PConf.engine.initialCollapsed, initialTab: PConf.engine.initialTab,
    blocks: PConf.blocks, icons: PConf.icons, hooks: PConf.hooks, onChange: PConf.onChange,
    esc: PConf.engine.esc, renderControl: PConf.engine.renderControl, renderRow: PConf.engine.renderRow,
    renderSelectOptions: PConf.engine.renderSelectOptions,
    renderSelectModal: PConf.engine.renderSelectModal,
    renderDateModal: PConf.engine.renderDateModal,
    renderEditModal: PConf.engine.renderEditModal,
    formatDateValue: PConf.engine.formatDateValue,
    parseDateParts: PConf.engine.parseDateParts,
    dateValueFromParts: PConf.engine.dateValueFromParts,
    parseRange: PConf.engine.parseRange, formatRange: PConf.engine.formatRange,
    snapToStep: PConf.engine.snapToStep, moveThumb: PConf.engine.moveThumb,
    renderRange: PConf.engine.renderRange,
    thresholdValues: PConf.engine.thresholdValues,
    resolveRangeItem: PConf.engine.resolveRangeItem,
    paintThresholdRange: PConf.engine.paintThresholdRange,
    parseRgb: PConf.engine.parseRgb, formatRgb: PConf.engine.formatRgb,
    rgbHex: PConf.engine.rgbHex, setRgbChannel: PConf.engine.setRgbChannel,
    renderRgb: PConf.engine.renderRgb, paintRgb: PConf.engine.paintRgb,
    rangeResolvers: PConf.rangeResolvers, badgeResolvers: PConf.badgeResolvers,
    displayResolvers: PConf.displayResolvers, hintResolvers: PConf.hintResolvers,
    renderTabBar: PConf.engine.renderTabBar, renderBody: PConf.engine.renderBody,
    resolveOptionsFrom: PConf.engine.resolveOptionsFrom,
    selectTriggerLabel: PConf.engine.selectTriggerLabel,
    findShownItem: PConf.engine.findShownItem,
    resolveDefaultFrom: PConf.engine.resolveDefaultFrom,
    resolveHint: PConf.engine.resolveHint,
    resolveTheme: PConf.engine.resolveTheme,
    fitSelectPeek: PConf.engine.fitSelectPeek,
    checkWriters: PConf.checkWriters,
    attentionResolvers: PConf.attentionResolvers,
    whenResolvers: PConf.whenResolvers,
    resolveStaticText: PConf.engine.resolveStaticText,
    resolveAttention: PConf.engine.resolveAttention,
    findAttention: PConf.engine.findAttention,
    renderConfirmModal: PConf.engine.renderConfirmModal
  };
}
