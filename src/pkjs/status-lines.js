/**
 * Bakes the four packed status-line snapshots into the weather payload.
 * Pure: reads only the payload + settings + watchInfo passed in -- never
 * mutable provider instance fields. ES5 only (aplite PKJS).
 */
var catalog = require('./status-line-catalog.js');
var platformLib = require('./config-ui/lib/platform.js');

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

/**
 * Convert an internal km/h wind value to the display unit and label.
 * @param {number} v wind/gust value in km/h
 * @param {Object} settings Clay settings blob (reads windUnits)
 * @returns {string} e.g. "50kph", "31mph", "27kn"
 */
function formatWind(v, settings) {
  var unit = settings && settings.windUnits;
  if (unit === 'mph') { return Math.round(v / 1.60934) + 'mph'; }
  if (unit === 'knots') { return Math.round(v / 1.852) + 'kn'; }
  return v + 'kph';
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
 * @param {*} targetValue Stored YYYY-MM-DD target.
 * @param {Date} [now] Current local time; injectable for tests.
 * @returns {string} Nd for future, now for today, -- for passed.
 */
function formatCountdown(targetValue, now) {
  var current = now || new Date();
  var today = new Date(current.getFullYear(), current.getMonth(), current.getDate());
  var target = parseCountdownDate(targetValue, today);
  var days = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (days < 0) { return '--'; }
  return days === 0 ? 'now' : days + 'd';
}

/**
 * Format one catalog item's display text from the payload.
 * @param {string} code catalog item code (TEXT kinds only)
 * @param {Object} payload weather payload (pre-transform)
 * @param {Object} settings Clay settings blob
 * @param {string} slotKey Owning status-slot settings key.
 * @returns {string} display text, '--' when the value is unavailable
 */
function formatValue(code, payload, settings, slotKey) {
  var v;
  if (code === 'countdown') {
    return formatCountdown(settings && slotKey
      ? settings[slotKey + 'Countdown'] : undefined);
  }
  if (code === 'temp') {
    if (typeof payload.CURRENT_TEMP !== 'number') { return '--'; }
    var t = payload.CURRENT_TEMP;
    if (settings.temperatureUnits !== 'f') {
      t = Math.round((t - 32) * 5 / 9);
    }
    // Bare number; the thermometer icon carries the "temperature" context (UV/AQI-style).
    return String(t);
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
    return v === null ? '--' : formatWind(v, settings);
  }
  if (code === 'gust') {
    v = trendHead(payload.GUST_TREND_UINT8);
    return v === null ? '--' : formatWind(v, settings);
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
      var valueBytes = utf8Truncate(
        utf8Encode(formatValue(code, payload, settings, key)), textCap(s));
      bytes.push(item.kind, item.icon, valueBytes.length);
      for (var b = 0; b < valueBytes.length; b++) { bytes.push(valueBytes[b]); }
    } else {
      bytes.push(kind, item.icon, 0);
    }
  }
  return bytes;
}

/**
 * Add STATUS_LINE_1..4_UINT8 to the weather payload. Must run BEFORE
 * applyForecastSeries deletes the transient trend arrays.
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
