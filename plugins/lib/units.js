'use strict';

// The user's units (`preferences/units`) and how a metric reading reads in them. Forecasts are
// normalized to °C, km/h, hPa and mm; each shape is converted here on the way out, so the text and
// the numericValue of one reading always agree.

const UNITS_SOURCE = { category: 'preferences', item: 'units' };

/** Metric with a 24-hour clock: what the plugins use when the Pebble app can't say. */
const DEFAULTS = Object.freeze({
  temperature: '°C',
  wind: 'km/h',
  pressure: 'hPa',
  precipitation: 'mm',
  clock: '24h',
  locale: '',
});

/** km/h -> each wind unit `preferences/units` can name. */
const WIND_FACTORS = { 'km/h': 1, mph: 1 / 1.609344, 'm/s': 1 / 3.6, knots: 1 / 1.852 };

/** How each wind unit prints after the number. */
const WIND_LABELS = { 'km/h': 'km/h', mph: 'mph', 'm/s': 'm/s', knots: 'kn' };

const HPA_TO_INHG = 0.029529983071445;
const MM_PER_INCH = 25.4;

// Languages that write a decimal comma. The plugin engine may have no Intl, so this short list
// stands in for it: it only touches the readings shown with decimals (rain amounts, inHg).
const DECIMAL_COMMA = [
  'bg', 'cs', 'da', 'de', 'el', 'es', 'et', 'fi', 'fr', 'hr', 'hu', 'id', 'it', 'lt', 'lv', 'nb',
  'nl', 'nn', 'no', 'pl', 'pt', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'tr', 'uk',
];

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/**
 * `value` when `allowed` lists it, else `fallback`.
 *
 * @param {string} value Candidate.
 * @param {string[]} allowed Accepted values.
 * @param {string} fallback Default.
 * @returns {string} The accepted value.
 */
function pick(value, allowed, fallback) {
  return allowed.indexOf(value) !== -1 ? value : fallback;
}

/**
 * The user's units from a `preferences/units` instance's properties. Anything missing or unknown
 * keeps its metric default.
 *
 * @param {Object} properties The instance's properties (each a `shortText`).
 * @returns {Object} {temperature, wind, pressure, precipitation, clock, locale}.
 */
function fromProperties(properties) {
  const text = (name) => {
    const property = properties && properties[name];
    return property && property.shortText && typeof property.shortText.text === 'string'
      ? property.shortText.text : '';
  };
  return {
    temperature: pick(text('temperature'), ['°C', '°F'], DEFAULTS.temperature),
    wind: pick(text('wind_speed'), Object.keys(WIND_FACTORS), DEFAULTS.wind),
    pressure: pick(text('pressure'), ['hPa', 'inHg'], DEFAULTS.pressure),
    precipitation: pick(text('precipitation'), ['mm', 'in'], DEFAULTS.precipitation),
    clock: pick(text('clock'), ['12h', '24h'], DEFAULTS.clock),
    locale: text('locale'),
  };
}

/**
 * Read the user's units from the Pebble app, or the metric defaults when it can't say (an older
 * app, or a failed read).
 *
 * @returns {Promise<Object>} The units (see fromProperties).
 */
async function readUnits() {
  try {
    const envelope = await Pebble.readSource(Object.assign({}, UNITS_SOURCE));
    const instance = envelope && envelope.instances && envelope.instances[0];
    return instance ? fromProperties(instance.properties) : Object.assign({}, DEFAULTS);
  } catch (error) {
    return Object.assign({}, DEFAULTS);
  }
}

/**
 * Round to a number of decimals, without a negative zero.
 *
 * @param {number} value Value.
 * @param {number} digits Decimals.
 * @returns {number} Rounded value.
 */
function round(value, digits) {
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor + 0;
}

/**
 * Whether a locale writes a decimal comma.
 *
 * @param {string} locale BCP 47 tag, e.g. 'de-DE'.
 * @returns {boolean} True for a decimal-comma language.
 */
function usesDecimalComma(locale) {
  const language = String(locale || '').toLowerCase().split(/[-_]/)[0];
  return DECIMAL_COMMA.indexOf(language) !== -1;
}

/**
 * A number with fixed decimals, in the locale's decimal separator.
 *
 * @param {number} value Value.
 * @param {number} digits Decimals.
 * @param {string} locale BCP 47 tag.
 * @returns {string} Formatted number.
 */
function decimal(value, digits, locale) {
  const text = round(value, digits).toFixed(digits);
  return usesDecimalComma(locale) ? text.replace('.', ',') : text;
}

/**
 * @param {number} celsius Temperature in °C.
 * @param {Object} units The user's units.
 * @returns {number} In the user's unit, one decimal.
 */
function temperatureValue(celsius, units) {
  return round(units.temperature === '°F' ? celsius * 9 / 5 + 32 : celsius, 1);
}

/**
 * @param {number} celsius Temperature in °C.
 * @param {Object} units The user's units.
 * @returns {string} e.g. '7°C' or '45°F'.
 */
function temperatureText(celsius, units) {
  return Math.round(temperatureValue(celsius, units)) + 0 + units.temperature;
}

/**
 * @param {number} kmh Speed in km/h.
 * @param {Object} units The user's units.
 * @returns {number} In the user's wind unit, one decimal.
 */
function speedValue(kmh, units) {
  return round(kmh * WIND_FACTORS[units.wind], 1);
}

/**
 * @param {number} kmh Speed in km/h.
 * @param {Object} units The user's units.
 * @returns {string} e.g. '12 km/h' or '7 kn'.
 */
function speedText(kmh, units) {
  return Math.round(speedValue(kmh, units)) + 0 + ' ' + WIND_LABELS[units.wind];
}

/**
 * @param {number} hpa Sea-level pressure in hPa.
 * @param {Object} units The user's units.
 * @returns {number} In the user's unit: hPa to one decimal, inHg to two.
 */
function pressureValue(hpa, units) {
  return units.pressure === 'inHg' ? round(hpa * HPA_TO_INHG, 2) : round(hpa, 1);
}

/**
 * @param {number} hpa Sea-level pressure in hPa.
 * @param {Object} units The user's units.
 * @param {boolean} spaced A space before the unit (the longText).
 * @returns {string} e.g. '1013hPa', '1013 hPa' or '29.91 inHg'.
 */
function pressureText(hpa, units, spaced) {
  const gap = spaced ? ' ' : '';
  if (units.pressure === 'inHg') {
    return decimal(hpa * HPA_TO_INHG, 2, units.locale) + gap + 'inHg';
  }
  return Math.round(hpa) + gap + 'hPa';
}

/**
 * @param {number} mm Precipitation in mm.
 * @param {Object} units The user's units.
 * @returns {number} In the user's unit: mm to one decimal, inches to two.
 */
function amountValue(mm, units) {
  return units.precipitation === 'in' ? round(mm / MM_PER_INCH, 2) : round(mm, 1);
}

/**
 * @param {number} mm Precipitation in mm.
 * @param {Object} units The user's units.
 * @returns {string} e.g. '0.4mm' or '0,02in'.
 */
function amountText(mm, units) {
  if (units.precipitation === 'in') {
    return decimal(mm / MM_PER_INCH, 2, units.locale) + 'in';
  }
  return decimal(mm, 1, units.locale) + 'mm';
}

/**
 * @param {number} percent Percentage.
 * @returns {string} e.g. '84%'.
 */
function percentText(percent) {
  return Math.round(percent) + 0 + '%';
}

/**
 * @param {number} index UV index.
 * @returns {string} e.g. '3'.
 */
function uvText(index) {
  return String(Math.round(index) + 0);
}

/**
 * The eight-point compass direction the wind comes from.
 *
 * @param {number} degrees Bearing the wind comes from, 0-360.
 * @returns {string} 'N', 'NE', ... 'NW'.
 */
function compass(degrees) {
  const sector = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return COMPASS[sector];
}

/**
 * The time of day at the place, on the user's clock.
 *
 * @param {number} epochSec Moment, epoch seconds.
 * @param {number} offsetMin The place's UTC offset in minutes.
 * @param {Object} units The user's units (clock).
 * @returns {string} e.g. '07:12' or '7:12 AM'.
 */
function clockText(epochSec, offsetMin, units) {
  const local = new Date((epochSec + offsetMin * 60) * 1000);
  const hours = local.getUTCHours();
  const minutes = ('0' + local.getUTCMinutes()).slice(-2);
  if (units.clock === '12h') {
    return ((hours + 11) % 12 + 1) + ':' + minutes + (hours < 12 ? ' AM' : ' PM');
  }
  return ('0' + hours).slice(-2) + ':' + minutes;
}

module.exports = {
  UNITS_SOURCE,
  DEFAULTS,
  fromProperties,
  readUnits,
  round,
  decimal,
  usesDecimalComma,
  temperatureValue,
  temperatureText,
  speedValue,
  speedText,
  pressureValue,
  pressureText,
  amountValue,
  amountText,
  percentText,
  uvText,
  compass,
  clockText,
};
