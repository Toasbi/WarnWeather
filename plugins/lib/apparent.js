'use strict';

// Humidity and "feels like" for feeds that don't report them (Bright Sky's forecast records carry a
// dew point but no relative humidity). The formulas are the ones the WarnWeather watchface uses
// (src/pkjs/weather/feels-like.js), so a plugin and the face agree on the same inputs:
//
//   apparent temperature (Steadman):  AT = T + 0.33·e − 0.70·v − 4.00   (T in °C, v in m/s)
//   vapour pressure (Magnus):         e  = (rh/100) · 6.105 · exp(17.27·T / (237.7 + T))

const { isNumber } = require('./values');

/**
 * Saturation vapour pressure (Magnus).
 *
 * @param {number} tempC Temperature in °C.
 * @returns {number} hPa.
 */
function saturationVaporPressure(tempC) {
  return 6.105 * Math.exp(17.27 * tempC / (237.7 + tempC));
}

/**
 * Relative humidity from the temperature and dew point.
 *
 * @param {number} tempC Air temperature in °C.
 * @param {number} dewPointC Dew point in °C.
 * @returns {number|null} Percent, 0-100, or null without both inputs.
 */
function humidityFromDewPoint(tempC, dewPointC) {
  if (!isNumber(tempC) || !isNumber(dewPointC)) {
    return null;
  }
  const humidity = 100 * saturationVaporPressure(dewPointC) / saturationVaporPressure(tempC);
  return Math.max(0, Math.min(100, Math.round(humidity)));
}

/**
 * Steadman's apparent temperature. A missing wind reads as calm, as the watchface reads it.
 *
 * @param {number} tempC Air temperature in °C.
 * @param {number} humidity Relative humidity in percent.
 * @param {number|null} windKmh Wind speed in km/h.
 * @returns {number|null} °C, or null without the temperature and humidity.
 */
function apparentTemperature(tempC, humidity, windKmh) {
  if (!isNumber(tempC) || !isNumber(humidity)) {
    return null;
  }
  const vaporPressure = humidity / 100 * saturationVaporPressure(tempC);
  const windMs = isNumber(windKmh) ? windKmh / 3.6 : 0;
  return tempC + 0.33 * vaporPressure - 0.70 * windMs - 4.00;
}

module.exports = { saturationVaporPressure, humidityFromDewPoint, apparentTemperature };
