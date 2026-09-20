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
//   daily:  up to 5 tiles from today — tmin/tmax °C, icon, rainMm, probMax,
//           sunshineH; null fields where the provider has no answer.
//
// Results are cached per provider+coords for the lifetime of the page open
// (module var — page storage doesn't persist, news-cache.js:3-5) with a 15 min
// TTL so switching between locations doesn't refetch on every tap.
/* global WeatherTabModel */
(function () {
    'use strict';

    var model = (typeof require !== 'undefined')
        ? require('./weather-tab-model.js') : window.WeatherTabModel;

    var PAST_HOURS = 6;
    var FUTURE_HOURS = 48;
    var DAILY_COUNT = 5;
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
     * @param {number} n Hours from now (negative = past).
     * @param {number} nowMs Reference epoch ms.
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
        return { time: [], temp: [], rain: [], prob: [], wind: [], gust: [], dir: [], rh: [], dew: [], pressure: [], icon: [], sunshineMin: [] };
    }

    // --- adapters -------------------------------------------------------------

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
     * Pure parser half of the Open-Meteo adapter (tests feed fixture JSON here).
     * @param {Object} data Raw response body.
     * @param {number} nowMs Reference time.
     * @returns {?{hourly: Object, daily: Array}} Normalized result, or null when unusable.
     */
    function parseOpenMeteo(data, nowMs) {
        {
            var h = data && data.hourly;
            if (!h || !h.time || !h.time.length) { return null; }
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
            var daily = [];
            var d = data.daily;
            var todayStart = new Date(nowMs);
            todayStart.setHours(0, 0, 0, 0);
            if (d && d.time) {
                for (var j = 0; j < d.time.length && daily.length < DAILY_COUNT; j += 1) {
                    var dayMs = d.time[j] * 1000;
                    if (dayMs < todayStart.getTime() - 3600000) { continue; }
                    var sun = num(d.sunshine_duration && d.sunshine_duration[j]);
                    daily.push({
                        date: dayMs,
                        tmin: num(d.temperature_2m_min && d.temperature_2m_min[j]),
                        tmax: num(d.temperature_2m_max && d.temperature_2m_max[j]),
                        icon: d.weather_code ? model.wmoIcon(d.weather_code[j]) : null,
                        rainMm: num(d.precipitation_sum && d.precipitation_sum[j]),
                        probMax: num(d.precipitation_probability_max && d.precipitation_probability_max[j]),
                        sunshineH: sun === null ? null : sun / 3600
                    });
                }
            }
            return { hourly: hourly, daily: daily };
        }
    }

    /**
     * DWD via Brightsky: hourly records only (default 'dwd' units: °C, km/h,
     * hPa, sunshine minutes); the daily strip aggregates client-side.
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @param {Object} settings Live settings (unused — keyless).
     * @param {number} nowMs Reference time.
     * @param {function(?Object, ?string):void} cb Normalized result callback.
     * @returns {void}
     */
    function fetchBrightsky(lat, lon, settings, nowMs, cb) {
        var url = 'https://api.brightsky.dev/weather?lat=' + lat + '&lon=' + lon
            + '&date=' + isoHour(nowMs, -PAST_HOURS)
            + '&last_date=' + isoHour(nowMs, DAILY_COUNT * 24 + 24)
            + '&max_dist=500000';
        fetchJson(url, function (data, err) {
            if (err) { cb(null, err); return; }
            var parsed = parseBrightsky(data, nowMs);
            cb(parsed, parsed ? null : 'empty');
        });
    }

    /**
     * Pure parser half of the Brightsky adapter.
     * @param {Object} data Raw response body.
     * @param {number} nowMs Reference time.
     * @returns {?{hourly: Object, daily: Array}} Normalized result, or null when unusable.
     */
    function parseBrightsky(data, nowMs) {
        {
            var rows = data && data.weather;
            if (!rows || !rows.length) { return null; }
            var hourly = emptyHourly();
            for (var i = 0; i < rows.length; i += 1) {
                var r = rows[i];
                var t = Date.parse(r.timestamp);
                if (!isFinite(t)) { continue; }
                hourly.time.push(t);
                hourly.temp.push(num(r.temperature));
                hourly.rain.push(num(r.precipitation));
                var p = num(r.precipitation_probability);
                hourly.prob.push(p);
                hourly.wind.push(num(r.wind_speed));
                hourly.gust.push(num(r.wind_gust_speed));
                hourly.dir.push(num(r.wind_direction));
                hourly.rh.push(num(r.relative_humidity));
                hourly.dew.push(num(r.dew_point));
                hourly.pressure.push(num(r.pressure_msl));
                hourly.icon.push(r.icon ? model.brightskyIcon(r.icon) : null);
                hourly.sunshineMin.push(num(r.sunshine));
            }
            return { hourly: hourly, daily: model.aggregateDaily(hourly, nowMs, DAILY_COUNT) };
        }
    }

    /**
     * OpenWeatherMap One Call 3.0 (metric): 48 h hourly + its own daily array
     * (no past hours, no sunshine duration).
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @param {Object} settings Live settings (owmApiKey).
     * @param {number} nowMs Reference time.
     * @param {function(?Object, ?string):void} cb Normalized result callback.
     * @returns {void}
     */
    function fetchOwm(lat, lon, settings, nowMs, cb) {
        var key = (settings && settings.owmApiKey) || '';
        if (!key) { cb(null, 'no_key'); return; }
        var url = 'https://api.openweathermap.org/data/3.0/onecall?lat=' + lat + '&lon=' + lon
            + '&units=metric&exclude=minutely,alerts&appid=' + encodeURIComponent(key);
        fetchJson(url, function (data, err) {
            if (err) { cb(null, err); return; }
            var parsed = parseOwm(data, nowMs);
            cb(parsed, parsed ? null : 'empty');
        });
    }

    /**
     * Pure parser half of the OWM adapter.
     * @param {Object} data Raw response body.
     * @param {number} nowMs Reference time.
     * @returns {?{hourly: Object, daily: Array}} Normalized result, or null when unusable.
     */
    function parseOwm(data, nowMs) {
        {
            var rows = data && data.hourly;
            if (!rows || !rows.length) { return null; }
            var MPS_TO_KMH = 3.6;
            var hourly = emptyHourly();
            for (var i = 0; i < rows.length; i += 1) {
                var r = rows[i];
                hourly.time.push(r.dt * 1000);
                hourly.temp.push(num(r.temp));
                hourly.rain.push(num(r.rain && r.rain['1h']) || 0);
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
                    rainMm: num(d.rain) || 0,
                    probMax: num(d.pop) === null ? null : d.pop * 100,
                    sunshineH: null
                });
            }
            return { hourly: hourly, daily: daily };
        }
    }

    /**
     * tomorrow.io Timelines, ONE call (billing is per call — the same reason
     * tomorrowio.js keeps to one): a 1h timestep spanning today-6h → +5 days;
     * the daily strip aggregates client-side. Metric wind is m/s.
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @param {Object} settings Live settings (tomorrowioApiKey).
     * @param {number} nowMs Reference time.
     * @param {function(?Object, ?string):void} cb Normalized result callback.
     * @returns {void}
     */
    function fetchTomorrowIo(lat, lon, settings, nowMs, cb) {
        var key = (settings && settings.tomorrowioApiKey) || '';
        if (!key) { cb(null, 'no_key'); return; }
        var url = 'https://api.tomorrow.io/v4/timelines?location=' + lat + ',' + lon
            + '&fields=temperature,precipitationIntensity,precipitationProbability,windSpeed,windGust,'
            + 'windDirection,humidity,dewPoint,pressureSeaLevel,weatherCode'
            + '&timesteps=1h&units=metric'
            + '&startTime=' + encodeURIComponent(isoHour(nowMs, -PAST_HOURS))
            + '&endTime=' + encodeURIComponent(isoHour(nowMs, DAILY_COUNT * 24 + 24))
            + '&apikey=' + encodeURIComponent(key);
        fetchJson(url, function (data, err) {
            if (err) { cb(null, err); return; }
            var parsed = parseTomorrowIo(data, nowMs);
            cb(parsed, parsed ? null : 'empty');
        });
    }

    /**
     * Pure parser half of the tomorrow.io adapter.
     * @param {Object} data Raw response body.
     * @param {number} nowMs Reference time.
     * @returns {?{hourly: Object, daily: Array}} Normalized result, or null when unusable.
     */
    function parseTomorrowIo(data, nowMs) {
        {
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
            return { hourly: hourly, daily: model.aggregateDaily(hourly, nowMs, DAILY_COUNT) };
        }
    }

    var ADAPTERS = {
        openmeteo: fetchOpenMeteo,
        dwd: fetchBrightsky,
        openweathermap: fetchOwm,
        tomorrowio: fetchTomorrowIo
    };

    /**
     * Fetch (or serve from the page-open cache) the normalized weather for one
     * provider + location.
     * @param {string} providerId A GRAPH_PROVIDERS id.
     * @param {number} lat Latitude.
     * @param {number} lon Longitude.
     * @param {Object} settings Live settings state.
     * @param {function(?Object, ?string):void} cb Normalized result callback.
     * @returns {void}
     */
    function fetchWeather(providerId, lat, lon, settings, cb) {
        var adapter = ADAPTERS[providerId];
        if (!adapter) { cb(null, 'unknown_provider'); return; }
        var key = providerId + '|' + lat.toFixed(3) + '|' + lon.toFixed(3);
        var nowMs = Date.now();
        var hit = cache[key];
        if (hit && (nowMs - hit.at) < CACHE_TTL_MS) {
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

    var api = {
        PAST_HOURS: PAST_HOURS,
        FUTURE_HOURS: FUTURE_HOURS,
        DAILY_COUNT: DAILY_COUNT,
        fetchJson: fetchJson,
        geocodeSearch: geocodeSearch,
        fetchWeather: fetchWeather,
        clearCache: clearCache,
        // Exported for direct testing with fixture JSON.
        adapters: ADAPTERS,
        parsers: {
            openmeteo: parseOpenMeteo,
            dwd: parseBrightsky,
            openweathermap: parseOwm,
            tomorrowio: parseTomorrowIo
        }
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WeatherTabData = api;
    }
})();
