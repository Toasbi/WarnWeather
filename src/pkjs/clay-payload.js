// Maps Clay settings to the watch AppMessage (CLAY_* keys + packed holiday
// window). Extracted from index.js so the mapping is unit-testable (index.js
// wires Pebble events and can't be required under node:test). ES5-only (PKJS).

var pebbleColors = require('./pebble-colors.js');
var holidayMask = require('./holidays/holiday-mask.js');
var paletteWire = require('./weather/palette-wire.js');
var viewCycle = require('./view-cycle.js');
var resolveInk = require('./resolve-ink.js').resolveInk;

var DEFAULT_COLOR_WHITE = pebbleColors.GColorWhite;
var DEFAULT_COLOR_FOLLY = pebbleColors.GColorFolly;
// Holiday highlight defaults to Blue Moon (weekends stay Folly/red).
var DEFAULT_COLOR_BLUE_MOON = pebbleColors.GColorBlueMoon;

/**
 * Build the Clay settings AppMessage payload.
 * @param {Object} settings Clay settings (claySettings.read() shape).
 * @param {Object|null} watchInfo Active watch info (platform read for palette packing).
 * @param {Date} [now] Reference time for the holiday window; defaults to new Date().
 * @returns {Object} AppMessage key→value payload.
 */
function buildClayPayload(settings, watchInfo, now) {
    now = now || new Date();
    var theme = settings.theme || 'dark';

    // Resolve preset + health + radar to the packed view cycle up front — the holiday
    // mask below needs to know whether the DEFAULT (slot 0) view is the 3-row full
    // calendar, to anchor prevWeek the same way the watch draws it.
    var presetKey = viewCycle.resolvePresetKey(settings);
    var healthMode = settings.healthMode || 'off';
    var radarMode = settings.radarMode || 'graph';
    var cycle = viewCycle.buildViewCycle(presetKey, healthMode, radarMode);
    var defaultIsFull = cycle[0].tier === viewCycle.TIER_FULL;   // slot 0 is the 3-row calendar
    var compact = !defaultIsFull;
    // CLAY_TOP_VIEW_MODE (TopViewMode enum: 0=full,1=compact,2=none) is a boot-time hint the
    // watch overwrites per active view; derive it from the default slot's tier for correctness.
    var topViewIdx = defaultIsFull ? 0 : (cycle[0].tier === viewCycle.TIER_NONE ? 2 : 1);
    var payload = {
        "CLAY_CELSIUS": settings.temperatureUnits === 'c',
        "CLAY_TIME_LEAD_ZERO": settings.timeLeadingZero,
        "CLAY_AXIS_12H": settings.axisTimeFormat === '12h',
        "CLAY_COLOR_TODAY": settings.hasOwnProperty('colorToday') ? settings.colorToday : DEFAULT_COLOR_WHITE,
        "CLAY_START_MON": settings.weekStartDay === 'mon',
        // No-cal date slot order: US writes the month first (mm.dd.yy); everyone
        // else is day-first (dd.mm.yy). Derived from the configured holiday
        // country (defaults to US, matching the holiday-mask default below).
        "CLAY_DATE_MONTH_FIRST": (settings.hasOwnProperty('holidayCountry')
            ? settings.holidayCountry : 'US') === 'US',
        "CLAY_PREV_WEEK": settings.firstWeek === 'prev',
        "CLAY_TOP_VIEW_MODE": topViewIdx,
        "CLAY_THEME": ['dark', 'light', 'bw', 'bw-light'].indexOf(theme),
        "CLAY_TIME_FONT": ['roboto', 'leco', 'bitham'].indexOf(settings.timeFont),
        "CLAY_SHOW_QT": settings.showQt,
        "CLAY_BATTERY_LOW_ONLY": Boolean(settings.batteryLowOnly),
        "CLAY_SHOW_BT": settings.btIcons === "connected" || settings.btIcons === "both",
        "CLAY_SHOW_BT_DISCONNECT": settings.btIcons === "disconnected" || settings.btIcons === "both",
        "CLAY_VIBE": settings.vibe,
        "CLAY_SHOW_AM_PM": settings.timeShowAmPm,
        "CLAY_COLOR_SUNDAY": settings.hasOwnProperty('colorSunday') ? settings.colorSunday : DEFAULT_COLOR_FOLLY,
        "CLAY_COLOR_SATURDAY": settings.hasOwnProperty('colorSaturday') ? settings.colorSaturday : DEFAULT_COLOR_FOLLY,
        "CLAY_COLOR_US_FEDERAL": settings.hasOwnProperty('colorUSFederal') ? settings.colorUSFederal : DEFAULT_COLOR_BLUE_MOON,
        "HOLIDAYS": (function() {
            var country = settings.hasOwnProperty('holidayCountry') ? settings.holidayCountry : 'US';
            var region = settings.holidayRegion || 'all';
            var built = holidayMask.build({
                startMon: settings.weekStartDay === 'mon',
                prevWeek: compact ? false : (settings.firstWeek === 'prev'),
                country: country,
                region: region,
                enabled: settings.holidaysEnabled !== false
            }, now);
            return holidayMask.pack(built.anchor, built.mask);
        })(),
        "CLAY_COLOR_TIME": settings.hasOwnProperty('colorTime') ? settings.colorTime : resolveInk(DEFAULT_COLOR_WHITE, theme),
        "CLAY_DAY_NIGHT_SHADING": settings.hasOwnProperty('dayNightShading') ? settings.dayNightShading : true,
        // Order IS the wire value; 'slot' appended as 3 (never reorder — persisted on the watch).
        "CLAY_HEALTH_MODE": ['off', 'status', 'all', 'slot'].indexOf(settings.healthMode || 'off'),
        "CLAY_FETCH_INTERVAL_MIN": parseInt(settings.fetchIntervalMin, 10) || 30,
        "CLAY_RAIN_COUNTDOWN_HORIZON": (function() {
            var rc = parseInt(settings.rainCountdownHorizon, 10);
            if (isNaN(rc)) { rc = 60; }
            if ((settings.radarMode || 'graph') === 'off') { rc = 0; }
            return rc;
        })()
    };
    var palette = paletteWire.buildPaletteTuples(watchInfo, settings);
    payload.BAR_PALETTE_UINT8 = palette.BAR_PALETTE_UINT8;
    payload.RADAR_PALETTE_UINT8 = palette.RADAR_PALETTE_UINT8;

    // Pack the cycle into the three wire bytes (unused slots → 0 = disabled).
    payload.CLAY_VIEW_0 = viewCycle.packSpec(cycle[0] || null);
    payload.CLAY_VIEW_1 = viewCycle.packSpec(cycle[1] || null);
    payload.CLAY_VIEW_2 = viewCycle.packSpec(cycle[2] || null);
    payload.CLAY_VIEW_RESET_MIN = parseInt(settings.viewResetMin, 10) || 0;

    return payload;
}

module.exports = {
    buildClayPayload: buildClayPayload
};
