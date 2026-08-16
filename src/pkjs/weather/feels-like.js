// src/pkjs/weather/feels-like.js
//
// Steadman apparent temperature ("feels like") for providers whose API exposes
// no feels-like field (DWD/Brightsky, Met.no):
//
//   AT = T + 0.33·e − 0.70·v − 4.00        (T in °C, v in m/s)
//   e  = (rh/100) · 6.105 · exp(17.27·T / (237.7 + T))   (vapor pressure, hPa)
//
// The repo's internal units are °F and km/h, so the helper converts on the way
// in and back out. Phone-side floats are fine — the no-float rule is C-side only.

/**
 * Whether a value is a real, finite number (null/undefined/NaN all fail).
 *
 * @param {*} value Candidate value.
 * @returns {boolean} True for a finite number.
 */
function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
}

/**
 * Steadman apparent temperature from internal-unit inputs.
 *
 * @param {number} tempF Air temperature in °F.
 * @param {number} rhPercent Relative humidity in percent [0, 100].
 * @param {number} windKmh Wind speed in km/h.
 * @returns {number|null} Apparent temperature in °F, or null when any input is
 *   missing/non-numeric — callers degrade to "no feels-like", never to 0.
 */
function feelsLikeF(tempF, rhPercent, windKmh) {
    if (!isFiniteNumber(tempF) || !isFiniteNumber(rhPercent) || !isFiniteNumber(windKmh)) {
        return null;
    }
    var tempC = (tempF - 32) * 5 / 9;
    var vaporPressureHpa = (rhPercent / 100) * 6.105 * Math.exp(17.27 * tempC / (237.7 + tempC));
    var windMs = windKmh / 3.6;
    var apparentC = tempC + 0.33 * vaporPressureHpa - 0.70 * windMs - 4.00;
    return apparentC * 9 / 5 + 32;
}

module.exports = {
    feelsLikeF: feelsLikeF
};
