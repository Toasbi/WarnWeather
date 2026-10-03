/**
 * Date-slot format wire codes: maps the two dateSlot* settings strings onto the
 * CLAY_DATE_FORMAT_UINT8 byte pair [monthYear, fullDate]. APPEND-ONLY, index =
 * wire value — lockstep with the C vocabulary in src/c/appendix/date_format.h
 * (DateMonthFormat / DateFullFormat), so a retired code keeps its slot. An
 * unknown or unset code packs 0 = Auto, the pre-setting behavior, which is also
 * what a watch that never receives the tuple renders.
 *
 * Also the date slot's TEXT, for the settings page's status bars preview: the watch
 * renders the slot itself (status_row.c format_status_date), so formatMonthYear and
 * formatFullDate are JS copies of date_format.h's two formatters, pinned to the C
 * host test's strings by test/date-format-contract.test.js. The settings page loads
 * this file too (window.DateFormat). ES5 only (aplite PKJS).
 */
(function () {
    var MONTH_FORMAT_CODES = ['auto', 'name', 'dots', 'slash', 'iso'];
    var FULL_FORMAT_CODES = ['auto', 'long', 'noyear', 'slash', 'iso', 'text', 'textyear'];

    // English month names, as strftime prints them in the app's default locale on the
    // watch ("%b" / "%B"; date_format.h: the app never calls setlocale()).
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
        'August', 'September', 'October', 'November', 'December'];

    /**
     * One settings code resolved to its wire byte.
     * @param {string[]} codes Append-only code list (index = wire value).
     * @param {*} value Stored settings value.
     * @returns {number} Wire byte; 0 (Auto) for unknown/unset.
     */
    function codeByte(codes, value) {
        var i = codes.indexOf(value);
        return i < 0 ? 0 : i;
    }

    /**
     * The CLAY_DATE_FORMAT_UINT8 payload for a settings blob.
     * @param {Object} settings Clay settings (claySettings.read() shape).
     * @returns {number[]} [monthYearFormat, fullDateFormat] wire bytes.
     */
    function buildDateFormatBytes(settings) {
        return [
            codeByte(MONTH_FORMAT_CODES, settings.dateSlotMonthFormat),
            codeByte(FULL_FORMAT_CODES, settings.dateSlotFullFormat)
        ];
    }

    /**
     * @param {number} n A non-negative integer.
     * @param {number} width Minimum digits.
     * @returns {string} n zero-padded to `width` (printf "%0Nd").
     */
    function pad(n, width) {
        var s = String(n);
        while (s.length < width) { s = '0' + s; }
        return s;
    }

    /**
     * The date slot while a calendar is on screen: month + year (date_format.h
     * date_format_month_year).
     * @param {Date} d The local date.
     * @param {*} code A MONTH_FORMAT_CODES value; unknown/unset = 'auto'.
     * @returns {string} e.g. 'Sep 2026', 'September 2026', '09.2026', '09/2026', '2026-09'
     */
    function formatMonthYear(d, code) {
        var mon = d.getMonth() + 1;
        var year = pad(d.getFullYear(), 4);
        var name = MONTHS[d.getMonth()];
        switch (code) {
        case 'name': return name + ' ' + year;
        case 'dots': return pad(mon, 2) + '.' + year;
        case 'slash': return pad(mon, 2) + '/' + year;
        case 'iso': return year + '-' + pad(mon, 2);
        default: return name.substr(0, 3) + ' ' + year;
        }
    }

    /**
     * The date slot with no calendar on screen: the full date (date_format.h
     * date_format_full), day and month in the country's order — month first for a US
     * Holiday region (clay-payload.js CLAY_DATE_MONTH_FIRST).
     * @param {Date} d The local date.
     * @param {*} code A FULL_FORMAT_CODES value; unknown/unset = 'auto'.
     * @param {boolean} monthFirst Whether the month leads.
     * @returns {string} e.g. '07.09.26', '7. Sep 2026', 'Sep 7, 2026'
     */
    function formatFullDate(d, code, monthFirst) {
        var mday = d.getDate();
        var mon = d.getMonth() + 1;
        var year = pad(d.getFullYear(), 4);
        var yy = pad(d.getFullYear() % 100, 2);
        var name = MONTHS[d.getMonth()].substr(0, 3);
        var a, b;
        switch (code) {
        case 'long':
            a = monthFirst ? mon : mday; b = monthFirst ? mday : mon;
            return pad(a, 2) + '.' + pad(b, 2) + '.' + year;
        case 'noyear':
            return (monthFirst ? mon + '.' + mday : mday + '.' + mon) + '.';
        case 'slash':
            return (monthFirst ? mon + '/' + mday : mday + '/' + mon) + '/' + yy;
        case 'iso':
            return year + '-' + pad(mon, 2) + '-' + pad(mday, 2);
        case 'text':
            return monthFirst ? name + ' ' + mday : mday + ' ' + name;
        case 'textyear':
            return monthFirst ? name + ' ' + mday + ', ' + year : mday + '. ' + name + ' ' + year;
        default:
            a = monthFirst ? mon : mday; b = monthFirst ? mday : mon;
            return pad(a, 2) + '.' + pad(b, 2) + '.' + yy;
        }
    }

    var api = {
        MONTH_FORMAT_CODES: MONTH_FORMAT_CODES,
        FULL_FORMAT_CODES: FULL_FORMAT_CODES,
        buildDateFormatBytes: buildDateFormatBytes,
        formatMonthYear: formatMonthYear,
        formatFullDate: formatFullDate
    };

    // Dual-context export, the tail of status-line-catalog.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.DateFormat = api;
    }
})();
