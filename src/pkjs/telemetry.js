var statusCatalog = require('./status-line-catalog.js');
var configUi = require('./config-ui');          // intToHex
// renderContext / graphColorKey / graphColorIsDefault — the module that resolves the graph
// colours for the WIRE, so this snapshot reports what the watch actually paints instead
// of a second opinion about it.
var lineStyle = require('./line-style.js');

/**
 * Parse a value as a base-10 integer for telemetry, omitting invalid input.
 *
 * @param {*} value Raw setting value (Clay selects arrive as strings).
 * @returns {number|undefined} Parsed integer or undefined when not parseable.
 */
function toIntOrUndefined(value) {
    var parsed = parseInt(value, 10);
    return isFinite(parsed) ? parsed : undefined;
}

/**
 * Read a boolean setting that ships ON, reporting the shipped state when the key is
 * absent. The catalog's true-default unit toggles ship ON (settings/schema.js), and
 * `Boolean(undefined)` would read as a deliberate "off" — a whole fleet of installs
 * looking like they turned kph off. seedDefaults backfills these keys at boot, so the
 * absent case should never reach here; this keeps the column honest if it ever does.
 *
 * @param {*} value Raw setting value.
 * @returns {boolean} The stored boolean, or true when the setting is absent.
 */
function boolDefaultOn(value) {
    return value === undefined || value === null ? true : Boolean(value);
}

/**
 * Format one graph colour for telemetry: the user's pick as '#RRGGBB', or the literal
 * 'default' while the colour is still the built-in.
 *
 * Every key now holds a CONCRETE colour (seedDefaults backfills the built-in), so there is
 * no '' sentinel left to mean "untouched" — and mining these for better defaults needs
 * exactly that distinction. The judgement is line-style.graphColorIsDefault's, not a hex
 * comparison here: it is the same predicate the wire uses, so telemetry cannot call a value
 * tuned that the wire is still resolving through the built-in — which is precisely what
 * gust's dark line does, where EITHER of its two built-ins (White, LightGray) counts as
 * untouched because the painted one follows rainBarColor.
 *
 * A STRING either way: the ingest schema types these z.string(), and a number or a null
 * against a z.number() would fail safeParse and 400 the WHOLE event, taking the fetch
 * outcome with it, with no retry. '#RRGGBB' rather than an int because the dashboards read
 * these through ->>; the existing int-encoded colorTime/colorSunday appear in no dashboard
 * query, which is exactly why they are unminable.
 *
 * @param {Object} settings Clay settings blob (the gc* keys, plus rainBarColor for gust).
 * @param {string} scope A metric id (line-style's GRAPH_METRICS), or 'night' for the band.
 * @param {string} role 'Line'|'Fill'|'Night' for a metric; 'Hatch'|'Boundary' for 'night'.
 * @param {string} suffix Polarity to read, 'Dark' or 'Light' (renderContext's `suffix`).
 * @returns {string} '#RRGGBB' for a colour moved off the built-in, else 'default'.
 */
function graphColorReport(settings, scope, role, suffix) {
    // graphColorIsDefault answers TRUE for an absent or unparseable value as well as for
    // one still equal to the built-in, so the other arm always has a real int to format.
    if (lineStyle.graphColorIsDefault(settings, scope, role, suffix)) {
        return 'default';
    }
    return configUi.intToHex(
        lineStyle.colorPick(settings[lineStyle.graphColorKey(scope, role, suffix)]));
}

/**
 * Build a compact, allowlisted settings snapshot for telemetry.
 *
 * @param {Object} settings Clay settings object.
 * @param {Object} [watchInfo] Pebble.getActiveWatchInfo() result — only its platform is
 *   read, to resolve the graph colours the way the renderer does (line-style.renderContext:
 *   the theme fold and the colour-display check). Absent = colour basalt.
 * @returns {Object} Telemetry-safe settings snapshot.
 */
function buildSettingsSnapshot(settings, watchInfo) {
    var safe = settings || {};
    var cx = lineStyle.renderContext(safe, watchInfo);
    var snapshot = {
        temperatureUnits: safe.temperatureUnits,
        tempSlotDisplay: safe.tempSlotDisplay,
        aqiScale: safe.aqiScale,
        aqiSource: safe.aqiSource,
        windUnits: safe.windUnits,
        distanceUnits: safe.distanceUnits,
        windSlotDirection: Boolean(safe.windSlotDirection),
        gustSlotDirection: Boolean(safe.gustSlotDirection),
        // The one per-kind Bold mode in the snapshot. The phone-battery slot is
        // Android-only (its reading comes from a host API that exists nowhere else),
        // so how the handful of phones that can have it configure it is worth seeing;
        // the other bold modes stay out. Passed through raw like tempSlotDisplay --
        // an unseeded install reports undefined, which the column reads as "default".
        threshPhoneBatteryBoldMode: safe.threshPhoneBatteryBoldMode,
        configTheme: safe.configTheme,
        dayNightShading: !!safe.dayNightShading,
        healthMode: safe.healthMode || 'off',
        provider: safe.provider,
        fetchIntervalMin: toIntOrUndefined(safe.fetchIntervalMin),
        rainCountdownHorizon: toIntOrUndefined(safe.rainCountdownHorizon),
        sleepStartHour: safe.sleepNightEnabled ? toIntOrUndefined(safe.sleepStartHour) : undefined,
        sleepEndHour: safe.sleepNightEnabled ? toIntOrUndefined(safe.sleepEndHour) : undefined,
        axisTimeFormat: safe.axisTimeFormat,
        timeFont: safe.timeFont,
        timeLeadingZero: !!safe.timeLeadingZero,
        timeShowAmPm: !!safe.timeShowAmPm,
        weekStartDay: safe.weekStartDay,
        firstWeek: safe.firstWeek,
        showQt: !!safe.showQt,
        batteryLowOnly: Boolean(safe.batteryLowOnly),
        topViewMode: safe.topViewMode,
        layoutPreset: safe.layoutPreset,
        viewResetMin: toIntOrUndefined(safe.viewResetMin),
        largeGraphFont: Boolean(safe.largeGraphFont),
        vibe: !!safe.vibe,
        btIcons: safe.btIcons,
        secondaryLine: safe.secondaryLine,
        secondaryLineFill: Boolean(safe.secondaryLineFill),
        windScale: safe.windScale,
        pressureScale: safe.pressureScale,
        thirdLine: safe.thirdLine,
        barSource: safe.barSource,
        rainBarColor: safe.rainBarColor,
        radarProvider: safe.radarProvider,
        radarMode: safe.radarMode || 'graph',
        radarColor: safe.radarColor,
        devStatsEnabled: Boolean(safe.devStatsEnabled),
        theme: safe.theme,
        statusForecastLeft: safe.statusForecastLeft,
        statusForecastMid: safe.statusForecastMid,
        statusForecastRight: safe.statusForecastRight,
        statusRadarLeft: safe.statusRadarLeft,
        statusRadarMid: safe.statusRadarMid,
        statusRadarRight: safe.statusRadarRight,
        statusTopLeft: safe.statusTopLeft,
        statusTopMid: safe.statusTopMid,
        statusTopRight: safe.statusTopRight,
        statusHealthLeft: safe.statusHealthLeft,
        statusHealthMid: safe.statusHealthMid,
        statusHealthRight: safe.statusHealthRight,
        colorTime: safe.colorTime,
        colorToday: safe.colorToday,
        colorSunday: safe.colorSunday,
        colorSaturday: safe.colorSaturday,
        colorUSFederal: safe.colorUSFederal
    };
    // The per-kind "Show unit" toggles, derived from the catalog's table (the
    // same one formatValue bakes by and settings/schema.js defaults from) so a
    // flipped default can never desynchronize what telemetry reports from what
    // the watch renders. Defaults pinned by test/telemetry.test.js. A new key
    // here must also join the Deno .strip() schema or it is silently dropped
    // (supabase/functions/telemetry-ingest/index.ts).
    var toggles = statusCatalog.UNIT_TOGGLES;
    for (var i = 0; i < toggles.length; i++) {
        snapshot[toggles[i].key] = toggles[i].dflt
            ? boolDefaultOn(safe[toggles[i].key])
            : Boolean(safe[toggles[i].key]);
    }
    // The graph colours, one field per painted ELEMENT, carrying the value for the polarity
    // this watch ACTUALLY RENDERS. Every platform/theme judgement comes from line-style's
    // renderContext (cx above) — the same call resolveLineStyle opens with — rather than
    // being re-derived here, which is how the two drifted before: this file had copied the
    // theme fold but not the colour-display check, and reported picks on a B&W watch that
    // the wire was already resolving away to the theme foreground.
    // cx.isColor is that missing half: a watch painting no colour reports nothing,
    // whether the reason is a Black & White theme or B&W hardware (aplite/diorite/flint).
    // cx.suffix is the polarity to read. It is folded (aplite has the light polarity
    // compiled out) but that fold changes nothing HERE, since aplite is also the one
    // no-polarity platform and cx.isColor has already excluded it — it is load-bearing on
    // the wire, not in this snapshot; taking it from the same place is what keeps the two
    // from disagreeing if that ever stops being true.
    // Precedent for reporting only the value in effect: sleepStartHour above.
    //
    // The colours are stored PER METRIC now (gcWindLineDark, …), but these six field names
    // and their z.string() type are unchanged — the watch/zod lockstep is satisfied by NOT
    // touching supabase/functions/telemetry-ingest/index.ts, and the dashboards keep their
    // history. Each names an ELEMENT of the graph, and the metric it belongs to is the
    // secondaryLine / thirdLine already in this same snapshot, so a query slices by metric
    // (`where secondaryLine = 'wind'`) rather than needing twenty more columns.
    //
    // Assign undefined, never delete: the key must still EXIST for the lockstep
    // set-equality test (test/telemetry.test.js). JSON.stringify drops it, and its
    // ABSENCE is then the "this watch paints no colour at all" flag (the
    // `settings_json ? 'sleepStartHour'` idiom in reports/telemetry-dashboards.sql).
    var secMetric = safe.secondaryLine;
    snapshot.graphMainColor = cx.isColor
        ? graphColorReport(safe, secMetric, 'Line', cx.suffix) : undefined;
    snapshot.graphFillColor = cx.isColor
        ? graphColorReport(safe, secMetric, 'Fill', cx.suffix) : undefined;
    // The third line has an 'off' state, and no third line means no colour in effect —
    // sleepStartHour's rule again, and it keeps 'off' installs out of the ranking's sample.
    snapshot.graphSecondColor = (cx.isColor && safe.thirdLine !== 'off')
        ? graphColorReport(safe, safe.thirdLine, 'Line', cx.suffix) : undefined;
    // The night tint belongs to the secondary metric (it is the base of that metric's night
    // area); the hatch and the dusk/dawn line are the band's own, under the 'night' scope.
    snapshot.nightFillColor = cx.isColor
        ? graphColorReport(safe, secMetric, 'Night', cx.suffix) : undefined;
    snapshot.nightHatchColor = cx.isColor
        ? graphColorReport(safe, 'night', 'Hatch', cx.suffix) : undefined;
    snapshot.nightBoundaryColor = cx.isColor
        ? graphColorReport(safe, 'night', 'Boundary', cx.suffix) : undefined;
    return snapshot;
}

/**
 * Normalize a country code to uppercase ISO-like format.
 *
 * @param {string|null|undefined} code Raw country code.
 * @returns {string|null} Normalized country code or null.
 */
function normalizeCountryCode(code) {
    if (typeof code !== 'string') {
        return null;
    }
    var trimmed = code.trim().toUpperCase();
    if (!/^[A-Z]{2,3}$/.test(trimmed)) {
        return null;
    }
    return trimmed;
}

/**
 * Normalize location mode to an allowlisted telemetry value.
 *
 * @param {string|null|undefined} mode Raw location mode.
 * @returns {string|null} Normalized location mode or null.
 */
function normalizeLocationMode(mode) {
    if (mode === 'gps' || mode === 'manual_coordinates' || mode === 'manual_address') {
        return mode;
    }
    return null;
}

/**
 * Build telemetry-safe WatchInfo snapshot.
 *
 * @param {Object} watchInfo Pebble active watch info.
 * @returns {Object} Normalized WatchInfo payload.
 */
function buildWatchInfoSnapshot(watchInfo) {
    var firmware = {};

    if (!watchInfo || typeof watchInfo !== 'object') {
        return {};
    }

    if (watchInfo.firmware && typeof watchInfo.firmware === 'object') {
        if (typeof watchInfo.firmware.major === 'number' && isFinite(watchInfo.firmware.major)) {
            firmware.major = Math.floor(watchInfo.firmware.major);
        }
        if (typeof watchInfo.firmware.minor === 'number' && isFinite(watchInfo.firmware.minor)) {
            firmware.minor = Math.floor(watchInfo.firmware.minor);
        }
        if (typeof watchInfo.firmware.patch === 'number' && isFinite(watchInfo.firmware.patch)) {
            firmware.patch = Math.floor(watchInfo.firmware.patch);
        }
        if (typeof watchInfo.firmware.suffix === 'string') {
            firmware.suffix = watchInfo.firmware.suffix;
        }
    }

    return {
        platform: typeof watchInfo.platform === 'string' ? watchInfo.platform : null,
        model: typeof watchInfo.model === 'string' ? watchInfo.model : null,
        language: typeof watchInfo.language === 'string' ? watchInfo.language : null,
        firmware: firmware
    };
}

/**
 * Truncate a string to a maximum length.
 *
 * @param {string} value Input string.
 * @param {number} maxLength Max number of characters.
 * @returns {string} Truncated string.
 */
function truncateString(value, maxLength) {
    if (typeof value !== 'string') {
        return '';
    }

    if (typeof maxLength !== 'number' || maxLength < 1) {
        return value;
    }

    if (value.length <= maxLength) {
        return value;
    }

    if (maxLength <= 3) {
        return value.slice(0, maxLength);
    }

    return value.slice(0, maxLength - 3) + '...';
}

/**
 * Normalize any failure value into a readable telemetry error string.
 *
 * @param {*} value Failure payload from fetch flow.
 * @param {number} maxLength Max serialized error length.
 * @returns {string} Human-readable error string.
 */
function serializeError(value, maxLength) {
    var out = '';
    var base;
    var name;
    var message;
    var stack;
    var lines;
    var frames;
    var i;

    if (value instanceof Error || (value && typeof value === 'object' && (typeof value.message === 'string' || typeof value.stack === 'string'))) {
        name = (typeof value.name === 'string' && value.name.trim() !== '') ? value.name.trim() : 'Error';
        message = typeof value.message === 'string' ? value.message.trim() : '';
        base = message !== '' ? (name + ': ' + message) : name;

        stack = typeof value.stack === 'string' ? value.stack : '';
        if (stack.trim() !== '') {
            lines = stack.split('\n').map(function(line) {
                return line.trim();
            }).filter(function(line) {
                return line !== '';
            });
            frames = [];
            for (i = 0; i < lines.length; i += 1) {
                if (lines[i] === base || lines[i] === message || lines[i].indexOf(name + ':') === 0) {
                    continue;
                }
                frames.push(lines[i]);
                if (frames.length >= 3) {
                    break;
                }
            }

            if (frames.length > 0) {
                out = base + ' | stack: ' + frames.join(' <- ');
            }
            else {
                out = base;
            }
        }
        else {
            out = base;
        }
    }
    else if (typeof value === 'string') {
        out = value.trim();
    }
    else if (value && typeof value === 'object') {
        if (typeof value.stage === 'string' && value.stage.trim() !== '' && typeof value.code === 'string' && value.code.trim() !== '') {
            out = value.stage.trim() + ': ' + value.code.trim();
            if (typeof value.detail === 'string' && value.detail.trim() !== '') {
                out += ' (' + value.detail.trim() + ')';
            }
        }
        else if (typeof value.message === 'string' && value.message.trim() !== '') {
            out = value.message.trim();
        }
        else {
            try {
                out = JSON.stringify(value);
            }
            catch (ex) {
                out = String(value);
            }
        }
    }
    else if (typeof value !== 'undefined' && value !== null) {
        out = String(value);
    }

    if (out === '') {
        out = 'unknown error';
    }

    return truncateString(out, maxLength);
}

/**
 * Create a telemetry client for weather fetch events.
 *
 * @param {Object} options Telemetry client options.
 * @param {string} options.endpoint Telemetry ingest endpoint.
 * @param {string} options.appVersion App version string.
 * @param {string} options.buildProfile Build profile string.
 * @returns {{enabled: boolean, trackWeatherFetch: Function}} Telemetry client.
 */
function createTelemetryClient(options) {
    var enabled = !options || options.enabled !== false;
    var endpoint = options && typeof options.endpoint === 'string' ? options.endpoint.trim() : '';
    var appVersion = options && typeof options.appVersion === 'string' ? options.appVersion : '0.0.0';
    var buildProfile = options && typeof options.buildProfile === 'string' ? options.buildProfile : 'unknown';

    if (!enabled) {
        console.log('[telemetry] disabled by user setting');
    }
    else if (endpoint === '') {
        console.log('[telemetry] disabled (no endpoint configured)');
    }
    else {
        console.log('[telemetry] enabled endpoint=' + endpoint);
    }

    function send(payload) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', endpoint);
        xhr.setRequestHeader('Content-Type', 'application/json');
        console.log('[telemetry] sending event=' + payload.eventType + ' endpoint=' + endpoint);
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                console.log('[telemetry] sent event=' + payload.eventType + ' status=' + xhr.status);
                return;
            }
            console.log('[telemetry] non-2xx status=' + xhr.status + ' body=' + xhr.responseText);
        };
        xhr.onerror = function() {
            console.log('[telemetry] request error');
        };
        xhr.send(JSON.stringify(payload));
    }

    /**
     * Track one weather fetch attempt.
     *
     * @param {Object} event Telemetry event properties.
     * @returns {void}
     */
    function trackWeatherFetch(event) {
        var accountToken;
        var watchToken;
        var watchInfo;
        var success;
        var error;
        var attempt;

        if (!enabled || endpoint === '') {
            console.log('[telemetry] telemetry disabled');
            return;
        }

        try {
            accountToken = Pebble.getAccountToken();
        }
        catch (ex) {
            console.log('[telemetry] getAccountToken failed: ' + ex.message);
            return;
        }

        if (typeof accountToken !== 'string' || accountToken.trim() === '') {
            console.log('[telemetry] getAccountToken returned empty value');
            return;
        }

        try {
            watchToken = Pebble.getWatchToken();
        }
        catch (ex) {
            watchToken = null;
            console.log('[telemetry] getWatchToken failed: ' + ex.message);
        }

        if (typeof watchToken !== 'string' || watchToken.trim() === '') {
            watchToken = null;
        }

        watchInfo = buildWatchInfoSnapshot(event.watchInfo);
        success = Boolean(event.success);
        error = success ? null : serializeError(event.error, 512);
        attempt = (
            typeof event.attempt === 'number' &&
            isFinite(event.attempt) &&
            event.attempt >= 1
        ) ? Math.floor(event.attempt) : null;

        send({
            eventType: 'weather_fetch',
            timestampUtc: new Date().toISOString(),
            accountToken: accountToken,
            watchToken: watchToken,
            provider: event.provider,
            success: success,
            usedGpsCache: event.usedGpsCache,
            gpsErrorCode: typeof event.gpsErrorCode === 'number' ? event.gpsErrorCode : null,
            locationMode: normalizeLocationMode(event.locationMode),
            error: error,
            countryCode: normalizeCountryCode(event.countryCode),
            settings: buildSettingsSnapshot(event.settings, event.watchInfo),
            appVersion: appVersion,
            buildProfile: buildProfile,
            watchInfo: watchInfo,
            durationMs: typeof event.durationMs === 'number' ? event.durationMs : null,
            attempt: attempt
        });
    }

    return {
        enabled: enabled && endpoint !== '',
        trackWeatherFetch: trackWeatherFetch
    };
}

module.exports = createTelemetryClient;
// Exposed for unit tests; the runtime entry point is the factory above.
module.exports.buildSettingsSnapshot = buildSettingsSnapshot;
