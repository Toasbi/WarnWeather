'use strict';

// Sunrise and sunset, for feeds that don't report them (Bright Sky). These are NOAA's solar
// calculator formulas (after Meeus, "Astronomical Algorithms"): the sun's declination and the
// equation of time give solar noon, and the hour angle at which its centre is 0.833° below the
// horizon (refraction plus its radius) puts sunrise and sunset either side of it. Each event is
// worked out again at its own time, since both inputs drift over the day. Within about half a
// minute of Open-Meteo's times. Ref: https://gml.noaa.gov/grad/solcalc/calcdetails.html

const DAY_MS = 86400000;
const MINUTE_MS = 60000;
const RAD = Math.PI / 180;
const ZENITH = 90.833;

/**
 * The sun's declination and the equation of time at a moment.
 *
 * @param {number} ms Epoch milliseconds.
 * @returns {{declination: number, equationOfTime: number}} Declination in radians; equation of
 *   time in minutes.
 */
function solarPosition(ms) {
  const julianDay = ms / DAY_MS + 2440587.5;
  const t = (julianDay - 2451545) / 36525;
  const meanLongitude = ((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360 + 360) % 360;
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre = Math.sin(meanAnomaly * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * meanAnomaly * RAD) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * meanAnomaly * RAD) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const apparentLongitude = meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RAD);
  const declination = Math.asin(Math.sin(obliquity * RAD) * Math.sin(apparentLongitude * RAD));
  const y = Math.pow(Math.tan(obliquity * RAD / 2), 2);
  const l0 = meanLongitude * RAD;
  const m = meanAnomaly * RAD;
  const equationOfTime = 4 / RAD * (y * Math.sin(2 * l0) - 2 * eccentricity * Math.sin(m)
    + 4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0)
    - 0.5 * y * y * Math.sin(4 * l0) - 1.25 * eccentricity * eccentricity * Math.sin(2 * m));
  return { declination, equationOfTime };
}

/**
 * The hour angle of sunrise, in degrees, or null when the sun stays above or below the horizon.
 *
 * @param {number} latitude Degrees north.
 * @param {number} declination Radians.
 * @returns {number|null} Degrees.
 */
function sunriseHourAngle(latitude, declination) {
  const phi = latitude * RAD;
  const cosine = Math.cos(ZENITH * RAD) / (Math.cos(phi) * Math.cos(declination))
    - Math.tan(phi) * Math.tan(declination);
  return cosine >= -1 && cosine <= 1 ? Math.acos(cosine) / RAD : null;
}

/**
 * Sunrise and sunset on the place's local day around a moment.
 *
 * @param {number} ms The place's local noon (any moment on the day works away from the date line).
 * @param {number} latitude Degrees north.
 * @param {number} longitude Degrees east.
 * @returns {{rise: number, set: number}|null} Epoch seconds, or null when the sun doesn't rise or
 *   set that day (polar day or night).
 */
function sunTimes(ms, latitude, longitude) {
  const dayStart = Math.floor(ms / DAY_MS) * DAY_MS;
  // Minutes after dayStart, for solar noon and for an event at `sign` hour angles from it.
  const minutesAt = (at, sign) => {
    const position = solarPosition(at);
    const noon = 720 - 4 * longitude - position.equationOfTime;
    if (sign === 0) {
      return noon;
    }
    const hourAngle = sunriseHourAngle(latitude, position.declination);
    return hourAngle === null ? null : noon + sign * 4 * hourAngle;
  };
  const noon = minutesAt(dayStart + minutesAt(ms, 0) * MINUTE_MS, 0);
  const event = (sign) => {
    const first = minutesAt(dayStart + noon * MINUTE_MS, sign);
    if (first === null) {
      return null;
    }
    const second = minutesAt(dayStart + first * MINUTE_MS, sign);
    return second === null ? null : Math.round((dayStart + second * MINUTE_MS) / 1000);
  };
  const rise = event(-1);
  const set = event(1);
  return rise === null || set === null ? null : { rise, set };
}

module.exports = { sunTimes };
