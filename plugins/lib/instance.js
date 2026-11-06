'use strict';

// One `weather/location` instance from a normalized forecast: every property a plugin serves, in
// every shape its kind has, in the user's units.
//
// A normalized forecast is provider-neutral and metric (°C, km/h, hPa, mm, %), with null for a
// missing reading:
//
//   utcOffsetMin  the place's offset from UTC, in minutes
//   current       {temperature, feelsLike, humidity, dewPoint, pressure, cloudCover, windSpeed,
//                  windGust, windDirection, uvIndex, precipitation, precipitationAmount, condition}
//                 - any may be absent: the hour now falls in stands in for it
//   hourly        {start, <field>: [...]} - start is epoch seconds on an hour; the same fields as
//                 current, one per hour. Instants (temperature, humidity, pressure, cloud cover,
//                 wind speed and direction) are read at the stamp; interval readings
//                 (precipitation chance and amount, gusts, UV, the condition) cover the hour
//                 starting at the stamp.
//   daily         {start, <field>: [...]} - start is the place's local midnight; high, low,
//                 condition, precipitation (chance), precipitationAmount, uvIndex, windSpeed and
//                 windGust (the day's highest), sunrise and sunset (epoch seconds)
//
// A condition is {code, short, long}: code from the shared vocabulary (sun, partly_cloudy, cloudy,
// light_rain, heavy_rain, light_snow, heavy_snow, rain_and_snow, unknown), short at most 12
// characters and long at most 32, which is what the watch's weather app shows of them.
//
// Series start at the place's local midnight, as the plugin guide asks: hourly_* run
// HOURLY_HOURS from it (so always 72 hours ahead or more), daily_* DAILY_DAYS.

const vocabulary = require('./vocabulary');
const units = require('./units');

const HOUR = 3600;
const DAY = 86400;
const HOURLY_HOURS = 96;
const DAILY_DAYS = 7;

/**
 * @param {*} value Candidate.
 * @returns {boolean} True for a reading: a finite number or a condition with a code.
 */
function isPresent(value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === 'number') {
    return isFinite(value);
  }
  if (typeof value === 'object') {
    return typeof value.code === 'string';
  }
  return typeof value === 'string' && value !== '';
}

/**
 * The start of the local day a moment falls in.
 *
 * @param {number} epochSec Moment, epoch seconds.
 * @param {number} offsetMin UTC offset in minutes.
 * @returns {number} Local midnight, epoch seconds.
 */
function localMidnight(epochSec, offsetMin) {
  const local = epochSec + offsetMin * 60;
  return local - (((local % DAY) + DAY) % DAY) - offsetMin * 60;
}

/**
 * `count` readings of a series from `from`, null where it has none.
 *
 * @param {Array} values The series' values.
 * @param {number} start Epoch seconds of values[0].
 * @param {number} step Seconds between values.
 * @param {number} from Epoch seconds of the first reading wanted.
 * @param {number} count Readings wanted.
 * @returns {Array} The readings.
 */
function seriesWindow(values, start, step, from, count) {
  const out = [];
  const first = Math.round((from - start) / step);
  for (let i = 0; i < count; i += 1) {
    const value = Array.isArray(values) ? values[first + i] : undefined;
    out.push(isPresent(value) ? value : null);
  }
  return out;
}

// How each kind turns a reading into its shapes. number() gives the numericValue, unit() and range
// its shared metadata, texts() the text shapes; time gives a timestamp.
const RENDER = {
  text: {
    texts: (text) => ({ shortText: text, longText: text }),
  },
  temperature: {
    unit: (ctx) => ctx.units.temperature,
    number: (celsius, ctx) => units.temperatureValue(celsius, ctx.units),
    texts: (celsius, ctx) => {
      const text = units.temperatureText(celsius, ctx.units);
      return { shortText: text, longText: text };
    },
  },
  percent: {
    unit: () => '%',
    range: [0, 100],
    number: (percent) => Math.round(percent) + 0,
    texts: (percent) => ({ shortText: units.percentText(percent) }),
  },
  speed: {
    unit: (ctx) => ctx.units.wind,
    number: (kmh, ctx) => units.speedValue(kmh, ctx.units),
    texts: (kmh, ctx) => ({ shortText: units.speedText(kmh, ctx.units) }),
  },
  direction: {
    unit: () => '°',
    range: [0, 360],
    number: (degrees) => Math.round(((degrees % 360) + 360) % 360),
    texts: (degrees) => ({ shortText: units.compass(degrees) }),
  },
  pressure: {
    unit: (ctx) => ctx.units.pressure,
    number: (hpa, ctx) => units.pressureValue(hpa, ctx.units),
    texts: (hpa, ctx) => ({
      shortText: units.pressureText(hpa, ctx.units, false),
      longText: units.pressureText(hpa, ctx.units, true),
    }),
  },
  amount: {
    unit: (ctx) => ctx.units.precipitation,
    number: (mm, ctx) => units.amountValue(mm, ctx.units),
    texts: (mm, ctx) => ({ shortText: units.amountText(mm, ctx.units) }),
  },
  uv: {
    range: [0, 11],
    number: (index) => units.round(index, 1),
    texts: (index) => ({ shortText: units.uvText(index) }),
  },
  offset: {
    unit: () => 'min',
    number: (minutes) => Math.round(minutes) + 0,
  },
  time: {
    timestamp: (epochSec) => Math.round(epochSec),
    texts: (epochSec, ctx) => ({ shortText: units.clockText(epochSec, ctx.offsetMin, ctx.units) }),
  },
  condition: {
    texts: (condition) => ({ shortText: condition.short, longText: condition.long }),
  },
  code: {
    texts: (condition) => ({ longText: condition.code }),
  },
};

/**
 * A numericValue's shared metadata (unit, and min/max as a pair) onto a payload.
 *
 * @param {Object} payload numericValue payload; changed in place.
 * @param {Object} render The kind's renderer.
 * @param {Object} ctx {units, offsetMin}.
 * @returns {Object} The payload.
 */
function numericMeta(payload, render, ctx) {
  const unit = render.unit ? render.unit(ctx) : '';
  if (unit) {
    payload.unit = unit;
  }
  if (render.range) {
    payload.min = render.range[0];
    payload.max = render.range[1];
  }
  return payload;
}

/**
 * Every shape of one reading.
 *
 * @param {string} kind The property's kind.
 * @param {*} value The reading.
 * @param {Object} ctx {units, offsetMin}.
 * @returns {Object} Shape name -> payload.
 */
function pointShapes(kind, value, ctx) {
  const render = RENDER[kind];
  const texts = render.texts ? render.texts(value, ctx) : {};
  const shapes = {};
  vocabulary.KINDS[kind].forEach((shape) => {
    if (shape === 'numericValue') {
      shapes.numericValue = numericMeta({ value: render.number(value, ctx) }, render, ctx);
    } else if (shape === 'timestamp') {
      shapes.timestamp = { value: render.timestamp(value) };
    } else {
      shapes[shape] = { text: texts[shape] };
    }
  });
  return shapes;
}

/**
 * A series of readings in every shape its kind has, or null when it has no reading at all.
 *
 * @param {string} kind The property's kind.
 * @param {Array} values Readings (null for a missing one).
 * @param {number} start Epoch seconds of values[0].
 * @param {number} step Seconds between readings.
 * @param {Object} ctx {units, offsetMin}.
 * @returns {Object|null} {series: {start, stepSec, <shape>: {values, ...}}}, or null.
 */
function seriesShapes(kind, values, start, step, ctx) {
  if (!values.some(isPresent)) {
    return null;
  }
  const render = RENDER[kind];
  const texts = values.map((value) => (isPresent(value) && render.texts ? render.texts(value, ctx) : null));
  const series = { start, stepSec: step };
  vocabulary.KINDS[kind].forEach((shape) => {
    if (shape === 'numericValue') {
      series.numericValue = numericMeta({
        values: values.map((value) => (isPresent(value) ? render.number(value, ctx) : null)),
      }, render, ctx);
    } else if (shape === 'timestamp') {
      series.timestamp = {
        values: values.map((value) => (isPresent(value) ? render.timestamp(value) : null)),
      };
    } else {
      series[shape] = { values: texts.map((text) => (text ? text[shape] : null)) };
    }
  });
  return { series };
}

/**
 * The length of a forecast block's series (its longest field).
 *
 * @param {Object} block hourly or daily block.
 * @returns {number} Values per field.
 */
function blockLength(block) {
  let length = 0;
  Object.keys(block || {}).forEach((key) => {
    if (Array.isArray(block[key])) {
      length = Math.max(length, block[key].length);
    }
  });
  return length;
}

/**
 * Build a `weather/location` instance.
 *
 * @param {{id: string, name: string}} place The place.
 * @param {Object} forecast Its normalized forecast (see the top of this file).
 * @param {Object} options {units, nowSec, serves: property names, wanted: Set of names or null}.
 * @returns {{instanceId: string, properties: Object}} The instance.
 */
function buildInstance(place, forecast, options) {
  const offsetMin = forecast.utcOffsetMin;
  const ctx = { units: options.units, offsetMin };
  const midnight = localMidnight(options.nowSec, offsetMin);
  const hourly = forecast.hourly || { start: midnight };
  const daily = forecast.daily || { start: midnight };
  const hourIndex = Math.floor((options.nowSec - hourly.start) / HOUR);
  const todayIndex = Math.round((midnight - daily.start) / DAY);
  const hourlyCount = Math.max(0, Math.min(HOURLY_HOURS,
    blockLength(hourly) - Math.round((midnight - hourly.start) / HOUR)));
  const dailyCount = Math.max(0, Math.min(DAILY_DAYS, blockLength(daily) - todayIndex));
  const atIndex = (values, index) => (Array.isArray(values) && isPresent(values[index])
    ? values[index] : null);
  const reading = {
    current: (field) => (forecast.current && isPresent(forecast.current[field])
      ? forecast.current[field] : atIndex(hourly[field], hourIndex)),
    today: (field) => atIndex(daily[field], todayIndex),
  };

  const properties = {};
  options.serves.forEach((name) => {
    if (options.wanted && !options.wanted.has(name)) {
      return;
    }
    const definition = vocabulary.PROPERTIES[name];
    let shapes = null;
    if (definition.scope === 'hourly') {
      const values = seriesWindow(hourly[definition.field], hourly.start, HOUR, midnight, hourlyCount);
      shapes = seriesShapes(definition.kind, values, midnight, HOUR, ctx);
    } else if (definition.scope === 'daily') {
      const values = seriesWindow(daily[definition.field], daily.start, DAY, midnight, dailyCount);
      shapes = seriesShapes(definition.kind, values, midnight, DAY, ctx);
    } else {
      let value;
      if (definition.scope === 'place') {
        value = name === 'name' ? place.name : offsetMin;
      } else {
        value = reading[definition.scope](definition.field);
      }
      shapes = isPresent(value) ? pointShapes(definition.kind, value, ctx) : null;
    }
    if (shapes) {
      properties[name] = shapes;
    }
  });
  return { instanceId: place.id, properties };
}

module.exports = {
  HOUR,
  DAY,
  HOURLY_HOURS,
  localMidnight,
  seriesShapes,
  buildInstance,
};
