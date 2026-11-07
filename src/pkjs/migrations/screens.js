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
//   - The layout, on a watch known not to be aplite: a preset becomes the custom keys of its
//     own cycle (view-cycle.js specToKeys, which compiles back byte for byte); a custom
//     layout is rewritten to the views 2.5 drew (legacyCycle), so a seat its modes folded
//     away does not come back once the modes follow the screens. aplite keeps its preset:
//     it folds a custom layout to Compact calendar (view-cycle.js resolveViewCycle). An
//     unknown watch keeps it too, since it might be an aplite; the settings page reads a
//     preset as screens all the same (screens.js screensOf), and its Save stores them.
//   - The modes, derived from the screens. Where the screens cannot tell two modes apart
//     (nothing on them shows a health item, or the rain alert), the install keeps the one it
//     had: 'slot' rather than 'off', 'countdown' rather than 'off'.
//   - With healthMode 'off', 2.5 drew a health item in a status slot as an empty slot
//     (status-line-catalog.js itemAvailable); such a slot on a bar a screen shows is stored
//     as Empty, so the derived modes do not bring it back.

var VC = require('../view-cycle.js');
var screens = require('../screens.js');
var catalog = require('../status-line-catalog.js');
var platformLib = require('../config-ui/lib/platform.js');

/**
 * The views a 2.5 watch drew for a custom layout: buildCustomCycle with the Radar bar
 * folded away outside radarMode 'status' and 'graph', as 2.5's compiler folded it (since 2.6
 * the bar no longer needs the radar, view-cycle.js), the surviving lower row taking the upper
 * seat under the legacy order, and a flick view left with nothing on it disabled.
 * @param {Object} S Settings (layoutPreset 'custom').
 * @returns {Array<?Object>} the views
 */
function legacyCycle(S) {
    var cycle = VC.buildCustomCycle(S);
    if (VC.RADAR_ROW_MODES.indexOf(S.radarMode || 'graph') >= 0) { return cycle; }
    return cycle.map(function (v) {
        if (!v) { return v; }
        var s = VC.cloneSpec(v);
        if (s.statusLower === VC.STATUS_SRC_RADAR) { s.statusLower = VC.STATUS_SRC_NONE; }
        if (s.statusUpper === VC.STATUS_SRC_RADAR) {
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
 * Store an Empty in every status slot of a shown bar that holds a health item: what 2.5
 * drew there while healthMode was 'off'.
 * @param {Object} blob Settings, mutated.
 * @param {Object} env Platform env.
 * @returns {boolean} whether a slot changed
 */
function emptyHealthSlots(blob, env) {
    var bars = VC.barsShown(blob, env);
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
    if (!platform || platform === 'aplite') {
        return { changed: JSON.stringify(blob) !== before, send: false };
    }
    var env = platformLib.computeEnv({ platform: platform });
    var wireBefore = wireOf(blob, env);
    var cycle = blob.layoutPreset === 'custom' ? legacyCycle(blob) : VC.resolveViewCycle(blob, env);
    Object.assign(blob, keysOf(cycle, blob));
    blob.layoutPreset = 'custom';
    blob.customLayoutSeeded = true;
    if (oldHealth === 'off') { emptyHealthSlots(blob, env); }
    var modes = screens.deriveModes(blob, env);
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
