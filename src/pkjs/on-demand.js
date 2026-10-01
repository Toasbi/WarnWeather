/**
 * On demand: THE one reading of which items each status bar shows at its edges, and of
 * the Battery item's settings. Loaded on the phone (require) and in the settings page
 * (window.OnDemand), so the watch's wire bytes, the fetch gates, telemetry and the page's
 * summaries all read the settings the same way.
 *
 * Each bar has two sides, left and right. A side ticks a list of items
 * (status<Bar>OnDemand<Side>Items: a comma list of item codes, in priority order) and is
 * on exactly while that list holds something. An item sits on at most one side of a bar;
 * it may also be ticked on other bars.
 *
 * It also holds the few writes that move a tick (tickOn, untickFrom, untickEverywhere,
 * placeRainForCountdown), so the settings page's hooks and the upgrade migration move
 * ticks by the same rules they are read by, and the boot's fold of the retired side
 * switches (retireSideSwitches).
 *
 * LOCKSTEP: ITEMS is the watch's OdItem order (src/c/appendix/on_demand.h: the priority
 * order and the wire order of the cells), BARS its ThreshBar order, and DEFAULTS for the
 * Watch Status Bar the compiled defaults in status_threshold.c;
 * test/on-demand-contract.test.js reads the C sources to pin all three. ES5 only (aplite
 * PKJS and the settings webview).
 */
(function () {
  // view-cycle.js requires nothing, so there is no cycle. In the flat settings page it is
  // concatenated ahead of this file (scripts/build-config-page.js APP_FILES).
  var VC = (typeof require !== 'undefined') ? require('./view-cycle.js') : window.VIEW_CYCLE;

  // The items, in priority order: nearest the side's status slot first, and the last
  // drops first when a bar runs short of room. The index is the watch's OdItem and the
  // cell byte's offset.
  // `label` is the page's name for the item (the checklist, the summaries, the card).
  var ITEMS = [
    {code: 'battery', group: 'system', label: 'Battery'},
    {code: 'bt', group: 'system', label: 'Bluetooth'},
    {code: 'qt', group: 'system', label: 'Quiet time'},
    {code: 'snooze', group: 'system', label: 'Sleep'},
    {code: 'rain', group: 'weather', label: 'Rain'},
    {code: 'gust', group: 'weather', label: 'Wind gusts'},
    {code: 'uv', group: 'weather', label: 'UV index'},
    {code: 'aqi', group: 'weather', label: 'Air quality'},
    {code: 'pollen', group: 'weather', label: 'Pollen'},
    {code: 'wind', group: 'weather', label: 'Wind speed'}
  ];

  // The status bars, in the watch's ThreshBar order (the 2-bit cell order in a cell byte).
  var BARS = [
    {bar: 'top', prefix: 'statusTop'},
    {bar: 'forecast', prefix: 'statusForecast'},
    {bar: 'radar', prefix: 'statusRadar'},
    {bar: 'health', prefix: 'statusHealth'}
  ];

  // The sides; the index + 1 is the cell's wire value (OdSide: 1 left, 2 right).
  var SIDES = ['left', 'right'];

  /**
   * @param {string} side 'left' | 'right'
   * @returns {string} 'Left' | 'Right', the key suffix
   */
  function sideSuffix(side) { return side === 'right' ? 'Right' : 'Left'; }

  /**
   * @param {string} bar 'top' | 'forecast' | 'radar' | 'health'
   * @returns {?string} the bar's key prefix, e.g. 'statusTop'; null for an unknown bar
   */
  function prefixOf(bar) {
    for (var i = 0; i < BARS.length; i++) {
      if (BARS[i].bar === bar) { return BARS[i].prefix; }
    }
    return null;
  }

  /**
   * @param {string} bar A BARS bar.
   * @param {string} side 'left' | 'right'
   * @returns {string} the side's items key, e.g. 'statusTopOnDemandLeftItems'
   */
  function itemsKey(bar, side) { return prefixOf(bar) + 'OnDemand' + sideSuffix(side) + 'Items'; }

  /**
   * The bar and side an items key belongs to: itemsKey read backwards, over BARS and
   * SIDES, so a hook handed the key that changed never spells the key scheme itself.
   * @param {string} key A settings key.
   * @returns {?{bar: string, side: string}} null when the key is no side's items list
   */
  function sideOfKey(key) {
    for (var b = 0; b < BARS.length; b++) {
      for (var s = 0; s < SIDES.length; s++) {
        if (itemsKey(BARS[b].bar, SIDES[s]) === key) { return { bar: BARS[b].bar, side: SIDES[s] }; }
      }
    }
    return null;
  }

  /**
   * @param {string} side 'left' | 'right'
   * @returns {string} the bar's other side
   */
  function otherSide(side) { return side === 'left' ? 'right' : 'left'; }

  // Every setting this module reads, with its default. The Watch Status Bar shows
  // Bluetooth, Quiet time, Sleep and the rain alert on its left, and the battery with the
  // weather alerts Wind gusts, UV index, Air quality and Wind speed on its right (Pollen
  // off; the battery takes the place of the old top-right low-battery warning); every
  // other bar starts with nothing ticked. seedDefaults writes these into every install,
  // upgraded ones included.
  var DEFAULTS = {
    statusTopOnDemandLeftItems: 'bt,qt,snooze,rain',
    statusTopOnDemandRightItems: 'battery,gust,uv,aqi,wind',
    batteryLowLevel: '10',
    batteryLowDisplay: 'icon'
  };
  (function () {
    for (var b = 1; b < BARS.length; b++) {
      for (var s = 0; s < SIDES.length; s++) {
        DEFAULTS[itemsKey(BARS[b].bar, SIDES[s])] = '';
      }
    }
  })();

  // The Battery item's warn level: what a stored level may be, and what anything else
  // reads as.
  var BATTERY_LEVEL_MIN = 5;
  var BATTERY_LEVEL_MAX = 30;
  var BATTERY_LEVEL_DEFAULT = 10;
  var BATTERY_DISPLAYS = ['icon', 'value'];

  /**
   * @param {*} code Candidate item code.
   * @returns {number} its ITEMS index (the OdItem), -1 for an unknown code
   */
  function itemIndex(code) {
    for (var i = 0; i < ITEMS.length; i++) {
      if (ITEMS[i].code === code) { return i; }
    }
    return -1;
  }

  /**
   * An items list as the canonical code array: unknown codes and duplicates dropped, in
   * ITEMS order.
   * @param {*} list A stored comma list ('bt,qt'); anything but a string is empty.
   * @returns {string[]} the codes
   */
  function parse(list) {
    var have = {};
    var parts = typeof list === 'string' ? list.split(',') : [];
    var out = [];
    var i;
    for (i = 0; i < parts.length; i++) { have[parts[i]] = true; }
    for (i = 0; i < ITEMS.length; i++) {
      if (have[ITEMS[i].code] === true) { out.push(ITEMS[i].code); }
    }
    return out;
  }

  /**
   * @param {string[]} codes Item codes.
   * @returns {string} their canonical comma list ('' for none)
   */
  function canonical(codes) { return parse((codes || []).join(',')).join(','); }

  /**
   * One setting, read the one way: the stored value while it is valid, else its default.
   * An absent key, a null S and a value of the wrong type all read the default, so a
   * partial settings blob reads the default ticks rather than "nothing placed". An items
   * key that is a string reads as its canonical list, so '' is a real "nothing ticked".
   * @param {Object} S Settings blob.
   * @param {string} key A DEFAULTS key.
   * @returns {*} the effective value
   */
  function read(S, key) {
    var v = S ? S[key] : undefined;
    if (/OnDemand(Left|Right)Items$/.test(key)) {
      return typeof v === 'string' ? parse(v).join(',') : DEFAULTS[key];
    }
    if (key === 'batteryLowLevel') {
      return (typeof v === 'string' || typeof v === 'number') ? v : DEFAULTS[key];
    }
    if (key === 'batteryLowDisplay') {
      return BATTERY_DISPLAYS.indexOf(v) >= 0 ? v : DEFAULTS[key];
    }
    return v === undefined ? DEFAULTS[key] : v;
  }

  /**
   * The facts this module reads off a platform env, with an omitted env (and an omitted
   * fact) reading as capable — the reading the render signature and the page's own
   * previews use. fineBattery is deliberately NOT capable by default: an unknown watch
   * reads the 10 % steps (batteryLevel).
   * @param {Object} [env] config-ui platform.js computeEnv() facts.
   * @returns {{onDemand: boolean, radar: boolean, health: boolean, fineBattery: boolean}}
   */
  function facts(env) {
    var e = env || {};
    return {
      onDemand: e.onDemand !== false,
      radar: e.radar !== false,
      health: e.health !== false,
      fineBattery: e.fineBattery === true
    };
  }

  /**
   * Whether a bar is on the watch at all: the Watch Status Bar and the forecast bar
   * always; the radar bar while the watch has the radar and radarMode draws a radar row;
   * the health bar while the watch has health and healthMode draws a health row
   * (view-cycle's RADAR_ROW_MODES / HEALTH_ROW_MODES).
   * @param {Object} S Settings blob.
   * @param {string} bar A BARS bar.
   * @param {Object} [env] Platform env (omitted = capable).
   * @returns {boolean}
   */
  function barExists(S, bar, env) {
    var f = facts(env);
    var s = S || {};
    if (bar === 'top' || bar === 'forecast') { return true; }
    if (bar === 'radar') { return f.radar && VC.RADAR_ROW_MODES.indexOf(s.radarMode) >= 0; }
    if (bar === 'health') { return f.health && VC.HEALTH_ROW_MODES.indexOf(s.healthMode) >= 0; }
    return false;
  }

  /**
   * The side of `bar` the watch shows an item on: the watch draws On demand, the bar
   * exists and the item is ticked there. Left wins an overlap, which only a hand-edited
   * blob can hold.
   * @param {Object} S Settings blob.
   * @param {string} bar A BARS bar.
   * @param {string} code An ITEMS code.
   * @param {Object} [env] Platform env (omitted = capable).
   * @returns {?string} 'left' | 'right', or null when the item does not show on that bar
   */
  function sideOf(S, bar, code, env) {
    if (!facts(env).onDemand || prefixOf(bar) === null || !barExists(S, bar, env)) { return null; }
    for (var s = 0; s < SIDES.length; s++) {
      if (parse(read(S, itemsKey(bar, SIDES[s]))).indexOf(code) >= 0) { return SIDES[s]; }
    }
    return null;
  }

  /**
   * @param {Object} S Settings blob.
   * @param {string} code An ITEMS code.
   * @param {Object} [env] Platform env (omitted = capable).
   * @returns {boolean} whether the item shows on any bar (sideOf)
   */
  function placedAnywhere(S, code, env) {
    for (var b = 0; b < BARS.length; b++) {
      if (sideOf(S, BARS[b].bar, code, env) !== null) { return true; }
    }
    return false;
  }

  /**
   * Tick one item on one side of a bar: the item joins the side's list in the canonical
   * order and leaves the bar's other side, since an item sits on one side of a bar.
   * Mutates S.
   * @param {Object} S Settings blob.
   * @param {string} bar A BARS bar.
   * @param {string} side 'left' | 'right'
   * @param {string} code An ITEMS code.
   * @returns {boolean} whether either list changed
   */
  function tickOn(S, bar, side, code) {
    var here = itemsKey(bar, side);
    var there = itemsKey(bar, otherSide(side));
    var before = [S[here], S[there]].join('|');
    S[here] = canonical(parse(read(S, here)).concat([code]));
    S[there] = canonical(parse(read(S, there)).filter(function (c) { return c !== code; }));
    return [S[here], S[there]].join('|') !== before;
  }

  /**
   * Take items off one side's list, which is written back in the canonical order. THE
   * write that unticks: the page's one-side-per-bar hook, its open-time heal and
   * untickEverywhere all go through it. Mutates S; a list that held none of them is left
   * as stored.
   * @param {Object} S Settings blob.
   * @param {string} key A side's items key (itemsKey).
   * @param {string[]} codes ITEMS codes to take off.
   * @returns {boolean} whether the list held any of them
   */
  function untickFrom(S, key, codes) {
    var list = parse(read(S, key));
    var kept = list.filter(function (c) { return codes.indexOf(c) < 0; });
    if (kept.length === list.length) { return false; }
    S[key] = kept.join(',');
    return true;
  }

  /**
   * Untick one item on every side of every bar. Mutates S; a list that never held the
   * item is left as stored.
   * @param {Object} S Settings blob.
   * @param {string} code An ITEMS code.
   * @returns {boolean} whether any list held it
   */
  function untickEverywhere(S, code) {
    var changed = false;
    for (var b = 0; b < BARS.length; b++) {
      for (var s = 0; s < SIDES.length; s++) {
        changed = untickFrom(S, itemsKey(BARS[b].bar, SIDES[s]), [code]) || changed;
      }
    }
    return changed;
  }

  /**
   * Radar mode 'Rain alert only' fetches the radar for the rain icon alone, so Rain
   * ticked on no bar that exists in that mode would spend radar calls on nothing. Unless
   * it already shows (placedAnywhere; the radar bar never exists in that mode), Rain is
   * ticked on the Watch Status Bar's left side, where the defaults put it (tickOn). THE
   * rule for
   * both the page entering the mode (reset-status-defaults.js forceRainOnDemand) and the
   * 1.24 upgrade (migrations/v1_24.js migrateOnDemand). Mutates S; any other radar mode
   * leaves it alone.
   * @param {Object} S Settings blob.
   * @param {Object} [env] Platform env (omitted = capable).
   * @returns {boolean} whether anything changed
   */
  function placeRainForCountdown(S, env) {
    if (!S || S.radarMode !== 'countdown' || placedAnywhere(S, 'rain', env)) { return false; }
    return tickOn(S, 'top', 'left', 'rain');
  }

  /**
   * The Battery item's effective warn level, THE rule for the page's slider, the card's
   * live text and the blob's byte 35: the stored level (batteryLowLevel) as an integer,
   * 10 when it is not a number or outside 5..30; then, unless the watch reports its charge
   * in 5 % steps (env.fineBattery, emery), rounded UP to the next 10 % step (5 -> 10,
   * 15 -> 20, 25 -> 30). The stored string is never rewritten.
   * @param {Object} S Settings blob.
   * @param {Object} [env] Platform env (omitted = 10 % steps).
   * @returns {number} 5..30
   */
  function batteryLevel(S, env) {
    var v = parseInt(read(S, 'batteryLowLevel'), 10);
    if (isNaN(v) || v < BATTERY_LEVEL_MIN || v > BATTERY_LEVEL_MAX) { v = BATTERY_LEVEL_DEFAULT; }
    return facts(env).fineBattery ? v : Math.ceil(v / 10) * 10;
  }

  /**
   * @param {Object} S Settings blob.
   * @returns {boolean} whether the Battery item's Look is Icon + value
   */
  function batteryShowsValue(S) { return read(S, 'batteryLowDisplay') === 'value'; }

  /**
   * The telemetry code: 40 characters, the bars in BARS order and within a bar the items
   * in ITEMS order. 'L'/'R' = ticked on a side of an existing bar, 'l'/'r' = ticked on a
   * bar the modes remove, '-' = not ticked. An untouched install reads 'RLLLLRRR-R'
   * followed by 30 '-'.
   * @param {Object} S Settings blob.
   * @param {Object} [env] Platform env (omitted = capable).
   * @returns {(string|undefined)} undefined on a watch without On demand (aplite)
   */
  function telemetryCode(S, env) {
    if (!facts(env).onDemand) { return undefined; }
    var out = '';
    for (var b = 0; b < BARS.length; b++) {
      var exists = barExists(S, BARS[b].bar, env);
      for (var i = 0; i < ITEMS.length; i++) {
        var ch = '-';
        for (var s = 0; s < SIDES.length && ch === '-'; s++) {
          if (parse(read(S, itemsKey(BARS[b].bar, SIDES[s]))).indexOf(ITEMS[i].code) >= 0) {
            ch = SIDES[s] === 'left' ? 'l' : 'r';
            if (exists) { ch = ch.toUpperCase(); }
          }
        }
        out += ch;
      }
    }
    return out;
  }

  /**
   * Fold away the retired side switches. A side used to be Enabled or Disabled on a key
   * of its own (status<Bar>OnDemand<Side>: 'on' | 'off', beside its items list); now a
   * side is on exactly while it ticks something. Only a development build ever stored
   * them, no release did. A side stored Disabled showed nothing, so its ticks go and it
   * stays showing nothing; then every switch key goes. Run on every boot by
   * clay-settings.js seedDefaults, before anything reads the blob; with the keys gone it
   * changes nothing. Mutates S.
   * @param {Object} S Settings blob.
   * @returns {boolean} whether anything changed
   */
  function retireSideSwitches(S) {
    var changed = false;
    if (!S) { return false; }
    for (var b = 0; b < BARS.length; b++) {
      for (var s = 0; s < SIDES.length; s++) {
        var items = itemsKey(BARS[b].bar, SIDES[s]);
        var key = items.replace(/Items$/, '');
        if (!Object.prototype.hasOwnProperty.call(S, key)) { continue; }
        if (S[key] === 'off') { S[items] = ''; }
        delete S[key];
        changed = true;
      }
    }
    return changed;
  }

  var api = {
    ITEMS: ITEMS,
    BARS: BARS,
    SIDES: SIDES,
    DEFAULTS: DEFAULTS,
    BATTERY_LEVEL_MIN: BATTERY_LEVEL_MIN,
    BATTERY_LEVEL_MAX: BATTERY_LEVEL_MAX,
    BATTERY_LEVEL_DEFAULT: BATTERY_LEVEL_DEFAULT,
    itemIndex: itemIndex,
    prefixOf: prefixOf,
    itemsKey: itemsKey,
    sideOfKey: sideOfKey,
    otherSide: otherSide,
    parse: parse,
    canonical: canonical,
    read: read,
    barExists: barExists,
    sideOf: sideOf,
    placedAnywhere: placedAnywhere,
    tickOn: tickOn,
    untickFrom: untickFrom,
    untickEverywhere: untickEverywhere,
    placeRainForCountdown: placeRainForCountdown,
    retireSideSwitches: retireSideSwitches,
    batteryLevel: batteryLevel,
    batteryShowsValue: batteryShowsValue,
    telemetryCode: telemetryCode
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (typeof window !== 'undefined') { window.OnDemand = api; }
})();
