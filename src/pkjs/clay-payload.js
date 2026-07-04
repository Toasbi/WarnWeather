// Maps Clay settings to the watch AppMessage (CLAY_* keys + packed holiday
// window). Extracted from index.js so the mapping is unit-testable (index.js
// wires Pebble events and can't be required under node:test). ES5-only (PKJS).

var pebbleColors = require('./pebble-colors.js');
var holidayMask = require('./holidays/holiday-mask.js');
var paletteWire = require('./weather/palette-wire.js');

var DEFAULT_COLOR_WHITE = pebbleColors.GColorWhite;
var DEFAULT_COLOR_FOLLY = pebbleColors.GColorFolly;

/**
 * Build the Clay settings AppMessage payload.
 * @param {Object} settings Clay settings (claySettings.read() shape).
 * @param {Object|null} watchInfo Active watch info (platform read for palette packing).
 * @param {Date} [now] Reference time for the holiday window; defaults to new Date().
 * @returns {Object} AppMessage key→value payload.
 */
function buildClayPayload(settings, watchInfo, now) {
    now = now || new Date();
    var TOP_VIEW_MODES = ['full', 'compact', 'none'];
    var topViewMode = settings.topViewMode || 'compact';
    var topViewIdx = TOP_VIEW_MODES.indexOf(topViewMode);
    if (topViewIdx < 0) { topViewIdx = 1; }        // unknown → compact

    // Layout preset → the watch's three-slot view cycle (ViewContent enum in
    // config.h: VC_OFF=0, VC_FORECAST_FULL=1, VC_FORECAST_COMPACT=2,
    // VC_FORECAST_NONE=3, VC_RADAR=4, VC_HEALTH_STATUS=5, VC_HEALTH_GRAPH=6).
    // Resolved up front (rather than down by CLAY_VIEW_*) because the holiday
    // mask below needs to know whether the DEFAULT (slot 0) view is the 3-row
    // full calendar, to anchor prevWeek the same way the watch will draw it.
    var LAYOUT_PRESETS = {
        classic:    [2, 4, 0],   // compact / radar / off      (today's behaviour)
        radarLast:  [2, 5, 4],   // compact / health-status / radar
        forecast:   [3, 4, 0],   // big forecast / radar / off
        fullCal:    [1, 4, 0],   // 3-row calendar / radar / off
        healthFirst:[2, 6, 4]    // compact / health-graph / radar
    };
    // Legacy migration: pre-preset installs only ever set healthMode/topViewMode.
    // When layoutPreset hasn't been chosen yet (new setting, unset in existing
    // storage), derive an equivalent preset so an upgrade doesn't silently reset
    // the watch to the classic layout — and, for existing health users, so health
    // stays reachable instead of being dropped from the cycle entirely.
    var layoutPresetKey = settings.layoutPreset;
    if (!layoutPresetKey) {
        if (settings.healthMode === 'all') {
            layoutPresetKey = 'healthFirst';
        } else if (settings.healthMode === 'status') {
            layoutPresetKey = 'radarLast';
        } else if (settings.topViewMode === 'full') {
            layoutPresetKey = 'fullCal';
        } else if (settings.topViewMode === 'none') {
            layoutPresetKey = 'forecast';
        } else {
            layoutPresetKey = 'classic';
        }
    }
    var preset = LAYOUT_PRESETS[layoutPresetKey] || LAYOUT_PRESETS.classic;
    var defaultIsFull = preset[0] === 1;           // slot 0 is the 3-row calendar
    var compact = !defaultIsFull;
    var payload = {
        "CLAY_CELSIUS": settings.temperatureUnits === 'c',
        "CLAY_TIME_LEAD_ZERO": settings.timeLeadingZero,
        "CLAY_AXIS_12H": settings.axisTimeFormat === '12h',
        "CLAY_COLOR_TODAY": settings.hasOwnProperty('colorToday') ? settings.colorToday : DEFAULT_COLOR_WHITE,
        "CLAY_START_MON": settings.weekStartDay === 'mon',
        "CLAY_PREV_WEEK": settings.firstWeek === 'prev',
        "CLAY_TOP_VIEW_MODE": topViewIdx,
        "CLAY_TIME_FONT": ['roboto', 'leco', 'bitham'].indexOf(settings.timeFont),
        "CLAY_SHOW_QT": settings.showQt,
        "CLAY_SHOW_BT": settings.btIcons === "connected" || settings.btIcons === "both",
        "CLAY_SHOW_BT_DISCONNECT": settings.btIcons === "disconnected" || settings.btIcons === "both",
        "CLAY_VIBE": settings.vibe,
        "CLAY_SHOW_AM_PM": settings.timeShowAmPm,
        "CLAY_COLOR_SUNDAY": settings.hasOwnProperty('colorSunday') ? settings.colorSunday : DEFAULT_COLOR_FOLLY,
        "CLAY_COLOR_SATURDAY": settings.hasOwnProperty('colorSaturday') ? settings.colorSaturday : DEFAULT_COLOR_FOLLY,
        "CLAY_COLOR_US_FEDERAL": settings.hasOwnProperty('colorUSFederal') ? settings.colorUSFederal : DEFAULT_COLOR_FOLLY,
        "HOLIDAYS": (function() {
            var country = settings.hasOwnProperty('holidayCountry') ? settings.holidayCountry : 'US';
            var region = settings['holidayRegion' + country] || 'all';
            var built = holidayMask.build({
                startMon: settings.weekStartDay === 'mon',
                prevWeek: compact ? false : (settings.firstWeek === 'prev'),
                country: country,
                region: region,
                enabled: settings.holidaysEnabled !== false
            }, now);
            return holidayMask.pack(built.anchor, built.mask);
        })(),
        "CLAY_COLOR_TIME": settings.hasOwnProperty('colorTime') ? settings.colorTime : DEFAULT_COLOR_WHITE,
        "CLAY_DAY_NIGHT_SHADING": settings.hasOwnProperty('dayNightShading') ? settings.dayNightShading : true,
        "CLAY_HEALTH_MODE": ['off', 'status', 'all'].indexOf(settings.healthMode || 'off'),
        // Phone gates health-off so the watch can trust the flag: dual-status is only
        // meaningful when a health view (status OR graph) is on. The watch owns the
        // remaining (layout) guard — dual never applies in full top view.
        "CLAY_DUAL_STATUS": Boolean(settings.dualStatus) && (settings.healthMode || 'off') !== 'off',
        "CLAY_FETCH_INTERVAL_MIN": parseInt(settings.fetchIntervalMin, 10) || 30,
        "CLAY_RAIN_COUNTDOWN_HORIZON": (function() {
            var rc = parseInt(settings.rainCountdownHorizon, 10);
            if (isNaN(rc)) { rc = 60; }
            if (settings.radarProvider === 'disabled') { rc = 0; }
            return rc;
        })()
    };
    var palette = paletteWire.buildPaletteTuples(watchInfo, settings);
    payload.BAR_PALETTE_UINT8 = palette.BAR_PALETTE_UINT8;
    payload.RADAR_PALETTE_UINT8 = palette.RADAR_PALETTE_UINT8;

    // preset was resolved above (before HOLIDAYS) so the calendar anchoring
    // could see the default view's slot; reuse it here rather than resolving twice.
    payload.CLAY_VIEW_0 = preset[0];
    payload.CLAY_VIEW_1 = preset[1];
    payload.CLAY_VIEW_2 = preset[2];
    payload.CLAY_VIEW_RESET_MIN = parseInt(settings.viewResetMin, 10) || 0;

    return payload;
}

module.exports = {
    buildClayPayload: buildClayPayload
};
