// src/pkjs/migrations/v1_24.js
//
// The 1.24.0 alert-levels migration: one registry entry (ALERT_LEVELS_MIGRATION_KEY)
// running three value-keyed moves in order: the highlight toggles, the warn look, the
// rain window's Off. Also the body of the temperature separator's own entry
// (TEMP_SEPARATOR_BAR_MIGRATION_KEY, migrateTempSeparatorBar at the end of this file).
// A registry body (migrations/registry.js): run(blob, ctx) ->
// {changed, send}, mutating the blob in place; the runner in clay-migrations.js owns the
// marker, the save and the send.
//
// Every move keys on stored VALUES, never on a key being absent: seedDefaults runs
// before the ledger (index.js; the layoutPreset trap) and has already backfilled every
// new key with its default. Each move is idempotent over its own output. That does NOT
// make a re-run safe over settings saved on the 1.24.0 page since: a highlight switched
// off with its pair kept, a warn colour picked under the default Fill look, a goal
// colour set back to auto all look exactly like the 1.23 shapes these moves convert.
// Hence the marker string (storage-keys.js) and resetAll marking it done.

var thresholds = require('../status-thresholds.js');   // KINDS + the pair rules

/**
 * Backfill the Highlight / Goals toggles (thresh<K>On) from their pairs. Until 1.24.0
 * the toggle was page-derived state: every settings open rewrote it as "the stored
 * warn/danger pair is complete and ordered", and the phone packed the blob[0] enable
 * bit from the pair alone. From 1.24.0 on the STORED toggle owns the bit
 * (status-thresholds.js kindConfig: On === true AND an ordered pair) and the pair lives
 * on while it is off, so a blob whose toggle was never re-derived — a pair set in the
 * old text fields and settings not opened since — would silently lose its highlight.
 * For every kind with a pair (bold-only kinds have none): On := the pair is ordered,
 * the last truth the page would have shown.
 *
 * Keyed on the PAIR, never on the toggle being absent: thresh<K>On has had a schema
 * default (false) for releases, so "absent" is not observable. The pair alone tells the
 * three populations apart: highlight on (ordered pair) → true; highlight off (the old
 * OFF blanked the pair) → false; AQI's wizard-seeded highlight (100/150 or 60/80, the
 * seed the 1.23 page's switch pinned) → true. Those pins go back to blank right after,
 * in the next ledger entry (migrations/seed-pairs.js).
 *
 * A pair that is not ordered but not blank either — half ('7', '') from the old text
 * fields, inverted, junk — is normalised to '' on both keys: the phone and the page
 * already resolve it to the kind's seed as a whole (resolvedPair), while the slider
 * fell back per value and would preview 'Warn 7' against a seed-6 bake. Blank is the
 * one stored form of "the seed" from here on; no numbers are written into any blob.
 *
 * No Clay send: for every install the post-migration enable bit (On && ordered) equals
 * the pre-split one (ordered), which the watch already holds. A fresh install (blank
 * pairs, toggles false) is a no-op.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateThresholdHighlightToggles(blob) {
    var changed = false;
    for (var i = 0; i < thresholds.KINDS.length; i++) {
        var kind = thresholds.KINDS[i];
        if (kind.boldOnly) { continue; }
        var onKey = 'thresh' + kind.key + 'On';
        var warnKey = 'thresh' + kind.key + 'Warn';
        var dangerKey = 'thresh' + kind.key + 'Danger';
        var ordered = thresholds.pairOrdered(thresholds.parseThreshold(blob[warnKey]),
            thresholds.parseThreshold(blob[dangerKey]));
        // Write only when the stored value is not already the verdict. An absent
        // toggle already reads as off (kindConfig wants === true), so it is left
        // absent under an unusable pair.
        var on = blob[onKey];
        if (ordered ? on !== true : (on !== false && typeof on !== 'undefined')) {
            blob[onKey] = ordered;
            changed = true;
        }
        if (!ordered) {
            var pairKeys = [warnKey, dangerKey];
            for (var p = 0; p < pairKeys.length; p++) {
                var raw = blob[pairKeys[p]];
                // null/undefined read as blank already (parseThreshold); only a stored
                // non-blank half of an unusable pair is rewritten.
                if (raw !== '' && raw !== null && typeof raw !== 'undefined') {
                    blob[pairKeys[p]] = '';
                    changed = true;
                }
            }
        }
    }
    if (changed) {
        console.log('Migrated threshold highlight toggles from their pairs');
    }
    return { changed: changed, send: false };
}

/**
 * @param {*} v Stored colour (0xRRGGBB int or '#RRGGBB' string).
 * @returns {boolean} True for black or white — the old auto text colour.
 */
function isTextColor(v) {
    if (typeof v === 'number') { return v === 0x000000 || v === 0xFFFFFF; }
    if (typeof v !== 'string') { return false; }
    var u = v.toUpperCase();
    return u === '#000000' || u === '#FFFFFF';
}

/**
 * Move the retired 'Outline on warn' / 'Outline on close' toggle
 * (thresh<K>WarnOutlineOn) onto the warn look (thresh<K>WarnLook: none / outline /
 * fill). The look has a per-PLATFORM default (status-thresholds.js warnLookDefault:
 * fill on colour watches, outline on B&W, outline for the goal kinds) and stays
 * absent until the user picks a look that differs from it: it is never seeded, and
 * a page save leaves a look equal to the saving watch's default out of the blob
 * (the item's defaultFrom is sticky: false, engine.js serialize). So only the
 * installs whose old box differs from "absent → default" get a stored look:
 *  - a WEATHER kind whose outline was on keeps its outline — the stored toggle true,
 *    or a stored warn colour (an int, or a non-empty '#RRGGBB'): before the toggle
 *    existed, and until the page next re-derived it, the colour alone drew the box.
 *    Every other weather kind stays absent and takes the new default (the owner's
 *    "switch to fill").
 *  - a GOAL kind whose outline was off keeps no box ('none') — the stored toggle
 *    false, or the blank warn colour ('' or the old parseResponse bug's null) that
 *    was the wire's no-outline state.
 * seedDefaults wrote the old toggle's and colour's defaults (weather false / '', goal
 * true / green): both land on "leave absent". A look already stored is the page's own
 * truth and is left alone. The old toggle is not deleted: nothing reads it any more.
 *
 * The same move gives a WEATHER kind's danger the contract's red where it held the
 * old auto text colour (a stored black or white, int or '#RRGGBB'): the page used to
 * write the theme fg there, and with warn now filled in that colour by default the
 * two levels would draw the same box. From here on a stored black or white danger is
 * a pick ("the text colour"), and unset means red (onbuild.js, kindConfig). Goal
 * kinds keep their green.
 *
 * Asks for ONE Clay send on every existing install — even when nothing in storage
 * changes: the watch still holds the pre-1.24 blob without the look bytes, so it
 * would keep drawing the old boxes (no box where the outline was off, a white danger)
 * while the page already shows the new defaults (fill, red). A FRESH install (no blob
 * before this boot's seedDefaults) asks for nothing: its boot already sends the whole
 * settings blob.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @param {{hadExistingInstall: boolean}} ctx Runner context.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateWarnLook(blob, ctx) {
    var changed = false;
    for (var i = 0; i < thresholds.KINDS.length; i++) {
        var kind = thresholds.KINDS[i];
        if (kind.boldOnly) { continue; }
        var dangerKey = 'thresh' + kind.key + 'DangerColor';
        if (!kind.goal && isTextColor(blob[dangerKey])) {
            blob[dangerKey] = typeof blob[dangerKey] === 'number'
                ? thresholds.DEFAULT_DANGER_COLOR : thresholds.DEFAULT_DANGER_HEX;
            changed = true;
        }
        var lookKey = 'thresh' + kind.key + 'WarnLook';
        if (Object.prototype.hasOwnProperty.call(thresholds.WARN_LOOKS, blob[lookKey])) {
            continue;
        }
        var outlineOn = blob['thresh' + kind.key + 'WarnOutlineOn'];
        var rawWarn = blob['thresh' + kind.key + 'WarnColor'];
        var look = null;
        if (kind.goal) {
            if (outlineOn === false || rawWarn === '' || rawWarn === null) { look = 'none'; }
        } else if (outlineOn === true || typeof rawWarn === 'number'
                   || (typeof rawWarn === 'string' && rawWarn !== '')) {
            look = 'outline';
        }
        if (look !== null) {
            blob[lookKey] = look;
            changed = true;
        }
    }
    if (changed) {
        console.log('Migrated the warn outline toggles to warn looks, danger to red');
    }
    return { changed: changed, send: Boolean(ctx.hadExistingInstall) };
}

/**
 * Move the rain window's retired Off option. Until 132b577a the Radar tab's rain
 * countdown offered 'Off' (rainCountdownHorizon '0'); the rain alert's own switch
 * (alertRain) replaced it, but a stored '0' was never moved: the Alerts card's Rain
 * row read "Within 60 min" through its fallback while the phone sent horizon 0 and the
 * watch showed no rain. A stored '0' becomes the window's default '60' with the switch
 * OFF — the same "no rain alert" the watch already draws — except in radar mode 'Rain
 * alert only', which holds the switch on (reset-status-defaults.js forceRainAlert):
 * there the alert stays on, now with a working window.
 *
 * Keyed on the stored HORIZON value, never on alertRain being absent. Reads radarMode,
 * so it must run after the radar provider -> mode move (radar.js).
 *
 * Asks for a send only in 'Rain alert only', where the sent value moves from 0 to 60.
 * Elsewhere the switch off keeps sending 0 (clay-payload.js), which the watch already
 * holds.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateRainHorizonOff(blob) {
    var h = blob.rainCountdownHorizon;
    if (h === null || typeof h === 'undefined' || String(h) !== '0') {
        return { changed: false, send: false };
    }
    var send = blob.radarMode === 'countdown';
    blob.rainCountdownHorizon = '60';
    blob.alertRain = send;
    console.log('Migrated rain window Off -> 60 min, rain alert ' + (send ? 'on' : 'off'));
    return { changed: true, send: send };
}

/**
 * The registry entry's body: the three moves above, in this order.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @param {{hadExistingInstall: boolean}} ctx Runner context.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateAlertLevels(blob, ctx) {
    var steps = [migrateThresholdHighlightToggles, migrateWarnLook, migrateRainHorizonOff];
    var out = { changed: false, send: false };
    for (var i = 0; i < steps.length; i++) {
        var r = steps[i](blob, ctx);
        out.changed = out.changed || r.changed;
        out.send = out.send || r.send;
    }
    return out;
}

/**
 * The temperature pair's separator: 1.24.0 moved its default from the slash to the
 * bar ('12|10', status-pair.js DEFAULT_SEPARATOR), and a stored 'slash' moves with it
 * once. Until 1.24.0 the slash was the default and the page stored it on every save,
 * so a stored 'slash' cannot tell a pick from the old default; the owner's call is
 * that everyone gets the bar. Every other value stays: 'custom' (even a custom '/'),
 * 'brackets', 'dot', an already stored 'bar', and the day-max kinds' own separators.
 * The Spaces flag is left alone, so '12 / 10' becomes '12 | 10'.
 *
 * Keyed on the stored VALUE: seedDefaults has already written 'bar' into a fresh
 * install, which is a no-op here. No Clay send: the separator is phone-baked slot text,
 * already in renderSignature, so the next bake (the startup fetch or the settings-close
 * re-bake) shows it.
 *
 * @param {Object} blob Stored settings, mutated in place.
 * @returns {{changed: boolean, send: boolean}}
 */
function migrateTempSeparatorBar(blob) {
    if (blob.tempSlotSeparator === 'slash') {
        blob.tempSlotSeparator = 'bar';
        return { changed: true, send: false };
    }
    return { changed: false, send: false };
}

module.exports = {
    migrateAlertLevels: migrateAlertLevels,
    migrateThresholdHighlightToggles: migrateThresholdHighlightToggles,
    migrateWarnLook: migrateWarnLook,
    migrateRainHorizonOff: migrateRainHorizonOff,
    migrateTempSeparatorBar: migrateTempSeparatorBar
};
