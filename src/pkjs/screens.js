// src/pkjs/screens.js — ES5. The screens: each view of the cycle (the Default screen, then up
// to two flick screens) as the list of what it shows, top to bottom, which the settings page
// edits, and the modes the phone works out from them.
//
// THE LIST. A screen is an array of blocks { k: kind } in drawn order: the Watch bar
// ('strip'), the Calendar ('cal', rows '2' | '3'), the Clock ('clock'), the three status bars
// ('fcbar', 'radarbar', 'healthbar') and the three graphs ('fc', 'radar', 'health', size
// '2' | '3' | '4' | 'fill'). Its rules:
//   - The Watch bar is always first. The Default screen keeps its Clock (the page offers no ✕
//     there; the compiler and the watch keep it whatever the keys say).
//   - At most two status bars, each kind once. Each graph kind once, at most two graphs.
//   - The last row, if it is a graph, is the bottom graph (the view's body). Only one row sits
//     in the top seat: the Calendar, or a graph that is not last.
//   - One fill per screen: a filling upper graph gives way to a filling bottom graph, and
//     setting a graph to Fill turns a filling other into 3 rows. The forecast never takes 2
//     rows (its high and low collide; the watch clamps it to 3).
//
// THE KEYS. The watch's contract stays the custom layout's per-view keys
// (settings/custom-layout-schema.js), which view-cycle.js buildCustomCycle compiles:
// compileKeys turns a list into them, listFromSpec reads a compiled view back into a list
// (the bands in the order the watch draws them, the Watch bar first, the body last), and
// screensOf reads every screen of a settings blob, a preset's too.
//
// THE MODES. radarMode and healthMode are no longer picked: deriveModes works them out from
// the screens (on Save, and in the 2.6 migration, migrations/screens.js), so every reader of
// the two keys stays as it is. radarEnabled (Setup's Rain radar Off) keeps radarProvider, so
// turning the radar on again restores the source.
//
// Dual-context: a CommonJS module on the phone and in the tests, a plain concatenated <script>
// in the settings-page webview (after view-cycle.js, status-line-catalog.js and on-demand.js,
// which it reads at load), which has no require().
(function () {
  var VC = (typeof require !== 'undefined') ? require('./view-cycle.js') : window.VIEW_CYCLE;
  var catalog = (typeof require !== 'undefined')
    ? require('./status-line-catalog.js') : window.StatusLineCatalog;
  var onDemand = (typeof require !== 'undefined') ? require('./on-demand.js') : window.OnDemand;

  // The blocks. `bar` names the status source a bar shows (its viewUpper / viewLower value),
  // `graph` the graph a graph shows (its viewTop / viewBody value).
  var KINDS = {
    strip: { name: 'Watch bar' },
    cal: { name: 'Calendar' },
    clock: { name: 'Clock' },
    fcbar: { name: 'Forecast bar', bar: 'weather' },
    radarbar: { name: 'Radar bar', bar: 'radar' },
    healthbar: { name: 'Health bar', bar: 'health' },
    fc: { name: 'Forecast graph', graph: 'forecast' },
    radar: { name: 'Rain radar', graph: 'radar' },
    health: { name: 'Health graph', graph: 'health' }
  };
  // The order "+ Add" offers them in.
  var ADD_ORDER = ['strip', 'cal', 'clock', 'fcbar', 'radarbar', 'healthbar', 'fc', 'radar', 'health'];
  var MAX_SCREENS = 3;
  var CAL_ROWS = ['2', '3'];
  var GRAPH_SIZES = ['2', '3', '4', 'fill'];

  // The snap-back messages: why a move breaks the rules.
  var WATCH_BAR_FIRST = 'The Watch bar stays at the top.';
  var CAL_GRAPH_BOTTOM = 'With a calendar, the graph stays at the bottom.';
  var ONE_GRAPH_BOTTOM = 'One graph has to stay at the bottom.';

  // A compiled view's parts, by their wire values (view-cycle.js), as blocks.
  var ROW_KIND = {};
  ROW_KIND[VC.STATUS_SRC_FORECAST] = 'fcbar';
  ROW_KIND[VC.STATUS_SRC_RADAR] = 'radarbar';
  ROW_KIND[VC.STATUS_SRC_HEALTH] = 'healthbar';
  var BODY_KIND = {};
  BODY_KIND[VC.BODY_FC] = 'fc';
  BODY_KIND[VC.BODY_GRAPH] = 'health';
  BODY_KIND[VC.BODY_RADAR] = 'radar';
  // Size codes (the ext word's, view-cycle.js SIZE_*) as a block's size: code 0 is the seat's
  // default, 3 rows for a top and Fill for the body.
  var TOP_SIZE = ['3', '2', '3', '4', 'fill'];
  var BODY_SIZE = ['fill', '2', '3', '4', 'fill'];

  /**
   * @param {?Object} b A block.
   * @returns {boolean} whether it is one of the three graphs
   */
  function isGraph(b) { return Boolean(b && KINDS[b.k] && KINDS[b.k].graph); }

  /**
   * @param {?Object} b A block.
   * @returns {boolean} whether it is one of the three status bars
   */
  function isBar(b) { return Boolean(b && KINDS[b.k] && KINDS[b.k].bar); }

  /**
   * @param {Array<Object>} list A screen.
   * @param {string} k A kind.
   * @returns {number} the index of the kind's block, -1 when the screen has none
   */
  function idxOf(list, k) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].k === k) { return i; }
    }
    return -1;
  }

  /**
   * @param {Array<Object>} list A screen.
   * @param {function(Object): boolean} pred A test.
   * @returns {number} how many blocks pass it
   */
  function count(list, pred) {
    var n = 0;
    for (var i = 0; i < list.length; i++) {
      if (pred(list[i])) { n++; }
    }
    return n;
  }

  /**
   * @param {Array<Object>} list A screen.
   * @returns {Array<Object>} a copy whose blocks are copies too
   */
  function copy(list) {
    return list.map(function (b) { return Object.assign({}, b); });
  }

  /**
   * The bottom graph: the last row, when it is a graph. It is the view's body.
   * @param {Array<Object>} list A screen.
   * @returns {?Object} the block, or null
   */
  function bottom(list) {
    var last = list[list.length - 1];
    return isGraph(last) ? last : null;
  }

  /**
   * The rows in the top seat: the calendar, and every graph that is not the last row.
   * @param {Array<Object>} list A screen.
   * @returns {Array<Object>} at most one on a screen that keeps the rules
   */
  function topRows(list) {
    var b = bottom(list);
    return list.filter(function (x) { return x.k === 'cal' || (isGraph(x) && x !== b); });
  }

  /**
   * Why a screen breaks the rules a move can break, or '' when it keeps them.
   * @param {Array<Object>} list A screen.
   * @returns {string} one of the snap-back messages, or ''
   */
  function problem(list) {
    if (idxOf(list, 'strip') > 0) { return WATCH_BAR_FIRST; }
    if (topRows(list).length > 1) {
      return idxOf(list, 'cal') >= 0 ? CAL_GRAPH_BOTTOM : ONE_GRAPH_BOTTOM;
    }
    return '';
  }

  /**
   * Whether this watch draws a kind at all: the radar and health blocks need the watch's
   * radar and health (aplite has neither). An unknown platform is capable.
   * @param {string} k A kind.
   * @param {?Object} env config-ui/lib/platform.js computeEnv() result.
   * @returns {boolean}
   */
  function capable(k, env) {
    var e = env || {};
    if (k === 'radar' || k === 'radarbar') { return e.radar !== false; }
    if (k === 'health' || k === 'healthbar') { return e.health !== false; }
    return true;
  }

  /**
   * What "+ Add" offers: the kinds the screen lacks that still have a place, in ADD_ORDER.
   * Whether the result fits the watch is fits()'s question.
   * @param {Array<Object>} list A screen.
   * @param {?Object} [env] Platform env (omitted = capable).
   * @returns {Array<string>} kinds
   */
  function addable(list, env) {
    var bars = count(list, isBar);
    var graphs = count(list, isGraph);
    var topTaken = topRows(list).length > 0;
    var bot = bottom(list);
    return ADD_ORDER.filter(function (k) {
      if (idxOf(list, k) >= 0 || !capable(k, env)) { return false; }
      if (k === 'cal') { return !topTaken; }
      if (KINDS[k].bar) { return bars < 2; }
      if (KINDS[k].graph) { return graphs < 2 && (!bot || !topTaken); }
      return true;
    });
  }

  /**
   * One fill per screen: with a filling bottom graph, a filling upper graph takes 3 rows.
   * @param {Array<Object>} list A screen (mutated).
   * @returns {Array<Object>} the same list
   */
  function oneFill(list) {
    var b = bottom(list);
    if (!b || b.size !== 'fill') { return list; }
    list.forEach(function (x) {
      if (isGraph(x) && x !== b && x.size === 'fill') { x.size = '3'; }
    });
    return list;
  }

  /**
   * Add a kind at its natural place: the Watch bar on top; the calendar under it (2 rows);
   * the clock after the calendar, or after a graph at the top; a bar above the bottom graph
   * (or last); a graph at the bottom (Fill), or, when a bottom graph is there, as the upper
   * graph under the Watch bar (3 rows).
   * @param {Array<Object>} list A screen (not changed).
   * @param {string} k A kind addable() offers.
   * @returns {Array<Object>} the new screen
   */
  function add(list, k) {
    var out = copy(list);
    var si = idxOf(out, 'strip');
    var under = si >= 0 ? si + 1 : 0;
    if (k === 'strip') {
      out.unshift({ k: 'strip' });
      return out;
    }
    if (k === 'cal') {
      out.splice(under, 0, { k: 'cal', rows: '2' });
      return out;
    }
    if (k === 'clock') {
      var first = out[under];
      var after = Boolean(first) && (first.k === 'cal' || (isGraph(first) && first !== bottom(out)));
      out.splice(after ? under + 1 : under, 0, { k: 'clock' });
      return out;
    }
    if (KINDS[k].bar) {
      if (bottom(out)) { out.splice(out.length - 1, 0, { k: k }); } else { out.push({ k: k }); }
      return out;
    }
    if (bottom(out)) {
      out.splice(under, 0, { k: k, size: '3' });
      return out;
    }
    out.push({ k: k, size: 'fill' });
    return oneFill(out);
  }

  /**
   * Take a row off.
   * @param {Array<Object>} list A screen (not changed).
   * @param {number} j The row's index.
   * @returns {Array<Object>} the new screen
   */
  function remove(list, j) {
    return copy(list).filter(function (b, x) { return x !== j; });
  }

  /**
   * Move a row from one place to another. The caller checks problem() on the result and
   * snaps back when it breaks a rule.
   * @param {Array<Object>} list A screen (not changed).
   * @param {number} from The row's index.
   * @param {number} to Its new index.
   * @returns {Array<Object>} the new screen
   */
  function move(list, from, to) {
    var out = copy(list);
    var b = out.splice(from, 1)[0];
    out.splice(to, 0, b);
    return oneFill(out);
  }

  /**
   * Set a row's option: a calendar's rows or a graph's size. Setting a graph to Fill turns a
   * filling other into 3 rows.
   * @param {Array<Object>} list A screen (not changed).
   * @param {number} j The row's index.
   * @param {string} key 'rows' | 'size'
   * @param {string} value Its new value.
   * @returns {Array<Object>} the new screen
   */
  function setOption(list, j, key, value) {
    var out = copy(list);
    out[j][key] = value;
    if (key === 'size' && value === 'fill') {
      out.forEach(function (b, x) {
        if (x !== j && isGraph(b) && b.size === 'fill') { b.size = '3'; }
      });
    }
    return out;
  }

  /**
   * The first stored band order (view-cycle.js STACK_ORDERS, code 1 up) whose letters, kept
   * to the ones present, read as `seq`; code 0's 'TACB' when none does.
   * @param {string} seq The screen's T / C / A / B letters in list order.
   * @returns {string} a STACK_ORDERS sequence
   */
  function orderFor(seq) {
    for (var c = 1; c < VC.STACK_ORDERS.length; c++) {
      var f = VC.STACK_ORDERS[c].split('').filter(function (ch) { return seq.indexOf(ch) >= 0; }).join('');
      if (f === seq) { return VC.STACK_ORDERS[c]; }
    }
    return VC.STACK_ORDERS[0];
  }

  /**
   * One screen's per-view keys (settings/custom-layout-schema.js) for view slot i: no Watch
   * bar is viewStripOff, no Clock viewClockOff (a flick only: the Default keeps its clock);
   * the last row, if a graph, the body; the calendar (its rows) or the upper graph the top;
   * the bars in list order the upper then the lower row; the order orderFor's. viewAlign is
   * left as stored: the list has no Position.
   * @param {Array<Object>} list A screen.
   * @param {number} i View slot (0 = Default, 1-2 = flicks).
   * @returns {Object} key -> value
   */
  function compileKeys(list, i) {
    var bot = bottom(list);
    var seq = '';
    var bars = 0;
    var keys = {};
    keys['viewTop' + i] = 'none';
    keys['viewTopSize' + i] = '3';
    keys['viewBody' + i] = bot ? KINDS[bot.k].graph : 'none';
    keys['viewBodySize' + i] = bot ? bot.size : 'fill';
    keys['viewUpper' + i] = 'off';
    keys['viewLower' + i] = 'off';
    if (i > 0) { keys['viewClockOff' + i] = idxOf(list, 'clock') < 0; }
    keys['viewStripOff' + i] = idxOf(list, 'strip') < 0;
    list.forEach(function (b) {
      var K = KINDS[b.k];
      if (b.k === 'strip' || b === bot) { return; }
      if (b.k === 'cal') {
        keys['viewTop' + i] = 'cal';
        keys['viewTopSize' + i] = b.rows;
        seq += 'T';
      } else if (K.graph) {
        keys['viewTop' + i] = K.graph;
        keys['viewTopSize' + i] = b.size;
        seq += 'T';
      } else if (b.k === 'clock') {
        seq += 'C';
      } else if (K.bar) {
        keys[(bars ? 'viewLower' : 'viewUpper') + i] = K.bar;
        seq += bars ? 'B' : 'A';
        bars++;
      }
    });
    keys['viewOrder' + i] = orderFor(seq);
    return keys;
  }

  /**
   * Every screen's keys, as the settings store them: the custom layout, the screen count,
   * each screen's view keys. The caller merges them into the settings.
   * @param {Array<Array<Object>>} screens The screens, the Default first.
   * @returns {Object} key -> value
   */
  function compileAll(screens) {
    var keys = { layoutPreset: 'custom', customLayoutSeeded: true, viewCount: String(screens.length) };
    screens.forEach(function (list, i) {
      var k = compileKeys(list, i);
      for (var n in k) {
        if (Object.prototype.hasOwnProperty.call(k, n)) { keys[n] = k[n]; }
      }
    });
    return keys;
  }

  /**
   * A compiled view read back as a screen: its bands in the order the watch draws them
   * (STACK_ORDERS[order] when it is stacked, else its tier's legacy order: a compact
   * calendar's T A C B, every other T C A B), the Watch bar first and the body last.
   * @param {?Object} s A compiled view (null: a screen with nothing on it).
   * @param {boolean} stripOn Whether a null view's screen keeps its Watch bar.
   * @returns {Array<Object>} the screen
   */
  function listFromSpec(s, stripOn) {
    if (!s) { return stripOn ? [{ k: 'strip' }] : []; }
    var bands = { T: null, C: null, A: null, B: null };
    if (s.top === VC.TOP_CAL) {
      bands.T = { k: 'cal', rows: s.tier === VC.TIER_FULL ? '3' : '2' };
    } else if (s.top === VC.TOP_RADAR) {
      bands.T = { k: 'radar', size: TOP_SIZE[s.topSize || 0] };
    } else if (s.top === VC.TOP_GRAPH) {
      bands.T = { k: s.topKind === VC.TOP_KIND_HEALTH ? 'health' : 'fc', size: TOP_SIZE[s.topSize || 0] };
    }
    if (!s.clockOff) { bands.C = { k: 'clock' }; }
    if (ROW_KIND[s.statusUpper]) { bands.A = { k: ROW_KIND[s.statusUpper] }; }
    if (ROW_KIND[s.statusLower]) { bands.B = { k: ROW_KIND[s.statusLower] }; }
    var order = VC.isStacked(s) ? (VC.STACK_ORDERS[s.order || 0] || VC.STACK_ORDERS[0])
      : (s.tier === VC.TIER_COMPACT ? 'TACB' : 'TCAB');
    var out = s.stripOff ? [] : [{ k: 'strip' }];
    order.split('').forEach(function (ch) {
      if (bands[ch]) { out.push(bands[ch]); }
    });
    if (BODY_KIND[s.body]) { out.push({ k: BODY_KIND[s.body], size: BODY_SIZE[s.bodySize || 0] }); }
    return out;
  }

  /**
   * The views the screens show, before the watch's data folds: a custom layout compiled
   * with every seat kind on (its stored rows and graphs, whatever the modes say: the modes
   * follow the screens), a preset as its cycle, and on aplite, which folds a custom layout to
   * a preset, what aplite runs.
   * @param {Object} S Settings.
   * @param {?Object} [env] Platform env.
   * @returns {Array<?Object>} the views (null = a screen with nothing on it)
   */
  function shownCycle(S, env) {
    var s = S || {};
    if (s.layoutPreset === 'custom' && !(env && env.platform === 'aplite')) {
      return VC.buildCustomCycle(Object.assign({}, s, { radarMode: 'graph', healthMode: 'all' }));
    }
    return VC.resolveViewCycle(s, env);
  }

  /**
   * Every screen of the settings, as lists (a preset's views too).
   * @param {Object} S Settings.
   * @param {?Object} [env] Platform env.
   * @returns {Array<Array<Object>>} the screens, the Default first
   */
  function screensOf(S, env) {
    var s = S || {};
    var custom = s.layoutPreset === 'custom';
    return shownCycle(s, env).map(function (spec, i) {
      return listFromSpec(spec, !(custom && s['viewStripOff' + i]));
    });
  }

  /**
   * Does a screen fit the watch it is edited for, in every data state (view-cycle.js
   * stackFits: the Radar bar kept without radar data, the radar graph folded)?
   * @param {Array<Object>} list A screen.
   * @param {number} i Its view slot.
   * @param {string} family Platform name ('emery', another, or '' for both screen sizes).
   * @returns {boolean}
   */
  function fits(list, i, family) {
    // This one view as slot i of an all-capable cycle (the slots before it read defaults).
    var S = compileKeys(list, i);
    S.viewCount = String(i + 1);
    S.radarMode = 'graph';
    S.healthMode = 'all';
    return VC.stackFits(VC.buildCustomCycle(S)[i], family).fits;
  }

  /**
   * What the views show, summed over every screen the watch stops on (a null view is
   * skipped, so its Watch bar shows nowhere).
   * @param {Array<?Object>} cycle shownCycle().
   * @returns {{bars: {top: boolean, forecast: boolean, radar: boolean, health: boolean},
   *   radarGraph: boolean, healthGraph: boolean}}
   */
  function shownParts(cycle) {
    var out = { bars: { top: false, forecast: false, radar: false, health: false },
                radarGraph: false, healthGraph: false };
    var rowBar = {};
    rowBar[VC.STATUS_SRC_FORECAST] = 'forecast';
    rowBar[VC.STATUS_SRC_RADAR] = 'radar';
    rowBar[VC.STATUS_SRC_HEALTH] = 'health';
    cycle.forEach(function (v) {
      if (!v) { return; }
      if (!v.stripOff) { out.bars.top = true; }
      if (rowBar[v.statusUpper]) { out.bars[rowBar[v.statusUpper]] = true; }
      if (rowBar[v.statusLower]) { out.bars[rowBar[v.statusLower]] = true; }
      if (v.top === VC.TOP_RADAR || v.body === VC.BODY_RADAR) { out.radarGraph = true; }
      if ((v.top === VC.TOP_GRAPH && v.topKind === VC.TOP_KIND_HEALTH) || v.body === VC.BODY_GRAPH) {
        out.healthGraph = true;
      }
    });
    return out;
  }

  /**
   * Whether an Alerts item is ticked on either side of a bar (on-demand.js' lists).
   * @param {Object} S Settings.
   * @param {string} bar An on-demand.js BARS bar.
   * @param {string} code An on-demand.js ITEMS code.
   * @returns {boolean}
   */
  function tickedOn(S, bar, code) {
    for (var s = 0; s < onDemand.SIDES.length; s++) {
      if (onDemand.parse(onDemand.read(S, onDemand.itemsKey(bar, onDemand.SIDES[s]))).indexOf(code) >= 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether a status slot of a bar holds a health item (status-line-catalog.js: an absent
   * slot reads its default, as the bake does).
   * @param {Object} S Settings.
   * @param {string} bar A status-line-catalog.js LINES id.
   * @param {?Object} env Platform env.
   * @returns {boolean}
   */
  function holdsHealth(S, bar, env) {
    for (var l = 0; l < catalog.LINES.length; l++) {
      var line = catalog.LINES[l];
      if (line.id !== bar) { continue; }
      for (var s = 0; s < line.slots.length; s++) {
        var item = catalog.byCode((S || {})[line.slots[s]] || catalog.slotDefault(line.slots[s], env));
        if (item && item.needsHealth) { return true; }
      }
    }
    return false;
  }

  /**
   * The modes the screens need, THE rule for Save and the 2.6 migration:
   *   radarMode — 'off' with the rain radar off (radarEnabled false) or on a watch without
   *     it; 'graph' when a screen shows the rain radar; 'status' when one shows the Radar bar
   *     (the mode whose readers ask for the bar: the Status bars tab and On demand); else
   *     'countdown' when the rain alert is ticked on a bar a screen shows (the radar is
   *     fetched for it alone); else 'off'.
   *   healthMode — 'all' when a screen shows the health graph; 'status' when one shows the
   *     Health bar; 'slot' when a status slot of a bar a screen shows holds a health item;
   *     else 'off' (always on a watch without health).
   * @param {Object} S Settings.
   * @param {?Object} [env] Platform env (omitted = capable).
   * @returns {{radarMode: string, healthMode: string}}
   */
  function deriveModes(S, env) {
    var s = S || {};
    var e = env || {};
    var shown = shownParts(shownCycle(s, env));
    var barNames = ['top', 'forecast', 'radar', 'health'];
    /** @param {function(string): boolean} pred @returns {boolean} whether a shown bar passes */
    function anyShownBar(pred) {
      for (var b = 0; b < barNames.length; b++) {
        if (shown.bars[barNames[b]] && pred(barNames[b])) { return true; }
      }
      return false;
    }
    var radarMode = 'off';
    if (e.radar !== false && s.radarEnabled !== false) {
      if (shown.radarGraph) {
        radarMode = 'graph';
      } else if (shown.bars.radar) {
        radarMode = 'status';
      } else if (e.onDemand !== false && anyShownBar(function (bar) { return tickedOn(s, bar, 'rain'); })) {
        radarMode = 'countdown';
      }
    }
    var healthMode = 'off';
    if (e.health !== false) {
      if (shown.healthGraph) {
        healthMode = 'all';
      } else if (shown.bars.health) {
        healthMode = 'status';
      } else if (anyShownBar(function (bar) { return holdsHealth(s, bar, env); })) {
        healthMode = 'slot';
      }
    }
    return { radarMode: radarMode, healthMode: healthMode };
  }

  var api = {
    KINDS: KINDS,
    ADD_ORDER: ADD_ORDER,
    MAX_SCREENS: MAX_SCREENS,
    CAL_ROWS: CAL_ROWS,
    GRAPH_SIZES: GRAPH_SIZES,
    WATCH_BAR_FIRST: WATCH_BAR_FIRST,
    CAL_GRAPH_BOTTOM: CAL_GRAPH_BOTTOM,
    ONE_GRAPH_BOTTOM: ONE_GRAPH_BOTTOM,
    isGraph: isGraph,
    isBar: isBar,
    idxOf: idxOf,
    copy: copy,
    bottom: bottom,
    topRows: topRows,
    problem: problem,
    capable: capable,
    addable: addable,
    oneFill: oneFill,
    add: add,
    remove: remove,
    move: move,
    setOption: setOption,
    orderFor: orderFor,
    compileKeys: compileKeys,
    compileAll: compileAll,
    listFromSpec: listFromSpec,
    shownCycle: shownCycle,
    screensOf: screensOf,
    fits: fits,
    shownParts: shownParts,
    holdsHealth: holdsHealth,
    deriveModes: deriveModes
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.Screens = api; }
})();
