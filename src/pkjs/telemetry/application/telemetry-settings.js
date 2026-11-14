// src/pkjs/telemetry/application/telemetry-settings.js — ES5, watch runtime (PKJS) + Node tests. The settings
// snapshot telemetry reports: buildSettingsSnapshot, the allowlist of settings fields the
// batch header carries, and the helpers that resolve them. telemetry.js (the queue, the
// batch and the POST) takes the snapshot from here and re-exports it.
//
// LOCKSTEP: every field buildSettingsSnapshot emits is a field of the Deno .strip()
// schema in supabase/functions/telemetry-ingest/handler.ts, and vice versa. A field
// missing there is silently dropped; a type mismatch fails safeParse and 400s the whole
// batch. test/telemetry/adapter/telemetry.test.js holds the two key sets and their types equal. Deploy the
// ingest BEFORE the app that sends a new field ships. Removing a field is safe in either
// order: the strip step drops what older apps still send, and every field is optional.
//
// A field earns its place by telling watches apart. Settings that read the same on every
// 2.6 watch were dropped (the UV and temperature pairs' presentation, the AQI slot's
// mode, the wind slot's direction, three Show unit toggles, the six Draw from / Bars
// from picks, the settings page's own theme), and so was provider: every event already
// carries the weather provider it fetched from.

// unitEnabled — a Show unit toggle, read like the bake prints the slot.
var slotText = require('../../status-bars/domain/slot-text.js');
var platforms = require('../../config-ui/lib/platform.js');
var color = require('../../lib/color.js');
// renderContextFor / graphColorKey / graphColorIsDefault — the module that resolves the
// graph colours for the WIRE, so this snapshot reports what the watch actually paints
// instead of a second opinion about it.
var lineStyle = require('../../forecast-graphs/domain/line-style.js');
var viewCycle = require('../../layout/domain/view-cycle.js');
// enabledAlerts, rainAlert and warnLookFor — the bake's and the packer's own reading
// of the weather alerts and the warn looks, so the report and the watch cannot
// disagree on what is on or how it looks.
var statusThresholds = require('../../alerts/domain/status-thresholds.js');
// telemetryCode — where each On demand item is ticked, read like the bake reads it.
var onDemand = require('../../status-bars/domain/on-demand.js');
// showOf — a graph line's Show choice, read like the bake reads it.
var lineAlert = require('../../alerts/domain/line-alert.js');
// The forecast's time span option this watch draws (12/24/48 on emery, 24 elsewhere).
var forecastSpan = require('../../weather/domain/forecast-span.js');
// The forecast's left axis options (emery only), read as the wire reads them.
var forecastAxis = require('../../forecast-graphs/domain/forecast-axis.js');
// Graph styles (emery): how many exist, and the length of each one a screen shows.
var graphStyles = require('../../forecast-graphs/domain/graph-styles.js');
// SLOT_KEYS / parseSlot — the Weather tab's saved places, read like the tab reads them.
var weatherTabModel = require('../../weather/domain/weather-tab-model.js');

// The Show unit toggles worth a field (status-line-catalog.js UNIT_TOGGLES has three more:
// pressure, rain countdown and dew point read the same on every 2.6 watch).
var REPORTED_UNIT_TOGGLES = ['windSlotUnit', 'gustSlotUnit', 'tempSlotUnit'];

// radarProvider while Setup's Rain radar is Off: the value apps before 1.10 stored for an
// Off radar, so the one field reads Off the same way on every version that reported it.
var RADAR_OFF = 'disabled';

var DAY_MS = 24 * 60 * 60 * 1000;
// The settings page stamps weatherTabSeenAt with its Date.now() (epoch ms,
// page/weather/weather-tab/weather-tab.js) whenever it draws the Weather tab's graphs. The stamp shipped
// with app 1.23.0 (2026-09), so an older time is no stamp of that page's: a phone clock
// that was wrong when the page stamped, or a value in another unit.
var WEATHER_TAB_STAMP_FLOOR_MS = Date.UTC(2026, 8, 1);

/**
 * Parse a value as a base-10 integer for telemetry, omitting invalid input.
 *
 * @param {*} value Raw setting value (Clay selects arrive as strings).
 * @returns {number|undefined} Parsed integer or undefined when not parseable.
 */
function toIntOrUndefined(value) {
    var parsed = parseInt(value, 10);
    return isFinite(parsed) ? parsed : undefined;
}

/**
 * Read a boolean setting that ships ON (backlightDim), reporting the shipped state when
 * the key is absent: `Boolean(undefined)` would read as a deliberate "off" — a whole
 * fleet of installs looking like they turned it off. seedDefaults backfills the key at
 * boot, so the absent case should never reach here; this keeps the column honest if it
 * ever does.
 *
 * @param {*} value Raw setting value.
 * @returns {boolean} The stored boolean, or true when the setting is absent.
 */
function boolDefaultOn(value) {
    return value === undefined || value === null ? true : Boolean(value);
}

/**
 * Format one graph colour for telemetry: the user's pick as '#RRGGBB', or the literal
 * 'default' while the colour is still the built-in.
 *
 * Every key now holds a CONCRETE colour (seedDefaults backfills the built-in), so there is
 * no '' sentinel left to mean "untouched" — and mining these for better defaults needs
 * exactly that distinction. The judgement is line-style.graphColorIsPicked's, not a hex
 * comparison here: it is the same predicate the wire's night-fill flag uses, so telemetry
 * cannot call a value chosen that the wire is still resolving for the user. Two colours
 * read as untouched despite holding a concrete value: gust's dark line, where EITHER
 * built-in (White, LightGray) counts because the painted one follows rainBarColor, and a
 * metric's night tint while it is still the fill colour the settings page carried into it.
 *
 * A STRING either way: the ingest schema types these z.string(), and a number or a null
 * against a z.number() would fail safeParse and 400 the WHOLE event, taking the fetch
 * outcome with it, with no retry. '#RRGGBB' rather than an int because a query reads these
 * through ->> as they are; the int-encoded colorTime family needs a to_hex() in the query
 * and has no 'default' sentinel, so an untouched one cannot be told from a picked one.
 *
 * @param {Object} settings Clay settings blob (the gc* keys, plus rainBarColor for gust).
 * @param {string} scope A metric id (line-style's GRAPH_METRICS), or 'night' for the band.
 * @param {string} role 'Line'|'Fill'|'Night' for a metric; 'Hatch'|'Boundary' for 'night'.
 * @param {string} suffix Polarity to read, 'Dark' or 'Light' (renderContextFor's `suffix`).
 * @returns {string} '#RRGGBB' for a colour moved off the built-in, else 'default'.
 */
function graphColorReport(settings, scope, role, suffix) {
    // graphColorIsPicked answers FALSE for an absent or unparseable value as well as for
    // one still equal to the built-in, so the other arm always has a real int to format.
    if (!lineStyle.graphColorIsPicked(settings, scope, role, suffix)) {
        return 'default';
    }
    return color.intToHex(
        lineStyle.colorPick(settings[lineStyle.graphColorKey(scope, role, suffix)]));
}

/**
 * The metric alerts, two letters per alert in the bake's order (status-thresholds
 * ALERT_KINDS: gust, uv, aqi, pollen, wind). The first is its look: o not placed on
 * any bar, i icon, v icon + value — upper case while its Days is "Today + tomorrow".
 * The second is the tomorrow mark in effect, the initial of its ALERT_NEXT_DAY_MARKS
 * key (r », g >, p +, s *, n none), while the alert looks ahead, else '-' (an alert
 * that is not placed or judges today only reads no mark — the "value in effect"
 * rule). So 'VrVrVro-Vr' is an untouched install (gust, UV, AQI and wind placed on the
 * Watch Status Bar, looking ahead with the »; pollen off), and 'o-Vro-o-i-' UV
 * printing its value and looking ahead, wind as an icon on today only. Placement is
 * read for THIS watch (env): a known aplite has no On demand, so nothing is placed
 * there. Everything is read off the alert bake's own list (enabledAlerts), so the
 * report and the watch cannot disagree. Ten characters, never lists: the ingest
 * copies the settings header into every row a batch writes, and this one code
 * replaced two comma lists (alertKinds, alertValueKinds) that cost about 60 B more
 * per row at their heaviest. The mark initials are pinned unique in
 * test/telemetry/adapter/telemetry.test.js.
 * @param {Object} safe Settings blob (never null).
 * @param {Object} env Platform env (config-ui computeEnv).
 * @returns {string} e.g. 'VrVrVro-Vr' on an untouched install.
 */
function alertsReport(safe, env) {
    var kinds = statusThresholds.ALERT_KINDS;
    var on = {};
    var enabled = statusThresholds.enabledAlerts(safe, env);
    for (var e = 0; e < enabled.length; e++) { on[enabled[e].code] = enabled[e]; }
    var out = '';
    for (var i = 0; i < kinds.length; i++) {
        var entry = on[kinds[i].code];
        if (!entry) {
            out += 'o-';
            continue;
        }
        var look = entry.showValue ? 'v' : 'i';
        out += entry.days === 'tomorrow' ? look.toUpperCase() + entry.mark.charAt(0) : look + '-';
    }
    return out;
}

/**
 * Each paired threshold kind's warn look, one letter per kind in the wire order
 * (status-thresholds KINDS: aqi, pollen, wind, gust, steps, sleep, distance, uv) —
 * n none, o outline, f fill. RESOLVED, the platform default included
 * (warnLookFor), so it reports the box the watch draws: 'ffffooof' is an untouched
 * colour watch, 'oooooooo' an untouched B&W one. Eight characters, not a list, for
 * alertsReport's reason; WARN_LOOKS' initials are pinned unique the same way.
 * @param {Object} safe Settings blob (never null).
 * @param {boolean} isColor Whether the watch has a colour display.
 * @returns {string} e.g. 'ffffooof'.
 */
function warnLooksReport(safe, isColor) {
    var out = '';
    var kinds = statusThresholds.KINDS;
    for (var i = 0; i < kinds.length; i++) {
        if (kinds[i].boldOnly) { continue; }
        out += statusThresholds.warnLookFor(safe, kinds[i].key, isColor).charAt(0);
    }
    return out;
}

/**
 * Whole days since the settings page last drew the Weather tab's graphs, from its
 * weatherTabSeenAt stamp (epoch ms; a Save brings it to the phone). Absent while there is
 * no sane stamp: never stamped (0 or absent), or not a past time since the stamp shipped.
 * @param {*} stamp Stored weatherTabSeenAt.
 * @param {number} nowMs Reference time (epoch ms).
 * @returns {number|undefined} Days, an integer >= 0; undefined without a sane stamp.
 */
function weatherTabSeenDays(stamp, nowMs) {
    // Number(), like weather-tab-cache.js tabInUse reads the same stamp.
    var seen = Number(stamp);
    if (!isFinite(seen) || seen < WEATHER_TAB_STAMP_FLOOR_MS || seen > nowMs) {
        return undefined;
    }
    return Math.floor((nowMs - seen) / DAY_MS);
}

/**
 * How many places the Weather tab has saved (savedLocation1..3), read like the tab reads
 * its slots: an empty or corrupt slot is no place. A count only, never a place itself.
 * @param {Object} safe Settings blob (never null).
 * @returns {number} 0..3.
 */
function weatherTabPlaces(safe) {
    var keys = weatherTabModel.SLOT_KEYS;
    var count = 0;
    for (var i = 0; i < keys.length; i++) {
        if (weatherTabModel.parseSlot(safe[keys[i]])) { count += 1; }
    }
    return count;
}

/**
 * Build a compact, allowlisted settings snapshot for telemetry.
 *
 * @param {Object} settings Clay settings object.
 * @param {Object} [watchInfo] Pebble.getActiveWatchInfo() result — only its platform is
 *   read: what the watch can show, and the graph colours resolved the way the renderer
 *   does (line-style.renderContextFor: the theme fold and the colour-display check).
 *   Absent = an unknown watch, which answers like basalt: colour, no LED.
 * @param {number} [nowMs] Reference time for the Weather tab's seen age; defaults to now.
 * @returns {Object} Telemetry-safe settings snapshot.
 */
function buildSettingsSnapshot(settings, watchInfo, nowMs) {
    var safe = settings || {};
    var now = typeof nowMs === 'number' ? nowMs : Date.now();
    // What this watch can show (the config page's own facts): no On demand on aplite.
    // An unknown watch (watchInfo absent) answers like basalt: colour, no LED.
    var env = platforms.computeEnv(watchInfo);
    var cx = lineStyle.renderContextFor(safe, env);
    // What only a known aplite reads: its fixed quiet-time and low-battery indicators
    // (every other watch has On demand, the onDemand code below) and its one-screen Layout
    // radio (every other watch keeps its screens as a custom layout, the customView fields
    // below). Elsewhere these three are leftovers, or a constant 'custom'.
    var isAplite = env.platform === 'aplite';
    // The On demand items' code (undefined on a watch without On demand), which the
    // settings that only On demand reads follow.
    var onDemandCode = onDemand.telemetryCode(safe, env);
    // Custom-layout usage: the three packed CLAY_VIEW values fully describe what a
    // custom user built (elements, seats, order, clock/strip omissions) in 3 ints.
    // null (-> absent fields) unless custom is active, so preset rows stay unchanged.
    var customCycle = safe.layoutPreset === 'custom' ? viewCycle.buildCustomCycle(safe) : null;
    var customPacked = customCycle ? customCycle.map(viewCycle.packSpec) : null;
    // The v2 fields (sizes, top-graph kind, Position) ride their own ADDITIVE fields
    // (packExt, 0..0x7FFF) rather than widening customView*: an ingest that predates
    // them strips unknown keys, but a known field failing validation 400s the batch.
    // The graph styles in the watch's slots (graph-styles.js wireCycle), as the watch is sent them.
    var customExt = customCycle
        ? graphStyles.wireCycle(safe, env, customCycle).map(function (v) { return viewCycle.packExt(v); })
        : null;
    // --- the Nighttime card's gates, resolved once for the fields below ---------
    // Dim backlight is HARDWARE-gated, not only setting-gated: the red tint is
    // light_set_color_rgb888() and emery is the only watch with the LED
    // (config-ui/lib/platform.js, the platform->capability SoT). The toggle ships ON,
    // so an ungated Boolean() would report a fleet of basalt watches "using" a
    // feature their hardware cannot perform. Same convention as the graph colours on
    // a B&W watch: no capability, no fields. An unknown watch answers false, the safe
    // direction.
    var hasColorBacklight = env.colorBacklight;
    var dimOn = Boolean(hasColorBacklight && boolDefaultOn(safe.backlightDim));
    // The left axis options' watch (forecast-axis.js isEmery: a KNOWN emery), which is
    // also the one watch with Larger graph fonts.
    var isEmery = forecastAxis.isEmery(env);
    // The graph styles the screens show past the first (graph-styles.js stylesSent; none
    // while only the first shows, and on every watch without styles).
    var stylesSent = graphStyles.stylesSent(safe, env);
    /**
     * The length option of graph style k (forecastHours' reading) while a screen shows it.
     * @param {number} k Style index.
     * @returns {(number|undefined)} 12 / 24 / 48, or undefined while no screen shows it.
     */
    function shownStyleHours(k) {
        return stylesSent.indexOf(k) !== -1 ? forecastSpan.option(graphStyles.settingsFor(safe, k), env) : undefined;
    }
    var snapshot = {
        temperatureUnits: safe.temperatureUnits,
        tempSlotDisplay: safe.tempSlotDisplay,
        // The Units tab's feels-like formula ('provider' | 'steadman'), raw like
        // tempSlotDisplay: an absent key reads as the default ('provider').
        feelsFormula: safe.feelsFormula,
        // The UV, wind and gust slots' display mode ('current' | 'max' | 'both'), raw
        // like tempSlotDisplay. The two-value slots' presentation (separator, spacing,
        // order, next-day mark) is not reported; the custom separator text never would
        // be: it is free text a user typed.
        uvSlotDisplay: safe.uvSlotDisplay,
        windSlotDisplay: safe.windSlotDisplay,
        gustSlotDisplay: safe.gustSlotDisplay,
        // The date slot's two format picks (edit sheet), raw like tempSlotDisplay.
        // dateSlotFullFormat is wizard-seeded per country ('slash' for US installs,
        // 'auto' elsewhere), so a present value does NOT mean the user opened the
        // sheet — and a stored 'auto' is indistinguishable from untouched. Only
        // dateSlotMonthFormat stays absent until the sheet is first saved.
        dateSlotMonthFormat: safe.dateSlotMonthFormat,
        dateSlotFullFormat: safe.dateSlotFullFormat,
        aqiScale: safe.aqiScale,
        aqiSource: safe.aqiSource,
        windUnits: safe.windUnits,
        distanceUnits: safe.distanceUnits,
        gustSlotDirection: Boolean(safe.gustSlotDirection),
        // The one per-kind Bold mode in the snapshot. The phone-battery slot is
        // Android-only (its reading comes from a host API that exists nowhere else),
        // so how the handful of phones that can have it configure it is worth seeing;
        // the other bold modes stay out. Passed through raw like tempSlotDisplay --
        // an unseeded install reports undefined, which the column reads as "default".
        threshPhoneBatteryBoldMode: safe.threshPhoneBatteryBoldMode,
        threshConditionBoldMode: safe.threshConditionBoldMode,
        dayNightShading: !!safe.dayNightShading,
        healthMode: safe.healthMode || 'off',
        fetchIntervalMin: toIntOrUndefined(safe.fetchIntervalMin),
        rainCountdownHorizon: toIntOrUndefined(safe.rainCountdownHorizon),
        // The weather alerts: each metric alert's look, Days and tomorrow mark (see
        // alertsReport), and the rain alert's look ('text' | 'icon' | 'minutes')
        // RESOLVED like the blob byte the watch reads, so an absent or unknown look
        // reports 'text'. Both are z.string() in the ingest schema, never an enum, so
        // a new alert kind or look cannot 400 an old ingest's batch.
        alerts: alertsReport(safe, env),
        rainAlertDisplay: statusThresholds.rainAlert(safe).look,
        // The warn box per paired kind (see warnLooksReport). The platform decides the
        // default, and an unknown watch reads as colour, as for the colours.
        warnLooks: warnLooksReport(safe, env.color),
        // The battery saver's window — the saver's OWN pair, as it has always been;
        // the Nighttime card groups it with two other features but shares no hours
        // with them. Present only while the saver is on ("value in effect"), so a
        // row's `settings_json ? 'sleepStartHour'` reads "battery saver on".
        sleepStartHour: safe.sleepNightEnabled ? toIntOrUndefined(safe.sleepStartHour) : undefined,
        sleepEndHour: safe.sleepNightEnabled ? toIntOrUndefined(safe.sleepEndHour) : undefined,
        // Dim backlight (emery only — see hasColorBacklight above). Sub-settings only
        // while it is on: the same "value in effect" rule, and the themeAuto block
        // below one card apart. Its hours are unconditional under the switch — there
        // is no mode to be in, so an "on" row always has a window to report.
        backlightDim: hasColorBacklight ? boolDefaultOn(safe.backlightDim) : undefined,
        backlightDimStartHour: dimOn ? toIntOrUndefined(safe.backlightDimStartHour) : undefined,
        backlightDimEndHour: dimOn ? toIntOrUndefined(safe.backlightDimEndHour) : undefined,
        // The LED colour, in its stored 'r,g,b' form rather than the '#RRGGBB' the
        // graph colours use: those are screen colours resolved through line-style for
        // the polarity the watch paints, with 'default' as a sentinel, and this is
        // three LED channel levels with neither. It is reported at all because the
        // shipped default (40,10,0) is a guess at "dim red", and what people dial in
        // is the only way to find out whether the guess was right.
        backlightDimColor: dimOn ? safe.backlightDimColor : undefined,
        // The automatic day/night theme switch. Sub-settings only while the
        // switch is on, and the manual hours only in manual mode — the
        // sleepStartHour "value in effect" rule, twice over.
        themeAuto: Boolean(safe.themeAuto),
        themeNight: safe.themeAuto ? safe.themeNight : undefined,
        themeAutoMode: safe.themeAuto ? (safe.themeAutoMode || 'sun') : undefined,
        themeAutoStartHour: (safe.themeAuto && safe.themeAutoMode === 'manual')
            ? toIntOrUndefined(safe.themeAutoStartHour) : undefined,
        themeAutoEndHour: (safe.themeAuto && safe.themeAutoMode === 'manual')
            ? toIntOrUndefined(safe.themeAutoEndHour) : undefined,
        axisTimeFormat: safe.axisTimeFormat,
        timeFont: safe.timeFont,
        timeLeadingZero: !!safe.timeLeadingZero,
        timeShowAmPm: !!safe.timeShowAmPm,
        weekStartDay: safe.weekStartDay,
        firstWeek: safe.firstWeek,
        // aplite only (isAplite above): its quiet-time icon and low-battery-only toggles.
        showQt: isAplite ? Boolean(safe.showQt) : undefined,
        batteryLowOnly: isAplite ? Boolean(safe.batteryLowOnly) : undefined,
        // On demand: 40 letters, the ten items of each bar (top, forecast, radar, health)
        // in the On demand order — L/R ticked on a side of a bar that shows, l/r
        // ticked on a bar the layout leaves out, '-' not ticked.
        // Absent on a known aplite, which has no On demand: showQt and batteryLowOnly
        // above are what aplite reads, and only aplite reports them.
        onDemand: onDemandCode,
        // The Rain alert dialog's "Replaces the slot" (true, the default, takes the place of
        // the slot on its side; false sits beside it), read like the thresholds blob packs it
        // (status-thresholds.js rainAlert). Absent where onDemand is: aplite has no On
        // demand. Lockstep with handler.ts -- deploy it first.
        rainReplacesSlot: onDemandCode === undefined ? undefined
            : statusThresholds.rainAlert(safe).replacesSlot,
        // The weather condition slot's Look ('both' icon and text, 'text', 'icon'; absent or
        // junk reads 'both'), on the watches that draw its glyph: aplite prints text whatever
        // is stored. Lockstep with handler.ts -- deploy it first.
        conditionSlotLook: isAplite ? undefined : slotText.conditionLook(safe),
        conditionSlotName: isAplite ? undefined : slotText.conditionName(safe),
        citySlotIcon: isAplite ? undefined : slotText.cityIcon(safe),
        // The Battery item's warn level as STORED (5-30 in 5s from an emery page,
        // 10/20/30 elsewhere), not the level the watch rounds it to; and its look.
        batteryLowLevel: toIntOrUndefined(safe.batteryLowLevel),
        batteryLowDisplay: safe.batteryLowDisplay,
        // aplite only: the preset its Layout radio stores, raw.
        layoutPreset: isAplite ? safe.layoutPreset : undefined,
        // Lockstep with the Deno telemetry-ingest .strip() schema — deploy the
        // function BEFORE the app ships, or these fields are silently dropped.
        customView0: customPacked ? customPacked[0] : undefined,
        customView1: customPacked ? (customPacked[1] || 0) : undefined,
        customView2: customPacked ? (customPacked[2] || 0) : undefined,
        customViewExt0: customExt ? customExt[0] : undefined,
        customViewExt1: customExt ? (customExt[1] || 0) : undefined,
        customViewExt2: customExt ? (customExt[2] || 0) : undefined,
        viewResetMin: toIntOrUndefined(safe.viewResetMin),
        // The Screen switching card's Double flick switch. Lockstep with the Deno telemetry-ingest
        // .strip() schema (handler.ts); ships OFF, so aplite's constant false is the default.
        doubleFlick: Boolean(safe.doubleFlick),
        // emery only: the one watch with the toggle (schema.js shows the row there alone).
        largeGraphFont: isEmery ? Boolean(safe.largeGraphFont) : undefined,
        // The forecast's time span, the option: 12 / 24 / 48 (48 = the long span, whatever
        // its label), on the one watch that offers a span (env.forecastSpan: emery); every
        // other watch is sent 24 whatever is stored, so it reports nothing. Categorical, not
        // the hours sent (forecast-span.js option()). Lockstep with handler.ts.
        forecastHours: env.forecastSpan ? forecastSpan.option(safe, env) : undefined,
        // Graph styles (3.0.0, emery only): how many exist (1-6), and the length option of
        // styles 2 and 3 while a screen shows them (the first style's is forecastHours).
        // Lockstep with handler.ts -- deploy it first.
        graphStyleCount: env.graphStyles ? graphStyles.count(safe) : undefined,
        graphStyle2Hours: shownStyleHours(1),
        graphStyle3Hours: shownStyleHours(2),
        // The forecast's left axis options, emery only (the one watch that offers
        // them), as chosen (forecast-axis.js readers: absent or junk reads the default, a
        // beta's 'beside' included), the Draw from precedent below: whether the scale applies
        // at all is the numbers and line fields. Lockstep with handler.ts -- deploy it first.
        forecastAxisNumbers: isEmery ? forecastAxis.numbers(safe) : undefined,
        forecastAxisScale: isEmery ? forecastAxis.scale(safe) : undefined,
        vibe: !!safe.vibe,
        btIcons: safe.btIcons,
        secondaryLine: safe.secondaryLine,
        secondaryLineFill: Boolean(safe.secondaryLineFill),
        windScale: safe.windScale,
        // The wind, gust and UV lines' Show, 'all' or 'alert' (line-alert.js showOf:
        // absent or junk reads 'all'), as chosen: whether that metric is on a line at
        // all is the four line fields here.
        windLineShow: lineAlert.showOf(safe, 'wind'),
        gustLineShow: lineAlert.showOf(safe, 'gust'),
        uvLineShow: lineAlert.showOf(safe, 'uv'),
        pressureScale: safe.pressureScale,
        thirdLine: safe.thirdLine,
        fourthLine: safe.fourthLine,
        fifthLine: safe.fifthLine,
        // Styles report the value IN EFFECT (the stored value or the line's
        // built-in — lineStyleValue is the same resolution the wire packs), the
        // radarMode || 'graph' precedent.
        secondaryLineStyle: lineStyle.lineStyleValue(safe, 'secondaryLineStyle'),
        thirdLineStyle: lineStyle.lineStyleValue(safe, 'thirdLineStyle'),
        fourthLineStyle: lineStyle.lineStyleValue(safe, 'fourthLineStyle'),
        fifthLineStyle: lineStyle.lineStyleValue(safe, 'fifthLineStyle'),
        barSource: safe.barSource,
        rainBarColor: safe.rainBarColor,
        // The rain radar's source, or RADAR_OFF while Setup's Rain radar is Off (2.6 keeps
        // the source apart from the switch, radarEnabled: on by default, so only a stored
        // false is Off). "Rainbow (own key)" reports 'rainbowkey', so the own-key share
        // stays countable without a field of its own (the Deno schema takes any string).
        radarProvider: safe.radarEnabled === false ? RADAR_OFF : safe.radarProvider,
        radarMode: safe.radarMode || 'graph',
        radarColor: safe.radarColor,
        radarSky: safe.radarSky !== false,   // on by default: a missing key is on
        devStatsEnabled: Boolean(safe.devStatsEnabled),
        theme: safe.theme,
        statusForecastLeft: safe.statusForecastLeft,
        statusForecastMid: safe.statusForecastMid,
        statusForecastRight: safe.statusForecastRight,
        statusRadarLeft: safe.statusRadarLeft,
        statusRadarMid: safe.statusRadarMid,
        statusRadarRight: safe.statusRadarRight,
        statusTopLeft: safe.statusTopLeft,
        statusTopMid: safe.statusTopMid,
        statusTopRight: safe.statusTopRight,
        statusHealthLeft: safe.statusHealthLeft,
        statusHealthMid: safe.statusHealthMid,
        statusHealthRight: safe.statusHealthRight,
        colorTime: safe.colorTime,
        colorToday: safe.colorToday,
        colorSunday: safe.colorSunday,
        colorSaturday: safe.colorSaturday,
        colorUSFederal: safe.colorUSFederal,
        // The settings page's Weather tab, which the watch never sees: whether the page
        // opens on it (Setup > Misc, read like the page's openWhen: only true is on), how
        // long ago the page last drew its graphs, and how many places it has saved.
        startOnWeatherTab: safe.startOnWeatherTab === true,
        weatherTabSeenDays: weatherTabSeenDays(safe.weatherTabSeenAt, now),
        weatherTabPlaces: weatherTabPlaces(safe)
    };
    // The reported "Show unit" toggles, each read the way the bake prints the slot
    // (slot-text.js unitEnabled, its absent value from the catalog's UNIT_TOGGLES, the
    // table page/settings/schema.js defaults from), so a flipped default can never
    // desynchronize what telemetry reports from what the watch renders: an absent key
    // reports what it renders (the look from before the toggle existed), not a fresh
    // install's default. Pinned by test/telemetry/adapter/telemetry.test.js. A new key here must also join
    // the Deno .strip() schema or it is silently dropped
    // (supabase/functions/telemetry-ingest/handler.ts).
    for (var i = 0; i < REPORTED_UNIT_TOGGLES.length; i++) {
        snapshot[REPORTED_UNIT_TOGGLES[i]] = slotText.unitEnabled(safe, REPORTED_UNIT_TOGGLES[i]);
    }
    // The graph colours, one field per painted ELEMENT, carrying the value for the polarity
    // this watch ACTUALLY RENDERS. Every platform/theme judgement comes from line-style's
    // renderContextFor (cx above) — the same call resolveGraphColors opens with — rather than
    // being re-derived here, which is how the two drifted before: this file had copied the
    // theme fold but not the colour-display check, and reported picks on a B&W watch that
    // the wire was already resolving away to the theme foreground.
    // cx.isColor is that missing half: a watch painting no colour reports nothing,
    // whether the reason is a Black & White theme or B&W hardware (aplite/diorite/flint).
    // cx.suffix is the polarity to read. It is folded (aplite has the light polarity
    // compiled out) but that fold changes nothing HERE, since aplite is also the one
    // no-polarity platform and cx.isColor has already excluded it — it is load-bearing on
    // the wire, not in this snapshot; taking it from the same place is what keeps the two
    // from disagreeing if that ever stops being true.
    // Precedent for reporting only the value in effect: sleepStartHour above.
    //
    // The colours are stored PER METRIC now (gcWindLineDark, …), but these six field names
    // and their z.string() type are unchanged — the watch/zod lockstep is satisfied by NOT
    // touching supabase/functions/telemetry-ingest/handler.ts, and the dashboards keep their
    // history. Each names an ELEMENT of the graph, and the metric it belongs to is the
    // secondaryLine / thirdLine already in this same snapshot, so a query slices by metric
    // (`where secondaryLine = 'wind'`) rather than needing twenty more columns.
    //
    // Assign undefined, never delete: the key must still EXIST for the lockstep
    // set-equality test (test/telemetry/adapter/telemetry.test.js). JSON.stringify drops it, and its
    // ABSENCE is then the "this watch paints no colour at all" flag (the
    // `settings_json ? 'sleepStartHour'` idiom).
    var secMetric = safe.secondaryLine;
    snapshot.graphMainColor = cx.isColor
        ? graphColorReport(safe, secMetric, 'Line', cx.suffix) : undefined;
    snapshot.graphFillColor = cx.isColor
        ? graphColorReport(safe, secMetric, 'Fill', cx.suffix) : undefined;
    // The third line has an 'off' state, and no third line means no colour in effect —
    // sleepStartHour's rule again, and it keeps 'off' installs out of the ranking's sample.
    snapshot.graphSecondColor = (cx.isColor && safe.thirdLine !== 'off')
        ? graphColorReport(safe, safe.thirdLine, 'Line', cx.suffix) : undefined;
    // Same rule for the third-metric line (settings.fourthLine), which is 'off'
    // by default and absent on aplite installs.
    snapshot.graphThirdColor = (cx.isColor && Boolean(safe.fourthLine) && safe.fourthLine !== 'off')
        ? graphColorReport(safe, safe.fourthLine, 'Line', cx.suffix) : undefined;
    // And the fourth-metric line (settings.fifthLine), likewise 'off' by default.
    snapshot.graphFourthColor = (cx.isColor && Boolean(safe.fifthLine) && safe.fifthLine !== 'off')
        ? graphColorReport(safe, safe.fifthLine, 'Line', cx.suffix) : undefined;
    // The night tint belongs to the secondary metric (it is the base of that metric's night
    // area); the hatch and the day line are the band's own, under the 'night' scope.
    snapshot.nightFillColor = cx.isColor
        ? graphColorReport(safe, secMetric, 'Night', cx.suffix) : undefined;
    snapshot.nightHatchColor = cx.isColor
        ? graphColorReport(safe, 'night', 'Hatch', cx.suffix) : undefined;
    snapshot.nightDayLineColor = cx.isColor
        ? graphColorReport(safe, 'night', 'Boundary', cx.suffix) : undefined;
    return snapshot;
}

module.exports = {
    buildSettingsSnapshot: buildSettingsSnapshot
};
