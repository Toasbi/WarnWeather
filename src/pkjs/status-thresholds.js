/**
 * Status-slot threshold highlighting: level computation for the 4 weather-
 * sourced kinds (phone-side, at weather-bake time) and the packed settings
 * blob (enabled bits + colors + health thresholds) the watch consumes for the
 * 3 health kinds.
 *
 * LOCKSTEP: kind order, level values, and blob layout mirror
 * src/c/appendix/status_threshold.h; test/status-thresholds-contract.test.js
 * enforces it. ES5 only (aplite PKJS).
 */
(function() {
  // Guarded: in the flat concatenated config page there is no require();
  // buildSettingsBlob (the only rainTier consumer) is never called there.
  var rainTier = (typeof require !== 'undefined')
    ? require('./weather/rain-tier.js') : null;

  var SETTINGS_BYTES = 27;
  var COLORS_OFFSET = 1;
  var HEALTH_OFFSET = 15;

  // DWD pollen reaches the phone as one of these display BANDS (a string, see
  // src/pkjs/weather/pollen.js), NOT a 0-3 number — Number('2-3') is NaN. Map
  // the band to its numeric level (index i -> i/2) so half-bands compare on the
  // same 0 / 0.5 / 1 / 1.5 / 2 / 2.5 / 3 scale the threshold is entered on.
  var POLLEN_BANDS = ['0', '0-1', '1', '1-2', '2', '2-3', '3'];

  // Exported for the config-UI schema (Task 8), which needs the same two
  // values as its defaultValue for the warn/danger color pickers.
  var DEFAULT_WARN_COLOR = 0xFFAA00;
  var DEFAULT_DANGER_COLOR = 0xFF0000;

  // Index in this array IS the wire kind id (ThreshKind). key is the settings
  // key stem: thresh<key>Warn / thresh<key>Danger / thresh<key>WarnColor /
  // thresh<key>DangerColor.
  var KINDS = [
    { code: 'aqi',      key: 'Aqi',      belowIsWorse: false },
    { code: 'pollen',   key: 'Pollen',   belowIsWorse: false },
    { code: 'wind',     key: 'Wind',     belowIsWorse: false },
    { code: 'gust',     key: 'Gust',     belowIsWorse: false },
    { code: 'steps',    key: 'Steps',    belowIsWorse: true },
    { code: 'sleep',    key: 'Sleep',    belowIsWorse: true },
    { code: 'distance', key: 'Distance', belowIsWorse: true }
  ];

  /**
   * @param {*} v raw settings field ('' = unset; comma decimals accepted)
   * @returns {number|null} parsed threshold, or null when unset/non-numeric
   */
  function parseThreshold(v) {
    if (v === null || typeof v === 'undefined') { return null; }
    var s = String(v).replace(/,/g, '.').replace(/\s/g, '');
    if (s === '') { return null; }
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  /**
   * @param {string} keyStem settings key stem, e.g. 'Steps'
   * @returns {boolean} the kind's fixed direction; false for unknown stems
   */
  function belowIsWorse(keyStem) {
    for (var i = 0; i < KINDS.length; i++) {
      if (KINDS[i].key === keyStem) { return KINDS[i].belowIsWorse; }
    }
    return false;
  }

  /**
   * @param {*} v color setting (0xRRGGBB int; '#RRGGBB' string tolerated)
   * @param {number} fallback default when unset/unparseable
   * @returns {number} 0xRRGGBB int
   */
  function colorInt(v, fallback) {
    if (typeof v === 'number' && isFinite(v)) { return v; }
    if (typeof v === 'string' && v) {
      var s = v.charAt(0) === '#' ? v.slice(1) : v;
      var n = parseInt(s, 16);
      if (isFinite(n)) { return n; }
    }
    return fallback;
  }

  /**
   * Resolve one kind's stored settings. enabled requires BOTH thresholds set
   * AND ordered for the kind's direction (pack-time defense in depth — the
   * config UI also rejects inverted pairs on entry).
   * @param {Object} settings Clay settings blob
   * @param {number} kindIndex wire kind id (0..6)
   * @returns {{enabled: boolean, warn: ?number, danger: ?number,
   *            warnColor: number, dangerColor: number}}
   */
  function kindConfig(settings, kindIndex) {
    var k = KINDS[kindIndex];
    var warn = parseThreshold(settings && settings['thresh' + k.key + 'Warn']);
    var danger = parseThreshold(settings && settings['thresh' + k.key + 'Danger']);
    var ordered = warn !== null && danger !== null
      && (k.belowIsWorse ? danger <= warn : danger >= warn);
    // warnColor null = NO OUTLINE (the default): warn renders as bold text only,
    // and the blob carries the 0x00 none-sentinel. Only an explicitly stored color
    // (the sheet's "Warn outline" toggle seeds one) draws the warn box.
    var rawWarn = settings && settings['thresh' + k.key + 'WarnColor'];
    return {
      enabled: ordered,
      warn: warn,
      danger: danger,
      warnColor: (rawWarn === '' || rawWarn === null || typeof rawWarn === 'undefined')
        ? null : colorInt(rawWarn, DEFAULT_WARN_COLOR),
      dangerColor: colorInt(settings && settings['thresh' + k.key + 'DangerColor'],
                            DEFAULT_DANGER_COLOR)
    };
  }

  /**
   * Level for a value against an ordered pair. Inclusive crossing, mirroring
   * status_threshold_level() in C.
   * @param {number} value the DISPLAYED number for the kind
   * @param {number} warn warn threshold
   * @param {number} danger danger threshold
   * @param {boolean} isBelowWorse the kind's fixed direction
   * @returns {number} 0 normal / 1 warn / 2 danger
   */
  function computeLevel(value, warn, danger, isBelowWorse) {
    if (isBelowWorse) {
      if (value <= danger) { return 2; }
      if (value <= warn) { return 1; }
      return 0;
    }
    if (value >= danger) { return 2; }
    if (value >= warn) { return 1; }
    return 0;
  }

  /**
   * @param {number[]|null|undefined} arr trend byte array
   * @returns {number|null} first trend value, or null when unavailable
   */
  function trendHead(arr) {
    return (arr && arr.length) ? arr[0] : null;
  }

  /**
   * The number the user SEES for a weather kind — thresholds compare against
   * the displayed value, so the conversions/rounding must mirror
   * status-lines.js formatValue()/formatWind() exactly.
   * @param {string} code 'aqi' | 'pollen' | 'wind' | 'gust'
   * @param {Object} payload weather payload (pre-transform, trends present)
   * @param {Object} settings Clay settings blob (windUnits)
   * @returns {number|null} displayed number, or null when unavailable
   */
  function displayValue(code, payload, settings) {
    var v;
    if (code === 'aqi') {
      v = trendHead(payload.AQI_TREND);
      return v === null ? null : Math.round(v);
    }
    if (code === 'pollen') {
      var pt = payload.POLLEN_TODAY;
      if (pt === null || typeof pt === 'undefined') { return null; }
      // POLLEN_TODAY is a DWD band string, not a number — map it to its level.
      var idx = POLLEN_BANDS.indexOf(String(pt));
      return idx < 0 ? null : idx / 2;   // 7 bands -> 0,0.5,1,1.5,2,2.5,3
    }
    if (code === 'wind' || code === 'gust') {
      v = trendHead(code === 'wind' ? payload.WIND_TREND_UINT8
                                    : payload.GUST_TREND_UINT8);
      if (v === null) { return null; }
      var unit = settings && settings.windUnits;
      if (unit === 'mph') { return Math.round(v / 1.60934); }
      if (unit === 'knots') { return Math.round(v / 1.852); }
      return v;
    }
    return null;
  }

  /**
   * Pack the 4 weather-kind levels into the STATUS_LEVELS_UINT8 wire byte
   * (kind k at bits 2k..2k+1). Disabled kinds and missing data stay Normal.
   * @param {Object} payload weather payload (pre-transform)
   * @param {Object} settings Clay settings blob
   * @returns {number[]} single-element byte array (1 wire byte)
   */
  function packWeatherLevels(payload, settings) {
    var packed = 0;
    for (var k = 0; k < 4; k++) {
      var cfg = kindConfig(settings, k);
      if (!cfg.enabled) { continue; }
      var v = displayValue(KINDS[k].code, payload, settings);
      if (v === null) { continue; }
      packed |= computeLevel(v, cfg.warn, cfg.danger, KINDS[k].belowIsWorse) << (2 * k);
    }
    return [packed];
  }

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
   * @param {Object} settings Clay settings blob
   * @returns {number[]} 27-byte array
   */
  function buildSettingsBlob(settings) {
    var blob = [];
    var i;
    for (i = 0; i < SETTINGS_BYTES; i++) { blob.push(0); }
    for (var k = 0; k < KINDS.length; k++) {
      var cfg = kindConfig(settings, k);
      if (cfg.enabled) { blob[0] |= (1 << k); }
      blob[COLORS_OFFSET + 2 * k] = cfg.warnColor === null
        ? 0 : rainTier.rgbToGColor8(cfg.warnColor);   // 0x00 = no-outline sentinel
      blob[COLORS_OFFSET + 2 * k + 1] = rainTier.rgbToGColor8(cfg.dangerColor);
      if (k >= 4) {
        var off = HEALTH_OFFSET + 4 * (k - 4);
        var warn = cfg.enabled ? healthWire(k, cfg.warn, settings) : 0;
        var danger = cfg.enabled ? healthWire(k, cfg.danger, settings) : 0;
        blob[off] = warn & 0xFF;
        blob[off + 1] = (warn >> 8) & 0xFF;
        blob[off + 2] = danger & 0xFF;
        blob[off + 3] = (danger >> 8) & 0xFF;
      }
    }
    return blob;
  }

  var api = {
    KINDS: KINDS,
    SETTINGS_BYTES: SETTINGS_BYTES,
    COLORS_OFFSET: COLORS_OFFSET,
    HEALTH_OFFSET: HEALTH_OFFSET,
    parseThreshold: parseThreshold,
    belowIsWorse: belowIsWorse,
    kindConfig: kindConfig,
    computeLevel: computeLevel,
    displayValue: displayValue,
    packWeatherLevels: packWeatherLevels,
    buildSettingsBlob: buildSettingsBlob,
    DEFAULT_WARN_COLOR: DEFAULT_WARN_COLOR,
    DEFAULT_DANGER_COLOR: DEFAULT_DANGER_COLOR
  };

  // Dual-context export — mirror the tail of src/pkjs/status-line-catalog.js.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.StatusThresholds = api;
  }
})();
