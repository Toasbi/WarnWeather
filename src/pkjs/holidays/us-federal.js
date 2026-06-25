// src/pkjs/holidays/us-federal.js
//
// US-federal holiday rules, ported from the former is_us_federal_holiday() C rules
// in calendar_layer.c (now removed — the watch reads the PKJS holiday mask).
// The provider seam: any holiday source exposes isHoliday(date, region) -> boolean.
// ES5 only (reaches the watch runtime).

/**
 * Whether a local civil date is an observed US-federal holiday.
 *
 * @param {Date} date A JS Date; only its local year/month/day/weekday are read.
 * @param {string} [region] Ignored — US federal holidays are nationwide; accepted for the provider seam.
 * @returns {boolean} True when the date is a US-federal holiday.
 */
function isHoliday(date, region) {
    var mon = date.getMonth();   // 0-11
    var mday = date.getDate();   // 1-31
    var wday = date.getDay();    // 0=Sun .. 6=Sat

    // No holidays on weekends (avoids false positives for the observed-shift cases).
    if (wday === 0 || wday === 6) {
        return false;
    }

    // Holidays pinned to a weekday-of-month (no observed shift).
    if ((mon === 0  && mday >= 15 && mday <= 21 && wday === 1) || // MLK Day
        (mon === 1  && mday >= 15 && mday <= 21 && wday === 1) || // Washington's Birthday
        (mon === 4  && mday >= 25 && mday <= 31 && wday === 1) || // Memorial Day
        (mon === 8  && mday >= 1  && mday <= 7  && wday === 1) || // Labor Day
        (mon === 9  && mday >= 8  && mday <= 14 && wday === 1) || // Columbus Day
        (mon === 10 && mday >= 22 && mday <= 28 && wday === 4)) { // Thanksgiving
        return true;
    }

    // Fixed-date holidays observed on the nearest weekday.
    // Friday observed (holiday falls on Saturday).
    if (wday === 5 && (
        (mon === 11 && mday === 31) || // New Year (Jan 1 → Fri Dec 31)
        (mon === 6  && mday === 3)  || // Independence Day
        (mon === 10 && mday === 10) || // Veterans Day
        (mon === 11 && mday === 24))) { // Christmas
        return true;
    }
    // Monday observed (holiday falls on Sunday).
    if (wday === 1 && (
        (mon === 0  && mday === 2)  || // New Year (Jan 1 → Mon Jan 2)
        (mon === 6  && mday === 5)  || // Independence Day
        (mon === 10 && mday === 12) || // Veterans Day
        (mon === 11 && mday === 26))) { // Christmas
        return true;
    }
    // Falls on a weekday — observed on the day itself.
    if ((mon === 0  && mday === 1)  || // New Year
        (mon === 6  && mday === 4)  || // Independence Day
        (mon === 10 && mday === 11) || // Veterans Day
        (mon === 11 && mday === 25)) {  // Christmas
        return true;
    }

    return false;
}

module.exports = { isHoliday: isHoliday };
