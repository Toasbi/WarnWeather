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
    LIVE_DISTANCE_MI: 8, LIVE_BATTERY: 9, LIVE_BATTERY_PCT: 10
  };
  var ICONS = {
    NONE: 0, DRAWN_SUN: 1, TEMP: 2, UV: 3, WIND: 4, GUST: 5,
    STEPS: 7, SLEEP: 8, HR: 9, DISTANCE: 10, AQI: 11,
    POLLEN: 12, COUNTDOWN: 13,
    // Text-only: no glyph exists for PRESSURE and the watch never loads one —
    // the id only discriminates pressure from city (both TEXT) on the wire so
    // each can carry its own bold mode (status_threshold.h).
    PRESSURE: 14,
    // Droplets. The glyph is optional (aplite ships none), but the id is not:
    // without one the dew slot would be TEXT + NONE and inherit city's bold mode.
    // Id 6 is a retired hole (STATUS_ICON_PRECIP, 3dae9f4) — never reuse it.
    DEWPOINT: 15,
    // The PHONE's battery, baked phone-side as "NN%" TEXT. One catalog item,
    // two glyphs: the baker swaps in PHONE_BATTERY_CHG while the phone charges,
    // so charging costs no wire field and no watch-side logic.
    PHONE_BATTERY: 16, PHONE_BATTERY_CHG: 17,
    // Text-only, exactly like PRESSURE: the no-icon phone-battery item never
    // loads a glyph, and the id exists so it does not arrive as TEXT + NONE and
    // inherit city's bold mode.
    PHONE_BATTERY_PLAIN: 18
  };
  var CAPS = { LINE_MAX: 48, EDGE_TEXT_MAX: 8, MID_TEXT_MAX: 19 };

  var ITEMS = [
    { code: 'empty', label: 'Empty', kind: KINDS.EMPTY, icon: ICONS.NONE },
    // Slashed like its neighbour 'Sunrise/sunset': one slot, two readings. It is the
    // only hint in the dropdown that this slot has a choice behind it — its edit sheet
    // picks actual, feels-like, or both — and without it the row reads as a fixed
    // reading and those modes go unfound. Reserved forms are out: the catalog's
    // parentheses mean a unit or source ('Air pressure (hPa)', 'Pollen (DWD)'), not a
    // list of modes.
    { code: 'temp', label: 'Temperature/feels like', kind: KINDS.TEXT, icon: ICONS.TEMP, category: 'weather' },
    { code: 'wind', label: 'Wind speed', kind: KINDS.TEXT, icon: ICONS.WIND, category: 'weather' },
    { code: 'gust', label: 'Wind gusts', kind: KINDS.TEXT, icon: ICONS.GUST, category: 'weather' },
    { code: 'pressure', label: 'Air pressure (hPa)', kind: KINDS.TEXT, icon: ICONS.PRESSURE, category: 'weather' },
    // No notAplite gate: the slot is plain phone-baked text everywhere, and the
    // lean aplite status-row twin returns NULL for an unknown icon id (reserving
    // zero width), so it simply renders without the droplets glyph.
    { code: 'dew', label: 'Dew point', kind: KINDS.TEXT, icon: ICONS.DEWPOINT, category: 'weather' },
    { code: 'uv', label: 'UV index', kind: KINDS.TEXT, icon: ICONS.UV, category: 'weather' },
    { code: 'aqi', label: 'Air quality (AQI)', kind: KINDS.TEXT, icon: ICONS.AQI, category: 'weather' },
    { code: 'pollen', label: 'Pollen (DWD)', kind: KINDS.TEXT, icon: ICONS.POLLEN, needsProvider: 'dwd', category: 'weather' },
    { code: 'sun', label: 'Sunrise/sunset', kind: KINDS.TEXT, icon: ICONS.DRAWN_SUN, category: 'weather' },
    { code: 'date', label: 'Date', kind: KINDS.LIVE_DATE, icon: ICONS.NONE, middleOnly: true, category: 'datelocation' },
    { code: 'week', label: 'Calendar week', kind: KINDS.LIVE_WEEK, icon: ICONS.NONE, category: 'datelocation' },
    { code: 'city', label: 'City', kind: KINDS.TEXT, icon: ICONS.NONE, category: 'datelocation' },
    { code: 'countdown', label: 'Date countdown', kind: KINDS.TEXT,
      icon: ICONS.COUNTDOWN, category: 'datelocation' },
    { code: 'steps', label: 'Steps', kind: KINDS.LIVE_STEPS, icon: ICONS.STEPS, needsHealth: true, category: 'health' },
    { code: 'distance', label: 'Walked distance', kind: KINDS.LIVE_DISTANCE, icon: ICONS.DISTANCE, needsHealth: true, category: 'health' },
    { code: 'hr', label: 'Heart rate', kind: KINDS.LIVE_HR, icon: ICONS.HR, needsHealth: true, needsHr: true, category: 'health' },
    { code: 'sleep', label: 'Sleep', kind: KINDS.LIVE_SLEEP, icon: ICONS.SLEEP, needsHealth: true, category: 'health' },
    { code: 'battery', label: 'Watch battery', kind: KINDS.LIVE_BATTERY, icon: ICONS.NONE, topRightOnly: true, category: 'battery' },
    { code: 'batteryPct', label: 'Watch battery percentage', kind: KINDS.LIVE_BATTERY_PCT, icon: ICONS.NONE, topRightOnly: true, notAplite: true, category: 'battery' },
    // The PHONE's battery: phone-baked TEXT, so unlike the watch items above it
    // is NOT corner-pinned — those sit top-right because that corner already
    // reads as the watch's battery, while these carry their own icon (or, for
    // the plain variant, deliberately none) and fit any slot.
    { code: 'phoneBattery', label: 'Phone battery', kind: KINDS.TEXT,
      icon: ICONS.PHONE_BATTERY, needsPhoneBattery: true, notAplite: true, category: 'battery' },
    { code: 'phoneBatteryPlain', label: 'Phone battery (no icon)', kind: KINDS.TEXT,
      icon: ICONS.PHONE_BATTERY_PLAIN, needsPhoneBattery: true, notAplite: true, category: 'battery' }
  ];

  // Dropdown grouping order + header labels (Part F). A category with no
  // available item for a slot emits no header, so gated items never leave an
  // orphan heading. 'battery' holds four items: the WATCH glyph item and the
  // watch "NN%" text item — both top-right only (the watch battery belongs in
  // the corner already read as its own), the "NN%" one additionally absent on
  // aplite — plus the two PHONE-battery items, which are selectable in any slot
  // but exist only where the phone can report its charge (needsPhoneBattery,
  // Android-only) and never on aplite. The labels carry the Watch/Phone
  // qualifier because all four otherwise read as "battery".
  var CATEGORIES = [
    ['weather', 'Weather'], ['datelocation', 'Date and location'],
    ['health', 'Health'], ['battery', 'Battery']
  ];

  var LINES = [
    { id: 'forecast', wireKey: 'STATUS_LINE_1_UINT8',
      slots: ['statusForecastLeft', 'statusForecastMid', 'statusForecastRight'],
      defaults: { statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'aqi' } },
    { id: 'radar', wireKey: 'STATUS_LINE_2_UINT8',
      slots: ['statusRadarLeft', 'statusRadarMid', 'statusRadarRight'],
      defaults: { statusRadarLeft: 'uv', statusRadarMid: 'wind', statusRadarRight: 'gust' } },
    { id: 'top', wireKey: 'STATUS_LINE_3_UINT8',
      slots: ['statusTopLeft', 'statusTopMid', 'statusTopRight'],
      defaults: { statusTopLeft: 'week', statusTopMid: 'date', statusTopRight: 'sun' } },
    { id: 'health', wireKey: 'STATUS_LINE_4_UINT8',
      slots: ['statusHealthLeft', 'statusHealthMid', 'statusHealthRight'],
      // Non-HR platforms (basalt/chalk/aplite): leave the middle empty and show
      // sleep on the right — matches the seed migrateStatusLineHealthDefaults
      // detects before upgrading HR-capable watches to the hr triple.
      defaults: { statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' },
      hrDefaults: { statusHealthLeft: 'steps', statusHealthMid: 'sleep', statusHealthRight: 'hr' } }
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
   * @param {Object} env {color, round, platform, health, radar, hr, phoneBattery}
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
    if (item.needsHr && (!env || !env.hr)) { return false; }
    // The phone's battery is readable only where the PKJS host exposes the
    // Battery Status API — Android's Chromium WebView, never iOS's
    // JavaScriptCore and never the emulator. env.phoneBattery carries that
    // answer (from the PHONE_BATTERY_SUPPORTED storage key). Like notAplite and
    // UNLIKE needsProvider, a false gate OMITS the item rather than showing a
    // disabled row: there is no setting the user could change to earn it.
    if (item.needsPhoneBattery && (!env || !env.phoneBattery)) { return false; }
    // Items whose watch-side C rendering is compiled out on aplite (frozen
    // image budget): batteryPct — the lean status-row twin never learned kind
    // 10, and aplite's glyph battery slot already renders as "NN%" text anyway
    // — and the two phone-battery items, which ship no aplite glyph at all.
    // (Calendar-week used this gate once — the watch-side iso_week() is
    // aplite-excluded — but the phone now bakes that slot as phone-side TEXT
    // for aplite instead; status-lines.js.)
    if (item.notAplite && env && env.platform === 'aplite') { return false; }
    // No catalog item sets needsRadarOff today; gate kept correct (radarMode-based) for when one does.
    if (item.needsRadarOff && (!settings || (settings.radarMode || 'graph') !== 'off')) {
      return false;
    }
    if (item.needsProvider && (!settings || settings.provider !== item.needsProvider)) {
      return false;
    }
    return true;
  }

  /**
   * True when the ONLY gate an item fails is needsProvider — i.e. itemAvailable
   * would answer true if the selected weather provider matched. slotOptions
   * keeps such an item visible as a DISABLED row (so the user learns the option
   * exists, e.g. "Pollen (DWD)" under another provider) instead of omitting it.
   * Selection-side callers (resolveSelection & co.) keep using itemAvailable,
   * which still treats a provider-mismatched code as unavailable.
   * @param {Object} item catalog entry
   * @param {Object} settings Clay settings blob
   * @param {Object} env platform env
   * @param {Object} [slotCtx] {slotKey, position} of the slot being resolved
   * @returns {boolean}
   */
  function itemAvailableExceptProvider(item, settings, env, slotCtx) {
    if (!item || !item.needsProvider) { return false; }
    var relaxed = Object.assign({}, settings || {}, { provider: item.needsProvider });
    return itemAvailable(item, relaxed, env, slotCtx);
  }

  /**
   * Option list for one slot dropdown: 'Empty' first, then available items per
   * category, minus args.excludeCodes. An item gated ONLY by the weather
   * provider stays in the list as a non-selectable row with {disabled: true}.
   * Multi-item categories emit a non-selectable header with
   * {disabled: true, groupHeader: true}; each child has
   * {groupChild: true, groupEnd: boolean}. Single-item categories collapse to
   * an ordinary two-element [label, code] tuple with no header.
   * @param {Object} settings Clay settings blob
   * @param {Object} env platform env
   * @param {Object} args {excludeCodes, slotKey, position}
   * @returns {Array} [[label, code], ...] with optional grouping metadata
   */
  function slotOptions(settings, env, args) {
    args = args || {};
    var slotCtx = { slotKey: args.slotKey, position: args.position };
    var taken = {};
    var i;
    var codes = args.excludeCodes || [];
    for (i = 0; i < codes.length; i++) { taken[codes[i]] = true; }
    var out = [['Empty', 'empty']];
    for (var c = 0; c < CATEGORIES.length; c++) {
      var children = [];
      for (i = 0; i < ITEMS.length; i++) {
        var item = ITEMS[i];
        if (item.category !== CATEGORIES[c][0]
            || (taken[item.code] && item.code !== 'countdown')) { continue; }
        if (!itemAvailable(item, settings, env, slotCtx)) {
          if (!itemAvailableExceptProvider(item, settings, env, slotCtx)) { continue; }
          children.push([item.label, item.code, { disabled: true }]);
          continue;
        }
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
        // Merge into any existing meta (a disabled provider-gated child) rather
        // than replacing it.
        var meta = children[i][2] || {};
        meta.groupChild = true;
        meta.groupEnd = i === children.length - 1;
        children[i][2] = meta;
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

  /**
   * The platform-aware default code for one slot: the HR flavor (hrDefaults) on a
   * watch with a heart-rate sensor, else the line's base default.
   * @param {string} slotKey slot settings key (e.g. 'statusHealthRight')
   * @param {Object} [env] platform env; env.hr selects the flavor
   * @returns {string|undefined} default item code, or undefined for an unknown slotKey
   */
  function slotDefault(slotKey, env) {
    for (var l = 0; l < LINES.length; l++) {
      var line = LINES[l];
      if (line.slots.indexOf(slotKey) === -1) { continue; }
      if (env && env.hr && line.hrDefaults) { return line.hrDefaults[slotKey]; }
      return line.defaults[slotKey];
    }
    return undefined;
  }

  /**
   * @param {string} slotKey Slot messageKey.
   * @returns {?Object} The LINES entry owning the slot, or null for non-slot keys.
   */
  function lineOf(slotKey) {
    for (var l = 0; l < LINES.length; l++) {
      if (LINES[l].slots.indexOf(slotKey) !== -1) { return LINES[l]; }
    }
    return null;
  }

  /**
   * Whether another slot of slotKey's own line already shows `code`. Non-slot
   * keys belong to no line and always answer false. THE row-sibling scan: the
   * wizard's policy guard, the availability resets and the pick-dedupe hook
   * all ask this instead of re-walking LINES themselves.
   * @param {Object} S Live settings state.
   * @param {string} slotKey Slot messageKey.
   * @param {*} code Candidate item code.
   * @returns {boolean} True when a same-line sibling holds it.
   */
  function siblingHolds(S, slotKey, code) {
    var line = lineOf(slotKey);
    if (!line) { return false; }
    for (var s = 0; s < line.slots.length; s++) {
      if (line.slots[s] !== slotKey && S[line.slots[s]] === code) { return true; }
    }
    return false;
  }

  /**
   * The per-kind "Show unit" toggles: settings key + shipped default, in ONE
   * table. Four consumers used to restate these pairs independently — the
   * baker's formatValue arms, schema.js's unitRow calls, resetStatusSlots'
   * key list, and renderSignature's — with nothing pinning the schema default
   * to the baker default. The six kinds are exactly the ones whose slot text
   * the PHONE bakes (the watch-formatted kinds would need the flag on the
   * wire); defaults are non-uniform on purpose: a kind that already printed
   // its unit ships ON, one that never did ships OFF.
   */
  var UNIT_TOGGLES = [
    { key: 'windSlotUnit', dflt: true },
    { key: 'gustSlotUnit', dflt: true },
    { key: 'pressureSlotUnit', dflt: true },
    { key: 'countdownSlotUnit', dflt: true },
    { key: 'tempSlotUnit', dflt: false },
    { key: 'dewSlotUnit', dflt: false }
  ];

  /**
   * @param {string} key A UNIT_TOGGLES settings key.
   * @returns {boolean} The toggle's shipped default (false for unknown keys).
   */
  function unitToggleDefault(key) {
    for (var i = 0; i < UNIT_TOGGLES.length; i++) {
      if (UNIT_TOGGLES[i].key === key) { return UNIT_TOGGLES[i].dflt; }
    }
    return false;
  }

  var api = {
    KINDS: KINDS, ICONS: ICONS, CAPS: CAPS, LINES: LINES,
    byCode: byCode, itemAvailable: itemAvailable, slotOptions: slotOptions,
    selectedCodes: selectedCodes, resolveSelection: resolveSelection,
    allSlotKeys: allSlotKeys, slotDefault: slotDefault,
    lineOf: lineOf, siblingHolds: siblingHolds,
    UNIT_TOGGLES: UNIT_TOGGLES, unitToggleDefault: unitToggleDefault
  };

  // Dual-context export - mirror the exact tail of src/pkjs/view-cycle.js.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.StatusLineCatalog = api;
  }
})();
