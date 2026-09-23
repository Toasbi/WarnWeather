// src/pkjs/settings/weather-tab-model.js — pure logic for the Weather tab:
// saved-location slots, the tab's own provider choice, unit conversion, the
// condition-code → icon normalization, and daily aggregation of hourly data.
// Side-effect-free and dual-context (Node tests + the flat page bundle) so the
// data/chart/glue files and the tests all share one vocabulary.
//
// The tab is DISPLAY-ONLY by design: nothing here reads or writes the watch's
// `provider`/`location` settings — the graphs provider and the saved slots are
// their own blob-only keys (graphsProvider, graphsLocation, savedLocation1..3)
// that never ride an AppMessage.
(function () {
    'use strict';

    // Providers the page itself can fetch (data: URI webview, null origin —
    // CORS must be permissive). WU is excluded (its key never enters the
    // settings blob), Met.no is excluded (its TOS-required User-Agent header
    // is browser-forbidden), Yandex is excluded (header auth → preflight).
    var GRAPH_PROVIDERS = [
        { id: 'dwd', label: 'DWD (Brightsky)', keySetting: null },
        { id: 'openmeteo', label: 'Open-Meteo', keySetting: null },
        { id: 'openweathermap', label: 'OpenWeatherMap', keySetting: 'owmApiKey' },
        { id: 'tomorrowio', label: 'tomorrow.io', keySetting: 'tomorrowioApiKey' }
    ];

    var SLOT_KEYS = ['savedLocation1', 'savedLocation2', 'savedLocation3'];

    // The timeline every panel shows: the location's today at 00:00 through
    // five local days — the 5-day strip's span, one day per viewport, panned
    // and day-snapped by the glue. Adapters fetch toward covering it.
    var DAY_COUNT = 5;

    // --- location-local time -------------------------------------------------
    // A saved place can sit in another timezone, so "today", "daytime" and the
    // hour labels must follow the LOCATION's clock, not the phone's. Providers
    // hand us a UTC offset (weather-tab-data.js); these helpers apply it. The
    // offset is the one in effect now — a DST flip inside the 5-day window
    // shifts a far day's boundary by an hour, which the tiles tolerate.

    /**
     * The phone's own UTC offset — the fallback when a provider has none.
     * @param {number} nowMs Reference time.
     * @returns {number} Offset in seconds east of UTC.
     */
    function phoneUtcOffsetSec(nowMs) {
        return -new Date(nowMs).getTimezoneOffset() * 60;
    }

    /**
     * The UTC instant of the location-local midnight containing `ms`.
     * @param {number} ms Epoch ms.
     * @param {number} offsetSec Location UTC offset (seconds).
     * @returns {number} Epoch ms of that local day's start.
     */
    function localDayStart(ms, offsetSec) {
        var off = offsetSec * 1000;
        return Math.floor((ms + off) / 86400000) * 86400000 - off;
    }

    /**
     * @param {number} ms Epoch ms.
     * @param {number} offsetSec Location UTC offset (seconds).
     * @returns {number} Hour 0..23 on the location's clock.
     */
    function localHour(ms, offsetSec) {
        return new Date(ms + offsetSec * 1000).getUTCHours();
    }

    /**
     * @param {number} ms Epoch ms.
     * @param {number} offsetSec Location UTC offset (seconds).
     * @returns {number} Weekday 0..6 (Sunday = 0) on the location's clock.
     */
    function localWeekday(ms, offsetSec) {
        return new Date(ms + offsetSec * 1000).getUTCDay();
    }

    /**
     * The provider rows currently offerable, keyed providers only with a
     * non-empty key in the settings blob.
     * @param {Object} settings Live settings state.
     * @returns {{id: string, label: string}[]} Offerable providers.
     */
    function availableProviders(settings) {
        var out = [];
        for (var i = 0; i < GRAPH_PROVIDERS.length; i += 1) {
            var p = GRAPH_PROVIDERS[i];
            if (p.keySetting && !(settings && settings[p.keySetting])) { continue; }
            out.push({ id: p.id, label: p.label });
        }
        return out;
    }

    /**
     * Resolve the tab's provider select ('auto' follows the watch provider
     * when the page can fetch it, otherwise keyless Open-Meteo).
     * @param {Object} settings Live settings state (graphsProvider/provider/keys).
     * @returns {string} A concrete GRAPH_PROVIDERS id.
     */
    function resolveGraphsProvider(settings) {
        var pick = (settings && settings.graphsProvider) || 'auto';
        var avail = availableProviders(settings);
        var i;
        if (pick !== 'auto') {
            for (i = 0; i < avail.length; i += 1) {
                if (avail[i].id === pick) { return pick; }
            }
        }
        var watch = settings && settings.provider;
        for (i = 0; i < avail.length; i += 1) {
            if (avail[i].id === watch) { return watch; }
        }
        return 'openmeteo';
    }

    /**
     * Parse a saved-location slot value (a JSON string in the settings blob).
     * @param {*} raw Stored slot value.
     * @returns {?{name: string, lat: number, lon: number, country: string}} The slot, or null when empty/corrupt.
     */
    function parseSlot(raw) {
        if (typeof raw !== 'string' || raw === '') { return null; }
        var parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (ex) {
            return null;
        }
        if (!parsed || typeof parsed.name !== 'string' || parsed.name === '') { return null; }
        var lat = Number(parsed.lat);
        var lon = Number(parsed.lon);
        if (!isFinite(lat) || !isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) { return null; }
        return { name: parsed.name, lat: lat, lon: lon, country: typeof parsed.country === 'string' ? parsed.country : '' };
    }

    /**
     * Serialize a slot for the settings blob.
     * @param {{name: string, lat: number, lon: number, country: string=}} slot Slot to store.
     * @returns {string} JSON string.
     */
    function serializeSlot(slot) {
        return JSON.stringify({
            name: String(slot.name),
            lat: Number(slot.lat),
            lon: Number(slot.lon),
            country: slot.country ? String(slot.country) : ''
        });
    }

    /**
     * Resolve which location the graphs show right now. 'current' is the
     * watch's own location, seeded by the phone at page open; a missing seed
     * or an empty selected slot falls back sensibly.
     * @param {Object} settings Live settings state (graphsLocation + slots).
     * @param {?{lat: number, lon: number, name: string}} seed Phone-injected current location, or null.
     * @returns {?{key: string, name: string, lat: number, lon: number}} Active location, or null when nothing is known.
     */
    function activeLocation(settings, seed) {
        var pick = (settings && settings.graphsLocation) || 'current';
        if (pick !== 'current') {
            var idx = parseInt(pick, 10);
            if (idx >= 1 && idx <= 3) {
                var slot = parseSlot(settings[SLOT_KEYS[idx - 1]]);
                if (slot) { return { key: String(idx), name: slot.name, lat: slot.lat, lon: slot.lon }; }
            }
        }
        if (seed && isFinite(Number(seed.lat)) && isFinite(Number(seed.lon))) {
            return { key: 'current', name: seed.name || 'Current location', lat: Number(seed.lat), lon: Number(seed.lon) };
        }
        // No phone fix yet: any saved slot is better than nothing.
        for (var i = 0; i < SLOT_KEYS.length; i += 1) {
            var s = parseSlot(settings && settings[SLOT_KEYS[i]]);
            if (s) { return { key: String(i + 1), name: s.name, lat: s.lat, lon: s.lon }; }
        }
        return null;
    }

    // --- rain intensity: the watchface's own tier scale ------------------------
    // Exact port of src/pkjs/weather/rain-tier.js (itself mirroring C
    // rain_tier.c): five tiers with upper bounds 0.1/0.5/2/10 mm, drawn on a
    // non-linear slab scale so drizzle stays visible next to a downpour. The
    // temp panel's right-hand precipitation axis uses this scale, so the tab
    // reads like the watch's own rain bar. test/weather-tab-model.test.js
    // locks this port to rain-tier.js value-for-value — change them together.
    var RAIN_TIER_MAX_TENTHS = [1, 5, 20, 100];       // tier upper bounds (tenths of mm)
    var RAIN_TIER_TOP_PCT = [0, 14, 34, 56, 78, 100]; // cumulative slab tops (% of plot)
    var RAIN_TIER_LABELS = ['trace', 'light', 'moderate', 'heavy', 'extreme'];

    /**
     * ES5 stand-in for Math.trunc (ES2015): this file rides the PAGE bundle,
     * which never loads polyfills.js — lib/shell.html now shims Math.trunc for
     * the page, but this local copy predates that and keeps the port free of
     * the dependency (the v1.1.0 Object.assign lesson).
     * Bit-identical to Math.trunc for this port's integer-range inputs.
     * @param {number} v Value.
     * @returns {number} v truncated toward zero.
     */
    function trunc(v) {
        return v < 0 ? Math.ceil(v) : Math.floor(v);
    }

    /**
     * Tier index 1..5 for a tenths-of-mm rain value, or 0 for <= 0.
     * @param {number} tenths Rain in tenths of mm.
     * @returns {number} Tier index.
     */
    function rainTierOf(tenths) {
        if (tenths <= 0) { return 0; }
        for (var i = 0; i < RAIN_TIER_MAX_TENTHS.length; i += 1) {
            if (tenths <= RAIN_TIER_MAX_TENTHS[i]) { return i + 1; }
        }
        return 5;
    }

    /**
     * Fraction (0..256) of the topmost tier slab that is filled.
     * @param {number} tenths Rain in tenths of mm.
     * @param {number} tier Tier index 1..5.
     * @returns {number} q8 fill in [0,256].
     */
    function rainTierFillQ8(tenths, tier) {
        var low, high;
        switch (tier) {
            case 1: return 256;
            case 2: low = 2;   high = 5;   break;
            case 3: low = 6;   high = 20;  break;
            case 4: low = 21;  high = 100; break;
            case 5: low = 101; high = 255; break;
            default: return 256;
        }
        if (tenths >= high) { return 256; }
        if (tenths <= low)  { return 0; }
        return trunc(((tenths - low) * 256) / (high - low));
    }

    /**
     * Per-mille (0..1000) bar height for a tenths-of-mm rain value — the same
     * number rain-tier.js/rain_tier.c compute for the watch's rain bar.
     * @param {number} tenths Rain in tenths of mm.
     * @returns {number} Height in per-mille of plot height.
     */
    function rainTierPermille(tenths) {
        if (tenths <= 0) { return 0; }
        var tier = rainTierOf(tenths);
        var q8 = rainTierFillQ8(tenths, tier);
        var belowH = trunc((1000 * RAIN_TIER_TOP_PCT[tier - 1]) / 100);
        var slabTopFull = trunc((1000 * RAIN_TIER_TOP_PCT[tier]) / 100);
        var slabHFull = slabTopFull - belowH;
        var slabHTop = trunc((slabHFull * q8) / 256);
        if (slabHTop === 0 && q8 > 0) { slabHTop = 1; }
        var total = belowH + slabHTop;
        return total > 0 ? total : 1;
    }

    /**
     * Tier height for an mm/h rate (the tab's normalized rain unit).
     * @param {number} mm Rain in mm (per hour).
     * @returns {number} Height in per-mille of plot height.
     */
    function rainPermilleFromMm(mm) {
        return rainTierPermille(Math.round(mm * 10));
    }

    // --- hourly grid -----------------------------------------------------------

    /**
     * Resample normalized hourly arrays onto a complete hourly grid over
     * [startMs, startMs + hourCount·1h): the continuous multi-day canvas the
     * panels draw. Continuous series interpolate linearly across gaps up to
     * 6 h (OWM's 3-hourly tail lands between grid hours); stepped series
     * (rain rate, probability, direction, icon, the measured flag) take the
     * nearest sample within 90 min. Hours no sample reaches stay null — and
     * for `measured` a null reads as "not measured", which is the right
     * answer for an hour no station row covers.
     * @param {Object} hourly Normalized parallel arrays over `time` (epoch ms, ascending).
     * @param {number} startMs Grid start (a location-local midnight).
     * @param {number} hourCount Grid length in hours.
     * @returns {Object} Parallel arrays of length hourCount, `time` included.
     */
    function buildHourlyGrid(hourly, startMs, hourCount) {
        var CONT = ['temp', 'wind', 'gust', 'rh', 'dew', 'pressure'];
        var STEP = ['rain', 'prob', 'dir', 'icon', 'measured', 'measuredAll'];
        var MAX_INTERP_MS = 6 * 3600000;
        var NEAR_MS = 90 * 60000;
        var out = { time: [] };
        var k;
        for (k = 0; k < CONT.length; k += 1) { out[CONT[k]] = []; }
        for (k = 0; k < STEP.length; k += 1) { out[STEP[k]] = []; }
        var times = (hourly && hourly.time) || [];
        var n = times.length;
        var j = 0; // walks the source: first sample with times[j] >= t
        for (var g = 0; g < hourCount; g += 1) {
            var t = startMs + g * 3600000;
            out.time.push(t);
            while (j < n && times[j] < t) { j += 1; }
            var ia = j < n ? j : -1;          // at-or-after t
            var ib = j > 0 ? j - 1 : -1;      // strictly before t
            if (ia >= 0 && times[ia] === t) { ib = ia; }
            for (k = 0; k < CONT.length; k += 1) {
                var src = hourly[CONT[k]];
                var v = null;
                if (src) {
                    if (ib === ia && ib >= 0) {
                        v = src[ib] === undefined ? null : src[ib];
                    } else {
                        var va = ia >= 0 ? src[ia] : null;
                        var vb = ib >= 0 ? src[ib] : null;
                        if (va === undefined) { va = null; }
                        if (vb === undefined) { vb = null; }
                        if (vb !== null && va !== null && (times[ia] - times[ib]) <= MAX_INTERP_MS) {
                            v = vb + (va - vb) * (t - times[ib]) / (times[ia] - times[ib]);
                        } else if (vb !== null && (t - times[ib]) <= NEAR_MS) {
                            v = vb;
                        } else if (va !== null && (times[ia] - t) <= NEAR_MS) {
                            v = va;
                        }
                    }
                }
                out[CONT[k]].push(v);
            }
            for (k = 0; k < STEP.length; k += 1) {
                var srcS = hourly[STEP[k]];
                var vs = null;
                if (srcS) {
                    var db = ib >= 0 ? t - times[ib] : Infinity;
                    var da = ia >= 0 ? times[ia] - t : Infinity;
                    var first = db <= da ? ib : ia;
                    var second = db <= da ? ia : ib;
                    var dFirst = db <= da ? db : da;
                    var dSecond = db <= da ? da : db;
                    if (first >= 0 && dFirst <= NEAR_MS && srcS[first] !== null && srcS[first] !== undefined) {
                        vs = srcS[first];
                    } else if (second >= 0 && dSecond <= NEAR_MS && srcS[second] !== null && srcS[second] !== undefined) {
                        vs = srcS[second];
                    }
                }
                out[STEP[k]].push(vs);
            }
        }
        return out;
    }

    // --- units ---------------------------------------------------------------
    // Normalized internal units are °C / mm / km/h / hPa; conversion happens at
    // display time from the same settings the watch honors.

    /**
     * @param {number} c Temperature in °C.
     * @param {Object} settings Live settings (temperatureUnits 'c'|'f').
     * @returns {number} Display temperature.
     */
    function displayTemp(c, settings) {
        return (settings && settings.temperatureUnits === 'f') ? c * 9 / 5 + 32 : c;
    }

    /**
     * @param {Object} settings Live settings.
     * @returns {string} '°C' | '°F'.
     */
    function tempUnitLabel(settings) {
        return (settings && settings.temperatureUnits === 'f') ? '°F' : '°C';
    }

    /**
     * @param {number} kmh Speed in km/h.
     * @param {Object} settings Live settings (windUnits 'kph'|'mph'|'knots').
     * @returns {number} Display speed.
     */
    function displayWind(kmh, settings) {
        var u = settings && settings.windUnits;
        if (u === 'mph') { return kmh / 1.609344; }
        if (u === 'knots') { return kmh / 1.852; }
        return kmh;
    }

    /**
     * @param {Object} settings Live settings.
     * @returns {string} 'km/h' | 'mph' | 'kn'.
     */
    function windUnitLabel(settings) {
        var u = settings && settings.windUnits;
        if (u === 'mph') { return 'mph'; }
        if (u === 'knots') { return 'kn'; }
        return 'km/h';
    }

    // --- condition-code → icon normalization ---------------------------------
    // The repo deliberately fetches no condition codes for the watch; the
    // Weather tab is the first consumer, so this is the project's first (and
    // only) icon vocabulary: a small fixed set the chart module draws glyphs for.
    var ICONS = ['clear', 'partly', 'cloudy', 'fog', 'drizzle', 'rain', 'sleet', 'snow', 'showers', 'thunder'];

    // Severity order for picking one icon to represent a whole day: the most
    // weather-significant condition seen in daytime hours wins.
    var ICON_SEVERITY = {
        thunder: 9, snow: 8, sleet: 7, showers: 6, rain: 5,
        drizzle: 4, fog: 3, cloudy: 2, partly: 1, clear: 0
    };

    /**
     * WMO weather code (Open-Meteo, and tomorrow.io/brightsky after their own
     * mapping) → icon id.
     * @param {number} code WMO 4677-style weather code.
     * @returns {string} Icon id.
     */
    function wmoIcon(code) {
        if (code === 0) { return 'clear'; }
        if (code === 1 || code === 2) { return 'partly'; }
        if (code === 3) { return 'cloudy'; }
        if (code === 45 || code === 48) { return 'fog'; }
        if (code >= 51 && code <= 55) { return 'drizzle'; }
        if (code === 56 || code === 57) { return 'sleet'; }
        if (code >= 61 && code <= 65) { return 'rain'; }
        if (code === 66 || code === 67) { return 'sleet'; }
        if (code >= 71 && code <= 77) { return 'snow'; }
        if (code >= 80 && code <= 82) { return 'showers'; }
        if (code === 85 || code === 86) { return 'snow'; }
        if (code >= 95) { return 'thunder'; }
        return 'cloudy';
    }

    /**
     * Brightsky `icon` string → icon id.
     * @param {string} icon Brightsky icon name.
     * @returns {string} Icon id.
     */
    function brightskyIcon(icon) {
        var map = {
            'clear-day': 'clear', 'clear-night': 'clear',
            'partly-cloudy-day': 'partly', 'partly-cloudy-night': 'partly',
            cloudy: 'cloudy', fog: 'fog', wind: 'cloudy', rain: 'rain',
            sleet: 'sleet', snow: 'snow', hail: 'sleet', thunderstorm: 'thunder'
        };
        return map[icon] || 'cloudy';
    }

    /**
     * OpenWeatherMap condition id → icon id.
     * @param {number} id OWM weather[0].id.
     * @returns {string} Icon id.
     */
    function owmIcon(id) {
        if (id >= 200 && id < 300) { return 'thunder'; }
        if (id >= 300 && id < 400) { return 'drizzle'; }
        if (id === 511) { return 'sleet'; }
        if (id >= 520 && id < 600) { return 'showers'; }
        if (id >= 500 && id < 520) { return 'rain'; }
        if (id >= 611 && id <= 616) { return 'sleet'; }
        if (id >= 600 && id < 700) { return 'snow'; }
        if (id >= 700 && id < 800) { return 'fog'; }
        if (id === 800) { return 'clear'; }
        if (id === 801 || id === 802) { return 'partly'; }
        return 'cloudy';
    }

    /**
     * tomorrow.io weatherCode → icon id.
     * @param {number} code v4 weatherCode.
     * @returns {string} Icon id.
     */
    function tomorrowIcon(code) {
        if (code === 1000 || code === 1100) { return 'clear'; }
        if (code === 1101) { return 'partly'; }
        if (code === 1102 || code === 1001) { return 'cloudy'; }
        if (code === 2000 || code === 2100) { return 'fog'; }
        if (code === 4000) { return 'drizzle'; }
        if (code === 4200 || code === 4001 || code === 4201) { return 'rain'; }
        if (code >= 5000 && code < 6000) { return 'snow'; }
        if (code >= 6000 && code < 8000) { return 'sleet'; }
        if (code === 8000) { return 'thunder'; }
        return 'cloudy';
    }

    /**
     * Pick the one icon that represents a day: the most severe daytime icon.
     * @param {Array<?string>} icons Hour icons for the day (index 0 = 00:00 local).
     * @returns {?string} Icon id, or null when nothing usable.
     */
    function pickDailyIcon(icons) {
        var best = null;
        var bestRank = -1;
        for (var h = 6; h <= 20 && h < icons.length; h += 1) {
            var icon = icons[h];
            if (!icon) { continue; }
            var rank = ICON_SEVERITY[icon] || 0;
            if (rank > bestRank) { bestRank = rank; best = icon; }
        }
        if (best) { return best; }
        for (var i = 0; i < icons.length; i += 1) {
            if (icons[i]) { return icons[i]; }
        }
        return null;
    }

    // --- hour convention ---------------------------------------------------------

    /**
     * Re-stamp fields a provider reports for the PRECEDING hour onto the hour
     * they START, which is what every hour of the tab means: the row stamped
     * 14:00 is 14:00-15:00, the bar right of the 14:00 tick, the figure a tap
     * there reads, and the slot the watch fills from the same provider
     * (openmeteo.js's precedingHourSlice, dwd.js's slotRecords). So row T
     * takes the value stamped T+1h. The pair is found by TIME, never by
     * index -- a provider can skip an hour, and a parser drops rows it
     * cannot date, so an index shift would slide every later hour -- and a
     * row with no T+1h partner takes `fills[key]` (null: unsourced).
     *
     * A skipped stamp S-1h would leave the values stamped S no row to land
     * on, and the grid would fill that hour from its neighbours: the next
     * hour's rain, drawn twice. So such an S gets a row of its own at S-1h,
     * as the watch gives it a slot: its re-stamped fields are S's, and its
     * other series are what the grid would have drawn there anyway (the
     * interpolated or nearest sample, buildHourlyGrid). The first stamp gets
     * none: its hour lies before the response, and the watch never reads it
     * either.
     *
     * Only Open-Meteo and DWD need this. tomorrow.io and OWM One Call report
     * an INSTANT at the stamp (a rate, a chance, a gust), which holds for
     * the hour starting there, as their own daily sums treat it; shifting
     * them would put them an hour early. (OWM's 3-hourly tail totals the
     * hours before its stamp too, but in 3 h blocks: parseOwmForecast3h
     * spreads those itself.)
     * @param {{time: number[]}} hourly Normalized hourly arrays (time = epoch
     *   ms); rewritten in place, every per-row array replaced.
     * @param {Object<string, *>} fills Series key -> the value for a row with no T+1h partner.
     * @returns {number[]} Per row of the result, the index (into the arrays
     *   passed in) its re-stamped values came from, or -1.
     */
    function startHourFields(hourly, fills) {
        var HOUR_MS = 3600000;
        var time = hourly.time;
        var n = time.length;
        var at = {};
        var keys = [];
        var out = {};
        var times = [];
        var from = [];
        var i, k, key, gap, sample;
        for (i = 0; i < n; i += 1) { at[time[i]] = i; }
        for (key in hourly) {
            if (Object.prototype.hasOwnProperty.call(hourly, key) && key !== 'time'
                && Array.isArray(hourly[key]) && hourly[key].length === n) {
                keys.push(key);
                out[key] = [];
            }
        }
        for (i = 0; i < n; i += 1) {
            gap = time[i] - HOUR_MS;
            if (i > 0 && at[gap] === undefined && gap > time[i - 1]) {
                sample = buildHourlyGrid(hourly, gap, 1);
                times.push(gap);
                for (k = 0; k < keys.length; k += 1) {
                    out[keys[k]].push(sample[keys[k]] ? sample[keys[k]][0] : null);
                }
            }
            times.push(time[i]);
            for (k = 0; k < keys.length; k += 1) { out[keys[k]].push(hourly[keys[k]][i]); }
        }
        for (i = 0; i < times.length; i += 1) {
            var j = at[times[i] + HOUR_MS];
            from.push(j === undefined ? -1 : j);
        }
        for (key in fills) {
            if (!Object.prototype.hasOwnProperty.call(fills, key) || !out[key]) { continue; }
            for (i = 0; i < times.length; i += 1) {
                out[key][i] = from[i] < 0 ? fills[key] : hourly[key][from[i]];
            }
        }
        hourly.time = times;
        for (k = 0; k < keys.length; k += 1) { hourly[keys[k]] = out[keys[k]]; }
        return from;
    }

    // --- daily aggregation ----------------------------------------------------

    /**
     * Aggregate a normalized hourly series into tiles per LOCATION-local day,
     * for providers that serve no daily endpoint (Brightsky, tomorrow.io).
     * @param {{time: number[], temp: Array<?number>, rain: Array<?number>, prob: Array<?number>, icon: Array<?string>, sunshineMin: Array<?number>}} hourly Normalized hourly arrays (time = epoch ms).
     * @param {number} nowMs Reference time (epoch ms).
     * @param {number} dayCount Days wanted, starting at the location's today.
     * @param {number} [offsetSec] Location UTC offset; the phone's when absent.
     * @returns {Array<{date: number, tmin: ?number, tmax: ?number, icon: ?string, rainMm: ?number, probMax: ?number, sunshineH: ?number}>} Daily tiles (`date` = the local day-start instant).
     */
    function aggregateDaily(hourly, nowMs, dayCount, offsetSec) {
        var off = (offsetSec === null || offsetSec === undefined) ? phoneUtcOffsetSec(nowMs) : offsetSec;
        var days = [];
        var todayStartMs = localDayStart(nowMs, off);
        for (var d = 0; d < dayCount; d += 1) {
            var startMs = todayStartMs + d * 86400000;
            var endMs = startMs + 86400000;
            var tmin = null, tmax = null, rain = null, prob = null, sun = null;
            var icons = [];
            for (var i = 0; i < hourly.time.length; i += 1) {
                var t = hourly.time[i];
                if (t < startMs || t >= endMs) { continue; }
                var hour = localHour(t, off);
                icons[hour] = hourly.icon ? hourly.icon[i] : null;
                var temp = hourly.temp[i];
                if (temp !== null && temp !== undefined) {
                    if (tmin === null || temp < tmin) { tmin = temp; }
                    if (tmax === null || temp > tmax) { tmax = temp; }
                }
                var r = hourly.rain[i];
                if (r !== null && r !== undefined) { rain = (rain || 0) + r; }
                var p = hourly.prob ? hourly.prob[i] : null;
                if (p !== null && p !== undefined) {
                    if (prob === null || p > prob) { prob = p; }
                }
                var s = hourly.sunshineMin ? hourly.sunshineMin[i] : null;
                if (s !== null && s !== undefined) { sun = (sun || 0) + s; }
            }
            // A day with no temperatures at all is beyond the provider's
            // horizon — stop rather than render empty tiles.
            if (tmin === null && d > 0) { break; }
            days.push({
                date: startMs,
                tmin: tmin, tmax: tmax,
                icon: pickDailyIcon(icons),
                rainMm: rain, probMax: prob,
                sunshineH: sun === null ? null : sun / 60
            });
        }
        return days;
    }

    var api = {
        SLOT_KEYS: SLOT_KEYS,
        DAY_COUNT: DAY_COUNT,
        RAIN_TIER_TOP_PCT: RAIN_TIER_TOP_PCT,
        RAIN_TIER_LABELS: RAIN_TIER_LABELS,
        rainTierPermille: rainTierPermille,
        rainPermilleFromMm: rainPermilleFromMm,
        buildHourlyGrid: buildHourlyGrid,
        ICONS: ICONS,
        phoneUtcOffsetSec: phoneUtcOffsetSec,
        localDayStart: localDayStart,
        localHour: localHour,
        localWeekday: localWeekday,
        availableProviders: availableProviders,
        resolveGraphsProvider: resolveGraphsProvider,
        parseSlot: parseSlot,
        serializeSlot: serializeSlot,
        activeLocation: activeLocation,
        displayTemp: displayTemp,
        tempUnitLabel: tempUnitLabel,
        displayWind: displayWind,
        windUnitLabel: windUnitLabel,
        wmoIcon: wmoIcon,
        brightskyIcon: brightskyIcon,
        owmIcon: owmIcon,
        tomorrowIcon: tomorrowIcon,
        pickDailyIcon: pickDailyIcon,
        startHourFields: startHourFields,
        aggregateDaily: aggregateDaily
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.WeatherTabModel = api;
    }
})();
