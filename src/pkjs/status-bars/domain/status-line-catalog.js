/**
 * Status-line item catalog: which items exist, where they may appear, and
 * how a stored selection resolves for packing. Shared by the pkjs baker
 * (status-lines.js) and the config page (slot dropdown options).
 *
 * LOCKSTEP: KINDS / ICONS / CAPS mirror src/c/appendix/status_line.h;
 * test/status-bars/domain/status-line-contract.test.js enforces it. ES5 only (aplite PKJS).
 */
(function() {
  // view-cycle.js requires nothing, so there is no cycle; in the flat settings page it is
  // concatenated ahead of this file (scripts/build-config-page.js APP_FILES).
  var VC = (typeof require !== 'undefined') ? require('../../layout/domain/view-cycle.js') : window.VIEW_CYCLE;
  var KINDS = {
    EMPTY: 0, TEXT: 1, LIVE_DATE: 2,
    LIVE_STEPS: 3, LIVE_HR: 4, LIVE_SLEEP: 5, LIVE_DISTANCE: 6, LIVE_WEEK: 7,
    LIVE_DISTANCE_MI: 8, LIVE_BATTERY: 9, LIVE_BATTERY_PCT: 10
  };
  /**
   * Whether a kind's slot carries value bytes: a text slot, and the watch battery as text,
   * into which the phone may bake the days the watch has left. Every other kind carries
   * none (status_line.h status_slot_kind_has_text, kept in lockstep by
   * test/status-bars/domain/status-line-contract.test.js).
   * @param {number} kind A KINDS value.
   * @returns {boolean}
   */
  function kindHasText(kind) {
    return kind === KINDS.TEXT || kind === KINDS.LIVE_BATTERY_PCT;
  }
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
    // The PHONE's battery, baked phone-side as "NN%" TEXT. Id 17 is a retired hole
    // (PHONE_BATTERY_CHG, the glyph of a phone that charges; the slot shows the charge
    // alone now) — never reuse it.
    PHONE_BATTERY: 16,
    // Text-only, exactly like PRESSURE: the phone battery in its Text look never
    // loads a glyph, and the id exists so it does not arrive as TEXT + NONE and
    // inherit city's bold mode.
    PHONE_BATTERY_PLAIN: 18,
    // The weather condition slot (weather/domain/condition.js): the glyph of the condition now,
    // picked per bake; COND_TEXT its text-only look, which
    // loads no glyph (and, like PRESSURE, keeps it off TEXT + NONE).
    COND_TEXT: 19, COND_SUN: 20, COND_MOON: 21, COND_SUN_CLOUD: 22, COND_MOON_CLOUD: 23,
    COND_CLOUD: 24, COND_FOG: 25, COND_HAZE: 26, COND_DRIZZLE: 27, COND_RAIN: 28,
    COND_SLEET: 29, COND_SNOW: 30, COND_HAIL: 31, COND_THUNDER: 32, COND_WIND: 33,
    // The watch battery's Icon + text look: on LIVE_BATTERY_PCT, the battery glyph the watch
    // draws in code before the charge, as it draws it alone for LIVE_BATTERY. A sentinel like
    // DRAWN_SUN: no drawing loads.
    DRAWN_BATTERY: 34,
    // Text-only, like PRESSURE: the Plugin value slot in its Text look, a value another app's
    // plugin serves. It loads no glyph and keeps the slot off TEXT + NONE, City's.
    PLUGIN_TEXT: 35,
    // The Plugin value slot's icons, before its text or alone (its Look; status_line.h
    // STATUS_ICON_PV_*). Each pair's off form while the value is off: Switch, Wi-Fi and
    // Bluetooth. Plug, Phone, Calendar and Tide stay the same. Like PLUGIN_TEXT, each takes the
    // Plugin value's bold kind and no other slot's short form.
    PV_SWITCH: 36, PV_SWITCH_OFF: 37, PV_WIFI: 38, PV_WIFI_OFF: 39, PV_BT: 40, PV_BT_OFF: 41,
    PV_PLUG: 42, PV_PHONE: 43, PV_CALENDAR: 44, PV_TIDE: 45
  };
  // A TEXT slot's short form rides after this byte (status_line.h STATUS_TEXT_ALT_SEP).
  var ALT_SEP = '\u001f';
  // The city's icon byte with the current weather's glyph: the glyph's id with this bit
  // (status_line.h STATUS_ICON_CITY_GLYPH), so the watch keeps the slot the city's.
  var CITY_GLYPH = 0x80;
  // EDGE_COND_TEXT_MAX: an edge slot's weather condition may take the middle slot's room, its
  // name with the short form after it, while the whole line still fits LINE_MAX
  // (widenEdges), so a side slot shows the whole name beside an empty or a short middle.
  var CAPS = { LINE_MAX: 48, EDGE_TEXT_MAX: 8, MID_TEXT_MAX: 19, EDGE_COND_TEXT_MAX: 19 };

  var ITEMS = [
    { code: 'empty', label: 'Empty', kind: KINDS.EMPTY, icon: ICONS.NONE },
    // Slashed like its neighbour 'Sunrise/sunset': one slot, two readings. It is the
    // only hint in the dropdown that this slot has a choice behind it — its edit sheet
    // picks actual, feels-like, or both — and without it the row reads as a fixed
    // reading and those modes go unfound. Reserved forms are out: the catalog's
    // parentheses mean a unit ('Air pressure (hPa)', 'Air quality (AQI)'), not a list of
    // modes.
    { code: 'temp', label: 'Temperature/feels like', kind: KINDS.TEXT, icon: ICONS.TEMP, category: 'weather' },
    { code: 'wind', label: 'Wind speed', kind: KINDS.TEXT, icon: ICONS.WIND, category: 'weather' },
    { code: 'gust', label: 'Wind gusts', kind: KINDS.TEXT, icon: ICONS.GUST, category: 'weather' },
    { code: 'pressure', label: 'Air pressure (hPa)', kind: KINDS.TEXT, icon: ICONS.PRESSURE, category: 'weather' },
    // No notAplite gate: the slot is plain phone-baked text everywhere, and the
    // lean aplite status-row twin returns NULL for an unknown icon id (reserving
    // zero width), so it simply renders without the droplets glyph.
    { code: 'dew', label: 'Dew point', kind: KINDS.TEXT, icon: ICONS.DEWPOINT, category: 'weather' },
    // No '/day max' suffix any more: the edit sheet's Now / Day max / Both pills pick
    // what prints, and wind, gusts and AQI carry the same modes without one either.
    { code: 'uv', label: 'UV index', kind: KINDS.TEXT, icon: ICONS.UV, category: 'weather' },
    { code: 'aqi', label: 'Air quality (AQI)', kind: KINDS.TEXT, icon: ICONS.AQI, category: 'weather' },
    // Every Provider has pollen: its pollen source follows the Provider (pollen-days.js sourceOf).
    { code: 'pollen', label: 'Pollen', kind: KINDS.TEXT, icon: ICONS.POLLEN, category: 'weather' },
    { code: 'sun', label: 'Sunrise/sunset', kind: KINDS.TEXT, icon: ICONS.DRAWN_SUN, category: 'weather' },
    // What the weather is like now (weather/domain/condition.js): its name, or its short form where
    // the slot is short of room, with the condition's glyph; the edit sheet's Look picks icon
    // and text, text alone or the icon alone. The baked icon varies (status-lines.js
    // iconFor); COND_TEXT is the id of the text-only look.
    { code: 'condition', label: 'Weather condition', kind: KINDS.TEXT, icon: ICONS.COND_TEXT, category: 'weather' },
    // Any position since custom layouts: the calendar can sit anywhere or be absent
    // now, so the date is a first-class slot like City (the middle-only gate was a
    // leftover from when it was hard-wired into the strip's centre; the watch's
    // SLOT_LIVE_DATE renderer never cared about position).
    { code: 'date', label: 'Date', kind: KINDS.LIVE_DATE, icon: ICONS.NONE, category: 'datelocation' },
    { code: 'week', label: 'Calendar week', kind: KINDS.LIVE_WEEK, icon: ICONS.NONE, category: 'datelocation' },
    // iconLabel: the slot lists' name on every watch that can draw the current weather's icon
    // before the city (every watch but aplite, which keeps the label), whether the icon is
    // switched on or off (citySlotIcon; slot-text.js cityIcon).
    { code: 'city', label: 'City', iconLabel: 'City with weather icon',
      kind: KINDS.TEXT, icon: ICONS.NONE, category: 'datelocation' },
    // repeatsInBar: what it shows is set in each slot of its own (the countdown's date,
    // countdownKey; the Plugin value's source, pluginValueKeys), so a bar may hold it in several
    // slots: picking it leaves a sibling's alone (page/status-bars/reset-status-defaults.js
    // dedupeStatusSlot), and the lists offer it beside one (slotOptions).
    { code: 'countdown', label: 'Date countdown', kind: KINDS.TEXT,
      icon: ICONS.COUNTDOWN, category: 'datelocation', repeatsInBar: true },
    { code: 'steps', label: 'Steps', kind: KINDS.LIVE_STEPS, icon: ICONS.STEPS, needsHealth: true, category: 'health' },
    { code: 'distance', label: 'Walked distance', kind: KINDS.LIVE_DISTANCE, icon: ICONS.DISTANCE, needsHealth: true, category: 'health' },
    { code: 'hr', label: 'Heart rate', kind: KINDS.LIVE_HR, icon: ICONS.HR, needsHealth: true, needsHr: true, category: 'health' },
    { code: 'sleep', label: 'Sleep', kind: KINDS.LIVE_SLEEP, icon: ICONS.SLEEP, needsHealth: true, category: 'health' },
    // The watch's own battery, one item with three looks (its dialog's Look,
    // slot-text.js batteryLook): the battery the watch draws (this entry's kind), its
    // charge as text, which the bake packs as LIVE_BATTERY_PCT (status-lines.js packLine)
    // and which can show the days the watch has left (battery-days.js), or both, the text
    // with the battery before it (ICONS.DRAWN_BATTERY). Until 3.3.0 the text look was an
    // item of its own, 'batteryPct'
    // (settings/domain/migrations/status-slots.js mergeBatterySlots). Any slot can hold it
    // (the owner's, 2026-11-23): until then only the top strip's right-hand corner could.
    // The watch refreshes every bar that shows it on a battery or Bluetooth change
    // (status_bar.c status_bar_system_changed). Aplite keeps the corner (topRightOnAplite):
    // its frozen twin repaints only the top strip on those changes. Its settings are the
    // item's own (batterySettingKeys), so every slot that holds it shows it alike.
    { code: 'battery', label: 'Watch battery', kind: KINDS.LIVE_BATTERY, icon: ICONS.NONE, topRightOnAplite: true,
      category: 'battery' },
    // The PHONE's battery: phone-baked TEXT. It carries its own icon (or, in its Text
    // look, deliberately none: slot-text.js phoneBatteryLook, status-lines.js iconFor)
    // and fits any slot. Its Look is each slot's own (phoneBatteryLookKey), so it can
    // show its icon in one slot and not in another. Until 3.3.0 the Text look was an
    // item of its own, 'phoneBatteryPlain'.
    { code: 'phoneBattery', label: 'Phone battery', kind: KINDS.TEXT,
      icon: ICONS.PHONE_BATTERY, needsPhoneBattery: true, notAplite: true, category: 'battery' },
    // A value another app's plugin serves (plugin-values.js), its source, Look and icon each
    // slot's own (pluginValueKeys), so each slot that holds it shows a value of its own. Its
    // icon is one of the watch's own, picked for it (plugin-values.js iconId): the watch draws
    // no plugin's picture. Only where the Pebble app reads plugins (needsPlugins), and never
    // on aplite, whose feature set is frozen.
    { code: 'pluginValue', label: 'Plugin value', kind: KINDS.TEXT, icon: ICONS.PLUGIN_TEXT,
      needsPlugins: true, notAplite: true, category: 'plugin', repeatsInBar: true }
  ];

  // Dropdown grouping order + header labels (Part F). A category with no
  // available item for a slot emits no header, so gated items never leave an
  // orphan heading. 'battery' holds two items: the WATCH's and the PHONE's, which
  // exists only where the phone can report its charge (needsPhoneBattery) and never on
  // aplite. The labels carry the Watch/Phone qualifier because both otherwise read as
  // "battery". Plugin comes first, right under Empty (the owner's, 2026-11-23).
  var CATEGORIES = [
    ['plugin', 'Plugin'], ['weather', 'Weather'], ['datelocation', 'Date and location'],
    ['health', 'Health'], ['battery', 'Battery']
  ];

  // A line's slots in order, as the slot context (resolveSelection, itemAvailable) names
  // them: each LINES entry's slots[i] is at SLOT_POSITIONS[i].
  var SLOT_POSITIONS = ['left', 'mid', 'right'];

  var LINES = [
    { id: 'forecast', wireKey: 'STATUS_LINE_1_UINT8',
      slots: ['statusForecastLeft', 'statusForecastMid', 'statusForecastRight'],
      // Sunrise/sunset on the right (the owner's, 2026-11-09: it swapped places with the top
      // row's air quality). An install from before keeps what it showed
      // (settings/domain/migrations/status-slots.js keepSlotDefaults27).
      defaults: { statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'sun' } },
    { id: 'radar', wireKey: 'STATUS_LINE_2_UINT8',
      slots: ['statusRadarLeft', 'statusRadarMid', 'statusRadarRight'],
      defaults: { statusRadarLeft: 'uv', statusRadarMid: 'wind', statusRadarRight: 'gust' } },
    { id: 'top', wireKey: 'STATUS_LINE_3_UINT8',
      slots: ['statusTopLeft', 'statusTopMid', 'statusTopRight'],
      // The strip beside the clock, and the one row on screen in EVERY view. Air quality
      // sits here, where every screen shows it (the owner's, 2026-11-09: it swapped places
      // with the Forecast bar's sunrise/sunset). emery's 200 px display has the width for
      // three readings: the week, the date and air quality in the right-hand corner. On
      // the 144/180 px platforms that corner is the battery, where the watch has long drawn
      // it, so air quality takes the left slot. An
      // install from before keeps what it showed (settings/domain/migrations/status-slots.js
      // keepSlotDefaults27).
      defaults: { statusTopLeft: 'aqi', statusTopMid: 'date', statusTopRight: 'battery' },
      emeryDefaults: { statusTopLeft: 'week', statusTopMid: 'date', statusTopRight: 'aqi' } },
    { id: 'health', wireKey: 'STATUS_LINE_4_UINT8',
      slots: ['statusHealthLeft', 'statusHealthMid', 'statusHealthRight'],
      // Non-HR platforms (basalt/aplite/flint): leave the middle empty and show
      // sleep on the right — matches the seed migrateStatusLineHealthDefaults
      // detects before upgrading HR-capable watches to the hr triple.
      defaults: { statusHealthLeft: 'steps', statusHealthMid: 'empty', statusHealthRight: 'sleep' },
      hrDefaults: { statusHealthLeft: 'steps', statusHealthMid: 'sleep', statusHealthRight: 'hr' } }
  ];

  // Bars 4 to 6 (Pebble Time 2, 3.0.0's New status bar: view-cycle.js EXTRA_BARS, whose prefixes they
  // take): their lines (STATUS_LINE_5..7_UINT8), every slot empty until New status bar writes its
  // starting set. Kept out of LINES, so every reader of the first four (the twelve selections,
  // telemetry, the 2.6 migration) stays as it is; the bake (bakedLines) adds one while a
  // screen shows the bar, and a slot key's lookups walk ALL_LINES.
  var EXTRA_LINES = VC.EXTRA_BARS.map(function (b, i) {
    var slots = [b.prefix + 'Left', b.prefix + 'Mid', b.prefix + 'Right'];
    var defaults = {};
    slots.forEach(function (key) { defaults[key] = 'empty'; });
    return { id: b.bar, wireKey: 'STATUS_LINE_' + (i + 5) + '_UINT8', slots: slots, defaults: defaults };
  });
  var ALL_LINES = LINES.concat(EXTRA_LINES);

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
   * @param {Object} env {color, platform, health, radar, hr, phoneBattery, plugins}
   * @param {Object} [slotCtx] {slotKey, position: 'left'|'mid'|'right'} of the
   *   slot being resolved; position-gated items are unavailable without it
   * @returns {boolean}
   */
  function itemAvailable(item, settings, env, slotCtx) {
    if (!item) { return false; }
    if (item.middleOnly && (!slotCtx || slotCtx.position !== 'mid')) { return false; }
    if (item.topRightOnAplite && env && env.platform === 'aplite'
            && (!slotCtx || slotCtx.slotKey !== 'statusTopRight')) {
        return false;
    }
    // Health items need the watch's health. Not healthMode: since 2.6 it follows the screens
    // and the slots (screens.js deriveModes), so a slot can pick a health item in any mode.
    if (item.needsHealth && (!env || !env.health)) { return false; }
    if (item.needsHr && (!env || !env.hr)) { return false; }
    // The phone's battery is readable only where the PKJS host has a source of it:
    // the Pebble app's Phone plugin, or the Battery Status API of Android's
    // Chromium WebView (phone-battery.js); never the emulator. env.phoneBattery carries that
    // answer (from the PHONE_BATTERY_SUPPORTED storage key). Like notAplite, a false
    // gate omits the item.
    if (item.needsPhoneBattery && (!env || !env.phoneBattery)) { return false; }
    // A value read from another app's plugin needs a Pebble app that reads plugins
    // (plugin-reader.js available): env.plugins, the page's from index.js, the bake's from its
    // facts (status-lines.js buildStatusLines). Omitted elsewhere, like the phone battery.
    if (item.needsPlugins && (!env || !env.plugins)) { return false; }
    // Items whose watch-side C rendering is compiled out on aplite (frozen
    // image budget): the phone battery, which ships no aplite glyph at all. (The
    // watch battery's text looks are not items: aplite's lean status-row twin never
    // learned kind 10, so its bake keeps the battery kind, which that twin prints as
    // "NN%" anyway. Calendar-week used this gate once — the watch-side iso_week() is
    // aplite-excluded — but the phone now bakes that slot as phone-side TEXT
    // for aplite instead; status-lines.js.)
    if (item.notAplite && env && env.platform === 'aplite') { return false; }
    // No catalog item sets needsRadarOff today; gate kept correct (radarMode-based) for when one does.
    if (item.needsRadarOff && (!settings || (settings.radarMode || 'graph') !== 'off')) {
      return false;
    }
    return true;
  }

  /**
   * An item's name in the slot lists: its iconLabel on every watch that can draw that icon
   * (switched on or off; never aplite), else its label.
   * @param {Object} item A catalog item.
   * @param {Object} env Platform env.
   * @returns {string}
   */
  function optionLabel(item, env) {
    return item.iconLabel && !(env && env.platform === 'aplite') ? item.iconLabel : item.label;
  }

  /**
   * Option list for one slot dropdown: 'Empty' first, then available items per
   * category, minus args.excludeCodes but an item a bar may repeat (repeatsInBar).
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
            || (taken[item.code] && !item.repeatsInBar)) { continue; }
        if (!itemAvailable(item, settings, env, slotCtx)) { continue; }
        children.push([optionLabel(item, env), item.code]);
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
   * The effective slot codes of every line the bake sends (bakedLines: the Watch bar's and
   * each bar a screen shows), answering each unset slot with the default the bake packs for
   * this watch (slotDefault with env: status-lines.js packLine). Its callers are fetch gates
   * (drawn-readings.js drawn, forecast-series.js's needsAqi / needsPollen, dayMaxInUse) asking whether a
   * code is on screen anywhere, and a flavor moves one of those: air quality sits in the top
   * row's corner on emery and in its left slot elsewhere. So a slot on a bar no screen shows
   * fetches nothing, and an unset slot fetches what the watch draws in it.
   * @param {Object} settings Clay settings blob
   * @param {?Object} [env] platform env (omitted: capable, the base flavor)
   * @returns {string[]} the effective slot codes (stored or line default), three per line
   */
  function selectedCodes(settings, env) {
    var out = [];
    var lines = bakedLines(settings, env);
    for (var l = 0; l < lines.length; l++) {
      var line = lines[l];
      for (var s = 0; s < line.slots.length; s++) {
        var key = line.slots[s];
        var v = settings && settings[key];
        out.push(v || slotDefault(key, env));
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

  /**
   * The lines the bake sends (status-lines.js), and so the ones whose slots the fetch gates
   * and the render signature read: the Watch bar's always, every other bar's while a screen
   * shows it (view-cycle.js barsShown, which shows a bar 4 to 6 only once made on a watch
   * that has them). The Watch bar is the exception because every watch can show it on any
   * screen: aplite has no screen without it, and the others bring it back in a Timeline
   * Quick View peek (the watch's layout_peek_spec). The Radar and Health bars also need a
   * watch that draws them, which aplite does not, whatever a settings blob from another
   * watch puts on its screens. A bar on no screen is sent no line, so the watch keeps the
   * last one it had (status_bar.c loads no row for it); the save that puts it on a screen
   * re-bakes at once (status-rebake.js) and fetches what its slots need (render-signature.js).
   * @param {Object} settings Clay settings blob
   * @param {?Object} [env] platform env (omitted: capable)
   * @returns {Array<Object>} LINES and EXTRA_LINES entries, in wire order
   */
  function bakedLines(settings, env) {
    var shown = VC.barsShown(settings, env);
    return ALL_LINES.filter(function (line) {
      if (line.id === 'top') { return true; }
      if ((line.id === 'radar' || line.id === 'health') && env && env[line.id] === false) { return false; }
      return Boolean(shown[line.id]);
    });
  }

  /**
   * @param {string} id A line's id (an on-demand.js BARS bar).
   * @returns {?Object} its LINES or EXTRA_LINES entry, null for none
   */
  function lineById(id) {
    for (var l = 0; l < ALL_LINES.length; l++) {
      if (ALL_LINES[l].id === id) { return ALL_LINES[l]; }
    }
    return null;
  }

  /**
   * @returns {string[]} Every bar's slot settings keys, the four bars' and bars 4 to 6's (21), in
   *   line order: the slots whose own settings and dialogs (pluginValueKeys, phoneBatterySheet)
   *   the page and the migrations go through.
   */
  function everySlotKey() {
    return ALL_LINES.reduce(function (keys, line) { return keys.concat(line.slots); }, []);
  }

  /**
   * The platform-aware default code for one slot: the emery flavor (emeryDefaults) on
   * the one display wide enough for it, the HR flavor (hrDefaults) on a watch with a
   * heart-rate sensor, else the line's base default. EVERY caller resolving a fresh
   * install's slot goes through here — the settings page (statusSlotDefault), the
   * per-row reset, and the phone's bake (status-lines.js packLine) — so a flavor added
   * to a line reaches all three at once.
   *
   * The two flavors sit on different lines (top and health), so no line carries both
   * and the order below is a tie-break nothing reaches today. Should one ever want
   * both, emery wins: it is the narrower condition.
   * @param {string} slotKey slot settings key (e.g. 'statusHealthRight')
   * @param {Object} [env] platform env; env.platform and env.hr select the flavor
   * @returns {string|undefined} default item code, or undefined for an unknown slotKey
   */
  function slotDefault(slotKey, env) {
    for (var l = 0; l < ALL_LINES.length; l++) {
      var line = ALL_LINES[l];
      if (line.slots.indexOf(slotKey) === -1) { continue; }
      if (env && env.platform === 'emery' && line.emeryDefaults) {
        return line.emeryDefaults[slotKey];
      }
      if (env && env.hr && line.hrDefaults) { return line.hrDefaults[slotKey]; }
      return line.defaults[slotKey];
    }
    return undefined;
  }

  /**
   * @param {string} slotKey Slot messageKey.
   * @returns {?Object} The LINES (or EXTRA_LINES) entry owning the slot, or null for
   *   non-slot keys.
   */
  function lineOf(slotKey) {
    for (var l = 0; l < ALL_LINES.length; l++) {
      if (ALL_LINES[l].slots.indexOf(slotKey) !== -1) { return ALL_LINES[l]; }
    }
    return null;
  }

  /**
   * @param {number} slotIndex A slot's place in its bar: 0 left, 1 middle, 2 right.
   * @returns {number} The most bytes of text a slot there prints (CAPS): the middle's the most.
   */
  function textCapAt(slotIndex) {
    return slotIndex === 1 ? CAPS.MID_TEXT_MAX : CAPS.EDGE_TEXT_MAX;
  }

  /**
   * @param {string} slotKey A slot's settings key.
   * @returns {number} The most bytes of text it prints (textCapAt): what a text row for the slot
   *   alone takes at most (plugin-value-schema.js, the Label).
   */
  function textCapOf(slotKey) {
    var line = lineOf(slotKey);
    return textCapAt(line ? line.slots.indexOf(slotKey) : 0);
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
   * The slots of a line that hold a health item, an absent slot read as its default (as
   * the bake reads it): the 2.6 modes' 'slot' rule (screens.js deriveModes) and the
   * migration's emptied slots (settings/domain/migrations/screens.js) ask this.
   * @param {Object} S Settings.
   * @param {string} lineId A LINES id.
   * @param {?Object} [env] Platform env (slotDefault's).
   * @returns {Array<string>} the slot keys
   */
  function healthSlots(S, lineId, env) {
    var line = lineById(lineId);
    return (line ? line.slots : []).filter(function (key) {
      var item = byCode((S || {})[key] || slotDefault(key, env));
      return Boolean(item && item.needsHealth);
    });
  }

  /**
   * The per-kind "Show unit" toggles: settings key + shipped default, in ONE
   * table. Four consumers used to restate these pairs independently — the
   * baker's formatValue arms, schema.js's unitRow calls, resetStatusSlots'
   * key list, and renderSignature's — with nothing pinning the schema default
   * to the baker default. The six kinds are exactly the ones whose slot text
   * the PHONE bakes (the watch-formatted kinds would need the flag on the
   * wire); defaults are non-uniform on purpose: a kind that already printed
   * its unit ships ON, one that never did ships OFF.
   *
   * `dflt` is what a fresh install and a reset get; `legacy`, where present, is
   * what a blob WITHOUT the key renders — the look from before the toggle
   * existed — and what clay-settings.js seedDefaults backfills into an existing
   * install, so a changed default never rearranges an upgrader's watch. Wind and
   * gusts ship OFF since 2.2.0 (their slots default to the Both pair, whose two
   * numbers leave the unit no room) but printed kph before, so they keep legacy ON.
   */
  var UNIT_TOGGLES = [
    { key: 'windSlotUnit', dflt: false, legacy: true },
    { key: 'gustSlotUnit', dflt: false, legacy: true },
    { key: 'pressureSlotUnit', dflt: true },
    { key: 'countdownSlotUnit', dflt: true },
    { key: 'tempSlotUnit', dflt: false },
    { key: 'dewSlotUnit', dflt: false }
  ];

  /**
   * @param {string} key A UNIT_TOGGLES settings key.
   * @returns {?Object} Its UNIT_TOGGLES entry, null for an unknown key.
   */
  function unitToggle(key) {
    for (var i = 0; i < UNIT_TOGGLES.length; i++) {
      if (UNIT_TOGGLES[i].key === key) { return UNIT_TOGGLES[i]; }
    }
    return null;
  }

  /**
   * @param {string} key A UNIT_TOGGLES settings key.
   * @returns {boolean} The toggle's shipped default (false for unknown keys).
   */
  function unitToggleDefault(key) {
    var t = unitToggle(key);
    return t ? t.dflt : false;
  }

  /**
   * What a settings blob WITHOUT the key renders: the toggle's legacy value where it
   * has one (a default changed after the key shipped), else its shipped default.
   * @param {string} key A UNIT_TOGGLES settings key.
   * @returns {boolean} false for unknown keys.
   */
  function unitToggleAbsent(key) {
    var t = unitToggle(key);
    if (!t) { return false; }
    return typeof t.legacy === 'boolean' ? t.legacy : t.dflt;
  }

  /**
   * The slot kinds with a day max (the Now / Day max / Both pills), and the settings
   * each owns on its Edit sheet: kind + suffix, e.g. 'windSlotOrder'. ONE table
   * for the keys schema.js' dayMaxRows builds, resetStatusSlots clears and
   * renderSignature watches, so a new kind or pair setting cannot be left out of
   * one of them.
   */
  var DAY_MAX_KINDS = ['uv', 'wind', 'gust', 'aqi'];
  var DAY_MAX_SUFFIXES = ['SlotDisplay', 'SlotSeparator', 'SlotSeparatorCustom',
    'SlotSeparatorSpaced', 'SlotOrder', 'SlotNextDayMark'];

  /**
   * @returns {string[]} Every day-max kind's Edit-sheet settings keys.
   */
  function dayMaxSettingKeys() {
    var out = [];
    for (var k = 0; k < DAY_MAX_KINDS.length; k++) {
      for (var s = 0; s < DAY_MAX_SUFFIXES.length; s++) {
        out.push(DAY_MAX_KINDS[k] + DAY_MAX_SUFFIXES[s]);
      }
    }
    return out;
  }

  /**
   * The settings the watch battery owns: its Look, what its text shows and how its pair
   * reads (slot-text.js batteryLook, battery-days.js). The item's own, so every slot that
   * holds it shows it alike. ONE list for the rows schema.js builds, the keys
   * resetStatusSlots clears and the ones renderSignature watches (every one of them is baked
   * into the line).
   * @returns {string[]}
   */
  function batterySettingKeys() {
    return ['batterySlotLook', 'batterySlotDisplay', 'batterySlotOrder', 'batterySlotSeparator',
      'batterySlotSeparatorCustom', 'batterySlotSeparatorSpaced'];
  }

  // The settings a slot keeps for the Plugin value, by part, each the slot's key with this after
  // it: the plugin, the value of it, which of its source's instances, its Look, its icon, the
  // label it prints for a value that is on or off, and how often it is read (plugin-values.js
  // pickOf). ONE table for each slot's keys (pluginValueKeys) and the list of them
  // (pluginValueKeyList).
  var PLUGIN_VALUE_PARTS = { plugin: 'PluginValuePlugin', id: 'PluginValueId', instance: 'PluginValueInstance',
    look: 'PluginValueLook', icon: 'PluginValueIcon', label: 'PluginValueLabel', every: 'PluginValueEvery' };

  /**
   * The settings a slot keeps for the Plugin value (PLUGIN_VALUE_PARTS), which the slot's own
   * dialog stores (plugin-value-schema.js). Each slot's own, like its countdown's date, so each
   * slot that holds the item shows a value of its own. Never signed (renderSignature,
   * slotCompanions): a new source needs a read, which the save starts (plugin-value-source.js
   * refresh), and no weather fetch; every close of the settings sends the bars again
   * (channel-scheduler.js onConfigClosed), the icon with them.
   * @param {string} slotKey A slot's settings key, e.g. 'statusForecastLeft'.
   * @returns {{plugin: string, id: string, instance: string, look: string, icon: string,
   *   label: string, every: string}} Each one's key, e.g. 'statusForecastLeftPluginValuePlugin'.
   */
  function pluginValueKeys(slotKey) {
    var keys = {};
    Object.keys(PLUGIN_VALUE_PARTS).forEach(function (part) { keys[part] = slotKey + PLUGIN_VALUE_PARTS[part]; });
    return keys;
  }

  /**
   * @param {string} slotKey A slot's settings key.
   * @returns {string[]} The slot's Plugin value settings keys (pluginValueKeys), each once: what
   *   Reset and a bar that is made or deleted put back (slotCompanions).
   */
  function pluginValueKeyList(slotKey) {
    var keys = pluginValueKeys(slotKey);
    return Object.keys(keys).map(function (part) { return keys[part]; });
  }

  /**
   * The settings page's dialog of an item a slot's Edit button opens: the slot's own where the
   * item's settings in it are (pluginValueKeys, phoneBatteryLookKey), since a dialog cannot tell
   * which slot opened it.
   * @param {string} item The item's part of the id, e.g. 'PluginValue'.
   * @param {string} slotKey A slot's settings key, e.g. 'statusForecastLeft'.
   * @returns {string} The dialog's sheet id, e.g. 'threshPluginValueForecastLeft'.
   */
  function slotSheet(item, slotKey) {
    return 'thresh' + item + slotKey.replace(/^status/, '');
  }

  /**
   * The settings page's dialog a slot's Edit button opens while the slot holds the Plugin value
   * (slotSheet): the slot's own, since its settings are (pluginValueKeys).
   * @param {string} slotKey A slot's settings key, e.g. 'statusForecastLeft'.
   * @returns {string} The dialog's sheet id, e.g. 'threshPluginValueForecastLeft'.
   */
  function pluginValueSheet(slotKey) {
    return slotSheet('PluginValue', slotKey);
  }

  /**
   * The setting a slot keeps its countdown's target date in (status-lines.js): the slot's
   * own, so each countdown slot counts down to its own day.
   * @param {string} slotKey A slot's settings key, e.g. 'statusForecastLeft'.
   * @returns {string}
   */
  function countdownKey(slotKey) {
    return slotKey + 'Countdown';
  }

  /**
   * The setting a slot keeps its phone battery's Look in (slot-text.js phoneBatteryLook): the
   * slot's own, like its countdown date, so the phone battery can show its icon in one slot
   * and not in another.
   * @param {string} slotKey A slot's settings key, e.g. 'statusForecastLeft'.
   * @returns {string}
   */
  function phoneBatteryLookKey(slotKey) {
    return slotKey + 'PhoneBatteryLook';
  }

  /**
   * The settings page's dialog a slot's Edit button opens while the slot holds the phone
   * battery (slotSheet): the slot's own, since the Look in it is (phoneBatteryLookKey). The page
   * builds one per slot (schema.js phoneBatterySlotSheet) and the Edit button names it (blocks.js
   * statusSlotEditSheet).
   * @param {string} slotKey A slot's settings key, e.g. 'statusForecastLeft'.
   * @returns {string} The dialog's sheet id, e.g. 'threshPhoneBatteryForecastLeft'.
   */
  function phoneBatterySheet(slotKey) {
    return slotSheet('PhoneBattery', slotKey);
  }

  // The phone battery's Look in a slot that has none set: the phone's icon before its charge
  // (the Look row's default, schema.js phoneBatterySlotSheet; slot-text.js phoneBatteryLook
  // reads anything but 'text' as it too).
  var PHONE_BATTERY_LOOK_DEFAULT = 'both';

  /**
   * What a slot keeps beside its item: a setting of the slot's own that one item reads, its
   * countdown's date (status-lines.js), its phone battery's Look and its Plugin value's
   * settings (pluginValueKeys). ONE list for what a bar that is made or deleted puts back on its
   * default with the slot (screens.js makeBar, unmakeBar), what Reset status bars puts back but
   * the countdown's date (blocks.js resetStatusSlots) and what renderSignature watches while the
   * slot holds the item (signSlots), the Plugin value's settings but (pluginValueKeys says why).
   * @param {string} slotKey A slot's settings key.
   * @returns {Array<{code: string, key: string, defaultValue: (string|undefined), signed: boolean}>}
   *   Each companion's item, settings key and the value it starts on: the Look's default, which
   *   its row marks as picked; none for the countdown's date, which its row and the bake read as
   *   today, nor for the Plugin value's, which read as no plugin, no icon, no label and the
   *   Updates default. signed: whether renderSignature watches it.
   */
  function slotCompanions(slotKey) {
    return [
      { code: 'countdown', key: countdownKey(slotKey), defaultValue: undefined, signed: true },
      { code: 'phoneBattery', key: phoneBatteryLookKey(slotKey), defaultValue: PHONE_BATTERY_LOOK_DEFAULT,
        signed: true }
    ].concat(pluginValueKeyList(slotKey).map(function (key) {
      return { code: 'pluginValue', key: key, defaultValue: undefined, signed: false };
    }));
  }

  /**
   * Whether a day-max kind's slot needs its day peaks: it sits in a status slot
   * whose display mode prints one. The slot half of the fetch gate — the metric
   * alerts, which judge the day whatever any slot shows, join it in
   * forecast-series.js dayPeakCodes, so this catalog stays alert-agnostic.
   * @param {Object} settings Clay settings blob.
   * @param {string} kind A DAY_MAX_KINDS entry.
   * @param {?Object} [env] platform env (omitted: capable)
   * @returns {boolean}
   */
  function dayMaxInUse(settings, kind, env) {
    if (!settings) { return false; }
    var mode = settings[kind + 'SlotDisplay'];
    return (mode === 'max' || mode === 'both') && selectedCodes(settings, env).indexOf(kind) !== -1;
  }

  /**
   * Which edge slots take their weather condition's wide value, its name with the short form
   * at the middle slot's room: the left first, then the right, each where the whole line still
   * fits CAPS.LINE_MAX with it. The bake (status-lines.js widenEdgeConditions) and the settings
   * page's pictures (preview-status-bars.js barSlots) both decide by it.
   * @param {number[]} sizes Each of the three slots' bytes on the wire as packed, its header
   *     included.
   * @param {Array<?number>} wideSizes An edge slot's bytes with its wide value, by slot index;
   *     not a number where the slot has none.
   * @returns {boolean[]} Whether each slot takes its wide value.
   */
  function widenEdges(sizes, wideSizes) {
    var take = [false, false, false];
    var total = sizes[0] + sizes[1] + sizes[2];
    [0, 2].forEach(function (s) {
      if (typeof wideSizes[s] !== 'number') { return; }
      var grown = total - sizes[s] + wideSizes[s];
      if (grown <= CAPS.LINE_MAX) {
        take[s] = true;
        total = grown;
      }
    });
    return take;
  }

  var api = {
    KINDS: KINDS, kindHasText: kindHasText, ICONS: ICONS, CAPS: CAPS, ALT_SEP: ALT_SEP, CITY_GLYPH: CITY_GLYPH, LINES: LINES,
    widenEdges: widenEdges,
    SLOT_POSITIONS: SLOT_POSITIONS,
    EXTRA_LINES: EXTRA_LINES, ALL_LINES: ALL_LINES, lineById: lineById, bakedLines: bakedLines,
    byCode: byCode, itemAvailable: itemAvailable, slotOptions: slotOptions,
    selectedCodes: selectedCodes, resolveSelection: resolveSelection,
    everySlotKey: everySlotKey, slotDefault: slotDefault,
    lineOf: lineOf, textCapAt: textCapAt, textCapOf: textCapOf, siblingHolds: siblingHolds, healthSlots: healthSlots,
    UNIT_TOGGLES: UNIT_TOGGLES, unitToggleDefault: unitToggleDefault,
    unitToggleAbsent: unitToggleAbsent,
    DAY_MAX_KINDS: DAY_MAX_KINDS, dayMaxSettingKeys: dayMaxSettingKeys, dayMaxInUse: dayMaxInUse,
    batterySettingKeys: batterySettingKeys, pluginValueKeys: pluginValueKeys,
    pluginValueKeyList: pluginValueKeyList,
    pluginValueSheet: pluginValueSheet,
    countdownKey: countdownKey,
    phoneBatteryLookKey: phoneBatteryLookKey, phoneBatterySheet: phoneBatterySheet,
    PHONE_BATTERY_LOOK_DEFAULT: PHONE_BATTERY_LOOK_DEFAULT, slotCompanions: slotCompanions
  };

  // Dual-context export - mirror the exact tail of src/pkjs/layout/domain/view-cycle.js.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.StatusLineCatalog = api;
  }
})();
