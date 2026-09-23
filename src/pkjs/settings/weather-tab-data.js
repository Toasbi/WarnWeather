// src/pkjs/settings/weather-tab-data.js — the Weather tab's own data layer,
// running INSIDE the settings webview (a data: URI page with a null origin, so
// every endpoint here must serve permissive CORS — the same constraint the
// API-key Test buttons and the news widget already live under, key-test.js).
// The phone-side provider adapters (src/pkjs/weather/*) are not in the page
// bundle and fetch a different, watch-shaped window; these adapters are
// independent and normalize to the tab's own shape instead:
//
//   hourly: parallel arrays over `time` (epoch ms) — temp °C, rain mm/h,
//           prob %, wind/gust km/h, dir deg, rh %, dew °C, pressure hPa,
//           icon id (weather-tab-model.js vocabulary); null = unsourced.
//           A row is the hour STARTING at its stamp: rain, chance and gust
//           stamped 14:00 are 14:00-15:00's. Open-Meteo and DWD stamp those
//           at the hour's END, so their parsers re-stamp them
//           (model.startHourFields), as the watch's adapters do, with the
//           icon that describes the same rain (the watch reads its pinned
//           model's 3-hourly Open-Meteo chance by block); OWM's
//           3-hourly tail totals the 3 h before its stamp, spread over them
//           (parseOwmForecast3h).
//           Two provenance flags, per hour. `measured` says whether the
//           RAIN was read off a station rather than modelled — it gates
//           the rain bar, so it follows that one field exactly.
//           `measuredAll` says whether EVERY field the panels plot was,
//           which is what the caption spanning all of them needs: a word
//           over four panels cannot rest on one field's provenance.
//           Only DWD/Brightsky can say yes to either — it tags every row
//           with the source that produced it, and names per field where a
//           value was filled in from another source.
//           Nobody else can. Open-Meteo's past_days stitches each model
//           run's first hours, which ARE observation-initialised and close
//           to the truth for most fields — but its own docs single out the
//           exception: "for precise values such as precipitation, local
//           measurements are preferable when available". tomorrow.io's
//           -4 h window is model output too, and OWM is asked for no past
//           hours at all. All three leave the array empty, so every one of
//           their hours reads as unmeasured.
//   daily:  up to 5 tiles from the location's today — tmin/tmax °C, icon,
//           rainMm, probMax, sunshineH; null fields where the provider has
//           no answer.
//   utcOffsetSec: the LOCATION's UTC offset when the provider reports one
//           (Open-Meteo utc_offset_seconds, OWM timezone_offset, Brightsky's
//           timestamp suffix — its default tz is the location's), else null
//           and consumers fall back to the phone's offset. Day boundaries,
//           daytime icon windows and hour labels all follow this clock.
//
// Results are cached per provider+coords for the lifetime of the page open
// (module var — page storage doesn't persist, news-cache.js:3-5) with a 15 min
// TTL so switching between locations doesn't refetch on every tap.
/* global WeatherTabModel */
(function () {
    'use strict';

    var model = (typeof require !== 'undefined')
        ? require('./weather-tab-model.js') : window.WeatherTabModel;

    var DAILY_COUNT = model.DAY_COUNT;
    var CACHE_TTL_MS = 15 * 60 * 1000;
    var XHR_TIMEOUT_MS = 12000;

    // provider|lat|lon → {at: ms, data: normalized} — page-open lifetime only.
    var cache = {};

    /**
     * GET a JSON endpoint with the page's XHR house pattern (key-test.js).
     * @param {string} url Request URL.
     * @param {function(?Object, ?string):void} cb (parsed, error) — exactly one is set.
     * @returns {void}
     */
    function fetchJson(url, cb) {
        var done = false;
        var finish = function (data, err) {
            if (done) { return; }
            done = true;
            cb(data, err);
        };
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.timeout = XHR_TIMEOUT_MS;
            xhr.onload = function () {
                if (xhr.status >= 200 && xhr.status < 300) {
                    var parsed = null;
                    try {
                        parsed = JSON.parse(xhr.responseText);
                    } catch (ex) {
                        finish(null, 'bad_json');
                        return;
                    }
                    finish(parsed, null);
                    return;
                }
                finish(null, 'http_' + xhr.status);
            };
            xhr.onerror = function () { finish(null, 'network'); };
            xhr.ontimeout = function () { finish(null, 'timeout'); };
            xhr.send();
        } catch (ex) {
            finish(null, 'xhr_unavailable');
        }
    }

    /**
     * City search for the location picker: keyless Open-Meteo geocoding.
     * @param {string} query Free-text city name (>= 2 chars).
     * @param {function(?Array, ?string):void} cb (candidates, error); candidates are
     *   {name, admin, country, lat, lon}.
     * @returns {void}
     */
    function geocodeSearch(query, cb) {
        var url = 'https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name='
            + encodeURIComponent(query);
        fetchJson(url, function (data, err) {
            if (err) { cb(null, err); return; }
            var out = [];
            var rows = (data && data.results) || [];
            for (var i = 0; i < rows.length; i += 1) {
                var r = rows[i];
                if (!r || typeof r.latitude !== 'number' || typeof r.longitude !== 'number') { continue; }
                out.push({
                    name: r.name || '',
                    admin: r.admin1 || '',
                    country: r.country_code || '',
                    lat: r.latitude,
                    lon: r.longitude
                });
            }
            cb(out, null);
        });
    }

    /**
     * @param {number} nowMs Reference epoch ms.
     * @param {number} n Hours from now (negative = past).
     * @returns {string} ISO timestamp floored to the hour.
     */
    function isoHour(nowMs, n) {
        var d = new Date(nowMs + n * 3600000);
        d.setMinutes(0, 0, 0);
        return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    }

    /**
     * @param {*} v Any value.
     * @returns {?number} A finite number, or null.
     */
    function num(v) {
        return (typeof v === 'number' && isFinite(v)) ? v : null;
    }

    /**
     * An empty normalized hourly frame.
     * @returns {Object} Parallel arrays keyed by series.
     */
    function emptyHourly() {
        return { time: [], temp: [], rain: [], prob: [], wind: [], gust: [], dir: [], rh: [], dew: [], pressure: [], icon: [], sunshineMin: [], measured: [], measuredAll: [] };
    }

    // --- parsers (pure — tests feed fixture JSON straight in) -----------------

    /**
     * Open-Meteo response → normalized. unixtime stamps are UTC epoch seconds;
     * daily stamps are the location-local day starts (timezone=auto).
     * @param {Object} data Raw response body.
     * @param {number} nowMs Reference time.
     * @returns {?Object} Normalized result, or null when unusable.
     */
    function parseOpenMeteo(data, nowMs) {
        var h = data && data.hourly;
        if (!h || !h.time || !h.time.length) { return null; }
        var offsetSec = num(data.utc_offset_seconds);
        var hourly = emptyHourly();
        for (var i = 0; i < h.time.length; i += 1) {
            hourly.time.push(h.time[i] * 1000);
            hourly.temp.push(num(h.temperature_2m && h.temperature_2m[i]));
            hourly.rain.push(num(h.precipitation && h.precipitation[i]));
            hourly.prob.push(num(h.precipitation_probability && h.precipitation_probability[i]));
            hourly.wind.push(num(h.wind_speed_10m && h.wind_speed_10m[i]));
            hourly.gust.push(num(h.wind_gusts_10m && h.wind_gusts_10m[i]));
            hourly.dir.push(num(h.wind_direction_10m && h.wind_direction_10m[i]));
            hourly.rh.push(num(h.relative_humidity_2m && h.relative_humidity_2m[i]));
            hourly.dew.push(num(h.dew_point_2m && h.dew_point_2m[i]));
            hourly.pressure.push(num(h.pressure_msl && h.pressure_msl[i]));
            var code = h.weather_code ? h.weather_code[i] : null;
            hourly.icon.push(code === null || code === undefined ? null : model.wmoIcon(code));
        }
        // Open-Meteo documents precipitation, its probability and the gust as
        // the PRECEDING hour's ("preceding hour sum/probability/max"); every
        // other series here is an instant. Row 14:00 takes the 15:00 stamp's.
        // weather_code rides along: the docs call it an instant, but the
        // server derives its rain and snow from the same stamp's
        // preceding-hour precipitation, so left in place the strip and the
        // chip showed a shower's icon an hour after its bar.
        model.startHourFields(hourly, { rain: null, prob: null, gust: null, icon: null });
        var daily = [];
        var d = data.daily;
        var off = offsetSec === null ? model.phoneUtcOffsetSec(nowMs) : offsetSec;
        var todayStartMs = model.localDayStart(nowMs, off);
        // The API's own daily sum and maximum run over the 24 values STAMPED
        // in the day, which for preceding-hour values is 23:00 the evening
        // before to 23:00 -- an hour off the day whose bars sit under the
        // tile. A tile's rain and chance come from the re-stamped hours
        // instead, so it totals exactly its own day's bars.
        var sums = model.aggregateDaily(hourly, nowMs, DAILY_COUNT, offsetSec);
        if (d && d.time) {
            for (var j = 0; j < d.time.length && daily.length < DAILY_COUNT; j += 1) {
                var dayMs = d.time[j] * 1000;
                // Keep from the LOCATION's today onward (its stamps are that
                // location's midnights); the hour of slack absorbs DST edges.
                if (dayMs < todayStartMs - 3600000) { continue; }
                var sun = num(d.sunshine_duration && d.sunshine_duration[j]);
                var own = sumsFor(sums, dayMs);
                var rainMm = own ? own.rainMm : null;
                var probMax = own ? own.probMax : null;
                daily.push({
                    date: dayMs,
                    tmin: num(d.temperature_2m_min && d.temperature_2m_min[j]),
                    tmax: num(d.temperature_2m_max && d.temperature_2m_max[j]),
                    icon: d.weather_code ? model.wmoIcon(d.weather_code[j]) : null,
                    rainMm: rainMm !== null ? rainMm : num(d.precipitation_sum && d.precipitation_sum[j]),
                    probMax: probMax !== null ? probMax : num(d.precipitation_probability_max && d.precipitation_probability_max[j]),
                    sunshineH: sun === null ? null : sun / 3600
                });
            }
        }
        return { hourly: hourly, daily: daily, utcOffsetSec: offsetSec };
    }

    /**
     * The aggregated tile for a provider's day stamp, within the hour of
     * slack a DST edge can put between the two.
     * @param {Array<{date: number}>} sums Tiles from model.aggregateDaily.
     * @param {number} dayMs The provider's day-start instant (epoch ms).
     * @returns {?Object} The matching tile, or null.
     */
    function sumsFor(sums, dayMs) {
        for (var i = 0; i < sums.length; i += 1) {
            if (Math.abs(sums[i].date - dayMs) <= 3600000) { return sums[i]; }
        }
        return null;
    }

    /**
     * The UTC offset carried by an ISO timestamp's suffix ('+02:00', 'Z').
     * @param {string} iso ISO 8601 timestamp.
     * @returns {?number} Offset seconds, or null when unrecognizable.
     */
    function isoOffsetSec(iso) {
        if (typeof iso !== 'string') { return null; }
        if (/[zZ]$/.test(iso)) { return 0; }
        var m = /([+-])(\d\d):?(\d\d)$/.exec(iso);
        if (!m) { return null; }
        var sec = (Number(m[2]) * 60 + Number(m[3])) * 60;
        return m[1] === '-' ? -sec : sec;
    }

    // Brightsky's /weather answers from three kinds of source, named by each
    // source's observation_type: 'historical' and 'current' are readings
    // taken at a station, 'forecast' is DWD's own MOSMIX. Every weather row
    // names its source_id, so the provenance is per HOUR, not per response —
    // which matters because the observation network lags: the last hour or
    // two of "the past" is usually still MOSMIX even in the middle of
    // Germany, and a request answered from far away can be MOSMIX
    // throughout. ('synop' cannot appear on /weather — it is what
    // /current_weather asks for — but it is a reading, so it is listed.)
    var OBSERVED_TYPES = { historical: true, current: true, synop: true };

    /**
     * The source ids in a Brightsky response whose rows are station
     * readings rather than forecast.
     * @param {Array<Object>} sources The response's `sources` array.
     * @returns {Object} A set-shaped map of source id → true.
     */
    function observedSourceIds(sources) {
        var out = {};
        if (!sources) { return out; }
        for (var i = 0; i < sources.length; i += 1) {
            var s = sources[i];
            if (s && OBSERVED_TYPES[s.observation_type]) { out[s.id] = true; }
        }
        return out;
    }

    /**
     * Whether ONE field of a Brightsky row is a station reading. The row's
     * own source_id is not the last word: where the main source left a
     * field empty, Brightsky fills it from another source and records which
     * in `fallback_source_ids`, keyed by field. So a row that is an
     * observation overall can still carry a MOSMIX precipitation — and
     * precipitation is the field this tab draws as history, so it is the
     * field the flag has to follow.
     * @param {Object} row One `weather[]` record.
     * @param {string} field The field name to resolve.
     * @param {Object} measuredIds Set-shaped map from observedSourceIds.
     * @returns {boolean} True when that field came from a station.
     */
    function fieldMeasured(row, field, measuredIds) {
        var fb = row.fallback_source_ids;
        var id = (fb && fb[field] !== null && fb[field] !== undefined) ? fb[field] : row.source_id;
        return Boolean(measuredIds[id]);
    }

    // The fields the panels plot a PAST value from off an hour's OWN record,
    // which is what the caption above them vouches for. Brightsky's own
    // IGNORED_MISSING_FIELDS never fills relative_humidity from MOSMIX
    // (MOSMIX has none), so it cannot appear in a fallback map pointing the
    // wrong way; it is listed for completeness. The precipitation and the
    // gust are not here: an hour draws them from the NEXT record (they are
    // re-stamped), so parseBrightsky vouches for them from that record.
    var OWN_FIELDS = {
        temperature: true, wind_speed: true, wind_direction: true,
        relative_humidity: true, dew_point: true, pressure_msl: true
    };

    /**
     * Whether every field this tab plots for a past hour off its own record
     * (OWN_FIELDS) was read off a station. The caption sits above all four panels, so the word has to
     * be true of all four: an observation row whose temperature was filled
     * in from MOSMIX draws a modelled line, and "Measured" must not span
     * it on the strength of the rain alone.
     *
     * Errs only one way. Brightsky orders candidate sources by
     * observation_type, whose Postgres enum declares forecast LAST
     * ('historical', 'recent', 'current', 'synop', 'forecast'), so a field
     * reaches MOSMIX only when no station had it — and an hour wrongly
     * excluded here merely reads as Estimated, never the reverse.
     * @param {Object} row One `weather[]` record.
     * @param {Object} measuredIds Set-shaped map from observedSourceIds.
     * @returns {boolean} True when the row's drawn fields came from stations.
     */
    function rowMeasured(row, measuredIds) {
        if (!measuredIds[row.source_id]) { return false; }
        var fb = row.fallback_source_ids;
        if (!fb) { return true; }
        for (var k in fb) {
            if (Object.prototype.hasOwnProperty.call(fb, k) && OWN_FIELDS[k]
                && !measuredIds[fb[k]]) { return false; }
        }
        return true;
    }

    /**
     * Brightsky response → normalized. Default units are DWD's (°C, km/h,
     * hPa, sunshine minutes) and timestamps default to the LOCATION's
     * timezone, so their suffix carries the offset.
     * @param {Object} data Raw response body.
     * @param {number} nowMs Reference time.
     * @returns {?Object} Normalized result, or null when unusable.
     */
    function parseBrightsky(data, nowMs) {
        var rows = data && data.weather;
        if (!rows || !rows.length) { return null; }
        // Brightsky echoes the timezone we ASKED in, not the location's: it
        // adopts the `date` parameter's offset, and only when that offset is
        // not UTC (brightsky/web/params.py's set_default_timezone_from_date).
        // We send a Z-suffixed date, so a UTC suffix coming back is our own
        // request read aloud — and taking it for the location's clock put the
        // whole DWD timeline on UTC: "00:00" on the hour strip was 02:00 in
        // Berlin, the day rules stood two hours off true local midnight, and
        // Today covered the wrong 24 h. A UTC echo therefore means we learned
        // nothing, and the view falls back to the phone's offset the way it
        // does for every provider that reports none. A NON-UTC suffix could
        // only come from a zone we named ourselves, so that one is real.
        var echoed = isoOffsetSec(rows[0].timestamp);
        var offsetSec = echoed ? echoed : null;
        var measuredIds = observedSourceIds(data.sources);
        var hourly = emptyHourly();
        // Per stamp, whether the record's own drawn fields were measured:
        // looked up by time once the rows are re-stamped, so a row that
        // startHourFields adds for a skipped stamp (no record of its own:
        // its instants are interpolated) finds none.
        var ownMeasured = {};
        hourly.gustMeasured = [];
        for (var i = 0; i < rows.length; i += 1) {
            var r = rows[i];
            var t = Date.parse(r.timestamp);
            if (!isFinite(t)) { continue; }
            // One flag per question. The rain bar asks only about the rain,
            // so a station that read the rain licenses it whatever else on
            // the row fell back; the caption asks about every panel it
            // stands over, so it takes the whole hour or nothing.
            hourly.measured.push(fieldMeasured(r, 'precipitation', measuredIds));
            hourly.gustMeasured.push(fieldMeasured(r, 'wind_gust_speed', measuredIds));
            ownMeasured[t] = rowMeasured(r, measuredIds);
            hourly.time.push(t);
            hourly.temp.push(num(r.temperature));
            hourly.rain.push(num(r.precipitation));
            hourly.prob.push(num(r.precipitation_probability));
            hourly.wind.push(num(r.wind_speed));
            hourly.gust.push(num(r.wind_gust_speed));
            hourly.dir.push(num(r.wind_direction));
            // MOSMIX has no humidity, so a forecast hour arrives without one
            // and the bars stopped at the now line -- or, in the hours the
            // observations lag behind, with one Brightsky borrowed from
            // another station (fallback_source_ids), which need not agree
            // with the temperature and dew point this panel draws beside it.
            // Those two are always there and give the humidity exactly; only
            // a reading of the row's own stands in their place.
            var fbIds = r.fallback_source_ids;
            var borrowed = Boolean(fbIds) && fbIds.relative_humidity !== null
                && fbIds.relative_humidity !== undefined;
            var rh = model.humidityFromDewPoint(num(r.temperature), num(r.dew_point));
            if (rh === null || (!borrowed && num(r.relative_humidity) !== null)) {
                rh = num(r.relative_humidity);
            }
            hourly.rh.push(rh);
            hourly.dew.push(num(r.dew_point));
            hourly.pressure.push(num(r.pressure_msl));
            hourly.icon.push(r.icon ? model.brightskyIcon(r.icon) : null);
            hourly.sunshineMin.push(num(r.sunshine));
        }
        // Brightsky documents the precipitation, its probability, the gust
        // and the sunshine as the PRECEDING hour's ("during previous 60
        // minutes"), and its icon shows rain only for that same hour's
        // precipitation (brightsky/enhancements.py get_icon); each field's
        // provenance moves with it. Before the tiles are summed, so each one
        // totals its own calendar day. Wind speed and direction stay on their
        // own row, as the watch keeps them (dwd.js).
        model.startHourFields(hourly, { rain: null, prob: null, gust: null,
            sunshineMin: null, icon: null, measured: false, gustMeasured: false });
        // The caption vouches for every panel over a past hour, and two of
        // them draw the NEXT record's rain and gust: the hour counts as
        // measured only when its own record's fields do and those two of
        // that record do too.
        hourly.measuredAll = [];
        for (i = 0; i < hourly.time.length; i += 1) {
            hourly.measuredAll.push(Boolean(ownMeasured[hourly.time[i]])
                && hourly.measured[i] && hourly.gustMeasured[i]);
        }
        delete hourly.gustMeasured;
        return {
            hourly: hourly,
            daily: model.aggregateDaily(hourly, nowMs, DAILY_COUNT, offsetSec),
            utcOffsetSec: offsetSec
        };
    }

    /**
     * OWM One Call 3.0 (metric) response → normalized: m/s → km/h,
     * pop 0..1 → %, its own daily array, timezone_offset for the local clock.
     * OWM reports snowfall apart from rain (both mm, water equivalent), so the
     * precipitation series is rain + snow — the total the other providers report,
     * and what the watch's own OWM adapter feeds its rain bar.
     * @param {Object} data Raw response body.
     * @param {number} nowMs Reference time.
     * @returns {?Object} Normalized result, or null when unusable.
     */
    function parseOwm(data, nowMs) {
        var rows = data && data.hourly;
        if (!rows || !rows.length) { return null; }
        var MPS_TO_KMH = 3.6;
        var offsetSec = num(data.timezone_offset);
        var hourly = emptyHourly();
        for (var i = 0; i < rows.length; i += 1) {
            var r = rows[i];
            hourly.time.push(r.dt * 1000);
            hourly.temp.push(num(r.temp));
            hourly.rain.push((num(r.rain && r.rain['1h']) || 0) + (num(r.snow && r.snow['1h']) || 0));
            hourly.prob.push(num(r.pop) === null ? null : r.pop * 100);
            hourly.wind.push(num(r.wind_speed) === null ? null : r.wind_speed * MPS_TO_KMH);
            hourly.gust.push(num(r.wind_gust) === null ? null : r.wind_gust * MPS_TO_KMH);
            hourly.dir.push(num(r.wind_deg));
            hourly.rh.push(num(r.humidity));
            hourly.dew.push(num(r.dew_point));
            hourly.pressure.push(num(r.pressure));
            hourly.icon.push(r.weather && r.weather[0] ? model.owmIcon(r.weather[0].id) : null);
        }
        var daily = [];
        var days = data.daily || [];
        for (var j = 0; j < days.length && daily.length < DAILY_COUNT; j += 1) {
            var d = days[j];
            daily.push({
                date: d.dt * 1000,
                tmin: num(d.temp && d.temp.min),
                tmax: num(d.temp && d.temp.max),
                icon: d.weather && d.weather[0] ? model.owmIcon(d.weather[0].id) : null,
                rainMm: (num(d.rain) || 0) + (num(d.snow) || 0),
                probMax: num(d.pop) === null ? null : d.pop * 100,
                sunshineH: null
            });
        }
        return { hourly: hourly, daily: daily, utcOffsetSec: offsetSec };
    }

    /**
     * OWM 5-day/3-hour forecast (2.5/forecast, metric) → normalized hourly
     * rows: the series that extends the timeline past One Call's 48 h of
     * hourlies. No dew point in this endpoint: it is derived from the
     * temperature and humidity, so the dew line runs on with the others.
     *
     * A record's rain['3h'] + snow['3h'] total and its pop are the 3 hours
     * that END at its dt ("Rain volume for last 3 hours"), so they fill the
     * three hourly rows before it, T-3h to T-1h, as an even mm/h rate: the
     * bars right of those ticks, where the rain fell. Its condition (the
     * icon) is that period's too. Its temperature, wind, humidity and
     * pressure are the instant at dt; the rows between two records take
     * the resampled values the grid would draw there anyway
     * (model.buildHourlyGrid). The last record's own row has no period
     * after it, so its rain and chance are unsourced.
     * @param {Object} data Raw response body.
     * @returns {?{hourly: Object, utcOffsetSec: ?number}} Parsed tail, or null.
     */
    function parseOwmForecast3h(data) {
        var rows = data && data.list;
        if (!rows || !rows.length) { return null; }
        var MPS_TO_KMH = 3.6;
        var HOUR_MS = 3600000;
        var PERIOD_MS = 3 * HOUR_MS;
        var at = emptyHourly();
        for (var i = 0; i < rows.length; i += 1) {
            var r = rows[i];
            if (!r || typeof r.dt !== 'number') { continue; }
            var main = r.main || {};
            var wind = r.wind || {};
            var precip3 = (num(r.rain && r.rain['3h']) || 0) + (num(r.snow && r.snow['3h']) || 0);
            at.time.push(r.dt * 1000);
            at.temp.push(num(main.temp));
            at.rain.push(precip3 / 3);
            at.prob.push(num(r.pop) === null ? null : r.pop * 100);
            at.wind.push(num(wind.speed) === null ? null : wind.speed * MPS_TO_KMH);
            at.gust.push(num(wind.gust) === null ? null : wind.gust * MPS_TO_KMH);
            at.dir.push(num(wind.deg));
            at.rh.push(num(main.humidity));
            at.dew.push(model.dewPointFromHumidity(num(main.temp), num(main.humidity)));
            at.pressure.push(num(main.pressure));
            at.icon.push(r.weather && r.weather[0] ? model.owmIcon(r.weather[0].id) : null);
        }
        var n = at.time.length;
        if (!n) { return null; }
        var first = at.time[0] - PERIOD_MS;
        var count = Math.floor((at.time[n - 1] - first) / HOUR_MS) + 1;
        var grid = model.buildHourlyGrid(at, first, count);
        var hourly = emptyHourly();
        var k = 0;   // the first record stamped after the row: the period holding it
        for (var g = 0; g < count; g += 1) {
            var t = first + g * HOUR_MS;
            while (k < n && at.time[k] <= t) { k += 1; }
            var inPeriod = k < n && at.time[k] - t <= PERIOD_MS;
            hourly.time.push(t);
            hourly.temp.push(grid.temp[g]);
            hourly.rain.push(inPeriod ? at.rain[k] : null);
            hourly.prob.push(inPeriod ? at.prob[k] : null);
            hourly.wind.push(grid.wind[g]);
            hourly.gust.push(grid.gust[g]);
            hourly.dir.push(grid.dir[g]);
            hourly.rh.push(grid.rh[g]);
            hourly.dew.push(grid.dew[g]);
            hourly.pressure.push(grid.pressure[g]);
            hourly.icon.push(inPeriod ? at.icon[k] : null);
        }
        return { hourly: hourly, utcOffsetSec: num(data.city && data.city.timezone) };
    }

    /**
     * Append the coarse tail's rows AFTER the base's last hourly stamp, in
     * place — the base (One Call hourlies) stays authoritative where both
     * overlap.
     * @param {Object} base Normalized result (mutated).
     * @param {{hourly: Object, utcOffsetSec: ?number}} tail Parsed 3 h tail.
     * @returns {void}
     */
    function mergeOwmTail(base, tail) {
        if (!base || !tail || !tail.hourly) { return; }
        var bh = base.hourly;
        var th = tail.hourly;
        var last = bh.time.length ? bh.time[bh.time.length - 1] : -1;
        // No sunshineMin: neither OWM endpoint serves it (both leave the
        // parallel array empty, like parseOwm always has).
        var KEYS = ['time', 'temp', 'rain', 'prob', 'wind', 'gust', 'dir', 'rh', 'dew', 'pressure', 'icon'];
        for (var i = 0; i < th.time.length; i += 1) {
            if (th.time[i] <= last) { continue; }
            for (var k = 0; k < KEYS.length; k += 1) {
                var arr = th[KEYS[k]];
                bh[KEYS[k]].push(arr && arr[i] !== undefined ? arr[i] : null);
            }
        }
        if (base.utcOffsetSec === null || base.utcOffsetSec === undefined) {
            base.utcOffsetSec = tail.utcOffsetSec;
        }
    }

    /**
     * tomorrow.io Timelines response → normalized: metric wind is m/s, no
     * timezone in the response (consumers fall back to the phone's offset),
     * daily aggregates client-side.
     * @param {Object} data Raw response body.
     * @param {number} nowMs Reference time.
     * @returns {?Object} Normalized result, or null when unusable.
     */
    function parseTomorrowIo(data, nowMs) {
        var timelines = data && data.data && data.data.timelines;
        var intervals = timelines && timelines[0] && timelines[0].intervals;
        if (!intervals || !intervals.length) { return null; }
        var MPS_TO_KMH = 3.6;
        var hourly = emptyHourly();
        for (var i = 0; i < intervals.length; i += 1) {
            var v = intervals[i].values || {};
            var t = Date.parse(intervals[i].startTime);
            if (!isFinite(t)) { continue; }
            hourly.time.push(t);
            hourly.temp.push(num(v.temperature));
            hourly.rain.push(num(v.precipitationIntensity));
            hourly.prob.push(num(v.precipitationProbability));
            hourly.wind.push(num(v.windSpeed) === null ? null : v.windSpeed * MPS_TO_KMH);
            hourly.gust.push(num(v.windGust) === null ? null : v.windGust * MPS_TO_KMH);
            hourly.dir.push(num(v.windDirection));
            hourly.rh.push(num(v.humidity));
            hourly.dew.push(num(v.dewPoint));
            hourly.pressure.push(num(v.pressureSeaLevel));
            hourly.icon.push(v.weatherCode === undefined || v.weatherCode === null
                ? null : model.tomorrowIcon(v.weatherCode));
        }
        return {
            hourly: hourly,
            daily: model.aggregateDaily(hourly, nowMs, DAILY_COUNT, null),
            utcOffsetSec: null
        };
    }

    // --- fetchers ---------------------------------------------------------------

    /**
     * Open-Meteo: one keyless call carries the hourly window AND the daily strip.
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @param {Object} settings Live settings (unused — keyless).
     * @param {number} nowMs Reference time.
     * @param {function(?Object, ?string):void} cb Normalized result callback.
     * @returns {void}
     */
    function fetchOpenMeteo(lat, lon, settings, nowMs, cb) {
        var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon
            + '&hourly=temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_gusts_10m,'
            + 'wind_direction_10m,relative_humidity_2m,dew_point_2m,pressure_msl,weather_code'
            + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,'
            + 'precipitation_probability_max,sunshine_duration'
            + '&timezone=auto&past_days=1&forecast_days=6&timeformat=unixtime';
        fetchJson(url, function (data, err) {
            if (err) { cb(null, err); return; }
            var parsed = parseOpenMeteo(data, nowMs);
            cb(parsed, parsed ? null : 'empty');
        });
    }

    /**
     * DWD via Brightsky: hourly records only; the daily strip aggregates
     * client-side.
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @param {Object} settings Live settings (unused — keyless).
     * @param {number} nowMs Reference time.
     * @param {function(?Object, ?string):void} cb Normalized result callback.
     * @returns {void}
     */
    function fetchBrightsky(lat, lon, settings, nowMs, cb) {
        // 36 h of slack on both sides: the timeline starts at the LOCATION's
        // midnight, which can sit up to ~26 h from the phone's clock.
        var url = 'https://api.brightsky.dev/weather?lat=' + lat + '&lon=' + lon
            + '&date=' + isoHour(nowMs, -36)
            + '&last_date=' + isoHour(nowMs, DAILY_COUNT * 24 + 36)
            + '&max_dist=500000';
        fetchJson(url, function (data, err) {
            if (err) { cb(null, err); return; }
            var parsed = parseBrightsky(data, nowMs);
            cb(parsed, parsed ? null : 'empty');
        });
    }

    /**
     * OpenWeatherMap (metric): One Call 3.0's 48 h of hourlies + its daily
     * array, PLUS the 2.5 5-day/3-hour forecast as the coarser tail so the
     * timeline still reaches five days (the "use the coarser forecast when
     * hourly runs out" rule). One Call is authoritative where they overlap;
     * a failed tail call degrades to the 48 h timeline instead of an error.
     * Neither endpoint serves past hours, so today starts at "now".
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @param {Object} settings Live settings (owmApiKey).
     * @param {number} nowMs Reference time.
     * @param {function(?Object, ?string):void} cb Normalized result callback.
     * @returns {void}
     */
    function fetchOwm(lat, lon, settings, nowMs, cb) {
        var key = String((settings && settings.owmApiKey) || '').trim();  // paste whitespace
        if (!key) { cb(null, 'no_key'); return; }
        var oneUrl = 'https://api.openweathermap.org/data/3.0/onecall?lat=' + lat + '&lon=' + lon
            + '&units=metric&exclude=minutely,alerts&appid=' + encodeURIComponent(key);
        var tailUrl = 'https://api.openweathermap.org/data/2.5/forecast?lat=' + lat + '&lon=' + lon
            + '&units=metric&appid=' + encodeURIComponent(key);
        var pending = 2;
        var parsed = null, oneErr = null, tail = null;
        var finish = function () {
            pending -= 1;
            if (pending > 0) { return; }
            if (oneErr) { cb(null, oneErr); return; }
            if (tail) { mergeOwmTail(parsed, tail); }
            cb(parsed, null);
        };
        fetchJson(oneUrl, function (data, err) {
            if (err) { oneErr = err; } else {
                parsed = parseOwm(data, nowMs);
                if (!parsed) { oneErr = 'empty'; }
            }
            finish();
        });
        fetchJson(tailUrl, function (data, err) {
            if (!err) { tail = parseOwmForecast3h(data); }
            finish();
        });
    }

    /**
     * tomorrow.io Timelines, ONE call (billing is per call — the same reason
     * tomorrowio.js keeps to one): a 1h timestep bounded by the free plan,
     * which 403s any request outside −6 h..+120 h (the v1.5 page asked for
     * +144 h and every tab open failed that way). Both bounds keep ≥ 1 h of
     * slack INSIDE the window: isoHour floors the minutes, so −5 h/+120 h
     * would leave only seconds of margin at hh:59/hh:00 — margin that request
     * latency or phone clock skew erases, since the server checks the window
     * at receipt. −4 h floored stays ≥ 1 h above the history floor (the
     * timeline's earliest hours of today can stay empty), and +119 h floored
     * still covers the last grid hour (day-start + 119 h ≤ floor(now) + 119 h,
     * because floor(now) ≥ day-start).
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @param {Object} settings Live settings (tomorrowioApiKey).
     * @param {number} nowMs Reference time.
     * @param {function(?Object, ?string):void} cb Normalized result callback.
     * @returns {void}
     */
    function fetchTomorrowIo(lat, lon, settings, nowMs, cb) {
        var key = String((settings && settings.tomorrowioApiKey) || '').trim();  // paste whitespace
        if (!key) { cb(null, 'no_key'); return; }
        var url = 'https://api.tomorrow.io/v4/timelines?location=' + lat + ',' + lon
            + '&fields=temperature,precipitationIntensity,precipitationProbability,windSpeed,windGust,'
            + 'windDirection,humidity,dewPoint,pressureSeaLevel,weatherCode'
            + '&timesteps=1h&units=metric'
            + '&startTime=' + encodeURIComponent(isoHour(nowMs, -4))
            + '&endTime=' + encodeURIComponent(isoHour(nowMs, DAILY_COUNT * 24 - 1))
            + '&apikey=' + encodeURIComponent(key);
        fetchJson(url, function (data, err) {
            if (err) { cb(null, err); return; }
            var parsed = parseTomorrowIo(data, nowMs);
            cb(parsed, parsed ? null : 'empty');
        });
    }

    var ADAPTERS = {
        openmeteo: fetchOpenMeteo,
        dwd: fetchBrightsky,
        openweathermap: fetchOwm,
        tomorrowio: fetchTomorrowIo
    };

    /**
     * Fetch (or serve from the page-open cache) the normalized weather for one
     * provider + location. A cache hit answers on the SAME tick — callers that
     * repaint from the callback must handle the synchronous case (weather-tab.js
     * skips its render() then, because it is already inside one).
     * `force` (the manual refresh) skips the cache hit but still stores a fresh
     * answer — so a refresh that fails leaves this key's entry, and every other
     * location's, exactly as they were.
     * @param {string} providerId A GRAPH_PROVIDERS id.
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @param {Object} settings Live settings state.
     * @param {function(?Object, ?string):void} cb Normalized result callback.
     * @param {boolean} [force] Go to the network even when a fresh entry is cached.
     * @returns {void}
     */
    function fetchWeather(providerId, lat, lon, settings, cb, force) {
        var adapter = ADAPTERS[providerId];
        if (!adapter) { cb(null, 'unknown_provider'); return; }
        var key = providerId + '|' + lat.toFixed(3) + '|' + lon.toFixed(3);
        var nowMs = Date.now();
        var hit = cache[key];
        if (!force && hit && (nowMs - hit.at) < CACHE_TTL_MS) {
            cb(hit.data, null);
            return;
        }
        adapter(lat, lon, settings, nowMs, function (data, err) {
            if (err) { cb(null, err); return; }
            data.meta = { provider: providerId, fetchedAt: nowMs, lat: lat, lon: lon };
            cache[key] = { at: nowMs, data: data };
            cb(data, null);
        });
    }

    /**
     * Drop the page-open cache (tests, and the Retry action after an error).
     * @returns {void}
     */
    function clearCache() {
        cache = {};
    }

    var GPS_TIMEOUT_MS = 8000;

    /**
     * One fresh device position via the webview's geolocation API, for the
     * manual-refresh paths (the Current chip should follow the phone). Exactly
     * one callback, always: a missing API answers synchronously, an error or
     * no-permission answers through the error handler, and a webview that
     * never answers either way (the page is a data: URI with a null origin —
     * some webviews neither grant nor deny those) resolves through our own
     * watchdog. A cached OS fix up to 60 s old is accepted: this refreshes
     * weather, not turn-by-turn navigation.
     * @param {function(?{lat: number, lon: number}, ?string):void} cb
     *   (fix, error) — exactly one is set.
     * @returns {void}
     */
    function getGpsFix(cb) {
        var done = false;
        var watchdog = null;
        var finish = function (fix, err) {
            if (done) { return; }
            done = true;
            if (watchdog !== null) { clearTimeout(watchdog); }
            cb(fix, err);
        };
        var geo = (typeof navigator !== 'undefined') ? navigator.geolocation : null;
        if (!geo || !geo.getCurrentPosition) { finish(null, 'unavailable'); return; }
        watchdog = setTimeout(function () { finish(null, 'timeout'); }, GPS_TIMEOUT_MS + 2000);
        try {
            geo.getCurrentPosition(function (pos) {
                var c = pos && pos.coords;
                if (c && isFinite(Number(c.latitude)) && isFinite(Number(c.longitude))) {
                    finish({ lat: Number(c.latitude), lon: Number(c.longitude) }, null);
                } else {
                    finish(null, 'empty');
                }
            }, function (err) {
                finish(null, err && err.code === 1 ? 'denied' : 'gps_error');
            }, { timeout: GPS_TIMEOUT_MS, maximumAge: 60000, enableHighAccuracy: false });
        } catch (ex) {
            finish(null, 'unavailable');
        }
    }

    /**
     * Coordinates → display city name, via the same keyless ArcGIS endpoint
     * the phone side uses (weather/provider.js withCityName) — one naming
     * vocabulary for the Current chip on both sides of the app.
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @param {function(?string, ?string):void} cb (name, error) — exactly one is set.
     * @returns {void}
     */
    function reverseGeocode(lat, lon, cb) {
        var url = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode'
            + '?f=json&langCode=EN&location=' + lon + ',' + lat;
        fetchJson(url, function (body, err) {
            if (err) { cb(null, err); return; }
            var a = (body && body.address) || {};
            var name = a.District || a.City || a.Region || '';
            if (name) { cb(String(name), null); } else { cb(null, 'no_name'); }
        });
    }

    var api = {
        DAILY_COUNT: DAILY_COUNT,
        fetchJson: fetchJson,
        geocodeSearch: geocodeSearch,
        fetchWeather: fetchWeather,
        clearCache: clearCache,
        getGpsFix: getGpsFix,
        reverseGeocode: reverseGeocode,
        isoOffsetSec: isoOffsetSec,
        // Exported for direct testing with fixture JSON.
        adapters: ADAPTERS,
        parsers: {
            openmeteo: parseOpenMeteo,
            dwd: parseBrightsky,
            openweathermap: parseOwm,
            owmForecast3h: parseOwmForecast3h,
            tomorrowio: parseTomorrowIo
        },
        mergeOwmTail: mergeOwmTail
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WeatherTabData = api;
    }
})();
