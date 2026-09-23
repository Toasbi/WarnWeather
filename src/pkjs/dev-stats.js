/**
 * Dev stats: a 7-day rolling log of outbox send/skip events, recorded only
 * while the Clay "Record diagnostics" toggle is enabled. The stored event
 * shape belongs to this module: callers hand over a semantic descriptor
 * (see record()) and never construct or read the compact storage form.
 *
 * Stored event shapes:
 *   weather: { k: 'weather', t: <epoch ms>, c: {forecast: 1, sun: 0, ...}, ok: 1|0 }
 *   setting: { k: 'setting', t: <epoch ms>, sent: 1|0, ok: 1|0 }
 * `ok` is omitted when nothing was transmitted (full skip). `c` lists only
 * categories present in that payload: 1 = updated (transmitted), 0 = cached.
 *
 * The settings page never gets the raw log: summarize() hands it per-day totals
 * plus the newest events, a size bounded whatever the update interval.
 */

var KEYS = require('./storage-keys');

var MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Newest raw events handed to the settings page (see summarize()); older events
// reach it only through the per-day totals.
var PAGE_EVENT_CAP = 100;

var enabled = false;

/**
 * Read the raw event array from localStorage, tolerating corrupt JSON.
 *
 * @returns {Object[]} Stored events, oldest first (possibly empty).
 */
function readEvents() {
    var raw = localStorage.getItem(KEYS.DEV_STATS_KEY);
    var parsed;

    if (raw === null) {
        return [];
    }

    try {
        parsed = JSON.parse(raw);
    }
    catch (ex) {
        localStorage.removeItem(KEYS.DEV_STATS_KEY);
        return [];
    }

    return Array.isArray(parsed) ? parsed : [];
}

/**
 * Drop events older than the rolling window.
 *
 * @param {Object[]} events Stored events.
 * @param {number} now Epoch milliseconds.
 * @returns {Object[]} Events within the window.
 */
function prune(events, now) {
    return events.filter(function(event) {
        return Boolean(event) && typeof event.t === 'number' && now - event.t <= MAX_AGE_MS;
    });
}

/**
 * Enable or disable recording (synced from the Clay toggle).
 *
 * @param {boolean} value New enabled state.
 * @returns {void}
 */
function setEnabled(value) {
    enabled = Boolean(value);
}

/**
 * Record one outbox send/skip event.
 *
 * @param {Object} info Event descriptor.
 * @param {string} info.type 'weather' or 'setting'.
 * @param {string} info.outcome 'ack', 'nack', or 'skip' (nothing transmitted).
 * @param {Object} info.categories Map of category name to 'updated'|'cached',
 *     covering only the categories present in the payload.
 * @returns {void}
 */
function record(info) {
    var now;
    var event;
    var name;
    var anyUpdated;
    var events;

    if (!enabled) {
        return;
    }

    try {
        now = Date.now();
        event = { k: info.type, t: now };
        if (info.type === 'weather') {
            event.c = {};
            for (name in info.categories) {
                if (Object.prototype.hasOwnProperty.call(info.categories, name)) {
                    event.c[name] = info.categories[name] === 'updated' ? 1 : 0;
                }
            }
        }
        else {
            anyUpdated = false;
            for (name in info.categories) {
                if (Object.prototype.hasOwnProperty.call(info.categories, name)
                        && info.categories[name] === 'updated') {
                    anyUpdated = true;
                }
            }
            event.sent = anyUpdated ? 1 : 0;
        }
        if (info.outcome === 'ack') {
            event.ok = 1;
        }
        else if (info.outcome === 'nack') {
            event.ok = 0;
        }

        events = prune(readEvents(), now);
        events.push(event);
        localStorage.setItem(KEYS.DEV_STATS_KEY, JSON.stringify(events));
    }
    catch (ex) {
        // Recording must never break a send or its ACK handling.
        console.log('[dev-stats] record failed: ' + ex.message);
    }
}

/**
 * Read all events inside the rolling window, oldest first.
 *
 * @returns {Object[]} Pruned event array.
 */
function read() {
    return prune(readEvents(), Date.now());
}

/**
 * Zero-pad a date part to two digits.
 *
 * @param {number} value Month, day, hour or minute.
 * @returns {string} Two-digit string.
 */
function pad2(value) {
    return value < 10 ? '0' + value : String(value);
}

/**
 * The bounded view the settings page's Connection stats panel renders. The raw
 * 7-day log cost ~240 characters of the page's data: URL per event, and at a
 * 5-10 min update interval it pushed that URL past Android WebView's 2 MiB limit:
 * the settings page opened blank, and the toggle that stops recording was on it.
 * So the page gets per-day totals over the whole window plus only the newest
 * PAGE_EVENT_CAP raw events -- a size that no longer grows with the interval.
 * Days are keyed in this phone's local time, the zone the webview renders in too.
 *
 * Day shape: { d: 'MM-DD', weather: {ack, nack, skip}, setting: {ack, nack, skip},
 * cats: { <category>: {sent, cached} } }. `cats` counts every category the weather
 * events carry, leaving out rejected (nack) sends, which delivered nothing.
 *
 * @returns {{days: Object[], events: Object[], total: number}} Days and events
 *     oldest first; total is the number of events in the window.
 */
function summarize() {
    var events = read();
    var days = [];
    var byDay = {};

    events.forEach(function(ev) {
        var date = new Date(ev.t);
        var key = pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
        var bucket = byDay[key];
        var outcome = ev.ok === 1 ? 'ack' : (ev.ok === 0 ? 'nack' : 'skip');
        var name;
        var cat;

        if (!bucket) {
            bucket = {
                d: key,
                weather: { ack: 0, nack: 0, skip: 0 },
                setting: { ack: 0, nack: 0, skip: 0 },
                cats: {}
            };
            byDay[key] = bucket;
            days.push(bucket);
        }
        if (ev.k !== 'weather') {
            bucket.setting[outcome] += 1;
            return;
        }
        bucket.weather[outcome] += 1;
        if (!ev.c || outcome === 'nack') {
            return;
        }
        for (name in ev.c) {
            if (Object.prototype.hasOwnProperty.call(ev.c, name)) {
                cat = bucket.cats[name] || (bucket.cats[name] = { sent: 0, cached: 0 });
                if (ev.c[name] === 1) {
                    cat.sent += 1;
                }
                else {
                    cat.cached += 1;
                }
            }
        }
    });

    return {
        days: days,
        events: events.slice(-PAGE_EVENT_CAP),
        total: events.length
    };
}

/**
 * Discard the entire stored event log.
 *
 * @returns {void}
 */
function clear() {
    localStorage.removeItem(KEYS.DEV_STATS_KEY);
}

/**
 * Boot-time GC: rewrite the stored log without out-of-window events. record()
 * prunes only while recording is enabled, so a disabled toggle would otherwise
 * leave the last recorded window in storage forever.
 *
 * @param {number} now Epoch milliseconds.
 * @returns {void}
 */
function gc(now) {
    var events = readEvents();
    if (!events.length) { return; }
    var kept = prune(events, now);
    if (kept.length === events.length) { return; }
    if (kept.length) {
        localStorage.setItem(KEYS.DEV_STATS_KEY, JSON.stringify(kept));
    }
    else {
        localStorage.removeItem(KEYS.DEV_STATS_KEY);
    }
}

module.exports = {
    setEnabled: setEnabled,
    record: record,
    read: read,
    summarize: summarize,
    clear: clear,
    gc: gc
};
