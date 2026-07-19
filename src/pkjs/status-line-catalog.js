/**
 * Status-line item catalog: which items exist, where they may appear, and
 * how a stored selection resolves for packing. Shared by the pkjs baker
 * (status-lines.js) and the config page (slot dropdown options).
 *
 * LOCKSTEP: KINDS / ICONS / CAPS mirror src/c/appendix/status_line.h;
 * test/status-line-contract.test.js enforces it. ES5 only (aplite PKJS).
 */
(function() {
  var KINDS = {
    EMPTY: 0, TEXT: 1, LIVE_DATE: 2,
    LIVE_STEPS: 3, LIVE_HR: 4, LIVE_SLEEP: 5, LIVE_DISTANCE: 6, LIVE_WEEK: 7,
    LIVE_DISTANCE_MI: 8, LIVE_BATTERY: 9
  };
  var ICONS = {
    NONE: 0, DRAWN_SUN: 1, TEMP: 2, UV: 3, WIND: 4, GUST: 5,
    PRECIP: 6, STEPS: 7, SLEEP: 8, HR: 9, DISTANCE: 10, AQI: 11,
    POLLEN: 12
  };
  var CAPS = { LINE_MAX: 48, EDGE_TEXT_MAX: 8, MID_TEXT_MAX: 19 };

  var ITEMS = [
    { code: 'empty', label: 'Empty', kind: KINDS.EMPTY, icon: ICONS.NONE },
    { code: 'temp', label: 'Current temperature', kind: KINDS.TEXT, icon: ICONS.TEMP, category: 'weather' },
    { code: 'wind', label: 'Wind speed', kind: KINDS.TEXT, icon: ICONS.WIND, category: 'weather' },
    { code: 'gust', label: 'Wind gusts', kind: KINDS.TEXT, icon: ICONS.GUST, category: 'weather' },
    { code: 'precip_prob', label: 'Precipitation %', kind: KINDS.TEXT, icon: ICONS.PRECIP, needsRadarOff: true, category: 'weather' },
    { code: 'uv', label: 'UV index', kind: KINDS.TEXT, icon: ICONS.UV, category: 'weather' },
    { code: 'aqi', label: 'Air quality (AQI)', kind: KINDS.TEXT, icon: ICONS.AQI, category: 'weather' },
    { code: 'pollen', label: 'Pollen', kind: KINDS.TEXT, icon: ICONS.POLLEN, needsProvider: 'dwd', category: 'weather' },
    { code: 'sun', label: 'Sunrise/sunset', kind: KINDS.TEXT, icon: ICONS.DRAWN_SUN, category: 'weather' },
    { code: 'date', label: 'Date', kind: KINDS.LIVE_DATE, icon: ICONS.NONE, middleOnly: true, category: 'datelocation' },
    { code: 'week', label: 'Calendar week', kind: KINDS.LIVE_WEEK, icon: ICONS.NONE, notAplite: true, category: 'datelocation' },
    { code: 'city', label: 'City', kind: KINDS.TEXT, icon: ICONS.NONE, category: 'datelocation' },
    { code: 'steps', label: 'Steps', kind: KINDS.LIVE_STEPS, icon: ICONS.STEPS, needsHealth: true, category: 'health' },
    { code: 'distance', label: 'Walked distance', kind: KINDS.LIVE_DISTANCE, icon: ICONS.DISTANCE, needsHealth: true, category: 'health' },
    { code: 'hr', label: 'Heart rate', kind: KINDS.LIVE_HR, icon: ICONS.HR, needsHealth: true, emeryOnly: true, category: 'health' },
    { code: 'sleep', label: 'Sleep', kind: KINDS.LIVE_SLEEP, icon: ICONS.SLEEP, needsHealth: true, category: 'health' },
    { code: 'battery', label: 'Battery', kind: KINDS.LIVE_BATTERY, icon: ICONS.NONE, topRightOnly: true, category: 'battery' }
  ];

  // Dropdown grouping order + header labels (Part F). A category with no
  // available item for a slot emits no header, so gated items never leave an
  // orphan heading. 'battery' is populated by the battery item (top-right only).
  var CATEGORIES = [
    ['weather', 'Weather'], ['datelocation', 'Date and location'],
    ['health', 'Health'], ['battery', 'Battery']
  ];

  var LINES = [
    { id: 'forecast', wireKey: 'STATUS_LINE_1_UINT8',
      slots: ['statusForecastLeft', 'statusForecastMid', 'statusForecastRight'],
      defaults: { statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'sun' } },
    { id: 'radar', wireKey: 'STATUS_LINE_2_UINT8',
      slots: ['statusRadarLeft', 'statusRadarMid', 'statusRadarRight'],
      defaults: { statusRadarLeft: 'temp', statusRadarMid: 'city', statusRadarRight: 'sun' } },
    { id: 'top', wireKey: 'STATUS_LINE_3_UINT8',
      slots: ['statusTopLeft', 'statusTopMid', 'statusTopRight'],
      defaults: { statusTopLeft: 'empty', statusTopMid: 'date', statusTopRight: 'battery' } },
    { id: 'health', wireKey: 'STATUS_LINE_4_UINT8',
      slots: ['statusHealthLeft', 'statusHealthMid', 'statusHealthRight'],
      defaults: { statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' },
      emeryDefaults: { statusHealthLeft: 'steps', statusHealthMid: 'sleep', statusHealthRight: 'hr' } }
  ];

  /**
   * @param {string} code catalog item code
   * @returns {Object|null} the item definition
   */
  function byCode(code) {
    for (var i = 0; i < ITEMS.length; i++) {
      if (ITEMS[i].code === code) { return ITEMS[i]; }
    }
    return null;
  }

  /**
   * Phone-side availability gate. The watch never gates.
   * @param {Object} item catalog entry
   * @param {Object} settings Clay settings blob
   * @param {Object} env {color, round, platform, health, radar}
   * @param {Object} [slotCtx] {slotKey, position: 'left'|'mid'|'right'} of the
   *   slot being resolved; position-gated items are unavailable without it
   * @returns {boolean}
   */
  function itemAvailable(item, settings, env, slotCtx) {
    if (!item) { return false; }
    if (item.middleOnly && (!slotCtx || slotCtx.position !== 'mid')) { return false; }
    if (item.topRightOnly && (!slotCtx || slotCtx.slotKey !== 'statusTopRight')) { return false; }
    if (item.needsHealth) {
      if (!env || !env.health) { return false; }
      if (settings && settings.healthMode === 'off') { return false; }
    }
    if (item.emeryOnly && (!env || env.platform !== 'emery')) { return false; }
    // aplite renders the calendar-week slot from watch-side C that is compiled
    // out there (frozen image budget), so never offer it on aplite.
    if (item.notAplite && env && env.platform === 'aplite') { return false; }
    if (item.needsRadarOff && (!settings || settings.radarProvider !== 'disabled')) {
      return false;
    }
    if (item.needsProvider && (!settings || settings.provider !== item.needsProvider)) {
      return false;
    }
    return true;
  }

  /**
   * Option list for one slot dropdown: 'Empty' first, then available items per
   * category, minus codes selected in sibling slots and minus args.excludeCodes.
   * Multi-item categories emit a non-selectable header with
   * {disabled: true, groupHeader: true}; each child has
   * {groupChild: true, groupEnd: boolean}. Single-item categories collapse to
   * an ordinary two-element [label, code] tuple with no header.
   * @param {Object} settings Clay settings blob
   * @param {Object} env platform env
   * @param {Object} args {excludeKeys, excludeCodes, slotKey, position}
   * @returns {Array} [[label, code], ...] with optional grouping metadata
   */
  function slotOptions(settings, env, args) {
    args = args || {};
    var slotCtx = { slotKey: args.slotKey, position: args.position };
    var taken = {};
    var i;
    var keys = args.excludeKeys || [];
    for (i = 0; i < keys.length; i++) {
      var v = settings && settings[keys[i]];
      if (v && v !== 'empty') { taken[v] = true; }
    }
    var codes = args.excludeCodes || [];
    for (i = 0; i < codes.length; i++) { taken[codes[i]] = true; }
    var out = [['Empty', 'empty']];
    for (var c = 0; c < CATEGORIES.length; c++) {
      var children = [];
      for (i = 0; i < ITEMS.length; i++) {
        var item = ITEMS[i];
        if (item.category !== CATEGORIES[c][0] || taken[item.code]) { continue; }
        if (!itemAvailable(item, settings, env, slotCtx)) { continue; }
        children.push([item.label, item.code]);
      }
      if (!children.length) { continue; }
      if (children.length === 1) {
        out.push(children[0]);
        continue;
      }
      out.push([CATEGORIES[c][1], '__hdr_' + CATEGORIES[c][0],
        { disabled: true, groupHeader: true }]);
      for (i = 0; i < children.length; i++) {
        children[i][2] = { groupChild: true, groupEnd: i === children.length - 1 };
        out.push(children[i]);
      }
    }
    return out;
  }

  /**
   * @param {Object} settings Clay settings blob
   * @returns {string[]} the 12 effective slot codes (stored or line default)
   */
  function selectedCodes(settings) {
    var out = [];
    for (var l = 0; l < LINES.length; l++) {
      var line = LINES[l];
      for (var s = 0; s < line.slots.length; s++) {
        var key = line.slots[s];
        var v = settings && settings[key];
        out.push(v || line.defaults[key]);
      }
    }
    return out;
  }

  /**
   * @param {string} code catalog item code
   * @param {Object} settings Clay settings blob
   * @param {Object} env platform env
   * @param {Object} [slotCtx] {slotKey, position} of the slot being resolved
   * @returns {string} code if selectable and available, else 'empty'
   */
  function resolveSelection(code, settings, env, slotCtx) {
    if (!code || code === 'empty') { return 'empty'; }
    var item = byCode(code);
    if (!item || !itemAvailable(item, settings, env, slotCtx)) { return 'empty'; }
    return code;
  }

  /** @returns {string[]} the 12 configurable slot settings keys, line order */
  function allSlotKeys() {
    var out = [];
    for (var l = 0; l < LINES.length; l++) {
      for (var s = 0; s < LINES[l].slots.length; s++) {
        out.push(LINES[l].slots[s]);
      }
    }
    return out;
  }

  var api = {
    KINDS: KINDS, ICONS: ICONS, CAPS: CAPS, LINES: LINES,
    byCode: byCode, itemAvailable: itemAvailable, slotOptions: slotOptions,
    selectedCodes: selectedCodes, resolveSelection: resolveSelection,
    allSlotKeys: allSlotKeys
  };

  // Dual-context export - mirror the exact tail of src/pkjs/view-cycle.js.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.StatusLineCatalog = api;
  }
})();
