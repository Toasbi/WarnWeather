/**
 * Status-slot alert levels, the model — loaded on the phone (require) and in the
 * settings page (window.StatusThresholds), so both read the settings the same way:
 *  - the kinds, and the per-kind warn/danger pairs (stored, else the kind's SEED
 *    pair — one resolution for the phone bake and the settings page), with the
 *    highlight colours, warn look and bold mode each kind resolves to;
 *  - the level rule (computeLevel);
 *  - the weather alerts: which exist, their order, and how their settings read
 *    (alertOn, alertDays, alertNextDayMark, enabledAlerts), plus the rain alert's
 *    look and window (rainAlert).
 * The bytes the phone packs from it — the settings blob (CLAY_THRESHOLDS_UINT8),
 * the weather levels (STATUS_LEVELS_UINT8) and the alert entries
 * (ALERT_ENTRIES_UINT8) — live in status-wire.js, which the page never loads.
 *
 * Levels and highlighting are split: a weather kind's LEVEL is computed from
 * its resolved pair whether or not its highlight is on, and the stored
 * thresh<Kind>On toggle alone decides the blob[0] enable bit that tells the
 * watch to colour the slot (see kindConfig).
 *
 * LOCKSTEP: kind order and the level, warn-look, bold-mode and rain-look values
 * mirror src/c/appendix/status_threshold.h, the mark order alert_set.h;
 * test/status-thresholds-contract.test.js and
 * test/alert-entries-contract.test.js enforce it. ES5 only (aplite PKJS).
 */
(function() {
  // The theme-polarity vocabulary, for the text colour an auto highlight colour
  // resolves to. The flat page concatenates resolve-ink.js ahead of this file
  // (scripts/build-config-page.js APP_FILES), so its global exists at load there.
  var resolveInk = (typeof require !== 'undefined')
    ? require('./resolve-ink.js') : window.ResolveInk;
  // Which bars show which On demand item: an alert is on while its item is placed on
  // any bar (alertOn). The flat page concatenates on-demand.js ahead of this file
  // (APP_FILES).
  var onDemand = (typeof require !== 'undefined')
    ? require('./on-demand.js') : window.OnDemand;

  // thresh<Kind>WarnLook -> the 2-bit wire value (ThreshWarnLook).
  var WARN_LOOKS = {none: 0, outline: 1, fill: 2};

  // rainAlertDisplay -> the 2-bit wire value. 'text' is 0 — the full "Rain in
  // 12'" countdown the strip always drew — so an absent setting and a
  // pre-upgrade watch (no byte 34 at all) both keep that look.
  var RAIN_DISPLAY = {text: 0, icon: 1, minutes: 2};

  // thresh<Kind>BoldMode -> ThreshBold (src/c/appendix/status_threshold.h). The
  // ladder is monotone over the level: danger is bold under every mode, 'warn'
  // adds the warn level, 'always' adds the normal zone too. 'warn' is 0 so a
  // never-configured kind packs as the shipped behaviour.
  var BOLD_MODES = {warn: 0, off: 1, always: 2};
  var DEFAULT_BOLD_MODE = 'warn';

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
    // the same Bold sheet and status-wire.js buildSettingsBlob reads the one
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
  // status-wire.js' displayValue and health packer compare against). THE one table:
  // the phone bake, the alert bake and the settings page's slider seeds (blocks.js
  // thresholdRangeCfg) all read it through seedPair, so a blank pair means the same
  // numbers everywhere. Goal kinds: warn = "close" (~80% of the goal), danger = the
  // goal. Gusts sit on the DWD's storm gusts (from 65 kph, 34 kn) and severe storm
  // gusts (from 90 kph, 48 kn), each unit on its nearest 5-step; wind's danger at gale
  // force (Beaufort 8, from 62 kph, 39 mph, 34 kn), kph on the step just below it.
  // 1.24.0 moved gust warn kph 60 -> 65 and kn 30 -> 35, and wind danger kn 30 -> 35;
  // the pairs the page pinned before then are frozen in migrations/seed-pairs.js.
  var SEEDS = {
    Uv: {'': {warn: 6, danger: 8}},
    Pollen: {'': {warn: 2, danger: 3}},
    Wind: {kph: {warn: 40, danger: 60}, mph: {warn: 25, danger: 40}, kn: {warn: 20, danger: 35}},
    Gust: {kph: {warn: 65, danger: 90}, mph: {warn: 40, danger: 55}, kn: {warn: 35, danger: 50}},
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
   * rule for the phone bake and the settings page.
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
   * these at bake time, so the level packer, the alert bake and the render
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
   * regardless (status-wire.js packWeatherLevels).
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

  // The metric alerts, in the On demand priority order (on-demand.js ITEMS, after
  // Rain, which the watch resolves itself). `code` is the KINDS code, so the wire
  // kind id is its index there; `key` is the settings stem: alert<Key>Display
  // ('icon' | 'value') picks whether its number rides after the icon,
  // alert<Key>Days (alertDays) whether it may look ahead to tomorrow and
  // alert<Key>NextDayMark (alertNextDayMark) how a tomorrow entry is marked. An
  // alert is on while its item is ticked on an On demand side of any bar
  // (alertOn). THE alert vocabulary: which alerts exist, their order and how their
  // settings read live here alone. Every reader outside this module — the fetch
  // gates, the render signature, telemetry, the settings page, the bake
  // (status-wire.js) — goes through alertOn / alertDays / alertNextDayMark or
  // enabledAlerts; all of them rest on alertOn. The order is also the bake's, so
  // the entries' 20-B cap drops Wind speed first. The settings page's
  // presentation list (schema.js, its labels and sheet copy) is pinned to this
  // order by a test.
  var ALERT_KINDS = [
    { code: 'gust', key: 'Gust' },
    { code: 'uv', key: 'Uv' },
    { code: 'aqi', key: 'Aqi' },
    { code: 'pollen', key: 'Pollen' },
    { code: 'wind', key: 'Wind' }
  ];

  // alert<Key>Days: 'today' judges only what is left of today; 'tomorrow' ("Today +
  // tomorrow") also lets tomorrow's peak raise the alert once nothing left today
  // reaches warn (status-wire.js bakeAlerts' rule). Absent or unknown reads as the
  // default.
  var ALERT_DAYS = ['today', 'tomorrow'];
  var ALERT_DAYS_DEFAULT = 'tomorrow';

  // alert<Key>NextDayMark: how a tomorrow entry marks its day, the choices of the
  // slot's "Tomorrow's peak mark" (status-pair.js NEXT_DAY_MARKS, pinned to these by
  // a test: '»8', '>8', '+8', '8*', or none). THIS order is the wire's: a tomorrow
  // entry carries its mark as the index here + 1 (0 marks today's entry — see
  // status-wire.js ALERT_DAY_SHIFT), and alert_set.h's STATUS_ALERT_MARK_* codes
  // mirror it. Kept here rather than read off status-pair.js: that module is
  // phone-only (no window export), and the settings page reads this contract.
  // Absent or unknown reads as the default, the slot's own default.
  var ALERT_NEXT_DAY_MARKS = ['raquo', 'gt', 'plus', 'star', 'none'];
  var ALERT_NEXT_DAY_MARK_DEFAULT = 'raquo';

  // The rain alert's window while none is stored or it does not parse, in minutes.
  // Its look default sits in rainAlert, the one reading of both.
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
   * @param {*} code A status item code.
   * @returns {?Object} its ALERT_KINDS entry; null for a code with no alert
   */
  function alertKindOf(code) {
    for (var i = 0; i < ALERT_KINDS.length; i++) {
      if (ALERT_KINDS[i].code === code) { return ALERT_KINDS[i]; }
    }
    return null;
  }

  /**
   * One of a metric alert's stored settings, alert<Key><suffix>.
   * @param {Object} settings Clay settings blob
   * @param {*} code An ALERT_KINDS code.
   * @param {string} suffix e.g. 'Days'.
   * @returns {*} the stored value; undefined without settings or for a code with
   *     no alert
   */
  function alertSetting(settings, code, suffix) {
    var a = alertKindOf(code);
    return (a && settings) ? settings['alert' + a.key + suffix] : undefined;
  }

  /**
   * Whether a metric alert is on: its On demand item is ticked on a side of a bar
   * that exists (on-demand.js placedAnywhere). An absent side list reads its default,
   * so a partial blob reads the default ticks.
   * @param {Object} settings Clay settings blob
   * @param {*} code An ALERT_KINDS code.
   * @param {Object} [env] Platform env (omitted = a watch that draws On demand, the
   *     reading of the bake and the render signature: the entries only ride to one).
   * @returns {boolean} whether that metric alert is on (false for a code with no
   *     alert)
   */
  function alertOn(settings, code, env) {
    return alertKindOf(code) !== null && onDemand.placedAnywhere(settings, code, env);
  }

  /**
   * A metric alert's Days, read the one way: a stored ALERT_DAYS value, else
   * ALERT_DAYS_DEFAULT ('tomorrow': "Today + tomorrow").
   * @param {Object} settings Clay settings blob
   * @param {*} code An ALERT_KINDS code.
   * @returns {string} 'today' | 'tomorrow' (the default for a code with no alert)
   */
  function alertDays(settings, code) {
    var v = alertSetting(settings, code, 'Days');
    return (typeof v === 'string' && ALERT_DAYS.indexOf(v) !== -1) ? v : ALERT_DAYS_DEFAULT;
  }

  /**
   * A metric alert's tomorrow mark, read the one way: a stored ALERT_NEXT_DAY_MARKS
   * key, else ALERT_NEXT_DAY_MARK_DEFAULT ('raquo', the "»").
   * @param {Object} settings Clay settings blob
   * @param {*} code An ALERT_KINDS code.
   * @returns {string} 'raquo' | 'gt' | 'plus' | 'star' | 'none' (the default for a
   *     code with no alert)
   */
  function alertNextDayMark(settings, code) {
    var v = alertSetting(settings, code, 'NextDayMark');
    return (typeof v === 'string' && ALERT_NEXT_DAY_MARKS.indexOf(v) !== -1)
      ? v : ALERT_NEXT_DAY_MARK_DEFAULT;
  }

  /**
   * The metric alerts that are on (alertOn, placed on any bar), in ALERT_KINDS order,
   * with how each reads: whether its Look prints the value, its Days and its
   * tomorrow mark (the mark only matters with Days 'tomorrow'). The rest is read
   * only for an alert that is on: one that is off bakes nothing, whatever its other
   * settings. THE list the bake, the render signature and telemetry read.
   * @param {Object} settings Clay settings blob
   * @param {Object} [env] Platform env, passed to alertOn (omitted = a watch that
   *     draws On demand).
   * @returns {Array<{code: string, kindId: number, showValue: boolean,
   *     days: string, mark: string}>} [] when none is on
   */
  function enabledAlerts(settings, env) {
    var out = [];
    for (var i = 0; i < ALERT_KINDS.length; i++) {
      var a = ALERT_KINDS[i];
      if (!alertOn(settings, a.code, env)) { continue; }
      out.push({code: a.code, kindId: kindId(a.code),
        showValue: alertSetting(settings, a.code, 'Display') === 'value',
        days: alertDays(settings, a.code),
        mark: alertNextDayMark(settings, a.code)});
    }
    return out;
  }

  /**
   * The rain alert's two settings resolved, with their defaults in this one place:
   * the look (rainAlertDisplay) is a RAIN_DISPLAY key, else 'text' — the "Rain in
   * 12'" the strip always drew; the window (rainCountdownHorizon) is the stored
   * minutes, else RAIN_HORIZON_DEFAULT_MIN. Whether the rain alert shows at all is
   * its On demand tick (on-demand.js placedAnywhere(settings, 'rain', env)), and
   * radar mode 'off' silencing it is the Clay packer's fold (clay-payload.js).
   * @param {Object} settings Clay settings blob
   * @returns {{look: string, horizonMin: number}}
   */
  function rainAlert(settings) {
    var s = settings || {};
    var look = s.rainAlertDisplay;
    var horizon = parseInt(s.rainCountdownHorizon, 10);
    return {
      look: Object.prototype.hasOwnProperty.call(RAIN_DISPLAY, look) ? look : 'text',
      horizonMin: isNaN(horizon) ? RAIN_HORIZON_DEFAULT_MIN : horizon
    };
  }

  var api = {
    KINDS: KINDS,
    WARN_LOOKS: WARN_LOOKS,
    warnLookDefault: warnLookDefault,
    warnLookFor: warnLookFor,
    RAIN_DISPLAY: RAIN_DISPLAY,
    rainAlert: rainAlert,
    ALERT_KINDS: ALERT_KINDS,
    alertOn: alertOn,
    ALERT_DAYS: ALERT_DAYS,
    ALERT_DAYS_DEFAULT: ALERT_DAYS_DEFAULT,
    alertDays: alertDays,
    ALERT_NEXT_DAY_MARKS: ALERT_NEXT_DAY_MARKS,
    ALERT_NEXT_DAY_MARK_DEFAULT: ALERT_NEXT_DAY_MARK_DEFAULT,
    alertNextDayMark: alertNextDayMark,
    enabledAlerts: enabledAlerts,
    BOLD_MODES: BOLD_MODES,
    DEFAULT_BOLD_MODE: DEFAULT_BOLD_MODE,
    parseThreshold: parseThreshold,
    pairOrdered: pairOrdered,
    scaleVariant: scaleVariant,
    seedPair: seedPair,
    resolvedPair: resolvedPair,
    isGoalKind: isGoalKind,
    isWeatherKind: isWeatherKind,
    weatherKindOf: weatherKindOf,
    DEFAULT_GOAL_HEX: DEFAULT_GOAL_HEX,
    textColor: textColor,
    thresholdColor: thresholdColor,
    isAutoColor: isAutoColor,
    kindConfig: kindConfig,
    computeLevel: computeLevel,
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
