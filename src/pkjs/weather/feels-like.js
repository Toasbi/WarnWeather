// src/pkjs/weather/feels-like.js
//
// Steadman apparent temperature ("feels like") for providers whose API exposes
// no feels-like field (DWD/Brightsky, Met.no):
//
//   AT = T + 0.33·e − 0.70·v − 4.00        (T in °C, v in m/s)
//   e  = (rh/100) · 6.105 · exp(17.27·T / (237.7 + T))   (vapor pressure, hPa)
//
// The vapor pressure e can come from relative humidity + air temperature, or —
// exactly equivalently — from the dew point alone (e is the saturation pressure
// AT the dew point). Brightsky forecast records carry dew_point but a null
// relative_humidity, so the dew-point route is the one that actually fires there.
//
// The repo's internal units are °F and km/h, so the helpers convert on the way
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
 * Magnus saturation vapor pressure at a temperature.
 *
 * @param {number} tempC Temperature in °C.
 * @returns {number} Saturation vapor pressure in hPa.
 */
function saturationVaporPressureHpa(tempC) {
    return 6.105 * Math.exp(17.27 * tempC / (237.7 + tempC));
}

/**
 * Steadman apparent temperature from a vapor pressure.
 *
 * @param {number} tempC Air temperature in °C.
 * @param {number} vaporPressureHpa Vapor pressure in hPa.
 * @param {number} windKmh Wind speed in km/h.
 * @returns {number} Apparent temperature in °F.
 */
function steadmanF(tempC, vaporPressureHpa, windKmh) {
    var windMs = windKmh / 3.6;
    var apparentC = tempC + 0.33 * vaporPressureHpa - 0.70 * windMs - 4.00;
    return apparentC * 9 / 5 + 32;
}

/**
 * Steadman apparent temperature from relative humidity.
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
    return steadmanF(tempC, (rhPercent / 100) * saturationVaporPressureHpa(tempC), windKmh);
}

/**
 * Steadman apparent temperature from the dew point (e = e_sat(dew point)).
 *
 * @param {number} tempF Air temperature in °F.
 * @param {number} dewPointF Dew point in °F.
 * @param {number} windKmh Wind speed in km/h.
 * @returns {number|null} Apparent temperature in °F, or null when any input is
 *   missing/non-numeric.
 */
function feelsLikeFromDewF(tempF, dewPointF, windKmh) {
    if (!isFiniteNumber(tempF) || !isFiniteNumber(dewPointF) || !isFiniteNumber(windKmh)) {
        return null;
    }
    var tempC = (tempF - 32) * 5 / 9;
    var dewC = (dewPointF - 32) * 5 / 9;
    return steadmanF(tempC, saturationVaporPressureHpa(dewC), windKmh);
}

module.exports = {
    feelsLikeF: feelsLikeF,
    feelsLikeFromDewF: feelsLikeFromDewF
};
