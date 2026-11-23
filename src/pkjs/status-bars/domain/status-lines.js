/**
 * Bakes the four packed status-line snapshots into the weather payload.
 * Pure: reads only the payload + settings + watchInfo passed in -- never
 * mutable provider instance fields. ES5 only (aplite PKJS).
 */
var catalog = require('./status-line-catalog.js');
var platformLib = require('../../config-ui/lib/platform.js');
var statusWire = require('../../alerts/domain/status-wire.js');
var pressurePlausibility = require('../../weather/domain/pressure-plausibility.js');
var isPolarSunPair = require('../../weather/domain/sun-events.js').isPolarSunPair;
var statusPair = require('./status-pair.js');
var slotText = require('./slot-text.js');
var wireUnits = require('../../wire/domain/wire-units.js');
var cityLadder = require('./city-ladder.js');
var onDemand = require('./on-demand.js');
var condition = require('../../weather/domain/condition.js');
var batteryDays = require('./battery-days.js');
var pluginValues = require('./plugin-values.js');

// Slot positions by index, the catalog's slot-context vocabulary.
var POSITIONS = catalog.SLOT_POSITIONS;

// utf8.js owns the byte engine (clay-payload's string cap shares it). The
// local names survive as aliases: encode for the wire byte arrays the watch
// renders, and a bytes-in/bytes-out truncate for packLine's pre-encoded path.
var utf8 = require('../../lib/utf8.js');
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
 * Whether it is night at `nowSec`: the next sun event when the forecast came was a sunrise
 * (start type 0), each event gone by since flipping it, so a re-bake from older inputs
 * (status-rebake.js) still turns at sunset. A polar pair reads the other way round (polar
 * night is a sunset then a sunrise) and never flips: neither of its events is a real sunrise
 * or sunset. No events: day.
 * @param {number[]} sunEvents packed SUN_EVENTS wire bytes
 * @param {number} nowSec now, in epoch seconds
 * @returns {boolean}
 */
function isNightNow(sunEvents, nowSec) {
  if (!sunEvents || sunEvents.length < 5) { return false; }
  var first = readInt32LE(sunEvents, 1);
  var second = sunEvents.length >= 9 ? readInt32LE(sunEvents, 5) : null;
  if (second !== null && isPolarSunPair(first, second)) { return sunEvents[0] === 1; }
  var night = sunEvents[0] === 0;
  if (nowSec >= first) { night = !night; }
  if (second !== null && nowSec >= second) { night = !night; }
  return night;
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
 * The phone's battery facts a bake reads: whether this PKJS host can read the phone's
 * battery at all, and the reading to show. The caller asks phone-battery.js for them
 * (bakeFacts) and passes them in, so the bake itself never touches the adapter.
 * @typedef {Object} PhoneBattery
 * @property {boolean} supported Whether this host has a source of the phone's charge (the
 *   persisted PHONE_BATTERY_SUPPORTED verdict: the Pebble app's Phone plugin, or the
 *   Battery Status API of Android's Chromium WebView).
 * @property {?function(): ?{available: boolean, level: (number|null)}} reading
 *   Reads the exact percentage to show, as of the last time the watch was
 *   sent the battery (phone-battery.js readShown; called once per bake, only when a
 *   bar it bakes shows the phone's battery); `available` is false until a real
 *   reading has landed, and null when the module cannot answer at all (storage blocked:
 *   the slot then bakes '--' instead of taking the whole status bar down).
 */

/**
 * The watch battery's facts a bake reads, which the watch does not know itself: the
 * estimate of the days it has left (battery-days.js). The caller asks
 * battery-estimate.js for them (bakeFacts) and passes them in, as for the phone's battery.
 * @typedef {Object} WatchBattery
 * @property {?function(): ?{days: number, updatedAt: number}} estimate Reads the last
 *   estimate heard (called once per bake, only when a bar it bakes shows the watch
 *   battery's days); null where no estimate can be read at all.
 */

/**
 * The Plugin value slot's facts (plugin-value-source.js bakeFacts).
 * @typedef {Object} PluginValueFacts
 * @property {boolean} available Whether this Pebble app can read plugins at all: the
 *   catalog offers the slot only there (needsPlugins).
 * @property {?function(): ?Object} value Reads the value last heard (plugin-values.js
 *   valueOf), called once per bake, only when a bar it bakes shows the slot.
 */

/**
 * What a bake reads that neither the payload nor the settings hold: the two batteries'
 * facts and the Plugin value slot's. The app composes them once (index.js bakeFacts) for
 * every bake: a fetch's, the fixture's and a re-bake's.
 * @typedef {Object} BakeFacts
 * @property {?PhoneBattery} [phone] The phone's battery facts; absent = a host that cannot
 *   read the phone's battery.
 * @property {?WatchBattery} [watch] The watch battery's facts; absent = no estimate of the
 *   days it has left.
 * @property {?PluginValueFacts} [plugin] The Plugin value slot's facts; absent = a host that
 *   cannot read plugins.
 */

/**
 * The bake's environment besides the watch's: the time and the phone's battery, read
 * once per bake so every slot judges the same instant and the same reading.
 * @typedef {Object} BakeEnv
 * @property {Date} now The current time (countdown, aplite's ISO week).
 * @property {number} nowSec The same instant in epoch seconds (day or night now).
 * @property {?{available: boolean, level: (number|null)}} phone The
 *   phone's battery reading, read once by buildStatusLines and only when a bar it bakes
 *   shows the phone battery; null when there is none.
 * @property {?number} batteryDays The whole days the watch battery's text shows (its Text
 *   and Icon + text looks), in place of the percentage or beside it (battery-days.js
 *   daysLeft); null when it shows the percentage alone.
 * @property {?Object} pluginReading The reading the Plugin value slot shows
 *   (plugin-values.js shownReading); null for none.
 */

/**
 * The bake's environment for one instant and one phone-battery reading.
 * @param {Date} now The current time.
 * @param {?Object} phone The phone's battery reading, or null.
 * @param {?number} [days] The watch battery's days left to show, or null.
 * @param {?Object} [pluginReading] The Plugin value slot's reading, or null.
 * @returns {BakeEnv}
 */
function bakeEnv(now, phone, days, pluginReading) {
  return { now: now, nowSec: now.getTime() / 1000, phone: phone || null,
    batteryDays: typeof days === 'number' ? days : null, pluginReading: pluginReading || null };
}

/**
 * Format one catalog item's display text from the payload.
 * @param {string} code catalog item code: an item whose slot carries text (slot-text.js
 *   wireKind, catalog kindHasText)
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
 * @param {BakeEnv} bake The time and the phone's battery (bakeEnv). Required: the
 *   countdown, the weather condition and the phone-battery items read it, and a call
 *   without it throws on those.
 * @returns {string} display text, '--' when the value is unavailable
 */
function formatValue(code, payload, settings, slotKey, cap, dayMax, alert, env, bake) {
  var v;
  if (code === 'countdown') {
    return formatCountdown(settings && slotKey
      ? settings[catalog.countdownKey(slotKey)] : undefined, bake.now,
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
  // The weather condition's name in the slot's Look ('' for the glyph alone), its short form
  // after it where the slot has the bytes (slot-text.js conditionText); iconFor picks the glyph.
  if (code === 'condition') {
    var cn = conditionNow(payload, bake.nowSec);
    if (!cn) { return '--'; }
    return slotText.conditionLook(settings, env) === 'icon' ? ''
      : slotText.conditionText(cn.names, cap, env, slotText.conditionName(settings));
  }
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
  // The phone battery's two looks render the same text; they differ only in the icon
  // id they pack (see iconFor). The value is baked here from the phone's own
  // cached reading rather than sourced from the payload -- it is the one status
  // item that has nothing to do with the weather fetch, which is exactly what
  // lets a battery event re-send it while a provider key is expired.
  if (code === 'phoneBattery') {
    var pb = bake.phone;
    // '--' covers both "this phone has no source of its charge" and "no
    // reading has landed yet". It is also what the watch substitutes whenever
    // Bluetooth is down (status_row.c's freshness rule), so the two paths agree
    // by construction and a dead phone never leaves a stale percentage on flash.
    if (!pb || !pb.available || typeof pb.level !== 'number') { return '--'; }
    // An exact percentage, never phone-battery.js's 5-point bucket: the bucket
    // is that module's SEND TRIGGER (a BLE-wake-up budget) and has no business
    // deciding what the slot says. A phone at 31% shows
    // '31%', not the '30%' the trigger happens to be named after.
    //
    // Which exact reading is the caller's: a weather fetch's bake gets the one the
    // watch was last sent (phone-battery.js bakeFacts), so the charge drifting
    // inside its bucket bakes the same status and sends nothing; a trigger, or a
    // weather message that goes out anyway (the outbox's ride-along), brings the
    // phone's reading of that moment.
    //
    // '%' is part of the value, not a per-kind unit: there is no bare-number
    // reading of a battery charge, so it takes no unitEnabled toggle and no
    // withUnit cap check. '100%' is 4 of the edge slot's 8 bytes at worst.
    return String(pb.level) + '%';
  }
  // The watch battery's text (its Text and Icon + text looks): the days the watch has
  // left while it is to show them, alone or with the place of the percentage beside them
  // (battery-days.js slotText), which the watch prints in place of its percentage while
  // they can be current. No text is the percentage alone, which the watch prints itself.
  // At an edge slot's cap in every slot: the watch keeps one 8-byte mark of the days for
  // the face (status_line.h StatusBatteryDaysMark), so every slot carries the same bytes.
  if (code === 'battery') {
    return batteryDays.slotText(bake.batteryDays, settings, catalog.CAPS.EDGE_TEXT_MAX);
  }
  // The ISO week, where the phone bakes it (slot-text.js wireKind: aplite).
  if (code === 'week') { return 'W' + isoWeek(bake.now); }
  // A value another app's plugin serves, as the slot prints it (plugin-values.js textFor): a
  // moment in the user's clock format, as the sun slot, with its date on another day than the
  // bake's; '--' until it is read, and once it is too old.
  if (code === 'pluginValue') {
    return pluginValues.textFor(bake.pluginReading, cap, settings, bake.now.getTime());
  }
  return '--';
}

/**
 * The weather condition now (CURRENT_CONDITION), by day or by night (the next sun event,
 * SUN_EVENTS): its id and names; null while no condition is known.
 * @param {Object} payload weather payload (pre-transform)
 * @param {number} nowSec now, in epoch seconds
 * @returns {?{id: string, night: boolean, names: {full: string, short: string}}}
 */
function conditionNow(payload, nowSec) {
  var id = payload && payload.CURRENT_CONDITION;
  var night = isNightNow(payload && payload.SUN_EVENTS, nowSec);
  var n = condition.names(id, night);
  return n ? { id: id, night: night, names: n } : null;
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
 * Every other item packs the static `icon` off its catalog entry. Four items choose
 * theirs PER BAKE, inside a byte the slot already pays for -- no wire field: 'condition'
 * draws the glyph of the weather now, by day or night, 'city' may draw it before its name,
 * 'phoneBattery' packs the id of its Text look, which draws none, and 'battery' in its
 * Icon + text look the id of the battery the watch draws before its text (status_line.h
 * status_slot_draws_battery).
 *
 * Resolved into a local exactly like `kind` is for the imperial distance slot --
 * the catalog entry itself is shared and must never be mutated.
 *
 * @param {string} code catalog item code
 * @param {Object} item the resolved catalog entry
 * @param {Object} payload weather payload (pre-transform)
 * @param {Object} settings Clay settings blob
 * @param {?Object} env platform environment
 * @param {BakeEnv} bake the time and the phone's battery (bakeEnv)
 * @param {string} slotKey the slot's settings key: the phone battery's Look is the slot's
 * @returns {number} STATUS_ICON_* id to pack
 */
function iconFor(code, item, payload, settings, env, bake, slotKey) {
  // The city with the current weather's glyph before its name (citySlotIcon): the glyph's id
  // with the city's bit, which keeps the slot the city's on the watch. No glyph while no
  // condition is known, nor on aplite.
  if (code === 'city') {
    var cw = slotText.cityIcon(settings, env) ? conditionNow(payload, bake.nowSec) : null;
    return cw ? (catalog.ICONS[condition.glyph(cw.id, cw.night)] | catalog.CITY_GLYPH) : item.icon;
  }
  // The weather condition's glyph; the text-only id while none is known and in the Text
  // look (aplite's too).
  if (code === 'condition') {
    var cn = conditionNow(payload, bake.nowSec);
    return cn && slotText.conditionLook(settings, env) !== 'text'
      ? catalog.ICONS[condition.glyph(cn.id, cn.night)] : catalog.ICONS.COND_TEXT;
  }
  // The phone battery in its Text look: the id that loads no glyph, and that keeps the
  // slot the phone battery's on the watch (its bold mode, its "--" out of reach).
  if (code === 'phoneBattery' && slotText.phoneBatteryLook(settings, slotKey) === 'text') {
    return catalog.ICONS.PHONE_BATTERY_PLAIN;
  }
  // The watch battery in its Icon + text look: its text (LIVE_BATTERY_PCT, slot-text.js
  // wireKind) with the battery the watch draws before it.
  if (code === 'battery' && slotText.batteryLook(settings, env) === 'both') {
    return catalog.ICONS.DRAWN_BATTERY;
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
 * The item code a line's slot shows: its stored selection, else the slot's default,
 * resolved against what this watch and phone can show.
 * @param {Object} line catalog line definition
 * @param {number} s slot index, 0..2
 * @param {Object} settings Clay settings blob
 * @param {Object} env platform environment
 * @returns {string} the resolved item code
 */
function slotCode(line, s, settings, env) {
  var key = line.slots[s];
  var stored = settings ? settings[key] : null;
  // slotDefault, not line.defaults: an install that never opened the settings page
  // has NOTHING stored for these (config-ui/lib/defaults.js deliberately does not
  // seed defaultFrom items), so this fallback IS the layout such a watch renders —
  // and it has to be the same one the page would have shown it. Reading the flat
  // table skipped every per-platform flavor, so an emery watch baked the narrow
  // top row and an HR watch baked the non-HR health row.
  return catalog.resolveSelection(stored || catalog.slotDefault(key, env), settings,
                                  env, { slotKey: key, position: POSITIONS[s] });
}

/**
 * Whether any slot of the given lines shows an item.
 * @param {Array<Object>} lines catalog line definitions
 * @param {Object} settings Clay settings blob
 * @param {Object} env platform environment
 * @param {string} code the item's catalog code
 * @returns {boolean}
 */
function showsItem(lines, settings, env, code) {
  for (var l = 0; l < lines.length; l++) {
    for (var s = 0; s < 3; s++) {
      if (slotCode(lines[l], s, settings, env) === code) { return true; }
    }
  }
  return false;
}

/**
 * Whether any slot of the given lines shows the phone's battery (in either look).
 * @param {Array<Object>} lines catalog line definitions
 * @param {Object} settings Clay settings blob
 * @param {Object} env platform environment
 * @returns {boolean}
 */
function showsPhoneBattery(lines, settings, env) {
  return showsItem(lines, settings, env, 'phoneBattery');
}

/**
 * Whether any slot of the given lines shows the watch battery's days left: the watch
 * battery in a look that prints its text, Text or Icon + text (slot-text.js batteryLook;
 * never on aplite), set to show them alone or beside the percentage (battery-days.js
 * wanted).
 * @param {Array<Object>} lines catalog line definitions
 * @param {Object} settings Clay settings blob
 * @param {Object} env platform environment
 * @returns {boolean}
 */
function showsBatteryDays(lines, settings, env) {
  return batteryDays.wanted(settings) && slotText.batteryLook(settings, env) !== 'icon'
    && showsItem(lines, settings, env, 'battery');
}

/**
 * Whether the watch battery's days left are wanted on this watch at all: a bar the bake
 * sends shows them. What decides whether the estimate is worth reading (battery-estimate.js).
 * @param {Object} settings Clay settings blob
 * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result
 * @returns {boolean}
 */
function wantsBatteryDays(settings, watchInfo) {
  var env = platformLib.computeEnv(watchInfo);
  return showsBatteryDays(catalog.bakedLines(settings, env), settings, env);
}

/**
 * Whether any slot of the given lines shows the Plugin value with a source picked
 * (plugin-values.js sourceOf). The source first: it alone rules out most settings, without
 * working out the bars.
 * @param {Array<Object>} lines catalog line definitions
 * @param {Object} settings Clay settings blob
 * @param {Object} env platform environment
 * @returns {boolean}
 */
function showsPluginValue(lines, settings, env) {
  return pluginValues.sourceOf(settings) !== null && showsItem(lines, settings, env, 'pluginValue');
}

/**
 * Whether the Plugin value is wanted on this watch at all: a source is picked, and a bar the
 * bake sends shows the slot. What decides whether its value is worth reading
 * (plugin-value-source.js) and what telemetry reports. Whether this Pebble app reads plugins
 * is a fact of the phone, its callers' to add: the catalog's needsPlugins gate is taken as
 * passed.
 * @param {Object} settings Clay settings blob
 * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result
 * @returns {boolean}
 */
function wantsPluginValue(settings, watchInfo) {
  var env = platformLib.computeEnv(watchInfo);
  env.plugins = true;
  return showsPluginValue(catalog.bakedLines(settings, env), settings, env);
}

/**
 * @param {Object} line catalog line definition
 * @param {Object} payload weather payload
 * @param {Object} settings Clay settings blob
 * @param {Object} env platform environment
 * @param {?Array<Object>} [alerts] the weather alerts the bake sends (status-wire.js
 *   bakedAlerts); absent or null = none (a watch the entries do not ride to)
 * @param {BakeEnv} bake the time and the phone's battery (bakeEnv), read once per bake
 * @returns {number[]} packed three-slot line
 */
function packLine(line, payload, settings, env, alerts, bake) {
  var bytes = [];
  // Where each slot's bytes start, and an edge slot's weather condition at the middle's room
  // (widenEdgeConditions).
  var starts = [];
  var wide = [];
  for (var s = 0; s < 3; s++) {
    starts.push(bytes.length);
    var key = line.slots[s];
    var code = slotCode(line, s, settings, env);
    var item = catalog.byCode(code) || catalog.byCode('empty');
    // Both resolved per bake rather than read straight off the entry: the kind the item
    // packs as (slot-text.js wireKind) and its glyph (iconFor).
    var kind = slotText.wireKind(code, item, settings, env);
    var icon = iconFor(code, item, payload, settings, env, bake, key);
    if (!catalog.kindHasText(kind)) {
      // The watch draws a live kind from its own readings: no bytes.
      bytes.push(kind, icon, 0);
    } else {
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
      var text = formatValue(code, payload, settings, key, textCap(s), dayMax, alert, env, bake);
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
      bytes.push(kind, icon, valueBytes.length);
      for (var b = 0; b < valueBytes.length; b++) { bytes.push(valueBytes[b]); }
      // An edge slot's weather condition at the middle's room: its name with the short form
      // after it (slot-text.js conditionText). Not on a known aplite, whose lean row reads one
      // form in an edge's 8 bytes.
      if (code === 'condition' && s !== 1 && env.platform !== 'aplite') {
        var wideBytes = utf8Truncate(utf8Encode(formatValue(code, payload, settings, key,
          catalog.CAPS.EDGE_COND_TEXT_MAX, dayMax, alert, env, bake)), catalog.CAPS.EDGE_COND_TEXT_MAX);
        if (wideBytes.join() !== valueBytes.join()) { wide[s] = wideBytes; }
      }
    }
  }
  return widenEdgeConditions(bytes, starts, wide);
}

/**
 * Give an edge slot's weather condition the room its name needs: its wide value (packLine)
 * where catalog.widenEdges takes it, the left slot's first while the whole line still fits,
 * else the edge form it was packed with. Beside an empty or a short middle the watch then shows the whole
 * name, and swaps in the short form where the row cannot hold it (status_row_layout.h
 * status_row_swap_short_forms).
 * @param {number[]} bytes The packed line.
 * @param {number[]} starts Where each of the three slots' bytes start.
 * @param {Array<number[]>} wide An edge slot's wide condition value by slot index, if any.
 * @returns {number[]} The line.
 */
function widenEdgeConditions(bytes, starts, wide) {
  if (!wide[0] && !wide[2]) { return bytes; }
  var parts = [bytes.slice(starts[0], starts[1]), bytes.slice(starts[1], starts[2]), bytes.slice(starts[2])];
  var grown = parts.map(function (part, s) {
    return wide[s] ? [part[0], part[1], wide[s].length].concat(wide[s]) : null;
  });
  var take = catalog.widenEdges(parts.map(function (part) { return part.length; }),
    grown.map(function (g) { return g ? g.length : null; }));
  return parts.reduce(function (out, part, s) { return out.concat(take[s] ? grown[s] : part); }, []);
}

/**
 * Add the status lines the watch shows (STATUS_LINE_1..4_UINT8, and a bar 4 to 6's
 * STATUS_LINE_5..7_UINT8 on a Pebble Time 2: catalog bakedLines), the packed
 * STATUS_LEVELS_UINT8 threshold bytes and
 * the weather alerts' ALERT_ENTRIES_UINT8 to the weather payload, read from the keys in
 * SOURCE_KEYS (render-payload.js removes the ones that are no wire key afterwards).
 * @param {Object} payload weather payload (mutated)
 * @param {Object} settings Clay settings blob
 * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result
 * @param {Date} now The current time: the countdown, aplite's ISO week and whether it is
 *   night now read it, one instant for the whole bake.
 * @param {?BakeFacts} [facts] The two batteries' facts and the Plugin value slot's; absent =
 *   none.
 * @returns {Object} the same payload
 */
function buildStatusLines(payload, settings, watchInfo, now, facts) {
  var phone = (facts && facts.phone) || null;
  var watch = (facts && facts.watch) || null;
  var plugin = (facts && facts.plugin) || null;
  var env = platformLib.computeEnv(watchInfo);
  // The weather alerts' entries, judged before the lines: a slot showing an alert's
  // metric on the alert's side merges it (packLine). Only for a watch they ride to
  // (see below); null elsewhere, so aplite's lines bake exactly as before.
  var alerts = env.thresholds ? statusWire.bakedAlerts(payload, settings, env) : null;
  // computeEnv derives WATCH facts from watchInfo and nothing else, but the two
  // phone-battery items are gated on a PHONE fact: whether this PKJS host
  // has a source of the phone's charge (phone-battery.js). The flag
  // has to be added here or itemAvailable() fails the gate and resolveSelection()
  // collapses every configured phone-battery slot to 'empty' -- the slot would
  // silently disappear even on a phone that CAN read its battery. The config
  // page threads the same flag into its own env through config-ui/index.js'
  // opts.env, so both sides answer from the one PHONE_BATTERY_SUPPORTED key.
  env.phoneBattery = Boolean(phone && phone.supported);
  // Likewise whether this Pebble app reads plugins: the catalog offers the Plugin value slot
  // only there (needsPlugins), as the page does (index.js passes it as env.plugins).
  env.plugins = Boolean(plugin && plugin.available);
  // The Watch bar's line, then each bar's that a screen shows (catalog bakedLines). A bar on
  // no screen is sent no line: its text would only cost the send and the watch's flash write.
  var lines = catalog.bakedLines(settings, env);
  // The phone's battery, read once and only when a bar baked here shows it: every
  // battery slot of the bake prints the same reading.
  var reading = env.phoneBattery && phone.reading && showsPhoneBattery(lines, settings, env)
    ? phone.reading() : null;
  // Likewise the estimate of the days the watch has left: none once it is too old at this instant.
  var estimate = watch && watch.estimate && showsBatteryDays(lines, settings, env)
    ? watch.estimate() : null;
  // And the Plugin value slot's value: none once it is too old at this instant, or another
  // source's.
  var value = env.plugins && plugin.value && showsPluginValue(lines, settings, env)
    ? plugin.value() : null;
  var bake = bakeEnv(now, reading, batteryDays.daysLeft(estimate, now.getTime()),
    pluginValues.shownReading(value, settings, now.getTime()));
  for (var l = 0; l < lines.length; l++) {
    var line = lines[l];
    payload[line.wireKey] = packLine(line, payload, settings, env, alerts, bake);
  }
  // Packed weather-kind threshold levels: computed here because the raw
  // AQI/pollen/wind/gust values exist only phone-side (the watch gets text).
  // Skipped for a watch that compiles the highlight out (aplite — no
  // WW_THRESHOLD_HIGHLIGHT, so its inbox handler for this tuple is gone too):
  // sending it would only spend BLE bytes and inbox budget on a tuple that is
  // read and discarded. The 'status' category still carries the Watch bar's line
  // (always baked), so the change detector is unaffected.
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
 * status-wire's packWeatherLevels and bakedAlerts need (their displayValue /
 * dayMaxToday / dayMaxTomorrow read a subset: the day-max trends and peaks,
 * POLLEN_TODAY — plus POLLEN_TOMORROW, which only the alerts read).
 * STATUS_LINE_n_UINT8, STATUS_LEVELS_UINT8 and ALERT_ENTRIES_UINT8 are
 * deliberately absent: the bake WRITES those.
 *
 * Exported because status-rebake.js persists exactly this slice of the payload
 * so a phone-battery event can re-bake after a PKJS restart. It lives HERE, next to
 * the code that reads the keys, so a new slot cannot add a read without the
 * list moving with it — test/status-bars/domain/status-lines.test.js pins the two together by
 * scanning this file's payload.* accesses.
 */
var SOURCE_KEYS = [
  'CITY',
  'CURRENT_TEMP',
  // The weather condition now (weather/domain/condition.js), and the sun events say whether it
  // is night.
  'CURRENT_CONDITION',
  'FEELS_CURRENT',
  'SUN_EVENTS',
  'WIND_DIR_TREND',
  'PRESSURE_TREND',
  'DEW_TREND',
  'POLLEN_TODAY',
  // Tomorrow's pollen band: read only by the pollen alert's look-ahead
  // (status-wire bakedAlerts), never by a slot.
  'POLLEN_TOMORROW'
  // ...plus the day-max kinds' trends and *_DAY_PEAKS, read through wire-units'
  // dayMaxShown (UV, wind, gusts, AQI).
].concat(wireUnits.dayMaxPayloadKeys());

module.exports = {
  buildStatusLines: buildStatusLines,
  wantsBatteryDays: wantsBatteryDays,
  wantsPluginValue: wantsPluginValue,
  isNightNow: isNightNow,
  SOURCE_KEYS: SOURCE_KEYS,
  packLine: packLine,
  bakeEnv: bakeEnv,
  formatValue: formatValue,
  formatCountdown: formatCountdown,
  utf8Encode: utf8Encode,
  utf8Truncate: utf8Truncate,
  isoWeek: isoWeek
};
