// src/pkjs/sleep-window.js
//
// The battery saver's night window. Since the Nighttime card landed, the hours
// come from one of TWO pairs: the card-level "Night hours"
// (sleepStartHour/sleepEndHour — shared with the other night features) or the
// saver's own sleepNightStartHour/sleepNightEndHour, selected by the
// sleepNightMode segmented control. Everything that needs the window goes
// through resolveSleepWindow() so the mode is honoured in exactly one place.

// Clamp targets for unparseable/out-of-range hours. Deliberately NOT the
// schema defaults (0/7): this is the historical "sane night" fallback, kept so
// garbage in storage can never widen the pause to the whole day.
var DEFAULT_START = 22;
var DEFAULT_END = 7;

/**
 * Parse an hour select value ('0'..'23'), clamping garbage to a fallback.
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
 * The EFFECTIVE (start, end) hour pair the battery saver runs on. Mode 'custom'
 * takes the saver's own pair; anything else — including the 'night' default and
 * an upgrading install with no sleepNightMode stored at all — takes the shared
 * Night hours, so behaviour is unchanged for every existing install.
 *
 * Callers apply the start === end "never" rule themselves (an empty window is
 * not a pair this can express).
 *
 * @param {Object} settings Clay settings (sleepNightMode + both hour pairs).
 * @returns {{start: number, end: number}} Effective hours, each 0..23.
 */
function resolveSleepWindow(settings) {
    var s = settings || {};
    var custom = (s.sleepNightMode || 'night') === 'custom';
    return {
        start: parseHour(custom ? s.sleepNightStartHour : s.sleepStartHour, DEFAULT_START),
        end: parseHour(custom ? s.sleepNightEndHour : s.sleepEndHour, DEFAULT_END)
    };
}

/**
 * True when the sleep toggle is on and `now`'s hour is inside the effective
 * window. Schedule values arrive from Clay as strings; parsed and clamped at
 * use-site (default 22..7) rather than mutating settings. A zero-length window
 * (start === end) means never.
 *
 * @param {Date} now Time to evaluate.
 * @param {Object} settings Clay settings (sleepNightEnabled + resolveSleepWindow's keys).
 * @returns {boolean} True when `now` is within the sleep window.
 */
function isWithinSleepWindow(now, settings) {
    if (!settings || !settings.sleepNightEnabled) { return false; }
    var h = now.getHours();
    var win = resolveSleepWindow(settings);
    if (win.start === win.end) { return false; }
    if (win.start < win.end) { return h >= win.start && h < win.end; }
    return h >= win.start || h < win.end;
}


module.exports = {
    isWithinSleepWindow: isWithinSleepWindow,
    resolveSleepWindow: resolveSleepWindow
};
