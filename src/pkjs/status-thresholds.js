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
  // Same guard: displayValue and the alert bake (its only consumers) run
  // phone-side only.
  var wireUnits = (typeof require !== 'undefined')
    ? require('./wire-units.js') : null;

  // 27 -> 29 when UV became kind 7; 29 -> 33 when the bold-only kinds (8..15)
  // widened the bold area to 16 kinds; 33 -> 34 when battery % (kind 16) opened
  // byte 33; 34 -> 36 when the two alert bytes were appended (the rain look, then
  // the per-bar placement). (The interim 31-byte, 8-kind-bold format never
  // shipped — it existed only on an unmerged branch — so exactly
  // {36, 35, 34, 33, 29} are accepted; see status_threshold.h.) Byte 33 holds
  // FOUR 2-bit cells (kinds 16..19): dew point (17) and the two phone-battery
  // kinds (18, 19) all appended into it for free — and it is FULL, with the alert
  // bytes right behind it. So a twenty-first kind (index 20) is no plain append
  // any more: it needs a sixth bold byte AND both alert bytes (and the warn-look
  // bytes behind them) relocated, a layout change on both ends (the C header's
  // _Static_assert trips). 36 -> 38 appended the two warn-look bytes, so exactly
  // {38, 36, 35, 34, 33, 29} are accepted now.
  var SETTINGS_BYTES = 38;
  var COLORS_OFFSET = 1;
  var HEALTH_OFFSET = 17;    // shifted 15 -> 17 with the UV color pair (append-only kinds)
  var BOLD_OFFSET = 29;      // 2 bits per kind: byte 29 + (k >> 2), bits 2 * (k & 3) — bytes 29..33
  // The alerts options byte: bits 0-1 the Alerts row's rain look (RAIN_DISPLAY),
  // bits 2-7 reserved (DWD official warnings later) and written 0.
  var ALERTS_OFFSET = 34;
  // The Alerts row's placement per status bar: 2 bits per bar (BAR_ALERT_KEYS
  // order — top 0-1, forecast 2-3, radar 4-5, health 6-7), BAR_ALERT_PLACES
  // values. While an alert is active the row replaces that slot of the bar.
  var BAR_ALERTS_OFFSET = 35;
  // Bar -> its placement setting, in the byte's cell order (ThreshBar in C).
  var BAR_ALERT_KEYS = [
    {bar: 'top', key: 'statusTopAlerts'},
    {bar: 'forecast', key: 'statusForecastAlerts'},
    {bar: 'radar', key: 'statusRadarAlerts'},
    {bar: 'health', key: 'statusHealthAlerts'}
  ];
  // statusXxxAlerts -> the 2-bit wire value (ThreshAlertsPlace).
  var BAR_ALERT_PLACES = {off: 0, left: 1, middle: 2, right: 3};
  // The warn look per PAIRED kind (the box at the warn level — a goal kind's
  // "close" — for its status slot and its alert icon): 2 bits per kind, kind k at
  // byte WARN_LOOK_OFFSET + (k >> 2), bits 2 * (k & 3) — bytes 36..37.
  var WARN_LOOK_OFFSET = 36;
  // thresh<Kind>WarnLook -> the 2-bit wire value (ThreshWarnLook).
  var WARN_LOOKS = {none: 0, outline: 1, fill: 2};

  // rainAlertDisplay -> the 2-bit wire value. 'text' is 0 — the full "Rain in
  // 12'" countdown the strip drew before the Alerts row — so an absent setting
  // and a pre-upgrade watch (no byte 34 at all) both keep today's look.
  var RAIN_DISPLAY = {text: 0, icon: 1, minutes: 2};

  // ALERT_ENTRIES_UINT8 entry header (alert_set.h): bits 0-2 the ThreshKind, bits 3-4
  // the level, bits 5-7 the value length.
  var ALERT_LEVEL_SHIFT = 3;
  var ALERT_LEN_SHIFT = 5;
  var ALERT_LEN_MAX = 7;

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

  // A weather kind's danger colour while it is unset: red, on every theme, so a
  // warn FILL (the colour-watch default look, in the theme's text colour) and the
  // danger fill stay apart. The settings page writes it too (onbuild.js heal,
  // blocks.js resetThresholds) and the 1.24.0 move turned the old auto text colour
  // into it (clay-migrations.js migrateWarnLook). A stored black or white is a pick
  // meaning "the text colour" (resolveAutoColor). (The warn colour has no such
  // constant: unset is AUTO — the theme's text colour, see kindConfig.)
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
  // The danger red in the same stored shape, derived the same way.
  var DEFAULT_DANGER_HEX =
    '#' + ('00000' + DEFAULT_DANGER_COLOR.toString(16).toUpperCase()).slice(-6);

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
   * The warn look a kind takes while its thresh<Kind>WarnLook is unset: goal kinds
   * the outline (their green "close" ring), weather kinds a fill on a colour watch
   * and an outline on a B&W one — there a warn fill would be the danger fill (both
   * solid in the one ink), so the outline is the only look that keeps the two
   * levels apart. The settings page's defaultFrom resolver (blocks.js
   * warnLookDefault) calls this too, so the page and the packer always agree.
   * @param {string} keyStem Kind key stem, e.g. 'Uv'.
   * @param {boolean} [isColor] Whether the watch has a colour display; anything
   *     but false (an unknown platform included) counts as colour.
   * @returns {string} 'outline' | 'fill'
   */
  function warnLookDefault(keyStem, isColor) {
    if (isGoalKind(keyStem)) { return 'outline'; }
    return isColor === false ? 'outline' : 'fill';
  }

  /**
   * A kind's warn look: the stored thresh<Kind>WarnLook when it is a known look,
   * else warnLookDefault. The one resolution for the packer and the telemetry code.
   * @param {Object} settings Clay settings blob
   * @param {string} keyStem Kind key stem, e.g. 'Uv'.
   * @param {boolean} [isColor] Whether the watch has a colour display (see
   *     warnLookDefault).
   * @returns {string} 'none' | 'outline' | 'fill'
   */
  function warnLookFor(settings, keyStem, isColor) {
    var raw = settings && settings['thresh' + keyStem + 'WarnLook'];
    return Object.prototype.hasOwnProperty.call(WARN_LOOKS, raw)
      ? raw : warnLookDefault(keyStem, isColor);
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
   * warnLook is the resolved look (warnLookFor); warnColor is null exactly when
   * it is 'none'.
   * @param {Object} settings Clay settings blob
   * @param {number} kindIndex wire kind id (0..THRESH_KIND_COUNT - 1)
   * @param {boolean} [isColor] Whether the watch has a colour display (the warn
   *     look's default, see warnLookDefault); anything but false counts as colour.
   * @returns {{enabled: boolean, warn: ?number, danger: ?number,
   *            warnLook: ?string, warnColor: ?number, dangerColor: ?number,
   *            boldMode: string}}
   */
  function kindConfig(settings, kindIndex, isColor) {
    var k = KINDS[kindIndex];
    if (k.boldOnly) {
      // Bold-only kinds own no thresholds, colors, or health pair — boldMode is
      // the only meaningful field. The DEFAULT_BOLD_MODE 'warn' packs 0, and a
      // level-less kind only ever resolves THRESH_LEVEL_NORMAL on the watch, so
      // unset renders non-bold: unset == 'off' visually, only 'always' changes
      // anything.
      return {
        enabled: false, warn: null, danger: null,
        warnLook: null, warnColor: null, dangerColor: null,
        boldMode: boldModeFor(settings, k)
      };
    }
    var pair = resolvedPair(k.key, settings);
    var on = Boolean(settings) && settings['thresh' + k.key + 'On'] === true;
    // The warn LOOK decides whether warn draws a box; the colour only paints it.
    // warnColor null = look 'none': the blob carries the 0x00 sentinel, which is
    // also what a watch WITHOUT the look bytes reads as "no outline" — so any
    // other look keeps a real colour in that byte and an older watch still draws
    // its outline. An unset colour ('' / null / absent, or garbage) is AUTO:
    // the packed theme's text colour for weather kinds, the goal green for goal
    // kinds (resolveAutoColor, fed black). Danger falls back green for goals,
    // red for weather.
    var warnLook = warnLookFor(settings, k.key, isColor);
    var rawWarn = settings && settings['thresh' + k.key + 'WarnColor'];
    var warnColor = warnLook === 'none' ? null
      : resolveAutoColor(colorInt(rawWarn, 0x000000), settings, k.goal);
    // Bold mode is deliberately NOT gated on `enabled`: 'always' bolds a slot
    // whose kind has its highlight off.
    return {
      enabled: on && pairOrdered(pair.warn, pair.danger),
      warn: pair.warn,
      danger: pair.danger,
      warnLook: warnLook,
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

  // The metric alerts, in the Alerts row's FIXED order (the watch appends the
  // rain alert in front of them). `code` is the KINDS code, so the wire kind id
  // is its index there; `key` is the settings stem: alert<Key> switches the alert
  // on, alert<Key>Display ('icon' | 'value') picks whether its number rides after
  // the icon.
  var ALERT_KINDS = [
    { code: 'uv', key: 'Uv' },
    { code: 'wind', key: 'Wind' },
    { code: 'gust', key: 'Gust' },
    { code: 'aqi', key: 'Aqi' },
    { code: 'pollen', key: 'Pollen' }
  ];

  /**
   * @param {string} code A KINDS code.
   * @returns {number} its wire kind id (the index in KINDS), -1 when unknown
   */
  function kindId(code) {
    for (var i = 0; i < KINDS.length; i++) {
      if (KINDS[i].code === code) { return i; }
    }
    return -1;
  }

  /**
   * @param {Object} settings Clay settings blob
   * @param {Object} a ALERT_KINDS entry
   * @returns {boolean} whether the alert is switched on
   */
  function alertOn(settings, a) {
    return Boolean(settings) && settings['alert' + a.key] === true;
  }

  /**
   * The number a metric alert judges: the day, not the slot. For the day-max
   * kinds that is the highest value left TODAY, the current hour included
   * (wire-units' dayMaxToday — independent of the kind's slot display mode, so
   * a Now-mode slot or no slot at all still gets the morning "UV reaches 8
   * today" alert); a kind without day peaks in the payload (not fetched, WAQI's
   * AQI) and pollen (a daily band) fall back to the current reading, judged as
   * the slot judges it (displayValue).
   * @param {string} code 'uv' | 'wind' | 'gust' | 'aqi' | 'pollen'
   * @param {Object} payload weather payload (pre-transform, trends present)
   * @param {Object} settings Clay settings blob
   * @returns {number|null} the number in display units, null when unavailable
   *     or the code has no alert
   */
  function alertValue(code, payload, settings) {
    if (!weatherKindOf(code) || !payload) { return null; }
    var s = settings || {};
    if (wireUnits.isDayMaxKind(code)) {
      var today = wireUnits.dayMaxToday(code, payload, s);
      if (today !== null) { return today; }
      // The current reading ALONE — read without the slot's display mode, which
      // in Alert mode would hand back tomorrow's marked peak (judged as null) when
      // today's is unknown. Only the unit picker matters to the number.
      var shown = wireUnits.dayMaxShown(code, payload, {windUnits: s.windUnits});
      return shown ? shown.now : null;
    }
    return displayValue(code, payload, s);
  }

  /**
   * A metric alert's level: alertValue against the kind's resolved pair (the
   * same pair the slot highlight judges by; seeds when blank).
   * @param {string} code 'uv' | 'wind' | 'gust' | 'aqi' | 'pollen'
   * @param {Object} payload weather payload (pre-transform, trends present)
   * @param {Object} settings Clay settings blob
   * @returns {?number} 0 normal / 1 warn / 2 danger; null without a value
   */
  function alertLevel(code, payload, settings) {
    var k = weatherKindOf(code);
    var v = alertValue(code, payload, settings);
    if (!k || v === null) { return null; }
    var pair = resolvedPair(k.key, settings);
    return computeLevel(v, pair.warn, pair.danger);
  }

  /**
   * An alert's value text as the kind's slot prints its number, without a unit
   * (the icon carries it): UV, wind, gusts in the user's wind unit and AQI as
   * whole numbers, pollen as its DWD band ('2-3').
   * @param {string} code An ALERT_KINDS code.
   * @param {number} v alertValue's number
   * @returns {string} ASCII text, '' when it would not fit an entry
   */
  function alertValueText(code, v) {
    var text = code === 'pollen'
      ? (POLLEN_BANDS[Math.round(v * 2)] || '') : String(Math.round(v));
    return (text.length <= ALERT_LEN_MAX && /^[\x20-\x7E]*$/.test(text)) ? text : '';
  }

  /**
   * Bake the Alerts row's metric entries (ALERT_ENTRIES_UINT8, alert_set.h): one entry
   * per ACTIVE metric alert — switched on (alert<Key>) and at warn or higher —
   * in the fixed order UV, wind, gust, AQI, pollen. Each entry is one header
   * byte (bits 0-2 ThreshKind, 3-4 level, 5-7 value length) + that many ASCII
   * value bytes, which are there only when the kind's Look is 'value'
   * (alert<Key>Display). Entries that would push the bytes past `cap` are
   * dropped from the TAIL (pollen first) — the rule the watch applies to its
   * pixels — so the tuple never outgrows what the watch's inbox budgets for it
   * (ALERT_ENTRIES_MAX_BYTES, test/inbox-size.test.js).
   * @param {Object} payload weather payload (pre-transform, trends present)
   * @param {Object} settings Clay settings blob
   * @param {number} cap the tuple's byte cap (status-lines.js: 20)
   * @returns {number[]} the entry bytes, [] when nothing is alerting
   */
  function bakeAlerts(payload, settings, cap) {
    var out = [];
    if (!payload || !settings) { return out; }
    for (var i = 0; i < ALERT_KINDS.length; i++) {
      var a = ALERT_KINDS[i];
      if (!alertOn(settings, a)) { continue; }
      var level = alertLevel(a.code, payload, settings);
      if (level === null || level < 1) { continue; }
      var text = settings['alert' + a.key + 'Display'] === 'value'
        ? alertValueText(a.code, alertValue(a.code, payload, settings)) : '';
      // Tail-drop: a prefix of the fixed order, never a later entry that happens
      // to be shorter — the watch fits the row by the same rule.
      if (out.length + 1 + text.length > cap) { break; }
      out.push(kindId(a.code) | (level << ALERT_LEVEL_SHIFT) | (text.length << ALERT_LEN_SHIFT));
      for (var c = 0; c < text.length; c++) { out.push(text.charCodeAt(c)); }
    }
    return out;
  }

  /**
   * @param {Object} settings Clay settings blob
   * @returns {string[]} the codes whose alert is switched on, fixed order
   */
  function alertKindCodes(settings) {
    var out = [];
    for (var i = 0; i < ALERT_KINDS.length; i++) {
      if (alertOn(settings, ALERT_KINDS[i])) { out.push(ALERT_KINDS[i].code); }
    }
    return out;
  }

  /**
   * @param {Object} settings Clay settings blob
   * @returns {string[]} the switched-on alerts whose Look prints the value
   */
  function alertValueKindCodes(settings) {
    var out = [];
    for (var i = 0; i < ALERT_KINDS.length; i++) {
      var a = ALERT_KINDS[i];
      if (alertOn(settings, a) && settings['alert' + a.key + 'Display'] === 'value') {
        out.push(a.code);
      }
    }
    return out;
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
   * Where a bar shows the Alerts row (its statusXxxAlerts setting), resolved to a
   * BAR_ALERT_PLACES key. An absent or unknown value takes the default: the top
   * strip 'left' — the rain countdown's takeover of that slot, which the strip
   * always had — and every other bar 'off', so an untouched upgrade draws
   * exactly what it drew before.
   * @param {Object} settings Clay settings blob
   * @param {string} bar 'top' | 'forecast' | 'radar' | 'health'
   * @returns {string} 'off' | 'left' | 'middle' | 'right'
   */
  function barAlertPlace(settings, bar) {
    for (var i = 0; i < BAR_ALERT_KEYS.length; i++) {
      if (BAR_ALERT_KEYS[i].bar !== bar) { continue; }
      var v = settings ? settings[BAR_ALERT_KEYS[i].key] : undefined;
      if (typeof v === 'string' && Object.prototype.hasOwnProperty.call(BAR_ALERT_PLACES, v)) {
        return v;
      }
      return bar === 'top' ? 'left' : 'off';
    }
    return 'off';
  }

  /**
   * Build the CLAY_THRESHOLDS_UINT8 settings blob (layout: status_threshold.h).
   * The statusBoldAll master row ('all') overrides the PACKED bold cell of
   * every kind to BOLD_MODES.always at build time only — the stored
   * thresh<Kind>BoldMode values are never modified, so 'perSlot' restores
   * them on the next build. Enable bits, colors, and health u16s are
   * untouched by the master.
   * Byte ALERTS_OFFSET carries the Alerts row's rain look (rainAlertDisplay);
   * which METRIC alerts are on never rides here — the phone bakes only the
   * active ones into their own weather tuple (bakeAlerts). Byte
   * BAR_ALERTS_OFFSET carries where each bar shows the row (barAlertPlace).
   * Bytes WARN_LOOK_OFFSET.. carry each paired kind's warn look (warnLookFor),
   * whose default depends on the watch's display — hence env.
   * @param {Object} settings Clay settings blob
   * @param {{color: boolean}} [env] platform env (config-ui platform.js
   *     computeEnv); absent = a colour watch
   * @returns {number[]} SETTINGS_BYTES-long array (currently 38 bytes)
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
    var rain = settings && settings.rainAlertDisplay;
    blob[ALERTS_OFFSET] = Object.prototype.hasOwnProperty.call(RAIN_DISPLAY, rain)
      ? RAIN_DISPLAY[rain] : RAIN_DISPLAY.text;
    for (var b = 0; b < BAR_ALERT_KEYS.length; b++) {
      blob[BAR_ALERTS_OFFSET] |=
        BAR_ALERT_PLACES[barAlertPlace(settings, BAR_ALERT_KEYS[b].bar)] << (2 * b);
    }
    return blob;
  }

  var api = {
    KINDS: KINDS,
    SETTINGS_BYTES: SETTINGS_BYTES,
    COLORS_OFFSET: COLORS_OFFSET,
    HEALTH_OFFSET: HEALTH_OFFSET,
    BOLD_OFFSET: BOLD_OFFSET,
    ALERTS_OFFSET: ALERTS_OFFSET,
    BAR_ALERTS_OFFSET: BAR_ALERTS_OFFSET,
    WARN_LOOK_OFFSET: WARN_LOOK_OFFSET,
    WARN_LOOKS: WARN_LOOKS,
    warnLookDefault: warnLookDefault,
    warnLookFor: warnLookFor,
    BAR_ALERT_KEYS: BAR_ALERT_KEYS,
    BAR_ALERT_PLACES: BAR_ALERT_PLACES,
    barAlertPlace: barAlertPlace,
    RAIN_DISPLAY: RAIN_DISPLAY,
    ALERT_KINDS: ALERT_KINDS,
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
    alertValue: alertValue,
    alertLevel: alertLevel,
    bakeAlerts: bakeAlerts,
    alertKindCodes: alertKindCodes,
    alertValueKindCodes: alertValueKindCodes,
    buildSettingsBlob: buildSettingsBlob,
    DEFAULT_DANGER_COLOR: DEFAULT_DANGER_COLOR,
    DEFAULT_DANGER_HEX: DEFAULT_DANGER_HEX
  };

  // Dual-context export — mirror the tail of src/pkjs/status-line-catalog.js.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window !== 'undefined') {
    window.StatusThresholds = api;
  }
})();
