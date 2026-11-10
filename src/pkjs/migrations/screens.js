// src/pkjs/migrations/screens.js
//
// The 2.6.0 move onto screens. Registry body (migrations/registry.js): run(blob, ctx) ->
// {changed, send}, mutating the blob in place; the runner in clay-migrations.js owns the
// marker, the save and the send.
//
// 2.6 edits each screen as a list (screens.js) stored as the custom layout's per-view keys,
// works radarMode and healthMode out from the screens (screens.js deriveModes) and keeps the
// rain radar's Off apart from its source (radarEnabled). This entry moves an install onto
// that shape without changing what its watch shows:
//   - radarEnabled: on unless radarMode was 'off', so radarProvider stays the source.
//   - The layout: a preset becomes the custom keys of its own cycle (view-cycle.js
//     specToKeys, which compiles back byte for byte); a custom layout is rewritten to the
//     views 2.5 drew (legacyCycle), so a seat its modes folded away does not come back once
//     the modes follow the screens. aplite keeps its layout as it is: it folds a custom layout
//     to Compact calendar (view-cycle.js resolveViewCycle) and draws no health. A watch that
//     did not say what it is might be an aplite, so it keeps a preset (the settings page reads
//     a preset as screens all the same, screens.js screensOf, and its Save stores them); its
//     custom layout, whose keys aplite never reads, is rewritten all the same.
//   - The modes, derived from the screens as 2.6.0 derived them (modesOf26; not on an unknown
//     watch: its page's Save works them out). Where the screens cannot tell two modes apart
//     (nothing on them shows a health item, or the rain alert), the install keeps the one it
//     had: 'slot' rather than 'off', 'countdown' rather than 'off'.
//   - With healthMode 'off', 2.5 drew a health item in a status slot as an empty slot
//     (status-line-catalog.js itemAvailable); such a slot on a bar 2.5 drew is stored as
//     Empty, so the derived modes do not bring it back, on an unknown watch too.

var VC = require('../view-cycle.js');
var screens = require('../screens.js');
var catalog = require('../status-line-catalog.js');
var platformLib = require('../config-ui/lib/platform.js');

/**
 * The views a 2.5 watch drew for a custom layout: buildCustomCycle with the Radar bar
 * folded away outside radarMode 'status' and 'graph' and the Health bar outside healthMode
 * 'status' and 'all', as 2.5's compiler folded them (since 2.6 the Radar bar and since 3.0
 * the Health bar no longer need their data, view-cycle.js), the surviving lower row taking
 * the upper seat under the legacy order, and a flick view left with nothing on it disabled.
 * @param {Object} S Settings (layoutPreset 'custom').
 * @returns {Array<?Object>} the views
 */
function legacyCycle(S) {
    var cycle = VC.buildCustomCycle(S);
    var folded = [];
    if (VC.RADAR_ROW_MODES.indexOf(S.radarMode || 'graph') < 0) { folded.push(VC.STATUS_SRC_RADAR); }
    if (VC.HEALTH_ROW_MODES.indexOf(S.healthMode || 'off') < 0) { folded.push(VC.STATUS_SRC_HEALTH); }
    if (!folded.length) { return cycle; }
    return cycle.map(function (v) {
        if (!v) { return v; }
        var s = VC.cloneSpec(v);
        if (folded.indexOf(s.statusLower) >= 0) { s.statusLower = VC.STATUS_SRC_NONE; }
        if (folded.indexOf(s.statusUpper) >= 0) {
            s.statusUpper = VC.STATUS_SRC_NONE;
            if (!s.order && s.statusLower !== VC.STATUS_SRC_NONE) {
                s.statusUpper = s.statusLower;
                s.statusLower = VC.STATUS_SRC_NONE;
            }
        }
        if (s.clockOff && s.top === VC.TOP_EMPTY && s.body === VC.BODY_NONE
                && s.statusUpper === VC.STATUS_SRC_NONE && s.statusLower === VC.STATUS_SRC_NONE) {
            return null;
        }
        return s;
    });
}

/**
 * The custom keys of a cycle (view-cycle.js specToKeys), a disabled view's too: nothing on
 * it, its Watch bar as stored.
 * @param {Array<?Object>} cycle The views.
 * @param {Object} S Settings (a disabled view's stored viewStripOff).
 * @returns {Object} key -> value
 */
function keysOf(cycle, S) {
    var empty = VC.spec(VC.TIER_NONE, VC.TOP_EMPTY, VC.BODY_NONE, VC.STATUS_SRC_NONE, VC.STATUS_SRC_NONE);
    empty.clockOff = true;
    var keys = VC.specToKeys(cycle.map(function (v) { return v || empty; }));
    for (var i = 0; i < cycle.length; i++) {
        if (!cycle[i]) { keys['viewStripOff' + i] = Boolean(S['viewStripOff' + i]); }
    }
    return keys;
}

/**
 * Store an Empty in every status slot of a drawn bar that holds a health item: what 2.5
 * drew there while healthMode was 'off'.
 * @param {Object} blob Settings, mutated.
 * @param {{top: boolean, forecast: boolean, radar: boolean, health: boolean}} bars The bars
 *   2.5 drew (view-cycle.js barsIn of its views).
 * @param {Object} env Platform env.
 * @returns {boolean} whether a slot changed
 */
function emptyHealthSlots(blob, bars, env) {
    var changed = false;
    catalog.LINES.forEach(function (line) {
        if (!bars[line.id]) { return; }
        catalog.healthSlots(blob, line.id, env).forEach(function (key) {
            blob[key] = 'empty';
            changed = true;
        });
    });
    return changed;
}

/**
 * The modes 2.6.0 worked out for the screens: screens.js deriveModes, plus 2.6's rule that a
 * screen showing the Radar bar or the Health bar needs 'status' (unless it shows that graph).
 * Since 3.0.0's named bars a custom layout's bars need no mode, but the move keeps what it
 * sent 2.6's way, so a 2.5 install is sent nothing new; its next Save works the modes out.
 * @param {Object} blob Settings (a custom layout).
 * @param {Object} env Platform env.
 * @returns {{radarMode: string, healthMode: string}}
 */
function modesOf26(blob, env) {
    var modes = screens.deriveModes(blob, env);
    var shown = VC.barsShown(blob, env);
    if (shown.radar && env.radar !== false && blob.radarEnabled !== false && modes.radarMode !== 'graph') {
        modes.radarMode = 'status';
    }
    if (shown.health && env.health !== false && modes.healthMode !== 'all') { modes.healthMode = 'status'; }
    return modes;
}

/**
 * The CLAY_VIEW words and the two modes the settings send, to tell whether the move needs a
 * send.
 * @param {Object} S Settings.
 * @param {Object} env Platform env.
 * @returns {string} a comparable fingerprint
 */
function wireOf(S, env) {
    return VC.resolveViewCycle(S, env).map(function (v) { return VC.packWire(v || null); }).join(',')
        + '|' + (S.radarMode || 'graph') + '|' + (S.healthMode || 'off');
}

/**
 * The 2.6.0 move onto screens (see the file header).
 * @param {Object} blob Stored settings, mutated in place.
 * @param {{knownPlatform: string}} ctx Runner context: the watch's platform, '' when the
 *   watch did not say.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateToScreens(blob, ctx) {
    var oldRadar = blob.radarMode || 'graph';
    var oldHealth = blob.healthMode || 'off';
    var before = JSON.stringify(blob);
    // seedDefaults has already backfilled the new key's default (on); this sets it once.
    blob.radarEnabled = oldRadar !== 'off';
    var platform = (ctx && ctx.knownPlatform) || '';
    if (platform === 'aplite') {
        return { changed: JSON.stringify(blob) !== before, send: false };
    }
    // A watch that did not say reads capable (platform.js computeEnv).
    var env = platformLib.computeEnv({ platform: platform });
    var wireBefore = wireOf(blob, env);
    var custom = blob.layoutPreset === 'custom';
    // The views 2.5 drew: a custom layout as its modes folded it, a preset as its cycle.
    var cycle = custom ? legacyCycle(blob) : VC.resolveViewCycle(blob, env);
    if (oldHealth === 'off') { emptyHealthSlots(blob, VC.barsIn(cycle), env); }
    if (!platform) {
        // It might be an aplite: a preset stays one, and the modes stay too (see the header).
        if (custom) { Object.assign(blob, keysOf(cycle, blob)); }
        return { changed: JSON.stringify(blob) !== before, send: wireOf(blob, env) !== wireBefore };
    }
    Object.assign(blob, keysOf(cycle, blob));
    blob.layoutPreset = 'custom';
    blob.customLayoutSeeded = true;
    var modes = modesOf26(blob, env);
    if (modes.healthMode === 'off' && oldHealth === 'slot') { modes.healthMode = 'slot'; }
    if (modes.radarMode === 'off' && oldRadar === 'countdown' && blob.radarEnabled) {
        modes.radarMode = 'countdown';
    }
    blob.radarMode = modes.radarMode;
    blob.healthMode = modes.healthMode;
    return { changed: JSON.stringify(blob) !== before, send: wireOf(blob, env) !== wireBefore };
}

module.exports = {
    migrateToScreens: migrateToScreens,
    legacyCycle: legacyCycle
};
