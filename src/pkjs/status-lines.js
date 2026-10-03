/**
 * Bakes the four packed status-line snapshots into the weather payload.
 * Pure: reads only the payload + settings + watchInfo passed in -- never
 * mutable provider instance fields. ES5 only (aplite PKJS).
 */
var catalog = require('./status-line-catalog.js');
var platformLib = require('./config-ui/lib/platform.js');
var statusWire = require('./status-wire.js');
var pressurePlausibility = require('./weather/pressure-plausibility.js');
var isPolarSunPair = require('./weather/sun-events.js').isPolarSunPair;
var statusPair = require('./status-pair.js');
var slotText = require('./slot-text.js');
var wireUnits = require('./wire-units.js');
var cityLadder = require('./city-ladder.js');
var onDemand = require('./on-demand.js');

// Slot positions by index, the catalog's slot-context vocabulary.
var POSITIONS = ['left', 'mid', 'right'];

// utf8.js owns the byte engine (clay-payload's string cap shares it). The
// local names survive as aliases: encode for the wire byte arrays the watch
// renders, and a bytes-in/bytes-out truncate for packLine's pre-encoded path.
var utf8 = require('./utf8.js');
var utf8Encode = utf8.encode;

/**
 * Truncate a UTF-8 byte array at a code-point boundary.
 * @param {number[]} bytes
 * @param {number} cap
 * @returns {number[]}
 */
function utf8Truncate(bytes, cap) {
  if (bytes.length <= cap) { return bytes; }
  var end = cap;
  while (end > 0 && (bytes[end] & 0xC0) === 0x80) { end--; }
  return bytes.slice(0, end);
}

/**
 * @param {number[]} bytes
 * @param {number} off
 * @returns {number} signed little-endian int32
 */
function readInt32LE(bytes, off) {
  // >> 0 keeps the sign; epochs fit int32 until 2038 like the C side.
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) |
          (bytes[off + 3] << 24)) >> 0;
}

/**
 * Null for the polar day/night pair too: its two events only tell the watch
 * how to shade the chart, and neither is a real sunrise or sunset time.
 * @param {number[]} sunEvents packed SUN_EVENTS wire bytes
 * @returns {{startType: number, epoch: number}|null} the next sun event
 */
function decodeFirstSunEvent(sunEvents) {
  if (!sunEvents || sunEvents.length < 5) { return null; }
  var epoch = readInt32LE(sunEvents, 1);
  if (sunEvents.length >= 9 && isPolarSunPair(epoch, readInt32LE(sunEvents, 5))) { return null; }
  return { startType: sunEvents[0], epoch: epoch };
}

/**
 * Compact clock string for the sun slot (slot-text.js clockText, the settings
 * page's preview's too).
 * @param {number} epoch Unix epoch seconds
 * @param {Object} settings Clay settings blob
 * @returns {string} e.g. "17:04", "5:04p", or "05:04p"
 */
function formatSunTime(epoch, settings) {
  var d = new Date(epoch * 1000);
  return slotText.clockText(d.getHours(), d.getMinutes(), settings);
}

// First trend value or null — shared with status-wire's displayValue
// through wire-units, so the two read a trend identically.
var trendHead = wireUnits.trendHead;

// The unit, fit and two-value rules every phone-baked slot prints by — shared with
// the settings page's status bars preview (slot-text.js).
var DEGREE = slotText.DEGREE;
var unitEnabled = slotText.unitEnabled;
var withUnit = slotText.withUnit;
var formatTemp = slotText.formatTemp;
var formatCountdown = slotText.formatCountdown;
var isoWeek = slotText.isoWeek;

/**
 * The phone's cached battery reading, or null when there is none.
 *
 * Required LAZILY, not at the top of this module, because the require chain
 * loops back here: phone-battery.js requires status-rebake.js, which requires
 * THIS module (a battery event re-runs buildStatusLines over the stashed bake
 * inputs so the new value reaches the watch without a fetch). THIS module is
 * the one mid-load when that chain would close (forecast-series requires it
 * before status-rebake), so a top-level require here would make status-rebake
 * capture status-lines' still-empty exports — killing every battery re-bake
 * with a TypeError inside resendStatus.
 *
 * The typeof guard is deliberate rather than paranoid: this runs inside the bake
 * for ALL FOUR status lines, so a phone-battery module that cannot answer has to
 * degrade this ONE slot to '--' instead of throwing and taking the whole status
 * bar down with it.
 *
 * @returns {{available: boolean, level: (number|null), charging: boolean}|null}
 *   the cached EXACT percentage and charging flag; `available` is false until a
 *   real reading has landed, and null only if the module cannot answer at all
 */
function phoneBatteryReading() {
  var mod = require('./phone-battery.js');
  return typeof mod.read === 'function' ? mod.read() : null;
}

/**
 * Whether this PKJS host can read the phone's battery at all -- the persisted
 * PHONE_BATTERY_SUPPORTED detector result, true only inside Android's Chromium
 * WebView. See phoneBatteryReading for why the require is lazy and guarded.
 * @returns {boolean}
 */
function phoneBatterySupported() {
  var mod = require('./phone-battery.js');
  return typeof mod.isSupported === 'function' ? Boolean(mod.isSupported()) : false;
}

/**
 * Format one catalog item's display text from the payload.
 * @param {string} code catalog item code (TEXT kinds only)
 * @param {Object} payload weather payload (pre-transform)
 * @param {Object} settings Clay settings blob
 * @param {string} slotKey Owning status-slot settings key.
 * @param {number} [cap] The slot's byte cap; defaults to the narrow edge cap.
 *   Only the per-kind unit and the two-value pairs' fit rule (status-pair.js)
 *   consult it -- the value itself is still truncated by the caller, which owns
 *   the wire.
 * @param {?Object} [dayMax] A day-max kind's pick, wireUnits.dayMaxShown -- packLine
 *   reads it once per slot for the text and the arrow; absent = read here.
 * @param {?{text: string, nextDay: boolean, mark: *}} [alert] The weather alert of
 *   this slot's metric that it merged (packLine's mergedAlert, its mark the one a
 *   tomorrow value takes here): the slot shows both values once
 *   (status-pair.js mergeAlert). Absent = none.
 * @param {Object} [env] Platform environment: a wind or gust slot keeps a byte free
 *   for the direction arrow only where packLine will draw one (arrowSector).
 *   Absent = a watch with the arrow (not aplite).
 * @returns {string} display text, '--' when the value is unavailable
 */
function formatValue(code, payload, settings, slotKey, cap, dayMax, alert, env) {
  var v;
  if (code === 'countdown') {
    return formatCountdown(settings && slotKey
      ? settings[slotKey + 'Countdown'] : undefined, undefined,
      unitEnabled(settings, 'countdownSlotUnit'), cap);
  }
  if (code === 'temp') {
    if (typeof payload.CURRENT_TEMP !== 'number') { return '--'; }
    // The Value selection (temp slot's Edit sheet; absent = 'actual') and the degree
    // (Show unit, off by default) are independent: slot-text.js tempText puts the
    // degree on every reading it prints, a pair's on both ('12°|10°') while that
    // pair still fits the slot. A missing/null FEELS_CURRENT (stale pre-upgrade
    // cache, provider gap) falls back to the actual temp alone in every mode.
    return slotText.tempText(formatTemp(payload.CURRENT_TEMP, settings),
      typeof payload.FEELS_CURRENT === 'number' ? formatTemp(payload.FEELS_CURRENT, settings) : null,
      settings, cap);
  }
  if (code === 'city') { return payload.CITY || '--'; }
  if (code === 'sun') {
    var ev = decodeFirstSunEvent(payload.SUN_EVENTS);
    return ev ? formatSunTime(ev.epoch, settings) : '--';
  }
  if (wireUnits.isDayMaxKind(code)) {
    // The day-max kinds' global per-kind display mode (each kind's Edit sheet),
    // the temp slot's pattern: absent = 'current'. 'max' is the day's peak
    // (wire-units' dayMaxShown): today's while it is ahead or running, then
    // tomorrow's once the reading drops below it, carrying the user's next-day
    // mark; 'both' pairs the two in the user's order and separator. The text is
    // status-pair's -- absent settings = current first, slash, '»' mark: 3/7,
    // 5/»6. No peak ahead known falls back to the current reading alone, never
    // '3/--'. UV and AQI are bare (their icon carries the context); wind and
    // gusts append their unit label when the whole text still fits ('12/30kph').
    var shown = typeof dayMax === 'undefined'
      ? wireUnits.dayMaxShown(code, payload, settings) : dayMax;
    // A merged alert's value joins what the slot shows (null: it adds nothing).
    var merged = alert ? statusPair.mergeAlert(code, shown, alert, settings, cap) : null;
    if (!shown && merged === null) { return '--'; }
    // The unit gives way to the direction arrow (packLine appends it after the
    // text, only into a free byte): '12/30' + arrow, never '12/30kph' without one.
    // Only to an arrow packLine will draw -- none on aplite or without a bearing.
    return slotText.dayMaxText(code, shown, merged, settings, cap,
      arrowSector(code, payload, settings, env || {}, shown) !== 0);
  }
  if (code === 'pressure') {
    v = trendHead(payload.PRESSURE_TREND);
    // Five of six providers zero-fill an unreported hour rather than null-filling
    // it, so a v of 0 is not a real reading -- the same plausibility window the
    // graph line uses (forecast-series.pressurePermille) applies here too, or a
    // zero-filled current hour would print as the bogus "0hPa".
    if (v === null || !pressurePlausibility.isPlausiblePressure(v)) { return '--'; }
    // Unit on by default, unlike temp/uv/aqi: those have an icon to carry their
    // context and this deliberately ships without one, so the text says what it is.
    return withUnit(String(Math.round(v)),
      unitEnabled(settings, 'pressureSlotUnit') ? 'hPa' : '', cap);
  }
  if (code === 'dew') {
    v = trendHead(payload.DEW_TREND);
    // Bare by default: the droplets icon carries the "dew point" context, the
    // temp / UV / AQI convention. formatTemp is the temperature slot's own
    // converter, so both slots follow temperatureUnits through identical
    // rounding -- and both take the same opt-in degree. Unsourced (a provider
    // that omits it, e.g. Yandex) degrades to '--' like pressure.
    return v === null ? '--' : withUnit(formatTemp(v, settings),
      unitEnabled(settings, 'dewSlotUnit') ? DEGREE : '', cap);
  }
  if (code === 'pollen') {
    var band = payload.POLLEN_TODAY === null || typeof payload.POLLEN_TODAY === 'undefined'
      ? null : String(payload.POLLEN_TODAY);
    // A merged pollen alert pairs with today's band like a Both pair (the slot has no
    // pair settings: the slash, today first).
    var pollen = alert ? statusPair.mergeAlert(code, band === null ? null
      : { now: band, peak: null, nextDay: false }, alert, settings, cap) : null;
    if (pollen !== null) { return pollen; }
    return band === null ? '--' : band;
  }
  // Both phone-battery items render the same text; they differ only in the icon
  // id they pack (see iconFor). The value is baked here from the phone's own
  // cached reading rather than sourced from the payload -- it is the one status
  // item that has nothing to do with the weather fetch, which is exactly what
  // lets a battery event re-send it while a provider key is expired.
  if (code === 'phoneBattery' || code === 'phoneBatteryPlain') {
    var pb = phoneBatteryReading();
    // '--' covers both "this phone has no battery API" and "Android, but no
    // event has landed yet". It is also what the watch substitutes whenever
    // Bluetooth is down (status_row.c's freshness rule), so the two paths agree
    // by construction and a dead phone never leaves a stale percentage on flash.
    if (!pb || !pb.available || typeof pb.level !== 'number') { return '--'; }
    // The EXACT percentage, never phone-battery.js's 5-point bucket: the bucket
    // is that module's SEND TRIGGER (a BLE-wake-up budget) and has no business
    // deciding what the slot says. A phone at 31% that gets plugged in shows
    // '31%', not the '30%' the trigger happens to be named after.
    //
    // Intended consequence, and it is the good half of the trade: this bake runs
    // on EVERY weather fetch (applyForecastSeries -> buildStatusLines, default
    // every 15 min), so the displayed number now also refreshes on those fetches
    // rather than only when the bucket moves. Max staleness drops from "until the
    // next 5-point step" to about one fetch interval. The cost is that the
    // outbox's all-or-nothing 'status' category goes dirty more often, so a
    // cycle that would have skipped its send entirely may now send it -- paid
    // only on Android, and only when a slot actually holds this item.
    //
    // '%' is part of the value, not a per-kind unit: there is no bare-number
    // reading of a battery charge, so it takes no unitEnabled toggle and no
    // withUnit cap check. '100%' is 4 of the edge slot's 8 bytes at worst.
    return String(pb.level) + '%';
  }
  return '--';
}

/**
 * @param {number} slotIndex 0..2
 * @returns {number} the slot's text byte cap
 */
function textCap(slotIndex) {
  return slotIndex === 1 ? catalog.CAPS.MID_TEXT_MAX : catalog.CAPS.EDGE_TEXT_MAX;
}

/**
 * The trailing wind-direction sentinel byte for a wind or gust slot, if any.
 *
 * Wire contract: 0x01 + sector, sector 0..15 = 16 compass points of 22.5 deg,
 * sector 0 = the arrow points north (screen up), counted clockwise. The sector
 * is ALREADY the downwind direction: providers report the bearing the wind comes
 * FROM, and the flip happens here so the watch never sees the meteorological
 * convention -- a future "point where it comes from" setting stays a one-line
 * change with no wire or watch impact.
 *
 * @param {string} code catalog item code
 * @param {Object} payload weather payload (pre-transform)
 * @param {Object} settings Clay settings blob
 * @param {Object} env platform environment
 * @param {string} text the slot's already-formatted display text
 * @param {?Object} dayMax the slot's day-max pick (wireUnits.dayMaxShown), the
 *   one its text was formatted from
 * @returns {number} 0x01..0x10, or 0 when no arrow should be drawn
 */
function directionSentinel(code, payload, settings, env, text, dayMax) {
  // The speed and the bearing fail INDEPENDENTLY -- a provider can report a
  // bearing for an hour whose speed is missing. An arrow beside a dead reading
  // reads as live data next to nothing, so the arrow follows the value: no
  // number, no arrow. (The caller passes the already-formatted text so this
  // check can never disagree with what the slot actually shows.)
  if (text === '--') { return 0; }
  return arrowSector(code, payload, settings, env, dayMax);
}

/**
 * The arrow a wind or gust slot with a reading would draw: its sentinel byte, or 0
 * when it draws none. directionSentinel's rule without the slot's text, so
 * formatValue can keep a byte free for exactly the arrows packLine appends.
 * @param {string} code catalog item code
 * @param {Object} payload weather payload (pre-transform)
 * @param {Object} settings Clay settings blob
 * @param {Object} [env] platform environment; absent = no arrow
 * @param {?Object} dayMax the slot's day-max pick (wireUnits.dayMaxShown)
 * @returns {number} 0x01..0x10, or 0
 */
function arrowSector(code, payload, settings, env, dayMax) {
  // Never on aplite: its lean status-row twin has no arrow and would draw the
  // control byte as a glyph box.
  if (!settings || !env || env.platform === 'aplite') { return 0; }
  if (code !== 'wind' && code !== 'gust') { return 0; }
  var on = code === 'wind' ? settings.windSlotDirection : settings.gustSlotDirection;
  if (!on) { return 0; }
  // Day max alone prints the peak, not the wind the arrow describes (the current
  // hour's), so it draws none; Both keeps it, its first reading being now's. The
  // pick is the one the text was formatted from, so the two never judge
  // different peaks. A slot with no reading of its own draws none either, even
  // where a merged alert's value fills it.
  if (!dayMax || dayMax.now === null) { return 0; }
  var from = trendHead(payload && payload.WIND_DIR_TREND);
  if (typeof from !== 'number' || !isFinite(from)) { return 0; }
  // Normalize into [0,360) before the flip so no input can push the byte outside
  // 0x01..0x10 -- exactly the range the watch strips. Math.round can carry a
  // downwind of 348.75..359.99 up to 16, which the mod folds back to sector 0.
  var downwind = ((from % 360) + 360 + 180) % 360;
  var sector = Math.round(downwind / 22.5) % 16;
  return 0x01 + sector;
}

/**
 * The icon id to pack for one resolved item.
 *
 * Every other item packs the static `icon` off its catalog entry. 'phoneBattery'
 * is the single item whose icon is chosen PER BAKE: the phone swaps in the
 * charging glyph while it charges, so charging state reaches the watch as a
 * different id inside a byte the slot already pays for -- no wire field, no
 * watch-side logic, no C plumbing. 'phoneBatteryPlain' draws nothing in either
 * state, so its id never varies; it exists only so the no-icon variant does not
 * arrive as TEXT + NONE and inherit City's bold mode (status_threshold.h).
 *
 * Resolved into a local exactly like `kind` is for the imperial distance slot --
 * the catalog entry itself is shared and must never be mutated.
 *
 * @param {string} code catalog item code
 * @param {Object} item the resolved catalog entry
 * @returns {number} STATUS_ICON_* id to pack
 */
function iconFor(code, item) {
  if (code === 'phoneBattery') {
    var pb = phoneBatteryReading();
    if (pb && pb.charging) { return catalog.ICONS.PHONE_BATTERY_CHG; }
  }
  return item.icon;
}

/**
 * The weather alert a slot merges (the owner, 2026-10-01): an edge slot showing the
 * metric of an alert the bake sends whose item sits on that slot's side of this bar.
 * The middle slot never merges, nor does a slot on the other side; the watch draws
 * the merged slot at the alert's level and its item only where the slot hides
 * (alert_set_merge in src/c/appendix/alert_set.c reads the same three facts: the
 * entries, the side cells and the slot's metric).
 * @param {?Array<{code: string}>} alerts status-wire.js bakedAlerts' list; null for
 *   a watch the entries do not ride to
 * @param {Object} settings Clay settings blob
 * @param {Object} env platform environment
 * @param {string} bar the line's bar (an on-demand.js BARS bar)
 * @param {number} s the slot's position, 0..2
 * @param {string} code the slot's item code
 * @returns {?Object} the alert's entry; null for none
 */
function mergedAlert(alerts, settings, env, bar, s, code) {
  if (!alerts || s === 1) { return null; }
  for (var i = 0; i < alerts.length; i++) {
    if (alerts[i].code === code) {
      return onDemand.sideOf(settings, bar, code, env) === POSITIONS[s] ? alerts[i] : null;
    }
  }
  return null;
}

/**
 * @param {Object} line catalog line definition
 * @param {Object} payload weather payload
 * @param {Object} settings Clay settings blob
 * @param {Object} env platform environment
 * @param {?Array<Object>} [alerts] the weather alerts the bake sends (status-wire.js
 *   bakedAlerts); absent or null = none (a watch the entries do not ride to)
 * @returns {number[]} packed three-slot line
 */
function packLine(line, payload, settings, env, alerts) {
  var bytes = [];
  for (var s = 0; s < 3; s++) {
    var key = line.slots[s];
    var stored = settings ? settings[key] : null;
    // slotDefault, not line.defaults: an install that never opened the settings page
    // has NOTHING stored for these (config-ui/lib/defaults.js deliberately does not
    // seed defaultFrom items), so this fallback IS the layout such a watch renders —
    // and it has to be the same one the page would have shown it. Reading the flat
    // table skipped every per-platform flavor, so an emery watch baked the narrow
    // top row and an HR watch baked the non-HR health row.
    var code = catalog.resolveSelection(stored || catalog.slotDefault(key, env), settings,
                                        env, { slotKey: key, position: POSITIONS[s] });
    var item = catalog.byCode(code) || catalog.byCode('empty');
    // Distance carries its unit in the wire kind (phone-only distanceUnits): the
    // watch renders km for LIVE_DISTANCE and mi for LIVE_DISTANCE_MI. Every other
    // item keeps its catalog kind unchanged.
    var kind = item.kind;
    if (code === 'distance' && settings && settings.distanceUnits === 'imperial') {
      kind = catalog.KINDS.LIVE_DISTANCE_MI;
    }
    // Likewise resolved per bake rather than read straight off the entry: today
    // only the charging phone-battery glyph varies (see iconFor).
    var icon = iconFor(code, item);
    if (env.platform === 'aplite' && item.kind === catalog.KINDS.LIVE_WEEK) {
      // aplite has no watch-side iso_week() (reaped for image budget), so the
      // phone bakes the ISO week as an ordinary TEXT slot instead.
      var weekBytes = utf8Truncate(utf8Encode('W' + isoWeek(new Date())), textCap(s));
      bytes.push(catalog.KINDS.TEXT, icon, weekBytes.length);
      for (var wb = 0; wb < weekBytes.length; wb++) { bytes.push(weekBytes[wb]); }
    } else if (item.kind === catalog.KINDS.TEXT) {
      // A day-max kind's pick (null for every other kind), read once: the text
      // and the wind arrow below must judge the same peak.
      var dayMax = wireUnits.dayMaxShown(code, payload, settings);
      // The weather alert of this slot's metric on its side, which the slot then
      // shows too; a tomorrow value takes the slot's own mark where it has one
      // (the day-max kinds), else the alert's (pollen).
      var merged = mergedAlert(alerts, settings, env, line.id, s, code);
      var alert = merged && { text: merged.text, nextDay: merged.nextDay,
        mark: wireUnits.isDayMaxKind(code) ? settings[code + 'SlotNextDayMark'] : merged.mark };
      // The cap goes DOWN into formatValue so a per-kind unit can decline to
      // append itself rather than be silently chopped off again by utf8Truncate
      // below (see withUnit). The truncation still guards the value itself.
      var text = formatValue(code, payload, settings, key, textCap(s), dayMax, alert, env);
      // An edge slot's city walks the watch's word ladder before the cap cuts it: the
      // first form that fits ('B. Soden', not 'Bad Sode'), whose words the watch can
      // still shorten from there. A name no form fits whole is cut as before ('New
      // York', never 'N. Y. Ci'). Not on a known aplite: it has no On demand, and its
      // bake stays byte for byte what it was.
      if (code === 'city' && textCap(s) === catalog.CAPS.EDGE_TEXT_MAX
          && env.platform !== 'aplite') {
        text = cityLadder.fit(text, textCap(s));
      }
      var valueBytes = utf8Truncate(utf8Encode(text), textCap(s));
      // Wind-direction arrow: one trailing sentinel byte, appended AFTER the
      // truncation so it can never be split or push the slot past its cap, and
      // only when a byte is actually free. Bytes < 0x80 are valid UTF-8, so the
      // watch's blob validator needs no change and the arrow rides inside the
      // slot's already-paid-for text bytes -- zero wire cost. The watch strips
      // the byte before measuring or drawing the text.
      var dirByte = directionSentinel(code, payload, settings, env, text, dayMax);
      if (dirByte && valueBytes.length < textCap(s)) { valueBytes.push(dirByte); }
      bytes.push(item.kind, icon, valueBytes.length);
      for (var b = 0; b < valueBytes.length; b++) { bytes.push(valueBytes[b]); }
    } else {
      bytes.push(kind, icon, 0);
    }
  }
  return bytes;
}

/**
 * Add STATUS_LINE_1..4_UINT8, the packed STATUS_LEVELS_UINT8 threshold bytes and
 * the weather alerts' ALERT_ENTRIES_UINT8 to the weather payload. Must run BEFORE
 * applyForecastSeries deletes the transient trend arrays (AQI_TREND,
 * WIND_TREND_UINT8, GUST_TREND_UINT8, PRESSURE_TREND, POLLEN_TODAY,
 * POLLEN_TOMORROW) -- the status text, the threshold levels and the alert
 * entries are read from them.
 * @param {Object} payload weather payload (mutated)
 * @param {Object} settings Clay settings blob
 * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result
 * @returns {Object} the same payload
 */
function buildStatusLines(payload, settings, watchInfo) {
  var env = platformLib.computeEnv(watchInfo);
  // The weather alerts' entries, judged before the lines: a slot showing an alert's
  // metric on the alert's side merges it (packLine). Only for a watch they ride to
  // (see below); null elsewhere, so aplite's lines bake exactly as before.
  var alerts = env.thresholds ? statusWire.bakedAlerts(payload, settings) : null;
  // computeEnv derives WATCH facts from watchInfo and nothing else, but the two
  // phone-battery items are gated on a PHONE fact: whether this PKJS host
  // exposes the Battery Status API (Android's Chromium WebView only). The flag
  // has to be added here or itemAvailable() fails the gate and resolveSelection()
  // collapses every configured phone-battery slot to 'empty' -- the slot would
  // silently disappear even on a phone that CAN read its battery. The config
  // page threads the same flag into its own env through config-ui/index.js'
  // opts.env, so both sides answer from the one PHONE_BATTERY_SUPPORTED key.
  env.phoneBattery = phoneBatterySupported();
  for (var l = 0; l < catalog.LINES.length; l++) {
    var line = catalog.LINES[l];
    payload[line.wireKey] = packLine(line, payload, settings, env, alerts);
  }
  // Packed weather-kind threshold levels: computed here because the raw
  // AQI/pollen/wind/gust values exist only phone-side (the watch gets text).
  // Skipped for a watch that compiles the highlight out (aplite — no
  // WW_THRESHOLD_HIGHLIGHT, so its inbox handler for this tuple is gone too):
  // sending it would only spend BLE bytes and inbox budget on a tuple that is
  // read and discarded. The 'status' category still carries the four line blobs,
  // so the change detector is unaffected.
  if (env.thresholds) {
    payload.STATUS_LEVELS_UINT8 = statusWire.packWeatherLevels(payload, settings);
    // The weather alerts' metric entries, judged here for the same reason. Its own
    // tuple in the 'status' category, so it rides (and is change-detected) with
    // the lines; [] when nothing is alerting, which clears the watch's stored
    // entries. The rain alert is not in here: the watch resolves it from its own
    // radar cache. On demand is compiled out on exactly the platforms the highlight
    // is (WW_ON_DEMAND and WW_THRESHOLD_HIGHLIGHT: every platform but aplite), so
    // this gate is the right one, and aplite's inbox never budgets for the tuple.
    payload.ALERT_ENTRIES_UINT8 = statusWire.packAlerts(alerts);
  }
  return payload;
}

/**
 * Every weather-payload key this module's bake actually READS — formatValue's
 * per-code arms plus directionSentinel — and, by inclusion, the only ones
 * status-wire's packWeatherLevels and bakeAlerts need (their displayValue /
 * dayMaxToday / dayMaxTomorrow read a subset: the day-max trends and peaks,
 * POLLEN_TODAY — plus POLLEN_TOMORROW, which only the alerts read).
 * STATUS_LINE_n_UINT8, STATUS_LEVELS_UINT8 and ALERT_ENTRIES_UINT8 are
 * deliberately absent: the bake WRITES those.
 *
 * Exported because status-rebake.js persists exactly this slice of the payload
 * so a charging event can re-bake after a PKJS restart. It lives HERE, next to
 * the code that reads the keys, so a new slot cannot add a read without the
 * list moving with it — test/status-lines.test.js pins the two together by
 * scanning this file's payload.* accesses.
 */
var SOURCE_KEYS = [
  'CITY',
  'CURRENT_TEMP',
  'FEELS_CURRENT',
  'SUN_EVENTS',
  'WIND_DIR_TREND',
  'PRESSURE_TREND',
  'DEW_TREND',
  'POLLEN_TODAY',
  // Tomorrow's pollen band: read only by the pollen alert's look-ahead
  // (status-wire bakeAlerts), never by a slot.
  'POLLEN_TOMORROW'
  // ...plus the day-max kinds' trends and *_DAY_PEAKS, read through wire-units'
  // dayMaxShown (UV, wind, gusts, AQI).
].concat(wireUnits.dayMaxPayloadKeys());

module.exports = {
  buildStatusLines: buildStatusLines,
  SOURCE_KEYS: SOURCE_KEYS,
  packLine: packLine,
  formatValue: formatValue,
  formatCountdown: formatCountdown,
  utf8Encode: utf8Encode,
  utf8Truncate: utf8Truncate,
  isoWeek: isoWeek
};
