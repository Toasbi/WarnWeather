/**
 * Date-slot format wire codes: maps the two dateSlot* settings strings onto the
 * CLAY_DATE_FORMAT_UINT8 byte pair [monthYear, fullDate]. APPEND-ONLY, index =
 * wire value — lockstep with the C vocabulary in src/c/appendix/date_format.h
 * (DateMonthFormat / DateFullFormat), so a retired code keeps its slot. An
 * unknown or unset code packs 0 = Auto, the pre-setting behavior, which is also
 * what a watch that never receives the tuple renders.
 */

var MONTH_FORMAT_CODES = ['auto', 'name', 'dots', 'slash', 'iso'];
var FULL_FORMAT_CODES = ['auto', 'long', 'noyear', 'slash', 'iso', 'text', 'textyear'];

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

module.exports = {
    MONTH_FORMAT_CODES: MONTH_FORMAT_CODES,
    FULL_FORMAT_CODES: FULL_FORMAT_CODES,
    buildDateFormatBytes: buildDateFormatBytes
};
