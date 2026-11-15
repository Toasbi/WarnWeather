/**
 * Outbox with per-category dedupe.
 *
 * Payload keys are grouped into categories that match the screen areas on the
 * watch (forecast chart, status row, sun events, rain radar, sleep state, Clay
 * config). ChangeDetector checks each category's content against the
 * last-sent state cached in localStorage; only categories whose
 * content actually changed are bundled into the outgoing AppMessage. When
 * nothing changed, no message is sent at all — Bluetooth is the most
 * battery-expensive part of a fetch cycle.
 *
 * All changed categories ride in ONE Pebble.sendAppMessage call: the channel
 * is half-duplex, so back-to-back sends would collide. Each changed category's
 * cache entry is forgotten BEFORE the send and committed again only in the ACK
 * callback. A NACK or a timeout does not say the watch lacks the message (it
 * may have stored it and lost the ACK), and PKJS can be torn down mid-send
 * (the user left the watchface) with no callback at all; a cache left holding
 * the previous content would then claim the watch holds what it may not, and
 * a later payload equal to it would be skipped while the watch kept the
 * unacknowledged one. Forgotten, the next send of that category goes out
 * whatever it holds: at most one redundant send after a failure.
 *
 * Two sends of one category can be in flight at once (a status re-bake from a
 * phone-battery event or a config close beside a fetch's send), so an ACK
 * commits only the categories no later send has carried since: the older
 * send's ACK would otherwise cache content the newer one may already have
 * replaced on the watch. The send numbers live in memory, like the callbacks
 * they guard: a PKJS restart drops both.
 *
 * A weather message that goes out anyway can take fresher values along for bytes
 * only, never a wake-up: the ride-along (setRideAlong) is asked once the message is
 * known to go out, and its values join it wherever they differ from what was last
 * sent (the phone battery's exact reading, phone-battery.js statusRideAlong).
 *
 * Every compare/send cycle is reported to dev-stats as a semantic descriptor
 * (skip immediately; ack/nack from the AppMessage callbacks).
 */

var KEYS = require('../../settings/domain/storage-keys');
var ChangeDetector = require('./change-detector');
var devStats = require('../../telemetry/adapter/dev-stats');

// Numbers each send in this PKJS life (sendCount) and keeps, per cache key, the
// number of the newest send that carried its category (newestSend): an ACK
// commits a category only when its send is still that newest one.
var sendCount = 0;
var newestSend = {};

var WEATHER_CATEGORIES = require('../domain/weather-categories.js');

// The weather message's ride-along (setRideAlong), or null.
var rideAlong = null;

/**
 * Distill a comparison result into the dev-stats descriptor.
 *
 * @param {string} type 'weather' or 'setting'.
 * @param {Object} result ChangeDetector result.
 * @param {string} outcome 'ack', 'nack', or 'skip'.
 * @returns {{type: string, outcome: string, categories: Object}} Descriptor for devStats.record().
 */
function statsDescriptor(type, result, outcome) {
    var categories = {};
    result.categories.forEach(function(entry) {
        categories[entry.name] = entry.changed ? 'updated' : 'cached';
    });
    return { type: type, outcome: outcome, categories: categories };
}

/**
 * Send the changed parts of a payload as one AppMessage.
 *
 * @param {Object} payload Full candidate payload.
 * @param {Array} categories Category descriptors to dedupe against.
 * @param {string} label Log prefix ('weather' or 'clay').
 * @param {Function} [onSuccess] Called after ACK, or immediately when nothing changed.
 * @param {Function} [onFailure] Called on NACK.
 * @returns {void}
 */
function sendChangedCategories(payload, categories, label, onSuccess, onFailure) {
    var statsType = label === 'clay' ? 'setting' : 'weather';
    var detector = new ChangeDetector(categories);
    var result = detector.detect(payload);
    var changed = result.categories.filter(isChanged);
    var extra = changed.length > 0 && label === 'weather' ? askRideAlong() : null;
    if (extra) {
        // The message goes out: the ride-along's values join it, and the categories are
        // judged again on them, so one they freshen rides along where it now differs.
        result = detector.detect(Object.assign({}, payload, extra));
        changed = result.categories.filter(isChanged);
    }
    var outgoing = {};
    var changedNames = [];

    changed.forEach(function(entry) {
        var key;
        for (key in entry.subset) {
            if (Object.prototype.hasOwnProperty.call(entry.subset, key)) {
                outgoing[key] = entry.subset[key];
            }
        }
        changedNames.push(entry.name);
    });

    if (changed.length === 0) {
        console.log('Outbox: ' + label + ' unchanged, skipping send.');
        devStats.record(statsDescriptor(statsType, result, 'skip'));
        if (typeof onSuccess === 'function') {
            onSuccess();
        }
        return;
    }

    console.log('Outbox: sending ' + label + ' categories: ' + changedNames.join(', '));
    sendCount += 1;
    var sendId = sendCount;
    // From here until the ACK the watch holds either the old content or this
    // one: forget the old, so a NACK, a timeout or PKJS torn down before the
    // callback leaves no cache that claims the watch holds it.
    changed.forEach(function(entry) {
        newestSend[entry.cacheKey] = sendId;
        localStorage.removeItem(entry.cacheKey);
    });
    Pebble.sendAppMessage(outgoing, function() {
        // Commit caches only after the watch ACKed, so NACKs retry next time,
        // and only those no later send has carried since: that send may have
        // replaced this content on the watch, ACKed or not.
        changed.forEach(function(entry) {
            if (newestSend[entry.cacheKey] === sendId) {
                localStorage.setItem(entry.cacheKey, entry.serialized);
            }
        });
        devStats.record(statsDescriptor(statsType, result, 'ack'));
        console.log('Outbox: ' + label + ' sent successfully.');
        if (typeof onSuccess === 'function') {
            onSuccess();
        }
    }, function(e) {
        devStats.record(statsDescriptor(statsType, result, 'nack'));
        console.log('Outbox: ' + label + ' send failed: ' + JSON.stringify(e));
        if (typeof onFailure === 'function') {
            onFailure(e);
        }
    });
}

/**
 * @param {{changed: boolean}} entry A ChangeDetector result entry.
 * @returns {boolean} Whether its category changed.
 */
function isChanged(entry) {
    return entry.changed;
}

/**
 * The ride-along's values for a weather message that goes out, or null. One that throws
 * brings nothing: a ride-along must never cost the message it would ride.
 * @returns {?Object} AppMessage keys of weather categories.
 */
function askRideAlong() {
    if (typeof rideAlong !== 'function') { return null; }
    try {
        return rideAlong() || null;
    }
    catch (ex) {
        console.log('Outbox: ride-along failed: ' + ex.message);
        return null;
    }
}

/**
 * Register the weather message's ride-along: a function asked, once a weather message is
 * known to go out (some category changed), for fresher values of keys it carries. They
 * join the message wherever they differ from the last-sent content, as part of their
 * category, so they cost bytes and never a send of their own. index.js wires the phone
 * battery's (phone-battery.js statusRideAlong).
 *
 * @param {?function(): ?Object} fn The ride-along, or null to drop it.
 * @returns {void}
 */
function setRideAlong(fn) {
    rideAlong = typeof fn === 'function' ? fn : null;
}

/**
 * Send the changed categories of a weather payload (forecast, status, sun,
 * radar, sleep) as a single AppMessage; skip the send when nothing changed.
 *
 * @param {Object} payload Full weather payload (radar/sleep keys optional).
 * @param {Function} [onSuccess] Called after ACK, or immediately when nothing changed.
 * @param {Function} [onFailure] Called on NACK.
 * @returns {void}
 */
function sendWeather(payload, onSuccess, onFailure) {
    sendChangedCategories(payload, WEATHER_CATEGORIES, 'weather', onSuccess, onFailure);
}

/**
 * Send a Clay settings payload, skipping the send when it matches the last
 * ACKed one.
 *
 * @param {Object} payload Clay settings payload.
 * @param {Function} [onSuccess] Called after ACK, or immediately when nothing changed.
 * @param {Function} [onFailure] Called on NACK.
 * @returns {void}
 */
function sendClay(payload, onSuccess, onFailure) {
    var clayCategory = {
        name: 'clay',
        cacheKey: KEYS.LAST_SENT_CLAY_KEY,
        keys: Object.keys(payload)
    };
    sendChangedCategories(payload, [clayCategory], 'clay', onSuccess, onFailure);
}

/**
 * Forget all last-sent weather categories so the next fetch resends
 * everything. Used when the watch reports it has no (or stale) forecast data.
 *
 * @returns {void}
 */
function clearWeatherCaches() {
    WEATHER_CATEGORIES.forEach(function(category) {
        localStorage.removeItem(category.cacheKey);
    });
}

/**
 * Forget the last-sent Clay settings so the next Clay send goes through.
 * Used when the watch reports it has no persisted config.
 *
 * @returns {void}
 */
function clearClayCache() {
    localStorage.removeItem(KEYS.LAST_SENT_CLAY_KEY);
}

/**
 * Forget the last-sent notice so the next notice send goes through even when its
 * text is unchanged (a recurring identical error after a success must re-notify).
 *
 * @returns {void}
 */
function clearNoticeCache() {
    localStorage.removeItem(KEYS.LAST_SENT_NOTICE_KEY);
}

module.exports = {
    // Read-only contract: shared by reference (change-detector + tests). Consumers
    // must not mutate the category descriptors. No defensive copy — nothing mutates
    // them, so it would only add code (a manual deep clone, since PKJS on aplite is ES5).
    WEATHER_CATEGORIES: WEATHER_CATEGORIES,
    sendWeather: sendWeather,
    sendClay: sendClay,
    setRideAlong: setRideAlong,
    clearWeatherCaches: clearWeatherCaches,
    clearClayCache: clearClayCache,
    clearNoticeCache: clearNoticeCache
};
