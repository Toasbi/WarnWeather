// src/pkjs/weather/pressure-plausibility.js
//
// Shared plausibility window for one hourly sea-level (MSL) pressure reading, in
// hPa. Five of six providers (dwd, metno, openweathermap, tomorrowio, wunderground)
// zero-fill an hour their source station didn't report rather than null-filling
// it, and 0 hPa is physically impossible but exactly what that zero-fill coerces
// to.
//
// Both consumers of a raw pressure trend array must agree on what counts as real
// data: forecast-series.js (scales the graph line/dots) and status-lines.js (formats
// the status-slot text). forecast-series.js already requires status-lines.js, so
// status-lines.js requiring forecast-series.js back would be a require cycle --
// this leaf module has no requires of its own, so both can reach it instead.
//
// The world-record low is ~870 hPa, so nothing legitimate falls outside this
// window; it exists solely to catch nulls and the zero-fill idiom.
var PRESSURE_MIN_VALID = 800;
var PRESSURE_MAX_VALID = 1100;

/**
 * Whether one sea-level pressure reading is physically plausible.
 * @param {*} v Candidate value (raw provider entry; may be null/undefined/NaN/a string).
 * @returns {boolean} True when v is a finite number inside the plausible MSL window.
 */
function isPlausiblePressure(v) {
    var n = Number(v);
    return isFinite(n) && n >= PRESSURE_MIN_VALID && n <= PRESSURE_MAX_VALID;
}

module.exports = {
    PRESSURE_MIN_VALID: PRESSURE_MIN_VALID,
    PRESSURE_MAX_VALID: PRESSURE_MAX_VALID,
    isPlausiblePressure: isPlausiblePressure
};
