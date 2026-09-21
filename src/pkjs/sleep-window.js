// src/pkjs/sleep-window.js
//
// The battery saver's night window: sleepStartHour/sleepEndHour, the pair that
// switch has always owned. The Nighttime card groups the saver with the theme
// switch and the backlight dim, but each of the three owns its OWN hours — there
// is no shared window to choose between, so there is nothing to resolve here.

// Clamp targets for unparseable/out-of-range hours. Deliberately NOT the
// schema defaults (0/7): this is the historical "sane night" fallback, kept so
// garbage in storage can never widen the pause to the whole day.
var DEFAULT_START = 22;
var DEFAULT_END = 7;

/**
 * Parse an hour select value ('0'..'23'), clamping garbage to a fallback.
 *
 * THE home of the rule: every hour window in the app parses its stored hours this
 * way, and each caller passes the fallback ITS OWN keys default to in schema.js,
 * since that is what an unparseable stored value stands in for. Exported for the
 * other windows built on it (night-light.js's dim window).
 *
 * @param {*} value Stored hour value (string from the settings page).
 * @param {number} fallback Hour to use when the value doesn't parse.
 * @returns {number} Hour 0..23.
 */
function parseHour(value, fallback) {
    var h = parseInt(value, 10);
    if (isNaN(h) || h < 0 || h > 23) { return fallback; }
    return h;
}

/**
 * True when the sleep toggle is on and `now`'s hour is inside the configured
 * window. Schedule values arrive from Clay as strings; parsed and clamped at
 * use-site (default 22..7) rather than mutating settings. The end hour is
 * EXCLUSIVE, the window WRAPS past midnight, and a zero-length window
 * (start === end) means never — the conventions night-light.js's dim window and
 * theme-schedule.js's manual window follow too.
 *
 * @param {Date} now Time to evaluate.
 * @param {Object} settings Clay settings (sleepNightEnabled/sleepStartHour/sleepEndHour).
 * @returns {boolean} True when `now` is within the sleep window.
 */
function isWithinSleepWindow(now, settings) {
    if (!settings || !settings.sleepNightEnabled) { return false; }
    var h = now.getHours();
    var start = parseHour(settings.sleepStartHour, DEFAULT_START);
    var end = parseHour(settings.sleepEndHour, DEFAULT_END);
    if (start === end) { return false; }
    if (start < end) { return h >= start && h < end; }
    return h >= start || h < end;
}


module.exports = {
    isWithinSleepWindow: isWithinSleepWindow,
    parseHour: parseHour
};
