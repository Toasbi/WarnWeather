// src/pkjs/clay-migrations.js
//
// The migration runner: runs the ledger in migrations/registry.js over the stored Clay
// blob, once per boot (index.js's ready handler, right after seedDefaults). Each entry's
// order, marker policy and body live under migrations/; this file is only the loop.
//
// The dependency on clay-settings.js, which owns the blob, is one-way: this module reads
// and writes THROUGH it, and clay-settings knows nothing about the ledger ("Reset
// watchface" hands resetAll RESET_SAFE_MARKERS from here). So the ledger can keep
// growing without the owner module growing with it.
//
// One boot's pass: parse the blob once, run every entry whose marker is unset over that
// one object in registry order, save once if any entry changed it, set the markers due
// now, and hold back the 'ack' markers of the entries that asked for a send. A body that
// throws aborts the pass before the save, so the next boot re-runs it from the same
// stored blob.
//
// THE SCHEDULER DEPENDENCY. A 'now' entry that asks for a send (the no-rain text, the
// 1.24.0 alert levels) is marked before that send can land, so a NACK does not re-run
// it. Its re-delivery is channel-scheduler.js's: the migration send's NACK, like every
// scheduler Clay NACK, runs forgetHolidayDaySent (its sendClay wrapper), which drops
// the stored day stamp, so the next tick's day-change resend (this session's, or the
// next boot's first) carries the settings again, once a minute until one is ACKed; and
// the outbox commits its last-sent cache only on an ACK, so that send still sees the
// change. Stop forgetting the day stamp on that NACK and those entries have to move to
// markOn 'ack'.

var claySettings = require('./clay-settings.js');
var REGISTRY = require('./migrations/registry.js');

/**
 * @param {string[]} keys Marker keys to set.
 * @returns {void}
 */
function markAll(keys) {
    for (var i = 0; i < keys.length; i++) {
        localStorage.setItem(keys[i], '1');
    }
}

/**
 * Run every ledger entry whose marker is unset, in registry order.
 *
 * @param {{platform: string, colors: Object, defaultRadarProvider: string,
 *   hadExistingInstall: boolean}} opts The ctx every body gets.
 *   platform: watch platform, for the status-line health defaults; colors: the
 *   DEFAULT_HOLIDAY_COLORS bundle; defaultRadarProvider: the radarMode move's
 *   fallback; hadExistingInstall: whether a settings blob was stored BEFORE this
 *   boot's seedDefaults (claySettings.hasStored()), the fresh-vs-existing signal.
 * @param {{only: string}} [filter] Tests: run just the entry with this marker key.
 * @returns {{clayRequired: boolean, commitDeferredMarkers: Function}} clayRequired: an
 *   entry asked for a Clay send. commitDeferredMarkers sets the markers of the 'ack'
 *   entries that did; index.js hands it to the scheduler as onClayAck.
 */
function runMigrations(opts, filter) {
    var only = filter ? filter.only : null;
    var result = { clayRequired: false, commitDeferredMarkers: function () {} };
    var pending = [];
    var i;

    for (i = 0; i < REGISTRY.length; i++) {
        if ((!only || REGISTRY[i].key === only) && localStorage.getItem(REGISTRY[i].key) === null) {
            pending.push(REGISTRY[i]);
        }
    }
    if (pending.length === 0) { return result; }

    var blob = claySettings.read();
    // index.js seeds a well-formed blob first; this only guards a store without one.
    if (blob === null || typeof blob !== 'object') {
        console.log('No readable clay settings, skipping the migrations');
        return result;
    }

    var ctx = {
        platform: opts.platform,
        colors: opts.colors,
        defaultRadarProvider: opts.defaultRadarProvider,
        hadExistingInstall: Boolean(opts.hadExistingInstall)
    };
    var changed = false;
    var markNow = [];
    var markOnAck = [];
    for (i = 0; i < pending.length; i++) {
        var r = pending[i].run(blob, ctx);
        changed = changed || r.changed;
        if (r.send) { result.clayRequired = true; }
        if (r.send && pending[i].markOn === 'ack') {
            markOnAck.push(pending[i].key);
        } else {
            markNow.push(pending[i].key);
        }
    }

    if (changed) { claySettings.save(blob); }
    markAll(markNow);
    result.commitDeferredMarkers = function () { markAll(markOnAck); };
    return result;
}

// The markers "Reset watchface" sets after its wipe (the registry's markOnReset).
var RESET_SAFE_MARKERS = [];
for (var k = 0; k < REGISTRY.length; k++) {
    if (REGISTRY[k].markOnReset) { RESET_SAFE_MARKERS.push(REGISTRY[k].key); }
}

module.exports = {
    runMigrations: runMigrations,
    RESET_SAFE_MARKERS: RESET_SAFE_MARKERS
};
