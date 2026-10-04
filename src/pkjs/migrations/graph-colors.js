// src/pkjs/migrations/graph-colors.js
//
// The 1.15.x graph-colour migrations. Registry bodies (migrations/registry.js):
// run(blob, ctx) -> {changed, send}, mutating the blob in place; the runner in
// clay-migrations.js owns the marker, the save and the send.

var lineStyle = require('../line-style');   // graph-colour keys + built-ins

/**
 * One-time forced Clay resend for the 1.15.0 graph colours. It migrates NO
 * stored value — its only job is to make one Clay send happen on the first boot
 * after the upgrade.
 *
 * 1.15.0 grew CLAY_LINE_STYLE_UINT8 from 4 to 10 bytes and the watch now reads
 * its night-area colours from the persist key that tuple writes (NIGHT_COLORS,
 * absent = the built-in precip triple). An IN-PLACE upgrade keeps the watch's
 * CONFIG persist, so the startup handshake reports hasConfig true and the
 * scheduler queues no Clay send; nothing else heals it either (the legacy
 * holiday migrations are long since marked, the holiday day stamp is already
 * today's, and showConfiguration does not send Clay). Without this, a colour
 * watch on dark polarity with day/night shading + fill on and a
 * wind/uv/gust/pressure main metric paints a precip-blue night area until the
 * settings page is opened and SAVED, or the local day rolls over.
 *
 * The change-detector still transmits when this fires: the phone's last-sent
 * cache holds the OLD 4-byte tuple and the new payload is 10 bytes.
 *
 * @returns {{changed: boolean, send: boolean}} Always a send, never a change.
 */
function migrateGraphNightColorsResend() {
    console.log('Forcing one Clay resend so the watch gets the graph night colours');
    return { changed: false, send: true };
}

/**
 * Un-carry a graph night tint that the 1.15.0 settings page wrote into the
 * tint key on the user's behalf.
 *
 * 1.15.0 shipped the fill -> tint cascade as a PAGE-SIDE write: its
 * `graphFillTint` onChange hook did `S[gc<Metric>Night<Pol>] = newFill` on every
 * fill pick whose tint was still unclaimed, and line-style.js then recognised
 * the carry by comparing the two stored values ("night equals fill" meant "not a
 * pick"). The cascade has since moved to RESOLVE time (line-style.js'
 * graphNightTint), which makes a stored tint mean exactly one thing — the user
 * chose it — and that is what makes a tint deliberately set equal to its fill
 * answerable at all. Every 1.15.0 install that ever used a metric's fill picker
 * has the carried bytes on flash, and under the new reading they are a pick:
 *
 *   - the wire's night-fill flag (byte [9] bit 0) would flip 0 -> 1, and on a
 *     COLOUR watch with a light theme and the secondary fill on that bit is the
 *     opt-in forecast_layer.c uses to draw the night re-shade 1.15.0 skipped;
 *   - graphNightTint would answer from the tint key forever, so changing the
 *     fill would leave the night hours painted in the fill colour the user just
 *     replaced — the exact failure the cascade exists to prevent;
 *   - telemetry would report those carried colours as picks.
 *
 * So a stored tint that still equals its stored fill goes back to the built-in.
 * The resolve-time cascade then re-derives the same triple from the fill with
 * the flag clear, which is byte-for-byte what 1.15.0 sent. A tint the user set
 * equal to the fill BY HAND is cleared too — indistinguishable by construction,
 * and 1.15.0 painted the two identically anyway, so clearing it is the
 * appearance-preserving choice.
 *
 * One shape is not restored byte-for-byte: a fill picked to the metric's OWN
 * built-in fill colour (e.g. precip + CobaltBlue). 1.15.0 stored that in the
 * tint key too, where it was not precip's night built-in, so it derived a
 * lightened night triple; with the tint cleared both keys read as built-in and
 * the hand-tuned triple stands. The flag still stays 0, and the result is what a
 * fresh install with those same settings paints.
 *
 * No Clay resend is asked for: the healed blob packs the bytes the watch is
 * already holding, so there is nothing to transmit. The narrow shape above does
 * change the tuple, and the change-detector sends that on its own.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateCarriedGraphNightTints(blob) {
    var metrics = lineStyle.GRAPH_METRICS;
    var changed = false;
    var polarities = ['Dark', 'Light'];
    var i, j, metric, suffix, nightKey, night, fill;

    for (i = 0; i < metrics.length; i++) {
        metric = metrics[i];
        // feels is Line-only, so it owns neither key (graphColorRoles).
        if (lineStyle.graphColorRoles(metric).indexOf('Night') === -1) { continue; }
        for (j = 0; j < polarities.length; j++) {
            suffix = polarities[j];
            nightKey = lineStyle.graphColorKey(metric, 'Night', suffix);
            night = lineStyle.colorPick(blob[nightKey]);
            // Already on the built-in: nothing was carried into it.
            if (night === null
                || lineStyle.graphColorIsDefault(blob, metric, 'Night', suffix)) {
                continue;
            }
            fill = lineStyle.colorPick(blob[lineStyle.graphColorKey(metric, 'Fill', suffix)]);
            if (fill === null || fill !== night) { continue; }
            // The INT form, like the schema defaults: parseResponse stores ints.
            blob[nightKey] = lineStyle.graphColorDefault(metric, 'Night', suffix, blob);
            changed = true;
        }
    }

    if (changed) {
        console.log('Released graph night tints the 1.15.0 page carried from their fill');
    }
    return { changed: changed, send: false };
}

module.exports = {
    migrateGraphNightColorsResend: migrateGraphNightColorsResend,
    migrateCarriedGraphNightTints: migrateCarriedGraphNightTints
};
