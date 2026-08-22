// src/pkjs/sleep-window.js
/**
 * True when the sleep toggle is on and `now`'s hour is inside the configured
 * window. Schedule values arrive from Clay as strings; parsed and clamped at
 * use-site (default 22..7) rather than mutating settings.
 *
 * @param {Date} now Time to evaluate.
 * @param {Object} settings Clay settings (sleepNightEnabled/sleepStartHour/sleepEndHour).
 * @returns {boolean} True when `now` is within the sleep window.
 */
function isWithinSleepWindow(now, settings) {
    if (!settings || !settings.sleepNightEnabled) { return false; }
    var h = now.getHours();
    var start = parseInt(settings.sleepStartHour, 10);
    var end = parseInt(settings.sleepEndHour, 10);
    if (isNaN(start) || start < 0 || start > 23) { start = 22; }
    if (isNaN(end) || end < 0 || end > 23) { end = 7; }
    if (start === end) { return false; }
    if (start < end) { return h >= start && h < end; }
    return h >= start || h < end;
}


module.exports = {
    isWithinSleepWindow: isWithinSleepWindow
};
