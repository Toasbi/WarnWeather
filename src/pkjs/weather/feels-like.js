// src/pkjs/weather/feels-like.js
//
// Steadman apparent temperature ("feels like") for providers whose API exposes
// no feels-like field (DWD/Brightsky, Met.no) — and, under the Units tab's
// Steadman option, for every provider that sources humidity (the resolvers at
// the bottom of this file):
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

// The Units tab's feelsFormula setting — which feels-like a provider ships:
//   'provider' — the value the weather service itself reports where it has one.
//                tomorrow.io and Weather Underground follow the US heat-index /
//                wind-chill rule, which equals the air temperature between
//                roughly 5–10 °C (by provider) and 27 °C; Steadman only where
//                the API has none.
//   'steadman' — Steadman from temperature + humidity + wind on every provider
//                that sources humidity, so the curve reads the same everywhere.
// Phone-side only: the watch just receives FEELS_TREND / FEELS_CURRENT.
var FORMULA_PROVIDER = 'provider';
var FORMULA_STEADMAN = 'steadman';

/**
 * The per-hour ladder both series resolvers share: Steadman when the formula is
 * selected and steadmanAt(i) could compute it, else the provider's own value when
 * numeric, else that hour's air temperature — so the series stays numeric and as
 * long as tempsF (0 would be a real 0 °F feels). Any formula other than
 * 'steadman' reads as 'provider'.
 *
 * @param {string} formula 'provider' | 'steadman'.
 * @param {Array.<?number>|null} apiFeels The provider's own feels-like series (°F), or null.
 * @param {number[]} tempsF Air temperature series (°F); sets the output length.
 * @param {function(number): ?number} steadmanAt Steadman for hour i (°F), or null when not computable.
 * @returns {number[]} Feels-like series (°F).
 */
function resolveSeries(formula, apiFeels, tempsF, steadmanAt) {
    var steadman = formula === FORMULA_STEADMAN;
    var out = [];
    var i;
    var value;
    for (i = 0; i < tempsF.length; i += 1) {
        value = steadman ? steadmanAt(i) : null;
        if (value === null && apiFeels && isFiniteNumber(apiFeels[i])) {
            value = apiFeels[i];
        }
        out.push(value === null ? tempsF[i] : value);
    }
    return out;
}

/**
 * Resolve an hourly feels-like series under the feelsFormula setting, with the
 * moisture given as relative humidity (see resolveSeries for the ladder). An hour
 * whose humidity is null keeps the provider's value. The wind is the adapters'
 * windTrend, which already reads a missing hour as 0 km/h — the convention
 * dwd.js / metno.js compute their Steadman with — so a gap in the WIND never
 * blocks an hour; only a whole series absent (null) does.
 *
 * @param {string} formula 'provider' | 'steadman'.
 * @param {Array.<?number>|null} apiFeels The provider's own feels-like series (°F), or null.
 * @param {number[]} tempsF Air temperature series (°F); sets the output length.
 * @param {Array.<?number>|null} rhPercent Relative humidity per hour (%), or null when unsourced.
 * @param {number[]|null} windsKmh Wind speed per hour (km/h), or null.
 * @returns {number[]} Feels-like series (°F).
 */
function resolveFeelsTrend(formula, apiFeels, tempsF, rhPercent, windsKmh) {
    return resolveSeries(formula, apiFeels, tempsF, function(i) {
        return rhPercent ? feelsLikeF(tempsF[i], rhPercent[i], windsKmh ? windsKmh[i] : null) : null;
    });
}

/**
 * resolveFeelsTrend's twin for a provider whose moisture comes as a dew point
 * (Open-Meteo: its dew point already rides the aux call, and unlike a relative
 * humidity it carries the moisture model's own vapour pressure whichever
 * temperature series it is paired with).
 *
 * @param {string} formula 'provider' | 'steadman'.
 * @param {Array.<?number>|null} apiFeels The provider's own feels-like series (°F), or null.
 * @param {number[]} tempsF Air temperature series (°F); sets the output length.
 * @param {Array.<?number>|null} dewF Dew point per hour (°F), or null when unsourced.
 * @param {number[]|null} windsKmh Wind speed per hour (km/h), or null.
 * @returns {number[]} Feels-like series (°F).
 */
function resolveFeelsTrendFromDew(formula, apiFeels, tempsF, dewF, windsKmh) {
    return resolveSeries(formula, apiFeels, tempsF, function(i) {
        return dewF ? feelsLikeFromDewF(tempsF[i], dewF[i], windsKmh ? windsKmh[i] : null) : null;
    });
}

/**
 * Resolve the "now" feels-like under the feelsFormula setting: Steadman when
 * selected and computable, else the provider's own current value when numeric,
 * else null (→ FEELS_CURRENT omitted, the temp slot degrades) — never the air
 * temperature, which would echo the temp into the slot's feels half.
 *
 * @param {string} formula 'provider' | 'steadman'.
 * @param {*} apiFeels The provider's own current feels-like (°F), or null/undefined.
 * @param {*} tempF Current air temperature (°F).
 * @param {*} rhPercent Current relative humidity (%).
 * @param {*} windKmh Current wind speed (km/h).
 * @returns {number|null} Current feels-like (°F), or null.
 */
function resolveCurrentFeels(formula, apiFeels, tempF, rhPercent, windKmh) {
    return pickCurrent(formula === FORMULA_STEADMAN ? feelsLikeF(tempF, rhPercent, windKmh) : null,
        apiFeels);
}

/**
 * resolveCurrentFeels' twin for a dew-point moisture reading (Open-Meteo).
 *
 * @param {string} formula 'provider' | 'steadman'.
 * @param {*} apiFeels The provider's own current feels-like (°F), or null/undefined.
 * @param {*} tempF Current air temperature (°F).
 * @param {*} dewF Current dew point (°F).
 * @param {*} windKmh Current wind speed (km/h).
 * @returns {number|null} Current feels-like (°F), or null.
 */
function resolveCurrentFeelsFromDew(formula, apiFeels, tempF, dewF, windKmh) {
    return pickCurrent(formula === FORMULA_STEADMAN ? feelsLikeFromDewF(tempF, dewF, windKmh) : null,
        apiFeels);
}

/**
 * The "now" ladder: the computed Steadman value when there is one, else the
 * provider's own value when numeric, else null.
 *
 * @param {?number} steadmanF Computed Steadman (°F), or null when not computable / not selected.
 * @param {*} apiFeels The provider's own current feels-like (°F), or null/undefined.
 * @returns {number|null} Current feels-like (°F), or null.
 */
function pickCurrent(steadmanF, apiFeels) {
    if (steadmanF !== null) {
        return steadmanF;
    }
    return isFiniteNumber(apiFeels) ? apiFeels : null;
}

module.exports = {
    FORMULA_PROVIDER: FORMULA_PROVIDER,
    FORMULA_STEADMAN: FORMULA_STEADMAN,
    feelsLikeF: feelsLikeF,
    feelsLikeFromDewF: feelsLikeFromDewF,
    resolveFeelsTrend: resolveFeelsTrend,
    resolveFeelsTrendFromDew: resolveFeelsTrendFromDew,
    resolveCurrentFeels: resolveCurrentFeels,
    resolveCurrentFeelsFromDew: resolveCurrentFeelsFromDew
};
