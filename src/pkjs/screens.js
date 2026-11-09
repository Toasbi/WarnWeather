// src/pkjs/screens.js — ES5. The screens: each view of the cycle (the Default screen, then up
// to two flick screens) as the list of what it shows, top to bottom, which the settings page
// edits, and the modes the phone works out from them.
//
// THE LIST. A screen is an array of blocks { k: kind } in drawn order: the Watch bar
// ('strip'), the Calendar ('cal', rows '2' | '3'), the Clock ('clock'), the status bars
// ('fcbar', 'radarbar', 'healthbar', and on a Pebble Time 2 the bars New bar makes, 'bar4',
// 'bar5', 'bar6': view-cycle.js EXTRA_BARS) and the three graphs ('fc', 'radar', 'health', size
// '2' | '3' | '4' | 'fill'; the forecast graph also names its graph style, style '2' | '3',
// absent for the first: Pebble Time 2, graph-styles.js). Its rules:
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
// THE NAMES. A screen's name is the page's own (viewName{i}, never compiled or sent): what the
// user called it, else its place's (NAMES: Default, Flick 1, Flick 2), so a screen moved to
// the top reads as the Default until it is named. nameOf is THE reading, for every label. A
// status bar's name is the page's own too (<prefix>Name, on-demand.js BARS' prefix): what the
// user called it, else its kind's (Forecast bar, Radar bar, Health bar, Bar 4 ...); barName reads
// it, and blockName names any row by it. The Watch bar is one for every screen and keeps its name.
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
  // `graph` the graph a graph shows (its viewTop / viewBody value). A status bar's name until
  // it is named is its on-demand.js BARS name (set below, with BAR_OF_KIND).
  var KINDS = {
    strip: { name: 'Watch bar' },
    cal: { name: 'Calendar' },
    clock: { name: 'Clock' },
    fcbar: { bar: 'weather' },
    radarbar: { bar: 'radar' },
    healthbar: { bar: 'health' },
    fc: { name: 'Forecast graph', graph: 'forecast' },
    radar: { name: 'Rain radar', graph: 'radar' },
    health: { name: 'Health graph', graph: 'health' }
  };
  // Bars 4 to 6: the kind is the bar's id and its row value (view-cycle.js EXTRA_BARS).
  VC.EXTRA_BARS.forEach(function (b) { KINDS[b.bar] = { bar: b.bar }; });
  // The order "+ Add" offers them in.
  var ADD_ORDER = ['strip', 'cal', 'clock', 'fcbar', 'radarbar', 'healthbar']
    .concat(VC.EXTRA_BARS.map(function (b) { return b.bar; }), ['fc', 'radar', 'health']);
  var MAX_SCREENS = 3;
  // The most status bars one screen shows (the Watch bar aside).
  var SCREEN_BARS = 2;
  // The places' names, the Default first: a screen's name until it is given one (nameOf).
  var NAMES = ['Default', 'Flick 1', 'Flick 2'];
  // The longest name a screen, a bar or a graph keeps (cleanName).
  var NAME_MAX = 24;
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
  VC.EXTRA_BARS.forEach(function (b) { ROW_KIND[b.src] = b.bar; });
  var BODY_KIND = {};
  BODY_KIND[VC.BODY_FC] = 'fc';
  BODY_KIND[VC.BODY_GRAPH] = 'health';
  BODY_KIND[VC.BODY_RADAR] = 'radar';

  /**
   * A name as a screen keeps it: trimmed, at most NAME_MAX characters ('' for none).
   * @param {*} text The name typed.
   * @returns {string}
   */
  function cleanName(text) {
    return String(text === undefined || text === null ? '' : text).replace(/^\s+|\s+$/g, '').slice(0, NAME_MAX);
  }

  /**
   * A screen's name (THE NAMES above): its own, else its place's.
   * @param {?Object} S Settings.
   * @param {number} i View slot.
   * @returns {string}
   */
  function nameOf(S, i) {
    return cleanName(S && S['viewName' + i]) || NAMES[i] || '';
  }

  // Each status bar row's bar (on-demand.js BARS: its key prefix, so its slots and its name),
  // and back, read off the rows' sources (ROW_KIND, view-cycle.js barOfSource).
  var BAR_OF_KIND = {};
  var KIND_OF_BAR = {};
  Object.keys(ROW_KIND).forEach(function (src) {
    var bar = VC.barOfSource(Number(src));
    BAR_OF_KIND[ROW_KIND[src]] = bar;
    KIND_OF_BAR[bar] = ROW_KIND[src];
  });
  onDemand.BARS.forEach(function (b) {
    if (KIND_OF_BAR[b.bar]) { KINDS[KIND_OF_BAR[b.bar]].name = b.name; }
  });

  /**
   * The key a status bar's name is stored under (THE NAMES above): '<prefix>Name'.
   * @param {string} bar An on-demand.js BARS bar.
   * @returns {?string} null for the Watch bar (it keeps its name) and an unknown bar
   */
  function barNameKey(bar) {
    var prefix = bar === 'top' ? null : onDemand.prefixOf(bar);
    return prefix ? prefix + 'Name' : null;
  }

  /**
   * A status bar's name (THE NAMES above): its own, else its kind's.
   * @param {?Object} S Settings.
   * @param {string} bar An on-demand.js BARS bar ('top' is the Watch bar).
   * @returns {string}
   */
  function barName(S, bar) {
    if (bar === 'top') { return KINDS.strip.name; }
    var key = barNameKey(bar), kind = KINDS[KIND_OF_BAR[bar]];
    return cleanName(S && key && S[key]) || (kind ? kind.name : '');
  }

  /**
   * A row's name as the page shows it: a status bar's its bar's (barName), any other its kind's.
   * @param {Object} b A block.
   * @param {?Object} S Settings.
   * @returns {string}
   */
  function blockName(b, S) {
    return BAR_OF_KIND[b.k] ? barName(S, BAR_OF_KIND[b.k]) : KINDS[b.k].name;
  }

  /**
   * @param {?Object} b A block.
   * @returns {boolean} whether it is one of the three graphs
   */
  function isGraph(b) { return Boolean(b && KINDS[b.k] && KINDS[b.k].graph); }

  /**
   * @param {?Object} b A block.
   * @returns {boolean} whether it is a status bar (not the Watch bar)
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
   * radar and health (aplite has neither), bars 4 to 6 a watch that has them (env.extraBars,
   * the Pebble Time 2). An unknown platform is capable of the rest.
   * @param {string} k A kind.
   * @param {?Object} env config-ui/lib/platform.js computeEnv() result.
   * @returns {boolean}
   */
  function capable(k, env) {
    var e = env || {};
    if (k === 'radar' || k === 'radarbar') { return e.radar !== false; }
    if (k === 'health' || k === 'healthbar') { return e.health !== false; }
    if (VC.extraBar(k)) { return e.extraBars === true; }
    return true;
  }

  /**
   * Whether a kind can go onto a screen: the watch draws it (capable), and a bar 4 to 6 is
   * made (view-cycle.js barMade: New bar makes one).
   * @param {string} k A kind.
   * @param {?Object} S Settings.
   * @param {?Object} env Platform env.
   * @returns {boolean}
   */
  function offered(k, S, env) {
    return capable(k, env) && (!VC.extraBar(k) || VC.barMade(S, k));
  }

  /**
   * What "+ Add" offers: the kinds the screen lacks that still have a place, in ADD_ORDER,
   * your bars 4 to 6 among them once made (offered). Whether the result fits the watch is
   * fits()'s question.
   * @param {Array<Object>} list A screen.
   * @param {?Object} [env] Platform env (omitted = capable).
   * @param {?Object} [S] Settings (which bars 4 to 6 are made; omitted = none).
   * @returns {Array<string>} kinds
   */
  function addable(list, env, S) {
    var bars = count(list, isBar);
    var graphs = count(list, isGraph);
    var topTaken = topRows(list).length > 0;
    var bot = bottom(list);
    return ADD_ORDER.filter(function (k) {
      if (idxOf(list, k) >= 0 || !offered(k, S, env)) { return false; }
      if (k === 'cal') { return !topTaken; }
      if (KINDS[k].bar) { return bars < SCREEN_BARS; }
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
   * the bars in list order the upper then the lower row; the order orderFor's; the forecast
   * graph's style viewStyle ('1' without one). viewAlign is left as stored: the list has no
   * Position.
   * @param {Array<Object>} list A screen.
   * @param {number} i View slot (0 = Default, 1-2 = flicks).
   * @returns {Object} key -> value
   */
  function compileKeys(list, i) {
    var bot = bottom(list);
    var seq = '';
    var bars = 0;
    var keys = {};
    var fc = list[idxOf(list, 'fc')];
    keys['viewStyle' + i] = (fc && fc.style) || '1';
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
   * A compiled view read back as a screen: its bands in the order the watch draws them
   * (STACK_ORDERS[order] when it is stacked, else its tier's legacy order: a compact
   * calendar's T A C B, every other T C A B), the Watch bar first and the body last. A size
   * code reads as its seat's size name (view-cycle.js TOP_SIZE_NAME / BODY_SIZE_NAME), the
   * forecast graph's style code as its viewStyle ('2' | '3'; none for the first style).
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
      bands.T = { k: 'radar', size: VC.TOP_SIZE_NAME[s.topSize || 0] };
    } else if (s.top === VC.TOP_GRAPH) {
      bands.T = { k: s.topKind === VC.TOP_KIND_HEALTH ? 'health' : 'fc', size: VC.TOP_SIZE_NAME[s.topSize || 0] };
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
    if (BODY_KIND[s.body]) { out.push({ k: BODY_KIND[s.body], size: VC.BODY_SIZE_NAME[s.bodySize || 0] }); }
    var fc = out[idxOf(out, 'fc')];
    if (fc && s.graphStyle) { fc.style = String(s.graphStyle + 1); }
    return out;
  }

  /**
   * The slots of the screens that pass a test, the Default first.
   * @param {Object} S Settings.
   * @param {?Object} env Platform env.
   * @param {function(Array<Object>): boolean} pred A screen's test, on its list.
   * @param {Array<?Object>} [cycle] screensCycle(S, env), when the caller has it already.
   * @returns {number[]}
   */
  function placesWhere(S, env, pred, cycle) {
    var out = [];
    screensOf(S, env, cycle).forEach(function (list, i) { if (pred(list)) { out.push(i); } });
    return out;
  }

  /**
   * Every screen of the settings, as lists (a preset's views too), read off the views the
   * screens show (view-cycle.js screensCycle: a custom layout with every seat kind on, since
   * the modes follow the screens).
   * @param {Object} S Settings.
   * @param {?Object} [env] Platform env.
   * @param {Array<?Object>} [cycle] screensCycle(S, env), when the caller has it already.
   * @returns {Array<Array<Object>>} the screens, the Default first
   */
  function screensOf(S, env, cycle) {
    var s = S || {};
    var custom = s.layoutPreset === 'custom';
    return (cycle || VC.screensCycle(s, env)).map(function (spec, i) {
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
    // This one view as slot i of a custom layout, as the screens show it (every seat kind on;
    // the slots before it read defaults; a bar 4 to 6 the list holds as made).
    var S = compileKeys(list, i);
    S.viewCount = String(i + 1);
    S.layoutPreset = 'custom';
    VC.EXTRA_BARS.forEach(function (b) { S[b.prefix + 'Made'] = true; });
    return VC.stackFits(VC.screensCycle(S)[i], family).fits;
  }

  /**
   * The modes the screens need, THE rule for Save and the 2.6 migration:
   *   radarMode — 'off' with the rain radar off (radarEnabled false) or on a watch without
   *     it; 'graph' when a screen shows the rain radar; on a preset, 'status' when one shows
   *     the Radar bar (a preset's cycle is built from the modes, view-cycle.js
   *     buildViewCycle); else 'countdown' when the rain alert is ticked on a bar a screen
   *     shows (the radar is fetched for it alone); else 'off'.
   *   healthMode — 'all' when a screen shows the health graph; on a preset, 'status' when one
   *     shows the Health bar; 'slot' when a status slot of a bar a screen shows holds a
   *     health item; else 'off' (always on a watch without health).
   * On a custom layout a bar is a status bar like the others (THE NAMES: a bar is what it
   * holds, not its kind), so the Radar bar alone fetches no radar and the Health bar alone
   * reads no health: what is on the shown bars decides.
   * @param {Object} S Settings.
   * @param {?Object} [env] Platform env (omitted = capable).
   * @returns {{radarMode: string, healthMode: string}}
   */
  function deriveModes(S, env) {
    var s = S || {};
    var e = env || {};
    var cycle = VC.screensCycle(s, env);
    var bars = VC.barsIn(cycle);
    var graphs = VC.graphsIn(cycle);
    var barNames = onDemand.BARS.map(function (b) { return b.bar; });
    var preset = s.layoutPreset !== 'custom';
    /** @param {function(string): boolean} pred @returns {boolean} whether a shown bar passes */
    function anyShownBar(pred) {
      for (var b = 0; b < barNames.length; b++) {
        if (bars[barNames[b]] && pred(barNames[b])) { return true; }
      }
      return false;
    }
    var radarMode = 'off';
    if (e.radar !== false && s.radarEnabled !== false) {
      if (graphs.radar) {
        radarMode = 'graph';
      } else if (preset && bars.radar) {
        radarMode = 'status';
      } else if (anyShownBar(function (bar) { return onDemand.sideOf(s, bar, 'rain', env) !== null; })) {
        radarMode = 'countdown';
      }
    }
    var healthMode = 'off';
    if (e.health !== false) {
      if (graphs.health) {
        healthMode = 'all';
      } else if (preset && bars.health) {
        healthMode = 'status';
      } else if (anyShownBar(function (bar) { return catalog.healthSlots(s, bar, env).length > 0; })) {
        healthMode = 'slot';
      }
    }
    return { radarMode: radarMode, healthMode: healthMode };
  }

  // ── YOUR BARS: New bar and Delete bar (Pebble Time 2) ─────────────────────────────────
  // Your bars are the bars a screen can show besides the Watch bar: the Forecast, Radar and
  // Health bars, and on a Pebble Time 2 bars 4 to 6 once New bar made them (view-cycle.js
  // barMade), at most MAX_BARS. New bar makes the first of bars 4 to 6 not made yet, empty and
  // called "Bar <n>" (the owner's, 2026-11-09: a bar is too simple for templates); Delete bar
  // unmakes one, and every screen that showed it drops the row.
  // Every bar but the Watch bar.
  var MAX_BARS = onDemand.BARS.length - 1;
  // The settings page opens each bar in a dialog of its own (schema.js barDialog): its sheet id
  // is BAR_SHEET + the bar ('bar-forecast').
  var BAR_SHEET = 'bar-';

  /**
   * The sheet id of a bar's dialog on the settings page.
   * @param {string} bar An on-demand.js BARS bar.
   * @returns {string}
   */
  function barSheet(bar) {
    return BAR_SHEET + bar;
  }

  /**
   * The bar a dialog's sheet id names (barSheet turned round).
   * @param {?string} id A sheet id.
   * @returns {?string} the bar, null when the id names no bar's dialog
   */
  function barOfSheet(id) {
    var s = String(id || ''), bar = s.indexOf(BAR_SHEET) === 0 ? s.slice(BAR_SHEET.length) : '';
    return onDemand.prefixOf(bar) !== null || bar === 'top' ? bar : null;
  }

  /**
   * Your bars on this watch (YOUR BARS above), in the Status bars tab's order (on-demand.js
   * PAGE_BARS).
   * @param {?Object} S Settings.
   * @param {?Object} env Platform env.
   * @returns {string[]} bars
   */
  function yourBars(S, env) {
    return onDemand.PAGE_BARS.filter(function (b) {
      return b.bar !== 'top' && offered(KIND_OF_BAR[b.bar], S, env);
    }).map(function (b) { return b.bar; });
  }

  /**
   * The bar New bar makes next: the first of bars 4 to 6 not made yet.
   * @param {?Object} S Settings.
   * @param {?Object} env Platform env.
   * @returns {?string} 'bar4' | 'bar5' | 'bar6', null when all three are made or the watch
   *   has none (capable)
   */
  function freeBar(S, env) {
    for (var i = 0; i < VC.EXTRA_BARS.length; i++) {
      var bar = VC.EXTRA_BARS[i].bar;
      if (capable(bar, env) && !VC.barMade(S, bar)) { return bar; }
    }
    return null;
  }

  /**
   * The bar + New bar puts on a screen: the one New bar makes next (freeBar), while the screen
   * has room for another bar (SCREEN_BARS, as addable offers bars).
   * @param {Array<Object>} list A screen.
   * @param {?Object} S Settings.
   * @param {?Object} env Platform env.
   * @returns {?string} 'bar4' | 'bar5' | 'bar6', null for none
   */
  function newBarFor(list, S, env) {
    return count(list, isBar) < SCREEN_BARS ? freeBar(S, env) : null;
  }

  /**
   * A name none of `taken` is, as a name is kept (cleanName): `base`, else "base 2",
   * "base 3" (your bars' and your graphs' new names).
   * @param {string[]} taken The names in use.
   * @param {string} base The name wanted.
   * @returns {string}
   */
  function freeName(taken, base) {
    var name = cleanName(base), n = 2;
    while (taken.indexOf(name) !== -1) { name = cleanName(base).slice(0, NAME_MAX - 3) + ' ' + n; n++; }
    return name;
  }

  /**
   * New bar: make the next of bars 4 to 6 (freeBar), empty (its slots' defaults: Empty), with
   * no countdown date and no alerts, and on no screen yet. It is called "Bar <n>" (its own name,
   * so '' is stored), unless another bar was renamed to that: then a name none of your bars has
   * (freeName). Mutates S.
   * @param {Object} S Settings.
   * @param {?Object} env Platform env.
   * @returns {?string} the bar made, null for none (all made, or a watch without them)
   */
  function makeBar(S, env) {
    var bar = freeBar(S, env);
    if (!bar) { return null; }
    var taken = yourBars(S, env).map(function (other) { return barName(S, other); });
    var own = KINDS[KIND_OF_BAR[bar]].name;
    S[VC.extraBar(bar).prefix + 'Made'] = true;
    S[barNameKey(bar)] = taken.indexOf(own) === -1 ? '' : freeName(taken, own);
    catalog.lineById(bar).slots.forEach(function (key) {
      S[key] = catalog.slotDefault(key, env);
      if (S[key + 'Countdown'] !== undefined) { S[key + 'Countdown'] = undefined; }
    });
    onDemand.SIDES.forEach(function (side) { S[onDemand.itemsKey(bar, side)] = ''; });
    return bar;
  }

  /**
   * Delete bar: a bar 4 to 6 unmade, its name, slots, countdown dates and alerts cleared, and
   * every screen that showed it stored again without its row, as the editor's Remove stores
   * one (compileKeys: a bar below it moves up to the upper row). Mutates S; the page then works
   * the modes out again.
   * @param {Object} S Settings.
   * @param {string} bar 'bar4' | 'bar5' | 'bar6'
   * @param {?Object} [env] Platform env (omitted: capable).
   * @returns {?Object<string, *>} the keys it wrote with the values they had (the page's
   *   Undo puts them back), null when no made bar went
   */
  function unmakeBar(S, bar, env) {
    var b = VC.extraBar(bar);
    if (!b || !VC.barMade(S, bar)) { return null; }
    // Read while the bar is still made, so the screens hold its row.
    var kind = KIND_OF_BAR[bar], redone = [];
    screensOf(S, env).forEach(function (list, i) {
      var j = idxOf(list, kind);
      if (j >= 0) { redone.push(compileKeys(remove(list, j), i)); }
    });
    var was = {};
    /** @param {string} key A key. @param {*} v Its new value. @returns {void} */
    function write(key, v) {
      was[key] = S[key];
      S[key] = v;
    }
    write(b.prefix + 'Made', false);
    write(barNameKey(bar), '');
    catalog.lineById(bar).slots.forEach(function (key) {
      write(key, catalog.slotDefault(key));
      // A date only a countdown slot reads; gone, the date row starts on today again.
      if (S[key + 'Countdown'] !== undefined) { write(key + 'Countdown', undefined); }
    });
    onDemand.SIDES.forEach(function (side) { write(onDemand.itemsKey(bar, side), ''); });
    redone.forEach(function (keys) {
      Object.keys(keys).forEach(function (key) { if (S[key] !== keys[key]) { write(key, keys[key]); } });
    });
    return was;
  }

  var api = {
    KINDS: KINDS,
    ADD_ORDER: ADD_ORDER,
    MAX_SCREENS: MAX_SCREENS,
    NAMES: NAMES,
    NAME_MAX: NAME_MAX,
    CAL_ROWS: CAL_ROWS,
    GRAPH_SIZES: GRAPH_SIZES,
    WATCH_BAR_FIRST: WATCH_BAR_FIRST,
    CAL_GRAPH_BOTTOM: CAL_GRAPH_BOTTOM,
    ONE_GRAPH_BOTTOM: ONE_GRAPH_BOTTOM,
    BAR_OF_KIND: BAR_OF_KIND,
    KIND_OF_BAR: KIND_OF_BAR,
    cleanName: cleanName,
    freeName: freeName,
    nameOf: nameOf,
    barNameKey: barNameKey,
    barName: barName,
    blockName: blockName,
    isGraph: isGraph,
    isBar: isBar,
    idxOf: idxOf,
    copy: copy,
    bottom: bottom,
    topRows: topRows,
    problem: problem,
    capable: capable,
    offered: offered,
    addable: addable,
    oneFill: oneFill,
    add: add,
    remove: remove,
    move: move,
    setOption: setOption,
    orderFor: orderFor,
    compileKeys: compileKeys,
    listFromSpec: listFromSpec,
    screensOf: screensOf,
    placesWhere: placesWhere,
    fits: fits,
    deriveModes: deriveModes,
    MAX_BARS: MAX_BARS,
    yourBars: yourBars,
    freeBar: freeBar,
    newBarFor: newBarFor,
    barSheet: barSheet,
    barOfSheet: barOfSheet,
    makeBar: makeBar,
    unmakeBar: unmakeBar
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.Screens = api; }
})();
