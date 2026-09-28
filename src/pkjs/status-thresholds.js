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
  // Same guard: its only consumers — the day-max pick (shownDayMax), the levels
  // and the alert bake — run phone-side only.
  var wireUnits = (typeof require !== 'undefined')
    ? require('./wire-units.js') : null;
  // The theme-polarity vocabulary, for the text colour an auto highlight colour
  // resolves to. The flat page concatenates resolve-ink.js ahead of this file
  // (scripts/build-config-page.js APP_FILES), so its global exists at load there.
  var resolveInk = (typeof require !== 'undefined')
    ? require('./resolve-ink.js') : window.ResolveInk;

  // One widening per release that shipped a new length, each appended to the
  // 29-byte pre-bold layout: 1.11.0 shipped 33 (the bold area for kinds 0..15);
  // 1.12.0 shipped 34 (battery %, kind 16, opened byte 33); 1.24.0 ships 38 (the
  // two alert bytes — the rain look, the per-bar placement — and the two
  // warn-look bytes). So exactly {38, 34, 33, 29} are accepted; the interim 31-,
  // 35- and 36-byte formats never shipped — they existed only on feature
  // branches — so they validate as garbage, not as legacy (see
  // status_threshold.h). Byte 33 holds FOUR 2-bit cells (kinds 16..19): dew point
  // (17) and the two phone-battery kinds (18, 19) all appended into it for free —
  // and it is FULL, with the alert bytes right behind it. So a twenty-first kind
  // (index 20) is no plain append any more: it needs a sixth bold byte AND both
  // alert bytes (and the warn-look bytes behind them) relocated, a layout change
  // on both ends (the C header's _Static_assert trips).
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

  // thresh<Kind>BoldMode -> ThreshBold (src/c/appendix/status_threshold.h). The
  // ladder is monotone over the level: danger is bold under every mode, 'warn'
  // adds the warn level, 'always' adds the normal zone too. 'warn' is 0 so a
  // never-configured kind packs as the shipped behaviour.
  var BOLD_MODES = {warn: 0, off: 1, always: 2};
  var DEFAULT_BOLD_MODE = 'warn';

  // DWD pollen reaches the phone as one of these display BANDS (a string, see
  // src/pkjs/weather/pollen.js), NOT a 0-3 number — Number('2-3') is NaN.
  // pollenToday maps a band to its numeric level (index i -> i/2) so half-bands
  // compare on the same 0 / 0.5 / 1 / 1.5 / 2 / 2.5 / 3 scale the threshold is
  // entered on.
  var POLLEN_BANDS = ['0', '0-1', '1', '1-2', '2', '2-3', '3'];

  // A weather kind's danger colour while it is unset: red, on every theme, so a
  // warn FILL (the colour-watch default look, in the theme's text colour) and the
  // danger fill stay apart. The settings page's open writes it too (onbuild.js heal,
  // through thresholdColor) and the 1.24.0 move turned the old auto text colour
  // into it (migrations/v1_24.js migrateWarnLook). A stored black or white is a pick
  // meaning "the text colour" (resolveAutoColor). (The warn colour has no such
  // constant: unset is AUTO — the theme's text colour, see thresholdColor.)
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
   * rule: resolvedPair takes a stored pair only when it holds, and kindConfig
   * re-checks it before setting an enable bit (defence in depth), so the page,
   * which reads the resolved pair, can never disagree with what the watch packs.
   * @param {?number} warn Parsed warn threshold (parseThreshold).
   * @param {?number} danger Parsed danger threshold.
   * @returns {boolean} True when the pair is complete and ordered.
   */
  function pairOrdered(warn, danger) {
    return warn !== null && danger !== null && danger >= warn;
  }

  /**
   * Which unit or scale a kind's numbers are in, as the settings select it — the key
   * its seed pair (SEEDS) and the settings page's slider geometry (blocks.js
   * THRESHOLD_RANGES) are tabled under, so the two can never branch on the pickers
   * apart. Wind and gusts follow the wind unit, distance the distance unit, and AQI
   * its scale: European only when Open-Meteo is the AQI source AND its scale picker
   * says so — WAQI (and Auto, which prefers it) reports US-style AQI. Every other
   * kind has the one variant ''.
   * @param {string} keyStem Kind key stem, e.g. 'Wind'.
   * @param {Object} settings Clay settings blob (windUnits, aqiSource, aqiScale,
   *     distanceUnits).
   * @returns {string} 'kph' | 'mph' | 'kn' | 'us' | 'eu' | 'km' | 'mi' | ''
   */
  function scaleVariant(keyStem, settings) {
    var s = settings || {};
    if (keyStem === 'Wind' || keyStem === 'Gust') {
      if (s.windUnits === 'mph') { return 'mph'; }
      return s.windUnits === 'knots' ? 'kn' : 'kph';
    }
    if (keyStem === 'Aqi') {
      return (s.aqiSource === 'openmeteo' && s.aqiScale !== 'us') ? 'eu' : 'us';
    }
    if (keyStem === 'Distance') { return s.distanceUnits === 'imperial' ? 'mi' : 'km'; }
    return '';
  }

  // Seed pairs per key stem and scaleVariant, in the kind's DISPLAY unit (the unit
  // displayValue and the health packer compare against). THE one table: the phone
  // bake, the day-max hold rule and the settings page's slider seeds (blocks.js
  // thresholdRangeCfg) all read it through seedPair, so a blank pair means the same
  // numbers everywhere. Goal kinds: warn = "close" (~80% of the goal), danger = the
  // goal.
  var SEEDS = {
    Uv: {'': {warn: 6, danger: 8}},
    Pollen: {'': {warn: 2, danger: 3}},
    Wind: {kph: {warn: 40, danger: 60}, mph: {warn: 25, danger: 40}, kn: {warn: 20, danger: 30}},
    Gust: {kph: {warn: 60, danger: 90}, mph: {warn: 40, danger: 55}, kn: {warn: 30, danger: 50}},
    Aqi: {us: {warn: 100, danger: 150}, eu: {warn: 60, danger: 80}},
    Steps: {'': {warn: 8000, danger: 10000}},
    Sleep: {'': {warn: 6.5, danger: 7.5}},
    Distance: {km: {warn: 4, danger: 5}, mi: {warn: 2.5, danger: 3}}
  };

  /**
   * A kind's seed pair — what a blank (or unusable) stored pair means.
   * @param {string} keyStem Kind key stem, e.g. 'Wind'.
   * @param {Object} settings Clay settings blob (the scaleVariant pickers).
   * @returns {{warn: ?number, danger: ?number}} a fresh copy of the seed in display
   *     units; both null for a stem without one (the bold-only kinds, an unknown stem)
   */
  function seedPair(keyStem, settings) {
    if (!Object.prototype.hasOwnProperty.call(SEEDS, keyStem)) {
      return {warn: null, danger: null};
    }
    var seed = SEEDS[keyStem][scaleVariant(keyStem, settings)];
    return {warn: seed.warn, danger: seed.danger};
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
   * Whether a kind is a WEATHER kind: neither a goal kind (the health trio levels
   * on the watch) nor a bold-only one (no pair to level). The phone levels exactly
   * these at bake time, so the level packer, the day-max hold rule and the render
   * signature's pair loop all select by this one predicate.
   * @param {?Object} k A KINDS entry.
   * @returns {boolean}
   */
  function isWeatherKind(k) {
    return Boolean(k) && !k.goal && !k.boldOnly;
  }

  /**
   * @param {*} code A status item code.
   * @returns {?Object} the KINDS entry of a weather kind (isWeatherKind) with that
   *     code, else null
   */
  function weatherKindOf(code) {
    for (var i = 0; i < KINDS.length; i += 1) {
      if (KINDS[i].code === code) { return isWeatherKind(KINDS[i]) ? KINDS[i] : null; }
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
   * What a day-max slot (UV, wind, gusts, AQI) shows: wire-units' dayMaxShown with
   * the hold rule's warn (holdWarn), so today's peak stays on screen while it is at
   * or above the kind's warn. The ONE place the hold is applied: the slot's text and
   * its wind arrow (status-lines packLine reads this once per slot and hands it to
   * both) and the highlight (displayValue) all judge this same pick, so none of
   * them can hold on a different warn.
   * @param {*} code A status item code.
   * @param {Object} payload weather payload (pre-transform, trends present)
   * @param {Object} settings Clay settings blob (<code>SlotDisplay, windUnits, the
   *     kind's thresh pair and the seed-unit pickers)
   * @returns {?{now: ?number, peak: ?number, nextDay: boolean}} dayMaxShown's pick;
   *     null without a reading, or for a code that is no day-max kind
   */
  function shownDayMax(code, payload, settings) {
    if (!wireUnits.isDayMaxKind(code)) { return null; }
    return wireUnits.dayMaxShown(code, payload, settings, holdWarn(code, settings));
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
   * The theme's text colour: black on the light polarity, white on the dark one.
   * What an auto weather colour resolves to, and what a B&W screen draws every
   * highlight in.
   * @param {Object} settings Clay settings blob (theme)
   * @returns {number} 0x000000 or 0xFFFFFF
   */
  function textColor(settings) {
    return resolveInk.isLightPolarity(settings && settings.theme) ? 0x000000 : 0xFFFFFF;
  }

  /**
   * Resolve an "auto" highlight colour for the theme this blob is packed FOR. The
   * settings page stores auto as a concrete black or white (the colour it last
   * resolved, onbuild.js heal) and re-derives it on every open, but a blob nobody
   * re-saved keeps the old one: 1.11-1.19 never converted it when Theme changed, so
   * a light-then-dark install holds black under a dark theme, and packing that
   * verbatim draws a black outline and fill on the black face -- invisible. So black
   * and white are resolved here: to the packed theme's text colour for weather kinds
   * (settings.theme, which theme-schedule's night copy sets to the night theme), to
   * the goal green for goal kinds. Every other colour is a pick, returned as is.
   * @param {number} c 0xRRGGBB colour, already parsed by colorInt
   * @param {Object} settings Clay settings blob (theme)
   * @param {boolean} goal Whether the kind is a goal kind (the health trio)
   * @returns {number} c, or the auto colour when c is black or white
   */
  function resolveAutoColor(c, settings, goal) {
    if (c !== 0x000000 && c !== 0xFFFFFF) { return c; }
    return goal ? DEFAULT_GOAL_COLOR : textColor(settings);
  }

  /**
   * THE colour rule for a kind's warn or danger colour: what the watch paints the
   * box in, independent of the warn look (a look of 'none' paints nothing, but the
   * colour it would paint stays defined, so a later switch to a box finds it). An
   * unset or unparseable value (isAutoColor) is AUTO: the warn colour the theme's
   * text colour (weather) or the goal green (goal); the danger colour the contract's
   * red (weather) or the goal green. A stored black or white resolves as auto too
   * (resolveAutoColor), whichever colour it is — for a weather danger it is the pick
   * "the text colour". Any other colour is the pick itself. The packer (kindConfig),
   * the settings page's swatches and zones, and its on-open heal all resolve through
   * here, so the three cannot disagree.
   * @param {Object} settings Clay settings blob (theme, thresh<Stem><which>Color)
   * @param {string} keyStem Kind key stem, e.g. 'Uv'.
   * @param {string} which 'Warn' | 'Danger'.
   * @returns {number} 0xRRGGBB colour
   */
  function thresholdColor(settings, keyStem, which) {
    var goal = isGoalKind(keyStem);
    var fallback = which !== 'Danger' ? 0x000000
      : (goal ? DEFAULT_GOAL_COLOR : DEFAULT_DANGER_COLOR);
    return resolveAutoColor(
      colorInt(settings && settings['thresh' + keyStem + which + 'Color'], fallback),
      settings, goal);
  }

  /**
   * Whether a stored highlight colour is AUTO rather than a pick: unset ('' / null /
   * absent), unparseable, or black or white (an int or a '#RRGGBB' string, either
   * case). thresholdColor resolves every such value per theme and kind, so the
   * settings page rewrites it to that resolution on open (onbuild.js heal) and the
   * picker shows what the watch draws.
   * @param {*} raw Stored colour.
   * @returns {boolean} True when the value is auto.
   */
  function isAutoColor(raw) {
    var c = colorInt(raw, null);
    return c === null || c === 0x000000 || c === 0xFFFFFF;
  }

  /**
   * The warn look a kind takes while its thresh<Kind>WarnLook is unset: goal kinds
   * the outline (their green "close" ring), weather kinds a fill on a colour watch
   * and an outline on a B&W one — there a warn fill would be the danger fill (both
   * solid in the one ink), so the outline is the only look that keeps the two
   * levels apart. The settings page's defaultFrom resolver (blocks.js
   * warnLookDefault) calls this too, so the page and the packer always agree,
   * and the page never stores the look it resolves here (the item's defaultFrom
   * is sticky: false): the key stays unset until a pick differs from the saving
   * watch's default, so a phone shared by a colour and a B&W watch still packs
   * each one's own default.
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
    // The warn LOOK decides whether warn draws a box; the colour (thresholdColor)
    // only paints it. warnColor null = look 'none': the blob carries the 0x00
    // sentinel, which is also what a watch WITHOUT the look bytes reads as "no
    // outline" — so any other look keeps a real colour in that byte and an older
    // watch still draws its outline.
    var warnLook = warnLookFor(settings, k.key, isColor);
    // Bold mode is deliberately NOT gated on `enabled`: 'always' bolds a slot
    // whose kind has its highlight off.
    return {
      enabled: on && pairOrdered(pair.warn, pair.danger),
      warn: pair.warn,
      danger: pair.danger,
      warnLook: warnLook,
      warnColor: warnLook === 'none' ? null : thresholdColor(settings, k.key, 'Warn'),
      dangerColor: thresholdColor(settings, k.key, 'Danger'),
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
   * Today's DWD pollen reading: POLLEN_TODAY, a POLLEN_BANDS string, with its
   * level (the band's index / 2 — 7 bands -> 0, 0.5, 1, ... 3).
   * @param {Object} payload weather payload (pre-transform)
   * @returns {?{band: string, level: number}} the band as the pollen slot prints
   *     it and the number thresholds compare; null when there is no reading or it
   *     is no known band
   */
  function pollenToday(payload) {
    var pt = payload.POLLEN_TODAY;
    if (pt === null || typeof pt === 'undefined') { return null; }
    var idx = POLLEN_BANDS.indexOf(String(pt));
    return idx < 0 ? null : {band: POLLEN_BANDS[idx], level: idx / 2};
  }

  /**
   * The number the user SEES for a weather kind — thresholds compare against
   * the displayed value. The day-max pick is SHARED with status-lines.js
   * (shownDayMax, over wire-units' readers), so the two cannot round apart or
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
    if (wireUnits.isDayMaxKind(code)) {
      return todaysShown(shownDayMax(code, payload, settings));
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
   * (packWeatherLevels, on the number the slot shows) and the Alerts row
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
      if (!isWeatherKind(KINDS[k])) { continue; }
      var code = KINDS[k].code;
      var level = levelOf(code, displayValue(code, payload, settings), settings);
      if (level === null) { continue; }
      packed |= level << weatherLevelShift(k);
    }
    return [packed & 0xFF, (packed >> 8) & 0xFF];
  }

  // The metric alerts, in the Alerts row's FIXED order (the watch appends the
  // rain alert in front of them). `code` is the KINDS code, so the wire kind id
  // is its index there; `key` is the settings stem: alert<Key> switches the alert
  // on, alert<Key>Display ('icon' | 'value') picks whether its number rides after
  // the icon. THE alert vocabulary: which alerts exist, their order and how their
  // two settings read live here alone, and every reader — the bake, the fetch
  // gates, the render signature, telemetry, the settings page — goes through
  // alertSettings / enabledAlerts below. The settings page's presentation list
  // (schema.js, its labels and sheet copy) is pinned to this order by a test.
  var ALERT_KINDS = [
    { code: 'uv', key: 'Uv' },
    { code: 'wind', key: 'Wind' },
    { code: 'gust', key: 'Gust' },
    { code: 'aqi', key: 'Aqi' },
    { code: 'pollen', key: 'Pollen' }
  ];

  // The rain alert's window while none is stored or it does not parse, in minutes.
  // Its switch and look defaults sit in rainAlert, the one reading of all three.
  var RAIN_HORIZON_DEFAULT_MIN = 60;

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
   * One metric alert's two settings, read the one way: on only for a stored
   * boolean true (a stored string is not the toggle's value), and the value shown
   * only while it is on — an alert that is off bakes nothing, whatever its Look.
   * @param {Object} settings Clay settings blob
   * @param {*} code An ALERT_KINDS code.
   * @returns {{on: boolean, showValue: boolean}} both false for a code with no alert
   */
  function alertSettings(settings, code) {
    for (var i = 0; i < ALERT_KINDS.length; i++) {
      if (ALERT_KINDS[i].code !== code) { continue; }
      var stem = 'alert' + ALERT_KINDS[i].key;
      var on = Boolean(settings) && settings[stem] === true;
      return {on: on, showValue: on && settings[stem + 'Display'] === 'value'};
    }
    return {on: false, showValue: false};
  }

  /**
   * @param {Object} settings Clay settings blob
   * @param {*} code An ALERT_KINDS code.
   * @returns {boolean} whether that metric alert is switched on (false for a code
   *     with no alert)
   */
  function alertOn(settings, code) {
    return alertSettings(settings, code).on;
  }

  /**
   * The switched-on metric alerts, in the row's fixed order.
   * @param {Object} settings Clay settings blob
   * @returns {Array<{code: string, kindId: number, showValue: boolean}>} [] when
   *     none is on
   */
  function enabledAlerts(settings) {
    var out = [];
    for (var i = 0; i < ALERT_KINDS.length; i++) {
      var code = ALERT_KINDS[i].code;
      var st = alertSettings(settings, code);
      if (st.on) { out.push({code: code, kindId: kindId(code), showValue: st.showValue}); }
    }
    return out;
  }

  /**
   * The rain alert's three settings resolved, with their defaults in this one
   * place: the switch (alertRain) is ON unless stored false — the countdown every
   * install had before the Alerts card; the look (rainAlertDisplay) is a
   * RAIN_DISPLAY key, else 'text' — the "Rain in 12'" the strip always drew; the
   * window (rainCountdownHorizon) is the stored minutes, else
   * RAIN_HORIZON_DEFAULT_MIN. The switch is the STORED one: radar mode 'off'
   * silencing the alert is the Clay packer's fold (clay-payload.js), not part of
   * it.
   * @param {Object} settings Clay settings blob
   * @returns {{on: boolean, look: string, horizonMin: number}}
   */
  function rainAlert(settings) {
    var s = settings || {};
    var look = s.rainAlertDisplay;
    var horizon = parseInt(s.rainCountdownHorizon, 10);
    return {
      on: s.alertRain !== false,
      look: Object.prototype.hasOwnProperty.call(RAIN_DISPLAY, look) ? look : 'text',
      horizonMin: isNaN(horizon) ? RAIN_HORIZON_DEFAULT_MIN : horizon
    };
  }

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

  // ALERT_ENTRIES_UINT8 (alert_set.h): per entry one header byte — bits 0-2 the
  // ThreshKind, bits 3-4 the level, bits 5-7 the value length, at most
  // ALERT_LEN_MAX — then that many ASCII value bytes; the whole tuple at most
  // ALERT_ENTRIES_MAX_BYTES, what the watch accepts and its inbox budgets for
  // (test/inbox-size.test.js). All five metric alerts with their widest realistic
  // values are 19 B, so nothing is dropped today.
  // test/alert-entries-contract.test.js pins all four to the C header.
  var ALERT_LEVEL_SHIFT = 3;
  var ALERT_LEN_SHIFT = 5;
  var ALERT_LEN_MAX = 7;
  var ALERT_ENTRIES_MAX_BYTES = 20;

  /**
   * Bake the Alerts row's metric entries (ALERT_ENTRIES_UINT8): one entry per
   * ACTIVE metric alert — switched on (alert<Key>) and at warn or higher on its
   * reading (alertReading) — in the fixed order UV, wind, gust, AQI, pollen. The
   * value bytes are there only when the kind's Look is 'value' (alert<Key>Display)
   * and the text is printable ASCII of at most ALERT_LEN_MAX bytes. Entries that
   * would push the bytes past ALERT_ENTRIES_MAX_BYTES are dropped from the TAIL
   * (pollen first) — the rule the watch applies to its pixels.
   * @param {Object} payload weather payload (pre-transform, trends present)
   * @param {Object} settings Clay settings blob
   * @returns {number[]} the entry bytes, [] when nothing is alerting
   */
  function bakeAlerts(payload, settings) {
    var out = [];
    if (!payload || !settings) { return out; }
    var alerts = enabledAlerts(settings);
    for (var i = 0; i < alerts.length; i++) {
      var a = alerts[i];
      var reading = alertReading(a.code, payload, settings);
      var level = levelOf(a.code, reading ? reading.value : null, settings);
      if (level === null || level < 1) { continue; }
      var text = a.showValue ? reading.text : '';
      if (text.length > ALERT_LEN_MAX || !/^[\x20-\x7E]*$/.test(text)) { text = ''; }
      // Tail-drop: a prefix of the fixed order, never a later entry that happens
      // to be shorter — the watch fits the row by the same rule.
      if (out.length + 1 + text.length > ALERT_ENTRIES_MAX_BYTES) { break; }
      out.push(a.kindId | (level << ALERT_LEVEL_SHIFT) | (text.length << ALERT_LEN_SHIFT));
      for (var c = 0; c < text.length; c++) { out.push(text.charCodeAt(c)); }
    }
    return out;
  }

  /**
   * @param {Object} settings Clay settings blob
   * @returns {string[]} the codes whose alert is switched on, fixed order
   */
  function alertKindCodes(settings) {
    return enabledAlerts(settings).map(function (a) { return a.code; });
  }

  /**
   * @param {Object} settings Clay settings blob
   * @returns {string[]} the switched-on alerts whose Look prints the value
   */
  function alertValueKindCodes(settings) {
    return enabledAlerts(settings)
      .filter(function (a) { return a.showValue; })
      .map(function (a) { return a.code; });
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
   * Byte ALERTS_OFFSET carries the Alerts row's rain look (rainAlert's look);
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
    blob[ALERTS_OFFSET] = RAIN_DISPLAY[rainAlert(settings).look];
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
    rainAlert: rainAlert,
    ALERT_KINDS: ALERT_KINDS,
    alertSettings: alertSettings,
    alertOn: alertOn,
    enabledAlerts: enabledAlerts,
    BOLD_MODES: BOLD_MODES,
    DEFAULT_BOLD_MODE: DEFAULT_BOLD_MODE,
    parseThreshold: parseThreshold,
    pairOrdered: pairOrdered,
    SEEDS: SEEDS,
    scaleVariant: scaleVariant,
    seedPair: seedPair,
    resolvedPair: resolvedPair,
    holdWarn: holdWarn,
    shownDayMax: shownDayMax,
    isGoalKind: isGoalKind,
    isWeatherKind: isWeatherKind,
    DEFAULT_GOAL_COLOR: DEFAULT_GOAL_COLOR,
    DEFAULT_GOAL_HEX: DEFAULT_GOAL_HEX,
    textColor: textColor,
    thresholdColor: thresholdColor,
    isAutoColor: isAutoColor,
    kindConfig: kindConfig,
    computeLevel: computeLevel,
    displayValue: displayValue,
    packWeatherLevels: packWeatherLevels,
    ALERT_LEVEL_SHIFT: ALERT_LEVEL_SHIFT,
    ALERT_LEN_SHIFT: ALERT_LEN_SHIFT,
    ALERT_LEN_MAX: ALERT_LEN_MAX,
    ALERT_ENTRIES_MAX_BYTES: ALERT_ENTRIES_MAX_BYTES,
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
