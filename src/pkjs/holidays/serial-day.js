//
// Days-from-civil (Howard Hinnant). Pure integer calendar arithmetic — no
// timezone/DST, no floating point. Shared contract with the watch's C port in
// calendar_layer.c; keep the two formulas identical.
// ES5 only (reaches the watch runtime).

/**
 * Convert a civil date to the number of days since 1970-01-01.
 *
 * @param {number} year Full year (e.g. 2026).
 * @param {number} month Month, 1-12.
 * @param {number} day Day of month, 1-31.
 * @returns {number} Days since 1970-01-01 (can be negative).
 */
function daysFromCivil(year, month, day) {
    var y = year - (month <= 2 ? 1 : 0);
    var era = Math.floor((y >= 0 ? y : y - 399) / 400);
    var yoe = y - era * 400;                                  // [0, 399]
    var doy = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1; // [0, 365]
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;             // [0, 146096]
    return era * 146097 + doe - 719468;
}

module.exports = daysFromCivil;
