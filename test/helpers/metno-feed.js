// test/helpers/metno-feed.js
// A deterministic Met.no locationforecast/2.0/complete body shaped like the recorded ones:
// hourly buckets to a model time, then 6-hourly buckets on the 00/06/12/18 UTC grid. The
// hourly ones carry next_1_hours (and next_6_hours), clear-sky UV and, in the Nordics, the
// gust and the chance; the 6-hourly ones carry next_6_hours / next_12_hours only, and no UV
// or gust (test/metno-tail.test.js, test/metno-gate.golden.json).

const HOUR = 3600;

/**
 * @param {number} epoch Epoch seconds.
 * @returns {string} Met.no's stamp form (no milliseconds).
 */
function iso(epoch) { return new Date(epoch * 1000).toISOString().replace('.000Z', 'Z'); }

/**
 * @param {number} v A value.
 * @returns {number} v rounded to one decimal, as Met.no reports.
 */
function r1(v) { return Math.round(v * 10) / 10; }

/**
 * The instant details of the hour `epoch`, a smooth daily cycle.
 * @param {number} epoch Epoch seconds.
 * @param {number} i The bucket's index (varies the wind).
 * @param {boolean} hourly Whether the bucket is on the hourly part (UV, gust).
 * @param {boolean} nordic Whether the feed carries the Nordic-only fields.
 * @returns {Object} instant.details.
 */
function instantAt(epoch, i, hourly, nordic) {
  const phase = ((epoch / HOUR) % 24) / 24 * 2 * Math.PI;
  const wind = r1(3 + (i % 5) * 0.7);
  const d = {
    air_pressure_at_sea_level: r1(1008 + (i % 9) * 0.6),
    air_temperature: r1(9 + 6 * Math.sin(phase - 2)),
    cloud_area_fraction: r1(40 + (i % 6) * 9),
    cloud_area_fraction_high: r1((i % 4) * 11),
    cloud_area_fraction_low: r1((i % 3) * 13),
    cloud_area_fraction_medium: r1((i % 5) * 7),
    dew_point_temperature: r1(4 + 2 * Math.sin(phase - 1)),
    relative_humidity: r1(70 + (i % 7) * 3),
    wind_from_direction: r1((i * 37) % 360),
    wind_speed: wind
  };
  if (hourly) {
    d.ultraviolet_index_clear_sky = r1(Math.max(0, 4 * Math.sin(phase - Math.PI / 2)));
    if (nordic) { d.wind_speed_of_gust = r1(wind * (1.5 + (i % 3) * 0.1)); }
  }
  return d;
}

/**
 * A 6-hour (or 12-hour) total.
 * @param {number} i The bucket's index.
 * @param {boolean} nordic Whether the chance is reported.
 * @returns {Object} next_6_hours.details.
 */
function sixAt(i, nordic) {
  const d = { air_temperature_max: 12, air_temperature_min: 6, precipitation_amount: r1((i % 4) * 0.9) };
  if (nordic) { d.probability_of_precipitation = r1(10 + (i % 5) * 12); }
  return d;
}

/**
 * Build the body.
 * @param {Object} o Options.
 * @param {number} o.start Epoch seconds of bucket 0 (a whole hour).
 * @param {number} o.hourly Hourly buckets before the 6-hourly part.
 * @param {number} [o.sixHourly] 6-hourly buckets after them (default 12).
 * @param {boolean} [o.nordic] Gusts and the chance present (default true).
 * @param {boolean} [o.lastHourlyHasNext1] Whether the last hourly bucket keeps
 *   next_1_hours (default false: like Berlin's, it has next_6_hours only).
 * @returns {{properties: {timeseries: Array}}} The body.
 */
function metnoFeed(o) {
  const nordic = o.nordic !== false;
  const ts = [];
  let i;
  for (i = 0; i < o.hourly; i += 1) {
    const t = o.start + i * HOUR;
    const data = { instant: { details: instantAt(t, i, true, nordic) } };
    if (i < o.hourly - 1 || o.lastHourlyHasNext1) {
      const n1 = { precipitation_amount: r1((i % 7 === 3) ? 0.6 + (i % 3) * 0.4 : 0) };
      if (nordic) { n1.probability_of_precipitation = r1(5 + (i % 6) * 8); }
      data.next_1_hours = { summary: { symbol_code: 'cloudy' }, details: n1 };
    }
    data.next_6_hours = { summary: { symbol_code: 'cloudy' }, details: sixAt(i, nordic) };
    ts.push({ time: iso(t), data: data });
  }
  const lastHourly = o.start + (o.hourly - 1) * HOUR;
  let t = (Math.floor(lastHourly / (6 * HOUR)) + 1) * 6 * HOUR;
  const n = o.sixHourly === undefined ? 12 : o.sixHourly;
  for (let k = 0; k < n; k += 1, t += 6 * HOUR) {
    ts.push({ time: iso(t), data: {
      instant: { details: instantAt(t, o.hourly + k, false, nordic) },
      next_12_hours: { summary: { symbol_code: 'cloudy' }, details: {} },
      next_6_hours: { summary: { symbol_code: 'cloudy' }, details: sixAt(o.hourly + k, nordic) }
    } });
  }
  return { type: 'Feature', properties: { meta: { updated_at: iso(o.start) }, timeseries: ts } };
}

module.exports = { HOUR, iso, metnoFeed };
