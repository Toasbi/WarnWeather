var statusCatalog = require('./status-line-catalog.js');
var configUi = require('./config-ui');          // intToHex
// renderContext / graphColorKey / graphColorIsDefault — the module that resolves the graph
// colours for the WIRE, so this snapshot reports what the watch actually paints instead
// of a second opinion about it.
var lineStyle = require('./line-style.js');
var viewCycle = require('./view-cycle.js');

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
 * exactly that distinction. The judgement is line-style.graphColorIsPicked's, not a hex
 * comparison here: it is the same predicate the wire's night-fill flag uses, so telemetry
 * cannot call a value chosen that the wire is still resolving for the user. Two colours
 * read as untouched despite holding a concrete value: gust's dark line, where EITHER
 * built-in (White, LightGray) counts because the painted one follows rainBarColor, and a
 * metric's night tint while it is still the fill colour the settings page carried into it.
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
    // graphColorIsPicked answers FALSE for an absent or unparseable value as well as for
    // one still equal to the built-in, so the other arm always has a real int to format.
    if (!lineStyle.graphColorIsPicked(settings, scope, role, suffix)) {
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
    // Custom-layout usage: the three packed CLAY_VIEW values fully describe what a
    // custom user built (elements, seats, order, clock/strip omissions) in 3 ints.
    // null (-> absent fields) unless custom is active, so preset rows stay unchanged.
    var customPacked = safe.layoutPreset === 'custom'
        ? viewCycle.buildCustomCycle(safe).map(viewCycle.packSpec) : null;
    var snapshot = {
        temperatureUnits: safe.temperatureUnits,
        tempSlotDisplay: safe.tempSlotDisplay,
        // The date slot's two format picks (edit sheet), raw like tempSlotDisplay.
        // dateSlotFullFormat is wizard-seeded per country ('slash' for US installs,
        // 'auto' elsewhere), so a present value does NOT mean the user opened the
        // sheet — and a stored 'auto' is indistinguishable from untouched. Only
        // dateSlotMonthFormat stays absent until the sheet is first saved.
        dateSlotMonthFormat: safe.dateSlotMonthFormat,
        dateSlotFullFormat: safe.dateSlotFullFormat,
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
        // Lockstep with the Deno telemetry-ingest .strip() schema — deploy the
        // function BEFORE the app ships, or these fields are silently dropped.
        customView0: customPacked ? customPacked[0] : undefined,
        customView1: customPacked ? (customPacked[1] || 0) : undefined,
        customView2: customPacked ? (customPacked[2] || 0) : undefined,
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

// --- batching ----------------------------------------------------------------
// One event used to mean one POST — ~59 edge-function invocations per watch per
// day (30-min fetches) against Supabase's 500k/month cap, and telemetry was 61%
// of the burn. Events now queue in localStorage as SLIM records and drain as ONE
// batch request when the queue is full enough or its head old enough (~2 flushes
// per watch per day). The heavy shared header (settings snapshot, watchInfo,
// version) is captured once at flush time — the rollup only ever reads the
// NEWEST settings per watch (telemetry_rollup_and_prune), so per-event snapshots
// bought nothing. The ingest keeps accepting the old single-event shape from
// app versions in the field; this client only sends batches.
var storageKeys = require('./storage-keys.js');

var TELEMETRY_FLUSH_AT_EVENTS = 24;                    // ~12 h at the 30-min default
var TELEMETRY_FLUSH_AT_AGE_MS = 12 * 60 * 60 * 1000;   // slow-interval watches still flush
var TELEMETRY_MAX_QUEUE_EVENTS = 200;                  // localStorage bound; oldest dropped
var TELEMETRY_MAX_BATCH_EVENTS = 50;                   // ingest's z.array max — keep lockstep
var TELEMETRY_MAX_EVENT_AGE_MS = 72 * 60 * 60 * 1000;  // ingest clamps received_at to now-72h
// After a retryable failure (5xx / 429 / network), no flush attempt for this
// long. Without it, a queue past the count trigger retried on EVERY track — one
// POST per fetch, the exact per-fetch invocation rate batching exists to kill,
// aimed at an endpoint that is already down.
var TELEMETRY_RETRY_BACKOFF_MS = 60 * 60 * 1000;

// MODULE scope, not per-client: the webviewclosed handler recreates the client
// (index.js), and a per-client latch would let the new client re-POST the head
// the old client's still-in-flight XHR already carries — duplicate rows AND a
// double head-removal. PKJS module state lives exactly as long as any XHR can,
// so one latch here covers every client the session creates.
var telemetryFlushInFlight = false;
var telemetryNextFlushEarliest = 0;
// Per-session tail for record ids: t alone can collide when two fetches land in
// the same millisecond, and the ACK removes records BY id.
var telemetryIdSeq = 0;

/**
 * Read the pending-event queue; a missing or corrupt blob is an empty queue.
 * @returns {Object[]} Slim event records, oldest first.
 */
function readTelemetryQueue() {
    try {
        var parsed = JSON.parse(localStorage.getItem(storageKeys.TELEMETRY_QUEUE_KEY));
        return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
    }
    catch (ex) {
        return [];
    }
}

/**
 * Persist the pending-event queue.
 * @param {Object[]} queue Slim event records, oldest first.
 * @returns {void}
 */
function writeTelemetryQueue(queue) {
    try {
        localStorage.setItem(storageKeys.TELEMETRY_QUEUE_KEY, JSON.stringify(queue));
    }
    catch (ex) {
        console.log('[telemetry] queue write failed: ' + ex.message);
    }
}

/**
 * Remove the given record ids from the stored queue. Removal is BY IDENTITY,
 * never by count: while a batch is in flight the queue can be rewritten under
 * it (a track appending, the 200-cap dropping head records), so "splice the
 * first N" can destroy records that were never sent.
 * @param {Object[]} sent The records that rode the batch.
 * @returns {void}
 */
function removeTelemetryRecords(sent) {
    var ids = {};
    var i;
    for (i = 0; i < sent.length; i += 1) { ids[sent[i].id] = true; }
    writeTelemetryQueue(readTelemetryQueue().filter(function(rec) {
        return !(rec && ids[rec.id] === true);
    }));
}

/**
 * Read the crashed-mid-send marker ({ids: [...]}), or null.
 * @returns {?Object} Marker, or null when absent/corrupt.
 */
function readTelemetrySendingMark() {
    try {
        var parsed = JSON.parse(localStorage.getItem(storageKeys.TELEMETRY_SENDING_KEY));
        return (parsed && Object.prototype.toString.call(parsed.ids) === '[object Array]')
            ? parsed : null;
    }
    catch (ex) {
        return null;
    }
}

/**
 * Write or clear the mid-send marker.
 * @param {?Object[]} sent Records about to ride a batch, or null to clear.
 * @returns {void}
 */
function writeTelemetrySendingMark(sent) {
    try {
        if (!sent) {
            localStorage.removeItem(storageKeys.TELEMETRY_SENDING_KEY);
            return;
        }
        var ids = [];
        var i;
        for (i = 0; i < sent.length; i += 1) { ids.push(sent[i].id); }
        localStorage.setItem(storageKeys.TELEMETRY_SENDING_KEY, JSON.stringify({ ids: ids }));
    }
    catch (ex) {
        console.log('[telemetry] sending-mark write failed: ' + ex.message);
    }
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
    // The freshest header context, refreshed on every track call: PKJS is torn
    // down between watchface sessions, but a flush only ever runs FROM a track
    // call, so this is always populated when the batch is built.
    var lastSettingsSnapshot = null;
    var lastWatchInfoSnapshot = null;

    if (!enabled || endpoint === '') {
        console.log(!enabled
            ? '[telemetry] disabled by user setting'
            : '[telemetry] disabled (no endpoint configured)');
        // A queue from an earlier enabled session must not sit in localStorage
        // indefinitely — the user turned reporting off (or the build carries no
        // endpoint), so pending events are purged, not parked.
        try {
            localStorage.removeItem(storageKeys.TELEMETRY_QUEUE_KEY);
            localStorage.removeItem(storageKeys.TELEMETRY_SENDING_KEY);
        }
        catch (exPurge) {
            console.log('[telemetry] queue purge failed: ' + exPurge.message);
        }
    }
    else {
        console.log('[telemetry] enabled endpoint=' + endpoint);
    }

    /**
     * POST one batch; the callback reports 'sent' | 'drop' | 'retry'.
     * @param {Object} payload Batch envelope.
     * @param {function(string): void} onOutcome Outcome callback.
     * @returns {void}
     */
    function sendBatch(payload, onOutcome) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', endpoint);
        xhr.setRequestHeader('Content-Type', 'application/json');
        console.log('[telemetry] sending batch events=' + payload.events.length);
        xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
                console.log('[telemetry] batch sent status=' + xhr.status);
                onOutcome('sent');
                return;
            }
            console.log('[telemetry] non-2xx status=' + xhr.status + ' body=' + xhr.responseText);
            // A 4xx is terminal — the same payload would fail identically, and
            // retrying poison events forever wedges the queue (the old client's
            // "nothing retries a 400" rule). 429 is the one retryable 4xx.
            onOutcome((xhr.status >= 400 && xhr.status < 500 && xhr.status !== 429)
                ? 'drop' : 'retry');
        };
        xhr.onerror = function() {
            console.log('[telemetry] request error');
            onOutcome('retry');
        };
        xhr.send(JSON.stringify(payload));
    }

    /**
     * Drain the queue head as one batch when it is full enough or old enough.
     * @returns {void}
     */
    function maybeFlush() {
        if (telemetryFlushInFlight) { return; }
        var now = Date.now();
        if (now < telemetryNextFlushEarliest) { return; }   // backing off a failed send
        // A sending-mark with no in-flight batch in THIS session means a
        // previous session died between send and ACK — outcome unknown. Drop
        // the marked records rather than resend (see TELEMETRY_SENDING_KEY).
        var mark = readTelemetrySendingMark();
        if (mark) {
            var markedIds = {};
            var m;
            for (m = 0; m < mark.ids.length; m += 1) { markedIds[mark.ids[m]] = true; }
            writeTelemetryQueue(readTelemetryQueue().filter(function(rec) {
                return !(rec && markedIds[rec.id] === true);
            }));
            writeTelemetrySendingMark(null);
        }
        // Stale events (a watchface unused for days) are dropped, not sent: the
        // ingest clamps received_at to now-72h, and clamped rows would land in
        // the wrong day's DAU. Written back only when something was actually
        // dropped — this runs on every track.
        var stored = readTelemetryQueue();
        var queue = stored.filter(function(ev) {
            return ev && typeof ev.t === 'number' && now - ev.t <= TELEMETRY_MAX_EVENT_AGE_MS;
        });
        if (queue.length !== stored.length) { writeTelemetryQueue(queue); }
        if (queue.length === 0) { return; }
        var headAge = now - queue[0].t;
        if (queue.length < TELEMETRY_FLUSH_AT_EVENTS && headAge < TELEMETRY_FLUSH_AT_AGE_MS) {
            return;
        }

        var accountToken;
        var watchToken;
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
        catch (ex2) {
            watchToken = null;
            console.log('[telemetry] getWatchToken failed: ' + ex2.message);
        }
        if (typeof watchToken !== 'string' || watchToken.trim() === '') {
            watchToken = null;
        }

        var events = queue.slice(0, TELEMETRY_MAX_BATCH_EVENTS);
        telemetryFlushInFlight = true;
        writeTelemetrySendingMark(events);
        try {
            sendBatch({
                eventType: 'weather_fetch_batch',
                accountToken: accountToken,
                watchToken: watchToken,
                appVersion: appVersion,
                buildProfile: buildProfile,
                watchInfo: lastWatchInfoSnapshot || {},
                settings: lastSettingsSnapshot || {},
                events: events
            }, function(outcome) {
                telemetryFlushInFlight = false;
                writeTelemetrySendingMark(null);
                if (outcome === 'retry') {
                    // Endpoint down or throttling: hold off instead of retrying
                    // on every subsequent track (which would restore the old
                    // one-POST-per-fetch rate against a struggling backend).
                    telemetryNextFlushEarliest = Date.now() + TELEMETRY_RETRY_BACKOFF_MS;
                    return;
                }
                // 'sent' and 'drop' both remove exactly the records that were
                // posted — by id, never by position (see removeTelemetryRecords).
                removeTelemetryRecords(events);
            });
        }
        catch (exSend) {
            // A synchronous XHR failure must not leave the latch stuck for the
            // whole session, nor propagate into the fetch callback chain.
            telemetryFlushInFlight = false;
            writeTelemetrySendingMark(null);
            telemetryNextFlushEarliest = Date.now() + TELEMETRY_RETRY_BACKOFF_MS;
            console.log('[telemetry] send threw: ' + exSend.message);
        }
    }

    /**
     * Track one weather fetch attempt: enqueue a slim record and flush when due.
     *
     * @param {Object} event Telemetry event properties.
     * @returns {void}
     */
    function trackWeatherFetch(event) {
        if (!enabled || endpoint === '') {
            console.log('[telemetry] telemetry disabled');
            return;
        }

        var success = Boolean(event.success);
        var attempt = (
            typeof event.attempt === 'number' &&
            isFinite(event.attempt) &&
            event.attempt >= 1
        ) ? Math.floor(event.attempt) : null;

        // Normalized at QUEUE time so the flush is a dumb envelope-builder and a
        // record is immutable once stored. The id is what the ACK removes by
        // (t alone collides when two fetches land in one millisecond); the
        // ingest's zod schema strips it from the wire.
        var trackNow = Date.now();
        telemetryIdSeq += 1;
        var record = {
            id: trackNow.toString(36) + '.' + telemetryIdSeq,
            t: trackNow,
            provider: event.provider,
            success: success,
            error: success ? null : serializeError(event.error, 512),
            countryCode: normalizeCountryCode(event.countryCode),
            usedGpsCache: Boolean(event.usedGpsCache),
            gpsErrorCode: typeof event.gpsErrorCode === 'number' ? event.gpsErrorCode : null,
            locationMode: normalizeLocationMode(event.locationMode),
            durationMs: typeof event.durationMs === 'number' ? event.durationMs : null,
            attempt: attempt
        };
        var queue = readTelemetryQueue();
        queue.push(record);
        if (queue.length > TELEMETRY_MAX_QUEUE_EVENTS) {
            queue.splice(0, queue.length - TELEMETRY_MAX_QUEUE_EVENTS);
        }
        writeTelemetryQueue(queue);

        // Header context for the next flush — freshest wins.
        lastSettingsSnapshot = buildSettingsSnapshot(event.settings, event.watchInfo);
        lastWatchInfoSnapshot = buildWatchInfoSnapshot(event.watchInfo);

        maybeFlush();
    }

    return {
        enabled: enabled && endpoint !== '',
        trackWeatherFetch: trackWeatherFetch
    };
}

module.exports = createTelemetryClient;
// Exposed for unit tests; the runtime entry point is the factory above.
module.exports.buildSettingsSnapshot = buildSettingsSnapshot;
module.exports.TELEMETRY_BATCH = {
    FLUSH_AT_EVENTS: TELEMETRY_FLUSH_AT_EVENTS,
    FLUSH_AT_AGE_MS: TELEMETRY_FLUSH_AT_AGE_MS,
    MAX_QUEUE_EVENTS: TELEMETRY_MAX_QUEUE_EVENTS,
    MAX_BATCH_EVENTS: TELEMETRY_MAX_BATCH_EVENTS,
    MAX_EVENT_AGE_MS: TELEMETRY_MAX_EVENT_AGE_MS,
    RETRY_BACKOFF_MS: TELEMETRY_RETRY_BACKOFF_MS
};
// The flush latch and retry backoff are MODULE state (shared across the clients
// one session creates — see maybeFlush); node runs every test in one process,
// so tests reset it between harnesses.
module.exports._resetBatchStateForTests = function() {
    telemetryFlushInFlight = false;
    telemetryNextFlushEarliest = 0;
};
