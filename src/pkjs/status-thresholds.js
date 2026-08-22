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

  // 27 -> 29 when UV became kind 7; 29 -> 33 when the bold-only kinds (8..15)
  // widened the bold area to 16 kinds; 33 -> 34 when battery % (kind 16) opened
  // byte 33. (The interim 31-byte, 8-kind-bold format never shipped — it
  // existed only on an unmerged branch — so exactly {34, 33, 29} are accepted;
  // see status_threshold.h.) Byte 33 holds FOUR 2-bit cells (kinds 16..19): dew
  // point (17) and the two phone-battery kinds (18, 19) all appended into it for
  // free, so this stays 34 — but the byte is now FULL, and a twenty-first kind
  // (index 20) is the first that widens the blob and every Clay send with it.
  var SETTINGS_BYTES = 34;
  var COLORS_OFFSET = 1;
  var HEALTH_OFFSET = 17;    // shifted 15 -> 17 with the UV color pair (append-only kinds)
  var BOLD_OFFSET = 29;      // 2 bits per kind: byte 29 + (k >> 2), bits 2 * (k & 3) — bytes 29..33

  // thresh<Kind>BoldMode -> ThreshBold (src/c/appendix/status_threshold.h). The
  // ladder is monotone over the level: danger is bold under every mode, 'warn'
  // adds the warn level, 'always' adds the normal zone too. 'warn' is 0 so a
  // never-configured kind packs as the shipped behaviour.
  var BOLD_MODES = {warn: 0, off: 1, always: 2};
  var DEFAULT_BOLD_MODE = 'warn';

  // DWD pollen reaches the phone as one of these display BANDS (a string, see
  // src/pkjs/weather/pollen.js), NOT a 0-3 number — Number('2-3') is NaN. Map
  // the band to its numeric level (index i -> i/2) so half-bands compare on the
  // same 0 / 0.5 / 1 / 1.5 / 2 / 2.5 / 3 scale the threshold is entered on.
  var POLLEN_BANDS = ['0', '0-1', '1', '1-2', '2', '2-3', '3'];

  // Exported for the config-UI schema (Task 8), which needs the same two
  // values as its defaultValue for the warn/danger color pickers.
  var DEFAULT_WARN_COLOR = 0xFFAA00;
  var DEFAULT_DANGER_COLOR = 0xFF0000;
  // Goal kinds celebrate instead of warn: crossing "close" (the warn slot) outlines
  // in this green, reaching the goal (the danger slot) fills with it. 0x55FF00 =
  // GColorBrightGreen. Their pack-time color fallback AND their page default.
  var DEFAULT_GOAL_COLOR = 0x55FF00;
  // The same green in the page's stored '#RRGGBB' shape — derived, so the two can
  // never disagree. Every settings-page site that seeds or resets the goal color
  // (schema defaults, the outline/reset hooks, onbuild's reseed) reads THIS
  // instead of restating the hex.
  var DEFAULT_GOAL_HEX =
    '#' + ('00000' + DEFAULT_GOAL_COLOR.toString(16).toUpperCase()).slice(-6);

  // Index in this array IS the wire kind id (ThreshKind). key is the settings
  // key stem: thresh<key>Warn / thresh<key>Danger / thresh<key>WarnColor /
  // thresh<key>DangerColor. `goal` kinds (the health trio) use the SAME
  // above-direction machinery as the weather kinds — value rises toward the pair —
  // but with celebratory semantics: warn-slot = "close" (outline), danger-slot =
  // "goal reached" (fill). A per-kind direction axis (below-is-worse) existed
  // once; no shipped kind used it since the goal rework, direction never rides
  // the wire, and the C mirror hardcodes false — so it is retired here, and
  // re-adding it for a genuinely downward-warning kind is purely additive.
  var KINDS = [
    { code: 'aqi',      key: 'Aqi' },
    { code: 'pollen',   key: 'Pollen' },
    { code: 'wind',     key: 'Wind' },
    { code: 'gust',     key: 'Gust' },
    { code: 'steps',    key: 'Steps', goal: true },
    { code: 'sleep',    key: 'Sleep', goal: true },
    { code: 'distance', key: 'Distance', goal: true },
    // UV is a WEATHER kind appended after the health trio (wire ids are
    // append-only): its level packs phone-side at bits 8-9 of the levels wire
    // value, and it carries NO health-threshold blob entry.
    { code: 'uv',       key: 'Uv' },
    // Bold-only kinds (appended, wire ids 8..15): every remaining selectable
    // slot option except battery, which renders a drawn glyph with no text run
    // so a Bold option would be a no-op lie. They own NO enable bit (blob[0]
    // covers the 8 paired kinds only), no color pair, and no health u16 — only
    // their 2-bit bold cell in the bold area (bytes 29..33).
    { code: 'temp',      key: 'Temp', boldOnly: true },
    { code: 'pressure',  key: 'Pressure', boldOnly: true },
    { code: 'sun',       key: 'Sun', boldOnly: true },
    { code: 'date',      key: 'Date', boldOnly: true },
    { code: 'week',      key: 'Week', boldOnly: true },
    { code: 'city',      key: 'City', boldOnly: true },
    { code: 'countdown', key: 'Countdown', boldOnly: true },
    { code: 'hr',        key: 'Hr', boldOnly: true },
    // Battery % (kind 16, appended): unlike the GLYPH battery slot — still
    // kind-less, a drawn glyph has no text run to bold — the % slot renders
    // text, so it owns a bold cell: the first one in byte 33.
    { code: 'batteryPct', key: 'BatteryPct', boldOnly: true },
    // Dew point (kind 17, appended): byte 33's SECOND cell, so SETTINGS_BYTES
    // stays 34 and the Clay message does not grow. Dew is a temperature, and the
    // temp slot already has its own kind, so it needs one too — otherwise its
    // Bold row would have no cell to write.
    { code: 'dew', key: 'Dew', boldOnly: true },
    // Phone battery (kinds 18/19, appended): byte 33's THIRD and FOURTH cells —
    // the last two, so SETTINGS_BYTES still stays 34. TWO wire kinds because the
    // watch must tell the no-icon variant apart from a plain TEXT+ICON_NONE city
    // slot (status_threshold.h), but ONE settings key on purpose: both entries
    // carry key 'PhoneBattery', so the sheet resolver hands both catalog codes
    // the same Bold sheet and buildSettingsBlob reads the one
    // threshPhoneBatteryBoldMode setting twice, writing the SAME mode into both
    // cells. Nothing in the packer keys off `key` being unique — boldModeFor()
    // is a plain per-entry lookup — so the duplicate is a share, not a clash.
    { code: 'phoneBattery', key: 'PhoneBattery', boldOnly: true },
    { code: 'phoneBatteryPlain', key: 'PhoneBattery', boldOnly: true }
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
   * @param {string} keyStem Kind key stem, e.g. 'Steps'.
   * @returns {boolean} true for the celebratory goal kinds (health trio)
   */
  function isGoalKind(keyStem) {
    for (var i = 0; i < KINDS.length; i += 1) {
      if (KINDS[i].key === keyStem) { return Boolean(KINDS[i].goal); }
    }
    return false;
  }

  /**
   * Whether a warn/danger pair ENABLES a kind: both set and ordered — the value
   * rises toward the pair (danger at or above warn). THE one definition of the
   * rule: kindConfig packs with it, and the settings page's toggle hook
   * (blocks.js thresholdToggle) and onLoad derivation (onbuild.js) call it, so
   * the UI can never disagree with what the watch packs.
   * @param {?number} warn Parsed warn threshold (parseThreshold).
   * @param {?number} danger Parsed danger threshold.
   * @returns {boolean} True when the pair is complete and ordered.
   */
  function pairOrdered(warn, danger) {
    return warn !== null && danger !== null && danger >= warn;
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
   * @param {Object} settings Clay settings blob
   * @param {Object} k KINDS entry
   * @returns {string} the kind's stored bold mode, DEFAULT_BOLD_MODE when unset
   */
  function boldModeFor(settings, k) {
    var rawBold = settings && settings['thresh' + k.key + 'BoldMode'];
    return Object.prototype.hasOwnProperty.call(BOLD_MODES, rawBold)
      ? rawBold : DEFAULT_BOLD_MODE;
  }

  /**
   * Resolve one kind's stored settings. enabled requires BOTH thresholds set
   * AND ordered for the kind's direction (pack-time defense in depth — the
   * config UI also rejects inverted pairs on entry).
   * @param {Object} settings Clay settings blob
   * @param {number} kindIndex wire kind id (0..THRESH_KIND_COUNT - 1)
   * @returns {{enabled: boolean, warn: ?number, danger: ?number,
   *            warnColor: ?number, dangerColor: ?number, boldMode: string}}
   */
  function kindConfig(settings, kindIndex) {
    var k = KINDS[kindIndex];
    if (k.boldOnly) {
      // Bold-only kinds own no thresholds, colors, or health pair — boldMode is
      // the only meaningful field. The DEFAULT_BOLD_MODE 'warn' packs 0, and a
      // level-less kind only ever resolves THRESH_LEVEL_NORMAL on the watch, so
      // unset renders non-bold: unset == 'off' visually, only 'always' changes
      // anything.
      return {
        enabled: false, warn: null, danger: null,
        warnColor: null, dangerColor: null,
        boldMode: boldModeFor(settings, k)
      };
    }
    var warn = parseThreshold(settings && settings['thresh' + k.key + 'Warn']);
    var danger = parseThreshold(settings && settings['thresh' + k.key + 'Danger']);
    var ordered = pairOrdered(warn, danger);
    // warnColor null = NO OUTLINE: warn renders as bold text only and the blob
    // carries the 0x00 none-sentinel. Weather kinds DEFAULT to none (only the
    // sheet's outline toggle stores a color); GOAL kinds default to the green
    // outline — for them '' (toggle turned off) means none, while never-touched
    // settings fall back to DEFAULT_GOAL_COLOR, matching the page's
    // outline-on-by-default. A stored NULL counts as off too: it is the old
    // parseResponse bug's footprint for exactly that '' (hexToInt('') = NaN,
    // persisted as null) — a never-touched key is ABSENT from the blob, never
    // null. Danger falls back green for goals, red for weather.
    var rawWarn = settings && settings['thresh' + k.key + 'WarnColor'];
    var warnColor;
    if (rawWarn === '' || rawWarn === null
        || (typeof rawWarn === 'undefined' && !k.goal)) {
      warnColor = null;
    } else if (typeof rawWarn === 'undefined') {
      warnColor = DEFAULT_GOAL_COLOR;
    } else {
      warnColor = colorInt(rawWarn, k.goal ? DEFAULT_GOAL_COLOR : DEFAULT_WARN_COLOR);
    }
    // Bold mode is deliberately NOT gated on `ordered`: 'always' bolds a slot
    // whose kind has no thresholds configured at all.
    return {
      enabled: ordered,
      warn: warn,
      danger: danger,
      warnColor: warnColor,
      dangerColor: colorInt(settings && settings['thresh' + k.key + 'DangerColor'],
                            k.goal ? DEFAULT_GOAL_COLOR : DEFAULT_DANGER_COLOR),
      boldMode: boldModeFor(settings, k)
    };
  }

  /**
   * Level for a value against an ordered pair. Inclusive crossing, mirroring
   * status_threshold_level() in C.
   * @param {number} value the DISPLAYED number for the kind
   * @param {number} warn warn threshold
   * @param {number} danger danger threshold
   * @returns {number} 0 normal / 1 warn / 2 danger
   */
  function computeLevel(value, warn, danger) {
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
    if (code === 'uv') {
      // UV_TREND_UINT8 carries tenths; the slot displays the rounded index
      // (status-lines.js) and thresholds compare the DISPLAYED number.
      v = trendHead(payload.UV_TREND_UINT8);
      return v === null ? null : Math.round(v / 10);
    }
    return null;
  }

  // Bit position of a weather kind's 2-bit level in the packed levels value:
  // the original four sit at bits 2k, UV (appended as kind 7) at bits 8-9.
  function weatherLevelShift(k) {
    return k <= 3 ? 2 * k : 8;
  }

  /**
   * Pack the weather-kind levels into the STATUS_LEVELS_UINT8 wire bytes, LE
   * (kinds 0..3 in byte 0 at bits 2k; UV in byte 1 at bits 0-1). Disabled kinds
   * and missing data stay Normal.
   * @param {Object} payload weather payload (pre-transform)
   * @param {Object} settings Clay settings blob
   * @returns {number[]} two-element byte array (2 wire bytes)
   */
  function packWeatherLevels(payload, settings) {
    var packed = 0;
    for (var k = 0; k < KINDS.length; k++) {
      // Health kinds level on the watch; bold-only kinds have no pair to level.
      if (KINDS[k].goal || KINDS[k].boldOnly) { continue; }
      var cfg = kindConfig(settings, k);
      if (!cfg.enabled) { continue; }
      var v = displayValue(KINDS[k].code, payload, settings);
      if (v === null) { continue; }
      packed |= computeLevel(v, cfg.warn, cfg.danger)
        << weatherLevelShift(k);
    }
    return [packed & 0xFF, (packed >> 8) & 0xFF];
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
   * The statusBoldAll master row ('all') overrides the PACKED bold cell of
   * every kind to BOLD_MODES.always at build time only — the stored
   * thresh<Kind>BoldMode values are never modified, so 'perSlot' restores
   * them on the next build. Enable bits, colors, and health u16s are
   * untouched by the master.
   * @param {Object} settings Clay settings blob
   * @returns {number[]} SETTINGS_BYTES-long array (currently 34 bytes)
   */
  function buildSettingsBlob(settings) {
    var blob = [];
    var i;
    var boldAll = Boolean(settings && settings.statusBoldAll === 'all');
    for (i = 0; i < SETTINGS_BYTES; i++) { blob.push(0); }
    for (var k = 0; k < KINDS.length; k++) {
      var cfg = kindConfig(settings, k);
      blob[BOLD_OFFSET + (k >> 2)] |=
        (boldAll ? BOLD_MODES.always : BOLD_MODES[cfg.boldMode]) << (2 * (k & 3));
      // Bold-only kinds pack ONLY their bold cell: blob[0]'s 8 enable bits and
      // the color/health offsets belong to the paired kinds (0..7) alone.
      if (KINDS[k].boldOnly) { continue; }
      if (cfg.enabled) { blob[0] |= (1 << k); }
      blob[COLORS_OFFSET + 2 * k] = cfg.warnColor === null
        ? 0 : rainTier.rgbToGColor8(cfg.warnColor);   // 0x00 = no-outline sentinel
      blob[COLORS_OFFSET + 2 * k + 1] = rainTier.rgbToGColor8(cfg.dangerColor);
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
    return blob;
  }

  var api = {
    KINDS: KINDS,
    SETTINGS_BYTES: SETTINGS_BYTES,
    COLORS_OFFSET: COLORS_OFFSET,
    HEALTH_OFFSET: HEALTH_OFFSET,
    BOLD_OFFSET: BOLD_OFFSET,
    BOLD_MODES: BOLD_MODES,
    DEFAULT_BOLD_MODE: DEFAULT_BOLD_MODE,
    parseThreshold: parseThreshold,
    pairOrdered: pairOrdered,
    isGoalKind: isGoalKind,
    DEFAULT_GOAL_COLOR: DEFAULT_GOAL_COLOR,
    DEFAULT_GOAL_HEX: DEFAULT_GOAL_HEX,
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
