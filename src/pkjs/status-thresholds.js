/**
 * Status-slot alert levels: the per-kind warn/danger pairs (stored, else the
 * kind's SEED pair — one resolution for the phone bake, the day-max hold rule
 * and the settings page), the level computation for the weather-sourced kinds
 * (phone-side, at weather-bake time) and the packed settings blob (enable bits
 * + colors + health thresholds) the watch consumes for the 3 health kinds.
 *
 * Levels and highlighting are split: a weather kind's LEVEL is computed from
 * its resolved pair whether or not its highlight is on, and the stored
 * thresh<Kind>On toggle alone decides the blob[0] enable bit that tells the
 * watch to colour the slot (see kindConfig).
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
  // Same guard: displayValue (the only consumer, kindLevel reads it) runs
  // phone-side only.
  var wireUnits = (typeof require !== 'undefined')
    ? require('./wire-units.js') : null;

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
   * Whether a warn/danger pair is USABLE: both set and ordered — the value
   * rises toward the pair (danger at or above warn). THE one definition of the
   * rule: resolvedPair takes a stored pair only when it holds, kindConfig
   * re-checks it before setting an enable bit (defence in depth), and the
   * settings page's toggle hook (blocks.js thresholdToggle) calls it, so the UI
   * can never disagree with what the watch packs.
   * @param {?number} warn Parsed warn threshold (parseThreshold).
   * @param {?number} danger Parsed danger threshold.
   * @returns {boolean} True when the pair is complete and ordered.
   */
  function pairOrdered(warn, danger) {
    return warn !== null && danger !== null && danger >= warn;
  }

  // Seed pairs per key stem, in the kind's DISPLAY unit (the unit displayValue
  // and the health packer compare against), resolved per call because wind,
  // gusts, AQI and distance change scale with a settings picker. THE one table:
  // the phone bake, the day-max hold rule and the settings page's slider seeds
  // (blocks.js thresholdRangeCfg) all read it through seedPair, so a blank pair
  // means the same numbers everywhere. Goal kinds: warn = "close" (~80% of the
  // goal), danger = the goal.
  var SEEDS = {
    Uv: function () { return {warn: 6, danger: 8}; },
    Pollen: function () { return {warn: 2, danger: 3}; },
    Wind: function (s) {
      if (s.windUnits === 'mph') { return {warn: 25, danger: 40}; }
      if (s.windUnits === 'knots') { return {warn: 20, danger: 30}; }
      return {warn: 40, danger: 60};
    },
    Gust: function (s) {
      if (s.windUnits === 'mph') { return {warn: 40, danger: 55}; }
      if (s.windUnits === 'knots') { return {warn: 30, danger: 50}; }
      return {warn: 60, danger: 90};
    },
    Aqi: function (s) {
      // The European scale applies only when Open-Meteo is the AQI source AND the
      // scale picker says so; WAQI (and auto, which prefers it) reports US-style AQI.
      return (s.aqiSource === 'openmeteo' && s.aqiScale !== 'us')
        ? {warn: 60, danger: 80} : {warn: 100, danger: 150};
    },
    Steps: function () { return {warn: 8000, danger: 10000}; },
    Sleep: function () { return {warn: 6.5, danger: 7.5}; },
    Distance: function (s) {
      return s.distanceUnits === 'imperial' ? {warn: 2.5, danger: 3} : {warn: 4, danger: 5};
    }
  };

  /**
   * A kind's seed pair — what a blank (or unusable) stored pair means.
   * @param {string} keyStem Kind key stem, e.g. 'Wind'.
   * @param {Object} settings Clay settings blob (windUnits, aqiSource, aqiScale,
   *     distanceUnits).
   * @returns {{warn: ?number, danger: ?number}} the seed in display units; both
   *     null for a stem without one (the bold-only kinds, an unknown stem)
   */
  function seedPair(keyStem, settings) {
    if (!Object.prototype.hasOwnProperty.call(SEEDS, keyStem)) {
      return {warn: null, danger: null};
    }
    return SEEDS[keyStem](settings || {});
  }

  /**
   * The pair a kind is judged against: the stored thresh<Stem>Warn/Danger when
   * BOTH parse AND are ordered, else the seed pair — all or nothing, so a legacy
   * half or inverted pair never mixes one stored number with one seed. The one
   * rule for the phone bake, the hold rule and the settings page.
   * @param {string} keyStem Kind key stem, e.g. 'Uv'.
   * @param {Object} settings Clay settings blob
   * @returns {{warn: ?number, danger: ?number, stored: boolean}} stored is true
   *     when the stored pair won
   */
  function resolvedPair(keyStem, settings) {
    var s = settings || {};
    var warn = parseThreshold(s['thresh' + keyStem + 'Warn']);
    var danger = parseThreshold(s['thresh' + keyStem + 'Danger']);
    if (pairOrdered(warn, danger)) { return {warn: warn, danger: danger, stored: true}; }
    var seed = seedPair(keyStem, s);
    return {warn: seed.warn, danger: seed.danger, stored: false};
  }

  /**
   * @param {*} code A status item code.
   * @returns {?Object} the KINDS entry of a weather kind (neither goal nor
   *     bold-only) with that code, else null
   */
  function weatherKindOf(code) {
    for (var i = 0; i < KINDS.length; i += 1) {
      if (KINDS[i].code === code) {
        return (KINDS[i].goal || KINDS[i].boldOnly) ? null : KINDS[i];
      }
    }
    return null;
  }

  /**
   * The warn level a day-max slot holds today's peak on (wire-units dayMaxShown's
   * `warn`): the kind's resolved warn in display units. Deliberately blind to the
   * highlight toggle — the slot is an alert whether or not it is coloured.
   * @param {*} code A status item code.
   * @param {Object} settings Clay settings blob
   * @returns {?number} the warn for a weather kind; null for goal, bold-only and
   *     unknown codes
   */
  function holdWarn(code, settings) {
    var k = weatherKindOf(code);
    return k ? resolvedPair(k.key, settings).warn : null;
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
   * Resolve the settings page's "auto" highlight colour for the theme this blob is
   * packed FOR. The page stores auto as a concrete black or white (the theme text
   * colour it last derived, blocks.js thresholdColorIsAuto) and re-derives it on
   * every open, but a blob nobody re-saved keeps the old one: 1.11-1.19 never
   * converted it when Theme changed, so a light-then-dark install holds black
   * under a dark theme, and packing that verbatim draws a black outline and fill on
   * the black face -- invisible. So black and white are resolved here, the way the
   * page resolves them: to the packed theme's text colour for weather kinds
   * (settings.theme, which theme-schedule's night copy sets to the night theme),
   * to the goal green for goal kinds. Every other colour is a pick, returned as is.
   * @param {number} c 0xRRGGBB colour, already parsed by colorInt
   * @param {Object} settings Clay settings blob (theme)
   * @param {boolean} goal Whether the kind is a goal kind (the health trio)
   * @returns {number} c, or the auto colour when c is black or white
   */
  function resolveAutoColor(c, settings, goal) {
    if (c !== 0x000000 && c !== 0xFFFFFF) { return c; }
    if (goal) { return DEFAULT_GOAL_COLOR; }
    var theme = settings && settings.theme;
    return (theme === 'light' || theme === 'bw-light') ? 0x000000 : 0xFFFFFF;
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
   * Resolve one kind's stored settings. warn/danger are the RESOLVED pair
   * (resolvedPair: stored when usable, else the seed). enabled — the blob[0]
   * bit that tells the watch to highlight the slot — is the stored toggle
   * thresh<Kind>On === true AND an ordered pair (pack-time defence in depth; a
   * resolved pair is ordered by construction). The toggle owns ONLY that bit
   * (plus the goal u16s, zeroed when off): a weather kind's level is packed
   * regardless (packWeatherLevels).
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
    var pair = resolvedPair(k.key, settings);
    var on = Boolean(settings) && settings['thresh' + k.key + 'On'] === true;
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
      warnColor = resolveAutoColor(
        colorInt(rawWarn, k.goal ? DEFAULT_GOAL_COLOR : DEFAULT_WARN_COLOR), settings, k.goal);
    }
    // Bold mode is deliberately NOT gated on `enabled`: 'always' bolds a slot
    // whose kind has its highlight off.
    return {
      enabled: on && pairOrdered(pair.warn, pair.danger),
      warn: pair.warn,
      danger: pair.danger,
      warnColor: warnColor,
      dangerColor: resolveAutoColor(
        colorInt(settings && settings['thresh' + k.key + 'DangerColor'],
                 k.goal ? DEFAULT_GOAL_COLOR : DEFAULT_DANGER_COLOR), settings, k.goal),
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
   * The number the user SEES for a weather kind — thresholds compare against
   * the displayed value. The readers are SHARED with status-lines.js through
   * wire-units (dayMaxShown), so the two cannot round apart or
   * disagree on which peak is shown.
   *
   * The day-max kinds (UV, wind, gusts, AQI) judge the highest of TODAY's
   * numbers shown. An unmarked peak is never below now by construction, so "2/8"
   * is highlighted for the 8. The hold rule gets the kind's resolved warn
   * (holdWarn), so today's peak stays on screen while it is at or above warn:
   * a 7 falling from an 8 under warn 6 prints "7" in every mode and is judged
   * on the 7 — the highlight can never go silent while today is still worth
   * warning about. Tomorrow's marked peak shows only once today's is below warn
   * (and behind us), and never counts until it is today's: "5/»8" is judged on
   * the 5 and a lone "»8" not at all (null).
   * @param {string} code 'aqi' | 'pollen' | 'wind' | 'gust' | 'uv'
   * @param {Object} payload weather payload (pre-transform, trends present)
   * @param {Object} settings Clay settings blob (windUnits, <kind>SlotDisplay,
   *     the kind's thresh pair and the seed-unit pickers)
   * @returns {number|null} displayed number, or null when unavailable
   */
  function displayValue(code, payload, settings) {
    var s = settings || {};
    if (wireUnits.isDayMaxKind(code)) {
      return todaysShown(wireUnits.dayMaxShown(code, payload, s, holdWarn(code, s)));
    }
    if (code === 'pollen') {
      var pt = payload.POLLEN_TODAY;
      if (pt === null || typeof pt === 'undefined') { return null; }
      // POLLEN_TODAY is a DWD band string, not a number — map it to its level.
      var idx = POLLEN_BANDS.indexOf(String(pt));
      return idx < 0 ? null : idx / 2;   // 7 bands -> 0,0.5,1,1.5,2,2.5,3
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
   * A weather kind's level for the value its slot shows, against the resolved
   * pair — toggle-agnostic: the level says how high the value is, the highlight
   * toggle only says whether the watch colours it.
   * @param {string} code 'aqi' | 'pollen' | 'wind' | 'gust' | 'uv'
   * @param {Object} payload weather payload (pre-transform, trends present)
   * @param {Object} settings Clay settings blob
   * @returns {?number} 0 normal / 1 warn / 2 danger; null when there is no
   *     displayed number or the code is not a weather kind
   */
  function kindLevel(code, payload, settings) {
    var k = weatherKindOf(code);
    if (!k) { return null; }
    var v = displayValue(code, payload, settings);
    if (v === null) { return null; }
    var pair = resolvedPair(k.key, settings);
    return computeLevel(v, pair.warn, pair.danger);
  }

  /**
   * Pack the weather-kind levels into the STATUS_LEVELS_UINT8 wire bytes, LE
   * (kinds 0..3 in byte 0 at bits 2k; UV in byte 1 at bits 0-1). Every weather
   * kind packs its level whether or not its highlight is on — only missing data
   * stays Normal. That is watch-safe: status_row.c's slot_level checks the
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
      // Health kinds level on the watch; bold-only kinds have no pair to level.
      if (KINDS[k].goal || KINDS[k].boldOnly) { continue; }
      var level = kindLevel(KINDS[k].code, payload, settings);
      if (level === null) { continue; }
      packed |= level << weatherLevelShift(k);
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
    SEEDS: SEEDS,
    seedPair: seedPair,
    resolvedPair: resolvedPair,
    holdWarn: holdWarn,
    isGoalKind: isGoalKind,
    DEFAULT_GOAL_COLOR: DEFAULT_GOAL_COLOR,
    DEFAULT_GOAL_HEX: DEFAULT_GOAL_HEX,
    kindConfig: kindConfig,
    computeLevel: computeLevel,
    displayValue: displayValue,
    kindLevel: kindLevel,
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
