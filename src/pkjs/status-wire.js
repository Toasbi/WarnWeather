/**
 * The phone-only wire half of the status-slot alert levels: the bytes the phone packs
 * from the model in status-thresholds.js.
 *  - the packed settings blob (CLAY_THRESHOLDS_UINT8, buildSettingsBlob): the 8
 *    paired kinds' highlight enable bits and warn/danger colours, the health trio's
 *    thresholds (the watch levels those kinds itself), every kind's 2-bit bold cell,
 *    the rain alert's look, the On demand Battery item, each paired kind's warn look
 *    and the On demand cells;
 *  - the weather kinds' levels (STATUS_LEVELS_UINT8, packWeatherLevels) and the
 *    weather alerts' metric entries (ALERT_ENTRIES_UINT8, bakeAlerts), both judged at
 *    weather-bake time;
 *  - the heart-rate alert (CLAY_HR_ALERT_UINT8, buildHrAlertBytes, emery only): the
 *    Heart rate On demand item and the heart rate slot's Alert highlighting.
 *
 * Phone-only: plain CommonJS, and NOT in the settings page's APP_FILES
 * (scripts/build-config-page.js). The page reads the model (status-thresholds.js,
 * on-demand.js) and never packs a byte, so none of this ships in it.
 *
 * LOCKSTEP: the blob layout mirrors src/c/appendix/status_threshold.h, the alert
 * entries alert_set.h, the heart-rate alert hr_alert.h;
 * test/status-thresholds-contract.test.js, test/alert-entries-contract.test.js and
 * test/hr-alert-contract.test.js enforce it. ES5 only (aplite PKJS).
 */
var thresholds = require('./status-thresholds.js');
var onDemand = require('./on-demand.js');
var wireUnits = require('./wire-units.js');
var rainTier = require('./weather/rain-tier.js');

// The model this module packs, under the names its packers use.
var KINDS = thresholds.KINDS;
var WARN_LOOKS = thresholds.WARN_LOOKS;
var RAIN_DISPLAY = thresholds.RAIN_DISPLAY;
var BOLD_MODES = thresholds.BOLD_MODES;
var ALERT_NEXT_DAY_MARKS = thresholds.ALERT_NEXT_DAY_MARKS;
var ALERT_NEXT_DAY_MARK_DEFAULT = thresholds.ALERT_NEXT_DAY_MARK_DEFAULT;
var kindConfig = thresholds.kindConfig;
var rainAlert = thresholds.rainAlert;
var resolvedPair = thresholds.resolvedPair;
var computeLevel = thresholds.computeLevel;
var isWeatherKind = thresholds.isWeatherKind;
var weatherKindOf = thresholds.weatherKindOf;

// ── the settings blob (CLAY_THRESHOLDS_UINT8) ────────────────────────────────

// One widening per release that shipped a new length, each appended to the
// 29-byte pre-bold layout: 1.11.0 shipped 33 (the bold area for kinds 0..15);
// 1.12.0 shipped 34 (battery %, kind 16, opened byte 33); 1.24.0 ships 48 (the
// rain look, the On demand Battery item, the two warn-look bytes and the ten On
// demand cells). The watch also accepts 34, 33 and 29; the interim 31-, 35-, 36-
// and 38-byte formats never shipped — they existed only on feature branches — so
// they validate as garbage, not as legacy (see status_threshold.h). Byte 33
// holds FOUR 2-bit cells (kinds 16..19): dew point (17) and the two
// phone-battery kinds (18, 19) all appended into it for free — and it is FULL,
// with the alert bytes right behind it. So a twenty-first kind (index 20) is no
// plain append any more: it needs a sixth bold byte AND everything behind it
// relocated, a layout change on both ends (the C header's _Static_assert trips).
var SETTINGS_BYTES = 48;
var COLORS_OFFSET = 1;
var HEALTH_OFFSET = 17;    // shifted 15 -> 17 with the UV color pair (append-only kinds)
var BOLD_OFFSET = 29;      // 2 bits per kind: byte 29 + (k >> 2), bits 2 * (k & 3) — bytes 29..33
// The alerts options byte: bits 0-1 the rain alert's look (RAIN_DISPLAY),
// bits 2-7 reserved (DWD official warnings later) and written 0.
var ALERTS_OFFSET = 34;
// The On demand Battery item: bits 0-5 its warn level in % (on-demand.js
// batteryLevel — already on the platform's step, the watch never rounds), bit 6
// its Look (BATTERY_VALUE_BIT: Icon + value), bit 7 reserved 0.
var BATTERY_OFFSET = 35;
var BATTERY_VALUE_BIT = 0x40;
// The warn look per PAIRED kind (the box at the warn level — a goal kind's
// "close" — for its status slot and its alert icon): 2 bits per kind, kind k at
// byte WARN_LOOK_OFFSET + (k >> 2), bits 2 * (k & 3) — bytes 36..37. The 2-bit
// values are WARN_LOOKS (status-thresholds.js).
var WARN_LOOK_OFFSET = 36;
// The On demand cells: one byte per blob item (the first on-demand.js BLOB_ITEM_COUNT
// ITEMS, the watch's OdItem order up to OD_WIND), 2 bits per bar (on-demand.js BARS, its
// ThreshBar order) — bytes 38..47. emery's Heart rate item has its cells on its own tuple
// (buildHrAlertBytes).
var ON_DEMAND_OFFSET = 38;

/**
 * Health threshold in its wire unit: steps as-is; sleep hours -> minutes;
 * distance km -> 100 m units (mi -> 100 m when distanceUnits is imperial).
 * Clamped to uint16.
 * @param {number} kindIndex 4..6
 * @param {number} v entered threshold (display units)
 * @param {Object} settings Clay settings blob (distanceUnits)
 * @returns {number} 0..65535
 */
function healthWire(kindIndex, v, settings) {
  var n;
  if (kindIndex === 4) {
    n = Math.round(v);
  } else if (kindIndex === 5) {
    n = Math.round(v * 60);
  } else {
    n = (settings && settings.distanceUnits === 'imperial')
      ? Math.round(v * 16.0934) : Math.round(v * 10);
  }
  if (!isFinite(n) || n < 0) { return 0; }
  if (n > 0xFFFF) { return 0xFFFF; }
  return n;
}

/**
 * Build the CLAY_THRESHOLDS_UINT8 settings blob (layout: status_threshold.h).
 * The statusBoldAll master row ('all') overrides the PACKED bold cell of
 * every kind to BOLD_MODES.always at build time only — the stored
 * thresh<Kind>BoldMode values are never modified, so 'perSlot' restores
 * them on the next build. Enable bits, colors, and health u16s are
 * untouched by the master.
 * Byte ALERTS_OFFSET carries the rain alert's look (rainAlert's look); which
 * METRIC alerts are active never rides here — the phone bakes only the active
 * ones into their own weather tuple (bakeAlerts). Byte BATTERY_OFFSET carries the
 * On demand Battery item: its warn level (on-demand.js batteryLevel, on the
 * watch's step — hence env.fineBattery) and its Look. Bytes WARN_LOOK_OFFSET..
 * carry each paired kind's warn look (warnLookFor), whose default depends on the
 * watch's display — hence env.color. Bytes ON_DEMAND_OFFSET.. carry the On
 * demand cells: which side of which bar shows each item.
 * @param {Object} settings Clay settings blob
 * @param {{color: boolean, fineBattery: boolean}} [env] platform env (config-ui
 *     platform.js computeEnv); absent = a colour watch with 10 % battery steps
 *     that draws On demand
 * @returns {number[]} SETTINGS_BYTES-long array (48 bytes)
 */
function buildSettingsBlob(settings, env) {
  var blob = [];
  var i;
  var boldAll = Boolean(settings && settings.statusBoldAll === 'all');
  var isColor = !env || env.color !== false;
  for (i = 0; i < SETTINGS_BYTES; i++) { blob.push(0); }
  for (var k = 0; k < KINDS.length; k++) {
    var cfg = kindConfig(settings, k, isColor);
    blob[BOLD_OFFSET + (k >> 2)] |=
      (boldAll ? BOLD_MODES.always : BOLD_MODES[cfg.boldMode]) << (2 * (k & 3));
    // Bold-only kinds pack ONLY their bold cell: blob[0]'s 8 enable bits and
    // the color/health offsets belong to the paired kinds (0..7) alone.
    if (KINDS[k].boldOnly) { continue; }
    if (cfg.enabled) { blob[0] |= (1 << k); }
    blob[COLORS_OFFSET + 2 * k] = cfg.warnColor === null
      ? 0 : rainTier.rgbToGColor8(cfg.warnColor);   // 0x00 = no-outline sentinel
    blob[COLORS_OFFSET + 2 * k + 1] = rainTier.rgbToGColor8(cfg.dangerColor);
    blob[WARN_LOOK_OFFSET + (k >> 2)] |= WARN_LOOKS[cfg.warnLook] << (2 * (k & 3));
    if (k >= 4 && k <= 6) {   // the health trio only — UV (7) has no blob entry
      var off = HEALTH_OFFSET + 4 * (k - 4);
      var warn = cfg.enabled ? healthWire(k, cfg.warn, settings) : 0;
      var danger = cfg.enabled ? healthWire(k, cfg.danger, settings) : 0;
      blob[off] = warn & 0xFF;
      blob[off + 1] = (warn >> 8) & 0xFF;
      blob[off + 2] = danger & 0xFF;
      blob[off + 3] = (danger >> 8) & 0xFF;
    }
  }
  blob[ALERTS_OFFSET] = RAIN_DISPLAY[rainAlert(settings).look];
  blob[BATTERY_OFFSET] = onDemand.batteryLevel(settings, env)
    | (onDemand.batteryShowsValue(settings) ? BATTERY_VALUE_BIT : 0);
  // The On demand cells: one byte per blob item in ITEMS order (BLOB_ITEM_COUNT, NOT
  // ITEMS.length: the Heart rate item past them would grow the blob to 49 B on every
  // watch), each onDemandCell.
  for (i = 0; i < onDemand.BLOB_ITEM_COUNT; i++) {
    blob[ON_DEMAND_OFFSET + i] = onDemandCell(settings, onDemand.ITEMS[i].code, env);
  }
  return blob;
}

/**
 * One On demand item's cell byte: 2 bits per bar at bits 2 * bar (BARS order) — 0 none,
 * 1 left, 2 right (the SIDES index + 1). Effective values only (sideOf), so a bar the
 * modes remove and a watch without On demand are zeros (and the Heart rate item off
 * hrAvailable).
 * @param {Object} settings Clay settings blob
 * @param {string} code An on-demand.js ITEMS code.
 * @param {Object} [env] platform env (absent = capable, see sideOf)
 * @returns {number} 0..255
 */
function onDemandCell(settings, code, env) {
  var cell = 0;
  for (var b = 0; b < onDemand.BARS.length; b++) {
    var side = onDemand.sideOf(settings, onDemand.BARS[b].bar, code, env);
    if (side !== null) { cell |= (onDemand.SIDES.indexOf(side) + 1) << (2 * b); }
  }
  return cell;
}

// ── the weather levels (STATUS_LEVELS_UINT8) ─────────────────────────────────

// DWD pollen reaches the phone as one of these display BANDS (a string, see
// src/pkjs/weather/pollen.js), NOT a 0-3 number — Number('2-3') is NaN.
// pollenToday maps a band to its numeric level (index i -> i/2) so half-bands
// compare on the same 0 / 0.5 / 1 / 1.5 / 2 / 2.5 / 3 scale the threshold is
// entered on.
var POLLEN_BANDS = ['0', '0-1', '1', '1-2', '2', '2-3', '3'];

/**
 * A DWD pollen reading, a POLLEN_BANDS string, with its level (the band's
 * index / 2 — 7 bands -> 0, 0.5, 1, ... 3).
 * @param {*} raw POLLEN_TODAY or POLLEN_TOMORROW
 * @returns {?{band: string, level: number}} the band as the pollen slot prints
 *     it and the number thresholds compare; null when there is no reading or it
 *     is no known band
 */
function pollenBand(raw) {
  if (raw === null || typeof raw === 'undefined') { return null; }
  var idx = POLLEN_BANDS.indexOf(String(raw));
  return idx < 0 ? null : {band: POLLEN_BANDS[idx], level: idx / 2};
}

/**
 * Today's DWD pollen reading (POLLEN_TODAY), see pollenBand.
 * @param {Object} payload weather payload (pre-transform)
 * @returns {?{band: string, level: number}}
 */
function pollenToday(payload) {
  return pollenBand(payload.POLLEN_TODAY);
}

/**
 * Tomorrow's DWD pollen reading (POLLEN_TOMORROW, from the same request as
 * today's), see pollenBand. Only an alert that looks ahead reads it.
 * @param {Object} payload weather payload (pre-transform)
 * @returns {?{band: string, level: number}} null when DWD has not issued
 *     tomorrow's band (or no pollen was fetched)
 */
function pollenTomorrow(payload) {
  return pollenBand(payload.POLLEN_TOMORROW);
}

/**
 * The number the user SEES for a weather kind — thresholds compare against
 * the displayed value. The readers are SHARED with status-lines.js through
 * wire-units (dayMaxShown), so the two cannot round apart or disagree on which
 * peak is shown.
 *
 * The day-max kinds (UV, wind, gusts, AQI) judge the highest of TODAY's
 * numbers shown (todaysShown). An unmarked peak is never below now by
 * construction, so "2/8" is highlighted for the 8 (and "5/5", a peak still
 * running, for 5); tomorrow's marked peak never counts until it is today's, so
 * "8/»6" is judged on the 8 and a lone "»9" not at all (null). The alert icon
 * judges tomorrow on its own (bakeAlerts); the slot's highlight never does.
 * @param {string} code 'aqi' | 'pollen' | 'wind' | 'gust' | 'uv'
 * @param {Object} payload weather payload (pre-transform, trends present)
 * @param {Object} settings Clay settings blob (windUnits, <kind>SlotDisplay)
 * @returns {number|null} displayed number, or null when unavailable
 */
function displayValue(code, payload, settings) {
  if (wireUnits.isDayMaxKind(code)) {
    return todaysShown(wireUnits.dayMaxShown(code, payload, settings));
  }
  if (code === 'pollen') {
    var pollen = pollenToday(payload);
    return pollen ? pollen.level : null;
  }
  return null;
}

/**
 * The highest of today's numbers a day-max slot shows (displayValue's policy).
 * @param {?{now: ?number, peak: ?number, nextDay: boolean}} shown wire-units' pick
 * @returns {number|null} today's peak when shown, else the current reading
 *     (null when only tomorrow's peak is on screen, or no reading at all)
 */
function todaysShown(shown) {
  if (!shown) { return null; }
  return (shown.peak === null || shown.nextDay) ? shown.now : shown.peak;
}

// Bit position of a weather kind's 2-bit level in the packed levels value:
// the original four sit at bits 2k, UV (appended as kind 7) at bits 8-9.
function weatherLevelShift(k) {
  return k <= 3 ? 2 * k : 8;
}

/**
 * A weather kind's level for a number, against the kind's resolved pair (seeds
 * when blank) — toggle-agnostic: the level says how high the value is, the
 * highlight toggle only says whether the watch colours it. The slot levels
 * (packWeatherLevels, on the number the slot shows) and the weather alerts
 * (bakeAlerts, on the day's) both judge here.
 * @param {*} code A status item code.
 * @param {?number} value the number in the kind's display unit
 * @param {Object} settings Clay settings blob
 * @returns {?number} 0 normal / 1 warn / 2 danger; null without a number or for
 *     a code that is no weather kind
 */
function levelOf(code, value, settings) {
  var k = weatherKindOf(code);
  if (!k || value === null) { return null; }
  var pair = resolvedPair(k.key, settings);
  return computeLevel(value, pair.warn, pair.danger);
}

/**
 * Pack the weather-kind levels into the STATUS_LEVELS_UINT8 wire bytes, LE
 * (kinds 0..3 in byte 0 at bits 2k; UV in byte 1 at bits 0-1). Every weather
 * kind packs its level whether or not its highlight is on — only missing data
 * stays Normal. That is watch-safe: status_threshold_slot_level checks the
 * kind's blob[0] enable bit (Clay message) BEFORE it reads this level, so an
 * un-highlighted kind still renders plain. And it keeps the highlight toggle
 * off the weather message: flipping thresh<Kind>On changes only the Clay blob
 * (sent immediately), so it needs no re-bake and stays out of renderSignature.
 * @param {Object} payload weather payload (pre-transform)
 * @param {Object} settings Clay settings blob
 * @returns {number[]} two-element byte array (2 wire bytes)
 */
function packWeatherLevels(payload, settings) {
  var packed = 0;
  for (var k = 0; k < KINDS.length; k++) {
    if (!isWeatherKind(KINDS[k])) { continue; }
    var code = KINDS[k].code;
    var level = levelOf(code, displayValue(code, payload, settings), settings);
    if (level === null) { continue; }
    packed |= level << weatherLevelShift(k);
  }
  return [packed & 0xFF, (packed >> 8) & 0xFF];
}

// ── the weather alerts' metric entries (ALERT_ENTRIES_UINT8) ─────────────────

/**
 * What a metric alert judges and prints: the day, not the slot. A day-max kind
 * judges the highest value left TODAY, the current hour included (wire-units'
 * dayMaxToday — independent of the kind's slot display mode, so a Now-mode slot
 * or no slot at all still gets the morning "UV reaches 8 today" alert; without
 * day peaks in the payload, as for WAQI's AQI, the current reading) and prints
 * it whole, as its slot prints the number (wind and gusts in the user's wind
 * unit). Pollen, a daily band, judges the band's level and prints the band
 * ('2-3'), as the pollen slot does.
 * @param {string} code An ALERT_KINDS code.
 * @param {Object} payload weather payload (pre-transform, trends present)
 * @param {Object} settings Clay settings blob (windUnits)
 * @returns {?{value: number, text: string}} the number in display units and its
 *     text without a unit (the icon carries it); null when unavailable
 */
function alertReading(code, payload, settings) {
  if (code === 'pollen') {
    var pollen = pollenToday(payload);
    return pollen ? {value: pollen.level, text: pollen.band} : null;
  }
  var v = wireUnits.dayMaxToday(code, payload, settings);
  return v === null ? null : {value: v, text: String(Math.round(v))};
}

/**
 * What a metric alert that looks ahead judges and prints for TOMORROW: a day-max
 * kind's peak (wire-units' dayMaxTomorrow — the slot's "»8" number, in the
 * user's wind unit), pollen tomorrow's DWD band. Never the current reading, and
 * only a value above 0 — the slot never marks a "»0" either, and a warn of 0
 * must not raise an alert about a quiet tomorrow.
 * @param {string} code An ALERT_KINDS code.
 * @param {Object} payload weather payload (pre-transform)
 * @param {Object} settings Clay settings blob (windUnits)
 * @returns {?{value: number, text: string}} null when tomorrow is unknown (a
 *     forecast that stops short of its end, WAQI's current-only AQI, a band DWD
 *     has not issued) or not above 0
 */
function alertTomorrowReading(code, payload, settings) {
  if (code === 'pollen') {
    var pollen = pollenTomorrow(payload);
    return (pollen && pollen.level > 0) ? {value: pollen.level, text: pollen.band} : null;
  }
  var v = wireUnits.dayMaxTomorrow(code, payload, settings);
  return v === null ? null : {value: v, text: String(Math.round(v))};
}

/**
 * Whether one switched-on alert is active, and for which day — THE rule:
 *  1. Today: the highest value left today (alertReading) at warn or higher makes
 *     a today entry. Today always wins, so warn today and danger tomorrow shows
 *     today's warn until today drops below warn.
 *  2. Tomorrow: only with Days 'tomorrow' and nothing left today at warn:
 *     tomorrow's peak (alertTomorrowReading), known and above 0, at warn or
 *     higher makes a tomorrow entry — its own value, at its own level, carrying
 *     the alert's mark.
 *  3. Otherwise the alert is not active.
 * Both days level on the kind's resolved pair (levelOf); the slot's Alert
 * highlighting switch plays no part.
 * @param {{code: string, days: string, mark: string}} alert an enabledAlerts entry
 * @param {Object} payload weather payload (pre-transform, trends present)
 * @param {Object} settings Clay settings blob
 * @returns {?{text: string, level: number, nextDay: boolean}} the entry's value
 *     text and level (1 warn / 2 danger); null when the alert is not active
 */
function alertPick(alert, payload, settings) {
  var today = alertReading(alert.code, payload, settings);
  var level = levelOf(alert.code, today ? today.value : null, settings);
  if (level !== null && level >= 1) {
    return {text: today.text, level: level, nextDay: false};
  }
  if (alert.days !== 'tomorrow') { return null; }
  var next = alertTomorrowReading(alert.code, payload, settings);
  level = levelOf(alert.code, next ? next.value : null, settings);
  if (level === null || level < 1) { return null; }
  return {text: next.text, level: level, nextDay: true};
}

// ALERT_ENTRIES_UINT8 (alert_set.h): one header byte per entry, then its value
// bytes; the whole tuple at most ALERT_ENTRIES_MAX_BYTES, what the watch accepts
// and its inbox budgets for (test/inbox-size.test.js).
//   header  bit 7     ALERT_HEADER, on every header — and on no value byte, which
//                     is printable ASCII (< 0x80). So the value needs no length:
//                     it runs to the next header or the end of the tuple.
//           bits 0-2  the ThreshKind (AQI 0, pollen 1, wind 2, gust 3, UV 7)
//           bit 3     ALERT_DANGER: danger when set, warn when clear — an entry
//                     is only ever baked at one of the two (alertPick)
//           bits 4-6  the day (ALERT_DAY_SHIFT): 0 today's value; else
//                     tomorrow's, as its mark's code — ALERT_NEXT_DAY_MARKS index
//                     + 1 (1 », 2 >, 3 +, 4 * after the value, 5 unmarked;
//                     6 and 7 unused). The watch draws the mark itself, so no
//                     non-ASCII byte rides.
//   value   0..ALERT_LEN_MAX printable ASCII bytes — the number printed after
//           the icon; none unless the kind's Look is 'value'
// A tomorrow entry costs no more than a today one, so all five alerts with their
// widest realistic values — UV "11", wind and gusts "255" (the byte clamp), AQI
// "500", pollen "2-3" — are 19 B on either day and nothing is dropped.
// test/alert-entries-contract.test.js pins these to the C header.
var ALERT_HEADER = 0x80;
var ALERT_DANGER = 0x08;
var ALERT_DAY_SHIFT = 4;
var ALERT_LEN_MAX = 7;
var ALERT_ENTRIES_MAX_BYTES = 20;

/**
 * The header byte of one entry.
 * @param {number} kind the entry's ThreshKind (its KINDS index)
 * @param {number} level 1 warn / 2 danger
 * @param {?string} mark tomorrow's ALERT_NEXT_DAY_MARKS key (alertNextDayMark —
 *     anything else codes as the default); null for today's entry
 * @returns {number} the byte
 */
function alertHeader(kind, level, mark) {
  var day = 0;
  if (mark !== null) {
    var idx = ALERT_NEXT_DAY_MARKS.indexOf(mark);
    day = 1 + (idx < 0 ? ALERT_NEXT_DAY_MARKS.indexOf(ALERT_NEXT_DAY_MARK_DEFAULT) : idx);
  }
  return ALERT_HEADER | kind | (level >= 2 ? ALERT_DANGER : 0) | (day << ALERT_DAY_SHIFT);
}

/**
 * The weather alerts' metric entries the bake sends (ALERT_ENTRIES_UINT8,
 * packAlerts): one per ACTIVE metric alert — placed on any bar (enabledAlerts, read
 * with a watch that draws On demand: the tuple only rides to one) and active today
 * or, with Days 'tomorrow', tomorrow (alertPick) — in ALERT_KINDS order: gust, UV,
 * AQI, pollen, wind. A tomorrow entry carries the alert's mark
 * (alert<Key>NextDayMark). The value text is there only when the kind's Look is
 * 'value' (alert<Key>Display) and it is printable ASCII of at most ALERT_LEN_MAX
 * bytes. Entries that would push the bytes past ALERT_ENTRIES_MAX_BYTES are dropped
 * from the TAIL (wind first) — the rule the watch applies to its pixels. The slots
 * read the same list (status-lines.js): a slot merges only an entry that rides.
 * @param {Object} payload weather payload (pre-transform, trends present)
 * @param {Object} settings Clay settings blob
 * @returns {Array<{code: string, kindId: number, level: number, nextDay: boolean,
 *     mark: string, text: string}>} the entries in wire order, [] when nothing is
 *     alerting
 */
function bakedAlerts(payload, settings) {
  var out = [];
  if (!payload || !settings) { return out; }
  var alerts = thresholds.enabledAlerts(settings);
  var bytes = 0;
  for (var i = 0; i < alerts.length; i++) {
    var a = alerts[i];
    var pick = alertPick(a, payload, settings);
    if (!pick) { continue; }
    var text = a.showValue ? pick.text : '';
    if (text.length > ALERT_LEN_MAX || !/^[\x20-\x7E]*$/.test(text)) { text = ''; }
    // Tail-drop: a prefix of the fixed order, never a later entry that happens
    // to be shorter — the watch fits the row by the same rule.
    bytes += 1 + text.length;
    if (bytes > ALERT_ENTRIES_MAX_BYTES) { break; }
    out.push({code: a.code, kindId: a.kindId, level: pick.level, nextDay: pick.nextDay,
      mark: a.mark, text: text});
  }
  return out;
}

/**
 * Pack the entries bakedAlerts picked into the ALERT_ENTRIES_UINT8 bytes: a header
 * per entry, then its value text.
 * @param {Array<{kindId: number, level: number, nextDay: boolean, mark: string,
 *     text: string}>} entries bakedAlerts' list
 * @returns {number[]} the entry bytes, [] when nothing is alerting
 */
function packAlerts(entries) {
  var out = [];
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    out.push(alertHeader(e.kindId, e.level, e.nextDay ? e.mark : null));
    for (var c = 0; c < e.text.length; c++) { out.push(e.text.charCodeAt(c)); }
  }
  return out;
}

/**
 * Bake the weather alerts' metric entries (ALERT_ENTRIES_UINT8): bakedAlerts' list,
 * packed.
 * @param {Object} payload weather payload (pre-transform, trends present)
 * @param {Object} settings Clay settings blob
 * @returns {number[]} the entry bytes, [] when nothing is alerting
 */
function bakeAlerts(payload, settings) {
  return packAlerts(bakedAlerts(payload, settings));
}

// ── the heart-rate alert (CLAY_HR_ALERT_UINT8, emery only) ───────────────────

// The layout is CANONICAL in src/c/appendix/hr_alert.h (and stored verbatim in the
// watch's HR_ALERT_SETTINGS persist slot); test/hr-alert-contract.test.js pins these to
// it. Seven bytes: [0] the Heart rate item's cells (a cell byte, onDemandCell), [1] its
// level in bpm (on-demand.js hrLevel), [2] the flags, [3] / [4] the heart rate slot's
// warn / danger bpm, [5] / [6] its warn / danger colours as GColor8 argb bytes.
var HR_ALERT_BYTES = 7;
var HR_ALERT_CELLS_OFFSET = 0;
var HR_ALERT_LEVEL_OFFSET = 1;
var HR_ALERT_FLAGS_OFFSET = 2;
var HR_ALERT_WARN_OFFSET = 3;
var HR_ALERT_DANGER_OFFSET = 4;
var HR_ALERT_WARN_COLOR_OFFSET = 5;
var HR_ALERT_DANGER_COLOR_OFFSET = 6;
// The flags byte: bit 0 the item's Look is Icon + value; bit 1 the slot's Alert
// highlighting is on (its switch AND an ordered pair); bits 2-3 the slot's warn look
// (WARN_LOOKS); bits 4-7 reserved, written 0.
var HR_ALERT_VALUE_BIT = 0x01;
var HR_ALERT_HIGHLIGHT_BIT = 0x02;
var HR_ALERT_LOOK_SHIFT = 2;
// The heart rate slot's kind, KINDS' one tuplePair entry: kindConfig resolves the switch,
// pair, warn look and colours that bytes [2]..[6] carry.
var HR_KIND = 0;
while (!KINDS[HR_KIND].tuplePair) { HR_KIND++; }

/**
 * Build the CLAY_HR_ALERT_UINT8 tuple (layout: src/c/appendix/hr_alert.h): the Heart
 * rate On demand item's cells, level and Look, and the heart rate slot's Alert
 * highlighting (kindConfig of HR_KIND, its levels as wireUnits.clampByte bytes). The
 * cells are effective values only (onDemandCell, through sideOf's hrAvailable gate), so
 * a bar that does not exist and a watch without a heart rate to show write 0. Only a
 * KNOWN emery is sent it (clay-payload.js).
 * @param {Object} settings Clay settings blob
 * @param {Object} [env] platform env (config-ui platform.js computeEnv); absent = a
 *     colour watch on which the item cannot show
 * @returns {number[]} HR_ALERT_BYTES-long array
 */
function buildHrAlertBytes(settings, env) {
  var isColor = !env || env.color !== false;
  var cfg = kindConfig(settings, HR_KIND, isColor);
  var bytes = [];
  bytes[HR_ALERT_CELLS_OFFSET] = onDemandCell(settings, 'hr', env);
  bytes[HR_ALERT_LEVEL_OFFSET] = onDemand.hrLevel(settings);
  bytes[HR_ALERT_FLAGS_OFFSET] = (onDemand.hrShowsValue(settings) ? HR_ALERT_VALUE_BIT : 0)
    | (cfg.enabled ? HR_ALERT_HIGHLIGHT_BIT : 0)
    | (WARN_LOOKS[cfg.warnLook] << HR_ALERT_LOOK_SHIFT);
  bytes[HR_ALERT_WARN_OFFSET] = wireUnits.clampByte(cfg.warn);
  bytes[HR_ALERT_DANGER_OFFSET] = wireUnits.clampByte(cfg.danger);
  // The real warn colour whatever the look: cfg.warnColor is null for the look 'none'
  // (the blob's no-outline sentinel), and this tuple carries the look in its flags.
  bytes[HR_ALERT_WARN_COLOR_OFFSET] =
    rainTier.rgbToGColor8(thresholds.thresholdColor(settings, 'Hr', 'Warn'));
  bytes[HR_ALERT_DANGER_COLOR_OFFSET] = rainTier.rgbToGColor8(cfg.dangerColor);
  return bytes;
}

module.exports = {
  SETTINGS_BYTES: SETTINGS_BYTES,
  COLORS_OFFSET: COLORS_OFFSET,
  HEALTH_OFFSET: HEALTH_OFFSET,
  BOLD_OFFSET: BOLD_OFFSET,
  ALERTS_OFFSET: ALERTS_OFFSET,
  BATTERY_OFFSET: BATTERY_OFFSET,
  BATTERY_VALUE_BIT: BATTERY_VALUE_BIT,
  WARN_LOOK_OFFSET: WARN_LOOK_OFFSET,
  ON_DEMAND_OFFSET: ON_DEMAND_OFFSET,
  buildSettingsBlob: buildSettingsBlob,
  packWeatherLevels: packWeatherLevels,
  ALERT_HEADER: ALERT_HEADER,
  ALERT_DANGER: ALERT_DANGER,
  ALERT_DAY_SHIFT: ALERT_DAY_SHIFT,
  ALERT_LEN_MAX: ALERT_LEN_MAX,
  ALERT_ENTRIES_MAX_BYTES: ALERT_ENTRIES_MAX_BYTES,
  bakedAlerts: bakedAlerts,
  packAlerts: packAlerts,
  bakeAlerts: bakeAlerts,
  HR_ALERT_BYTES: HR_ALERT_BYTES,
  HR_KIND: HR_KIND,
  HR_ALERT_CELLS_OFFSET: HR_ALERT_CELLS_OFFSET,
  HR_ALERT_LEVEL_OFFSET: HR_ALERT_LEVEL_OFFSET,
  HR_ALERT_FLAGS_OFFSET: HR_ALERT_FLAGS_OFFSET,
  HR_ALERT_WARN_OFFSET: HR_ALERT_WARN_OFFSET,
  HR_ALERT_DANGER_OFFSET: HR_ALERT_DANGER_OFFSET,
  HR_ALERT_WARN_COLOR_OFFSET: HR_ALERT_WARN_COLOR_OFFSET,
  HR_ALERT_DANGER_COLOR_OFFSET: HR_ALERT_DANGER_COLOR_OFFSET,
  HR_ALERT_VALUE_BIT: HR_ALERT_VALUE_BIT,
  HR_ALERT_HIGHLIGHT_BIT: HR_ALERT_HIGHLIGHT_BIT,
  HR_ALERT_LOOK_SHIFT: HR_ALERT_LOOK_SHIFT,
  buildHrAlertBytes: buildHrAlertBytes
};
