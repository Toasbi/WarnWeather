/**
 * Bakes the four packed status-line snapshots into the weather payload.
 * Pure: reads only the payload + settings + watchInfo passed in -- never
 * mutable provider instance fields. ES5 only (aplite PKJS).
 */
var catalog = require('./status-line-catalog.js');
var platformLib = require('./config-ui/lib/platform.js');
var thresholds = require('./status-thresholds.js');
var pressurePlausibility = require('./weather/pressure-plausibility.js');

// Slot positions by index, the catalog's slot-context vocabulary.
var POSITIONS = ['left', 'mid', 'right'];

/**
 * @param {string} str
 * @returns {number[]} UTF-8 bytes
 */
function utf8Encode(str) {
  var out = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      var lo = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        c = 0x10000 + ((c - 0xD800) << 10) + (lo - 0xDC00);
        i++;
      } else {
        c = 0xFFFD;
      }
    } else if (c >= 0xDC00 && c <= 0xDFFF) {
      c = 0xFFFD;
    }
    if (c < 0x80) {
      out.push(c);
    } else if (c < 0x800) {
      out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F));
    } else if (c < 0x10000) {
      out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    } else {
      out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 0x3F),
               0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F));
    }
  }
  return out;
}

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
 * @param {number[]} sunEvents packed SUN_EVENTS wire bytes
 * @returns {{startType: number, epoch: number}|null} the next sun event
 */
function decodeFirstSunEvent(sunEvents) {
  if (!sunEvents || sunEvents.length < 5) { return null; }
  return { startType: sunEvents[0], epoch: readInt32LE(sunEvents, 1) };
}

/**
 * @param {number} n
 * @returns {string} a two-digit decimal string
 */
function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/**
 * Compact clock string for the sun slot. Hour conversion and leading-zero
 * handling mirror config_format_time in src/c/appendix/config.c. The optional
 * lowercase marker is the compact equivalent of time_layer.c's AM/PM layer.
 * @param {number} epoch Unix epoch seconds
 * @param {Object} settings Clay settings blob
 * @returns {string} e.g. "17:04", "5:04p", or "05:04p"
 */
function formatSunTime(epoch, settings) {
  var d = new Date(epoch * 1000);
  var h = d.getHours();
  var m = d.getMinutes();
  var displayHour = h;
  var marker = '';
  if (settings.axisTimeFormat === '12h') {
    displayHour = h % 12;
    if (displayHour === 0) { displayHour = 12; }
    if (settings.timeShowAmPm) { marker = h < 12 ? 'a' : 'p'; }
  }
  var hourText = settings.timeLeadingZero ? pad2(displayHour) : String(displayHour);
  return hourText + ':' + pad2(m) + marker;
}

/**
 * @param {number[]|null|undefined} arr trend byte array
 * @returns {number|null} first trend value, or null when unavailable
 */
function trendHead(arr) {
  return (arr && arr.length) ? arr[0] : null;
}

/**
 * ISO-8601 week number (1..53) for a local date. Mirrors the watch-side iso_week()
 * used on non-aplite so the phone-baked aplite week matches other platforms.
 * @param {Date} d local date
 * @returns {number}
 */
function isoWeek(d) {
  var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var day = (t.getUTCDay() + 6) % 7;               // Mon=0 .. Sun=6
  t.setUTCDate(t.getUTCDate() - day + 3);           // Thursday of this ISO week
  var firstThursday = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  var fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  return 1 + Math.round((t - firstThursday) / 604800000); // 7*24*3600*1000
}

// The DEGREE SIGN ALONE for the temperature and dew-point slots -- never '°C' /
// '°F'. The letter would only repeat the global temperature-unit setting, and
// these are the two units that cost TWO UTF-8 bytes instead of one, which is what
// makes the edge-slot cap a real constraint (see withUnit).
var DEGREE = '°';

/**
 * Whether one slot's per-kind "Show unit" toggle is on.
 * An ABSENT key means the kind's default: the four slots that show a unit today
 * (wind, gust, pressure, countdown) default on and the two bare ones (temp, dew)
 * default off, so a settings blob written before this feature renders exactly as
 * it always did.
 * @param {Object} settings Clay settings blob
 * @param {string} key the toggle's settings key, e.g. 'windSlotUnit'
 * @param {boolean} dflt the kind's default when the key is absent
 * @returns {boolean}
 */
function unitEnabled(settings, key, dflt) {
  var v = settings ? settings[key] : undefined;
  return (typeof v === 'undefined' || v === null) ? dflt : Boolean(v);
}

/**
 * Append a unit to a slot value, but only when the result still fits the slot.
 *
 * The cap guard lives HERE rather than in packLine because the unit is part of
 * the value's presentation and this module is the only place that knows which
 * unit each kind carries. packLine's utf8Truncate would otherwise chop an
 * overlong unit back off at the code-point boundary -- the two-byte degree would
 * VANISH whole, so an over-cap slot would look untouched while silently ignoring
 * the user's setting. Dropping the unit deliberately makes that the same visible
 * outcome, arrived at on purpose and testable.
 *
 * @param {string} value the bare formatted value
 * @param {string} unit the unit to append; '' when the toggle is off
 * @param {number} [cap] the slot's byte cap; defaults to the narrow edge cap
 * @returns {string} value + unit when it fits the cap, else value alone
 */
function withUnit(value, unit, cap) {
  if (!unit) { return value; }
  var limit = typeof cap === 'number' ? cap : catalog.CAPS.EDGE_TEXT_MAX;
  var combined = value + unit;
  return utf8Encode(combined).length <= limit ? combined : value;
}

/**
 * Convert an internal km/h wind value to the display unit, value and label apart
 * so the caller can drop the label. One switch, not two, keeps the conversion
 * and its label from ever disagreeing.
 * @param {number} v wind/gust value in km/h
 * @param {Object} settings Clay settings blob (reads windUnits)
 * @returns {{value: string, unit: string}} e.g. {value: "50", unit: "kph"}
 */
function windParts(v, settings) {
  var unit = settings && settings.windUnits;
  if (unit === 'mph') { return { value: String(Math.round(v / 1.60934)), unit: 'mph' }; }
  if (unit === 'knots') { return { value: String(Math.round(v / 1.852)), unit: 'kn' }; }
  return { value: String(v), unit: 'kph' };
}

/**
 * Convert an internal km/h wind value to the display unit and label.
 * @param {number} v wind/gust value in km/h
 * @param {Object} settings Clay settings blob (reads windUnits)
 * @param {boolean} showUnit whether this slot's "Show unit" toggle is on
 * @param {number} [cap] the slot's byte cap
 * @returns {string} e.g. "50kph", "31mph", "27kn", or a bare "50"
 */
function formatWind(v, settings, showUnit, cap) {
  var parts = windParts(v, settings);
  return withUnit(parts.value, showUnit ? parts.unit : '', cap);
}

/**
 * Convert an internal °F temperature to the display unit as a bare number.
 * Shared by the actual and feels-like halves of the temp slot and by the dew
 * point slot, so all three ride the identical conversion/rounding path.
 * Rounds LAST, in both units: the temp/feels callers already pass whole °F, but
 * DEW_TREND carries the provider's unrounded reading (kept unrounded so the °C
 * conversion rounds once rather than twice), and an unrounded °F would render as
 * "53.6" — four characters of nonsense in an 8-byte slot.
 * @param {number} vF temperature in °F
 * @param {Object} settings Clay settings blob (reads temperatureUnits)
 * @returns {string} e.g. "20" or "-12"
 */
function formatTemp(vF, settings) {
  var t = vF;
  if (settings.temperatureUnits !== 'f') {
    t = (t - 32) * 5 / 9;
  }
  return String(Math.round(t));
}

/**
 * Parse YYYY-MM-DD at local midnight, returning fallback for malformed or
 * normalized-away dates such as 2028-02-31.
 * @param {*} value Stored settings value.
 * @param {Date} fallback Valid local-midnight fallback.
 * @returns {Date} Parsed local-midnight date or fallback.
 */
function parseCountdownDate(value, fallback) {
  var parts = typeof value === 'string' ? value.split('-') : [];
  if (parts.length !== 3 || !/^\d{4}$/.test(parts[0])
      || !/^\d{2}$/.test(parts[1]) || !/^\d{2}$/.test(parts[2])) {
    return fallback;
  }
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10);
  var day = parseInt(parts[2], 10);
  var parsed = new Date(1970, 0, 1);
  parsed.setFullYear(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1
      || parsed.getDate() !== day) {
    return fallback;
  }
  return parsed;
}

/**
 * Format whole local calendar days until a target date.
 * 'now' and '--' never take the unit: neither is a count of days.
 * @param {*} targetValue Stored YYYY-MM-DD target.
 * @param {Date} [now] Current local time; injectable for tests.
 * @param {boolean} [showUnit] Whether countdownSlotUnit is on; absent = its default (on).
 * @param {number} [cap] The slot's byte cap.
 * @returns {string} Nd for future, now for today, -- for passed.
 */
function formatCountdown(targetValue, now, showUnit, cap) {
  var current = now || new Date();
  var today = new Date(current.getFullYear(), current.getMonth(), current.getDate());
  var target = parseCountdownDate(targetValue, today);
  var days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days < 0) { return '--'; }
  if (days === 0) { return 'now'; }
  return withUnit(String(days), showUnit === false ? '' : 'd', cap);
}

/**
 * Format one catalog item's display text from the payload.
 * @param {string} code catalog item code (TEXT kinds only)
 * @param {Object} payload weather payload (pre-transform)
 * @param {Object} settings Clay settings blob
 * @param {string} slotKey Owning status-slot settings key.
 * @param {number} [cap] The slot's byte cap; defaults to the narrow edge cap.
 *   Only the per-kind unit consults it -- the value itself is still truncated by
 *   the caller, which owns the wire.
 * @returns {string} display text, '--' when the value is unavailable
 */
function formatValue(code, payload, settings, slotKey, cap) {
  var v;
  if (code === 'countdown') {
    return formatCountdown(settings && slotKey
      ? settings[slotKey + 'Countdown'] : undefined, undefined,
      unitEnabled(settings, 'countdownSlotUnit', true), cap);
  }
  if (code === 'temp') {
    if (typeof payload.CURRENT_TEMP !== 'number') { return '--'; }
    // Global per-kind display mode (temp slot's Edit sheet); absent = 'actual'.
    var mode = settings.tempSlotDisplay;
    // Off by default: the thermometer icon already says "temperature", so the
    // degree is opt-in and today's bare number stays the default rendering.
    // 'both' never takes one: "-12/-10" is already 7 of an edge slot's 8 bytes,
    // so the degree would appear or vanish with the digit count. The settings
    // page keeps the two apart (blocks.js' tempUnitExclusive hook), and this is
    // the authoritative gate -- a blob stored before that hook existed, or any
    // future caller, still cannot combine them. Same shape and same reason as
    // buildForecastSeries' `secMetric !== 'feels'` fill guard.
    var degree = (mode !== 'both' && unitEnabled(settings, 'tempSlotUnit', false))
      ? DEGREE : '';
    var actual = formatTemp(payload.CURRENT_TEMP, settings);
    if (mode === 'feels' || mode === 'both') {
      // Missing/null FEELS_CURRENT (stale pre-upgrade cache, provider gap):
      // every mode falls back to the actual temp alone -- never '--/--' or '12/--'.
      if (typeof payload.FEELS_CURRENT === 'number') {
        var feels = formatTemp(payload.FEELS_CURRENT, settings);
        // 'both' is slash-separated, actual first. It carries no degree at all
        // (see above); 'feels' takes one like the plain reading does.
        return withUnit(mode === 'feels' ? feels : actual + '/' + feels, degree, cap);
      }
    }
    return withUnit(actual, degree, cap);
  }
  if (code === 'city') { return payload.CITY || '--'; }
  if (code === 'sun') {
    var ev = decodeFirstSunEvent(payload.SUN_EVENTS);
    return ev ? formatSunTime(ev.epoch, settings) : '--';
  }
  if (code === 'uv') {
    v = trendHead(payload.UV_TREND_UINT8);
    return v === null ? '--' : String(Math.round(v / 10));
  }
  if (code === 'wind') {
    v = trendHead(payload.WIND_TREND_UINT8);
    return v === null ? '--'
      : formatWind(v, settings, unitEnabled(settings, 'windSlotUnit', true), cap);
  }
  if (code === 'gust') {
    v = trendHead(payload.GUST_TREND_UINT8);
    return v === null ? '--'
      : formatWind(v, settings, unitEnabled(settings, 'gustSlotUnit', true), cap);
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
      unitEnabled(settings, 'pressureSlotUnit', true) ? 'hPa' : '', cap);
  }
  if (code === 'dew') {
    v = trendHead(payload.DEW_TREND);
    // Bare by default: the droplets icon carries the "dew point" context, the
    // temp / UV / AQI convention. formatTemp is the temperature slot's own
    // converter, so both slots follow temperatureUnits through identical
    // rounding -- and both take the same opt-in degree. Unsourced (a provider
    // that omits it, e.g. Yandex) degrades to '--' like pressure.
    return v === null ? '--' : withUnit(formatTemp(v, settings),
      unitEnabled(settings, 'dewSlotUnit', false) ? DEGREE : '', cap);
  }
  if (code === 'aqi') {
    v = trendHead(payload.AQI_TREND);
    // Bare index; the leaf icon carries the "air quality" context (UV-style).
    return v === null ? '--' : String(Math.round(v));
  }
  if (code === 'pollen') {
    return payload.POLLEN_TODAY === null || typeof payload.POLLEN_TODAY === 'undefined'
      ? '--' : String(payload.POLLEN_TODAY);
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
 * @returns {number} 0x01..0x10, or 0 when no arrow should be drawn
 */
function directionSentinel(code, payload, settings, env, text) {
  // Never on aplite: its lean status-row twin has no arrow and would draw the
  // control byte as a glyph box.
  if (!settings || !env || env.platform === 'aplite') { return 0; }
  if (code !== 'wind' && code !== 'gust') { return 0; }
  var on = code === 'wind' ? settings.windSlotDirection : settings.gustSlotDirection;
  if (!on) { return 0; }
  // The speed and the bearing fail INDEPENDENTLY -- a provider can report a
  // bearing for an hour whose speed is missing. An arrow beside a dead reading
  // reads as live data next to nothing, so the arrow follows the value: no
  // number, no arrow. (The caller passes the already-formatted text so this
  // check can never disagree with what the slot actually shows.)
  if (text === '--') { return 0; }
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
 * @param {Object} line catalog line definition
 * @param {Object} payload weather payload
 * @param {Object} settings Clay settings blob
 * @param {Object} env platform environment
 * @returns {number[]} packed three-slot line
 */
function packLine(line, payload, settings, env) {
  var bytes = [];
  for (var s = 0; s < 3; s++) {
    var key = line.slots[s];
    var stored = settings ? settings[key] : null;
    var code = catalog.resolveSelection(stored || line.defaults[key], settings, env,
                                        { slotKey: key, position: POSITIONS[s] });
    var item = catalog.byCode(code) || catalog.byCode('empty');
    // Distance carries its unit in the wire kind (phone-only distanceUnits): the
    // watch renders km for LIVE_DISTANCE and mi for LIVE_DISTANCE_MI. Every other
    // item keeps its catalog kind unchanged.
    var kind = item.kind;
    if (code === 'distance' && settings && settings.distanceUnits === 'imperial') {
      kind = catalog.KINDS.LIVE_DISTANCE_MI;
    }
    if (env.platform === 'aplite' && item.kind === catalog.KINDS.LIVE_WEEK) {
      // aplite has no watch-side iso_week() (reaped for image budget), so the
      // phone bakes the ISO week as an ordinary TEXT slot instead.
      var weekBytes = utf8Truncate(utf8Encode('W' + isoWeek(new Date())), textCap(s));
      bytes.push(catalog.KINDS.TEXT, item.icon, weekBytes.length);
      for (var wb = 0; wb < weekBytes.length; wb++) { bytes.push(weekBytes[wb]); }
    } else if (item.kind === catalog.KINDS.TEXT) {
      // The cap goes DOWN into formatValue so a per-kind unit can decline to
      // append itself rather than be silently chopped off again by utf8Truncate
      // below (see withUnit). The truncation still guards the value itself.
      var text = formatValue(code, payload, settings, key, textCap(s));
      var valueBytes = utf8Truncate(utf8Encode(text), textCap(s));
      // Wind-direction arrow: one trailing sentinel byte, appended AFTER the
      // truncation so it can never be split or push the slot past its cap, and
      // only when a byte is actually free. Bytes < 0x80 are valid UTF-8, so the
      // watch's blob validator needs no change and the arrow rides inside the
      // slot's already-paid-for text bytes -- zero wire cost. The watch strips
      // the byte before measuring or drawing the text.
      var dirByte = directionSentinel(code, payload, settings, env, text);
      if (dirByte && valueBytes.length < textCap(s)) { valueBytes.push(dirByte); }
      bytes.push(item.kind, item.icon, valueBytes.length);
      for (var b = 0; b < valueBytes.length; b++) { bytes.push(valueBytes[b]); }
    } else {
      bytes.push(kind, item.icon, 0);
    }
  }
  return bytes;
}

/**
 * Add STATUS_LINE_1..4_UINT8 AND the packed STATUS_LEVELS_UINT8 threshold
 * byte to the weather payload. Must run BEFORE applyForecastSeries deletes
 * the transient trend arrays (AQI_TREND, WIND_TREND_UINT8, GUST_TREND_UINT8,
 * PRESSURE_TREND, POLLEN_TODAY) -- both the status text and the threshold
 * levels are read from them.
 * @param {Object} payload weather payload (mutated)
 * @param {Object} settings Clay settings blob
 * @param {Object|null} watchInfo Pebble.getActiveWatchInfo() result
 * @returns {Object} the same payload
 */
function buildStatusLines(payload, settings, watchInfo) {
  var env = platformLib.computeEnv(watchInfo);
  for (var l = 0; l < catalog.LINES.length; l++) {
    var line = catalog.LINES[l];
    payload[line.wireKey] = packLine(line, payload, settings, env);
  }
  // Packed weather-kind threshold levels: computed here because the raw
  // AQI/pollen/wind/gust values exist only phone-side (the watch gets text).
  // Skipped for a watch that compiles the highlight out (aplite — no
  // WW_THRESHOLD_HIGHLIGHT, so its inbox handler for this tuple is gone too):
  // sending it would only spend BLE bytes and inbox budget on a tuple that is
  // read and discarded. The 'status' category still carries the four line blobs,
  // so the change detector is unaffected.
  if (env.thresholds) {
    payload.STATUS_LEVELS_UINT8 = thresholds.packWeatherLevels(payload, settings);
  }
  return payload;
}

module.exports = {
  buildStatusLines: buildStatusLines,
  packLine: packLine,
  formatValue: formatValue,
  formatCountdown: formatCountdown,
  utf8Encode: utf8Encode,
  utf8Truncate: utf8Truncate,
  isoWeek: isoWeek
};
