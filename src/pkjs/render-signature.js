// src/pkjs/render-signature.js — the render-affecting-settings change signature.
//
// THE FORCE-FETCH RULE (see AGENTS.md and the schema comments that point here): any
// setting that changes what the phone BAKES into the weather payload — slot text,
// series encoding, status levels — MUST join this signature, or flipping it sits
// invisible until the next scheduled fetch. index.js compares the signature across a
// settings save and forces a refetch on change. Extracted from index.js so the rule
// is testable against real module resolution (index.js registers Pebble listeners at
// load and exports nothing).

var statusCatalog = require('./status-line-catalog.js');
var statusThresholds = require('./status-thresholds.js');

/**
 * Join the render-affecting settings into a change-detection signature.
 *
 * @param {Object} settings Clay settings.
 * @returns {string} Pipe-joined signature, or '' when settings is falsy.
 */
function renderSignature(settings) {
    if (!settings) { return ''; }
    var parts = [settings.secondaryLine, settings.thirdLine, settings.secondaryLineFill,
        settings.barSource, settings.windScale, settings.pressureScale, settings.theme,
        // Status-line bake inputs: value formatting...
        settings.temperatureUnits, settings.tempSlotDisplay, settings.axisTimeFormat,
        settings.timeShowAmPm, settings.timeLeadingZero, settings.healthMode,
        // ...the unit pickers (change baked/fetched values: wind & distance rebake,
        // AQI source/scale refetch)...
        settings.windUnits, settings.distanceUnits, settings.aqiScale, settings.aqiSource,
        // ...the per-kind wind-direction arrows (baked into the wind/gust slot text as a
        // trailing sentinel byte, so a flip only shows after a re-bake)...
        settings.windSlotDirection, settings.gustSlotDirection,
        // ...and the night weather-pause window (a change flips whether fetching pauses
        // and the IS_SLEEPING glyph the forced fetch pushes)...
        settings.sleepNightEnabled, settings.sleepStartHour, settings.sleepEndHour];
    // ...the per-kind "Show unit" toggles (whether the phone bakes the unit
    // into the slot text at all — kph/hPa/d/°; same rule: without them here a
    // flip sits invisible until the next scheduled fetch), derived from the
    // catalog's table so a new unit-bearing kind can never be omitted...
    var unitToggles = statusCatalog.UNIT_TOGGLES;
    for (var u = 0; u < unitToggles.length; u++) {
        parts.push(settings[unitToggles[u].key]);
    }
    // ...and the twelve slot selections themselves.
    var slotKeys = statusCatalog.allSlotKeys();
    for (var i = 0; i < slotKeys.length; i++) {
        parts.push(settings[slotKeys[i]]);
    }
    // The WEATHER threshold kinds are evaluated phone-side at weather-bake
    // time (STATUS_LEVELS_UINT8), so enabling one only shows up after a refetch —
    // without this the highlight would first appear on the next scheduled fetch
    // (15 min default, or after the overnight pause). Selected by the SAME
    // predicate packWeatherLevels packs by (neither goal nor boldOnly), so a
    // kind the phone levels can never be omitted here — KINDS.slice(0, 4)
    // silently dropped UV when it joined as kind 7.
    // Deliberately NOT the health kinds (goal: true — evaluated watch-side from
    // the Clay-delivered blob, already immediate) and NOT the threshold colours
    // (Clay-delivered, applied on the next paint): a refetch there is pure waste.
    var kinds = statusThresholds.KINDS;
    for (var w = 0; w < kinds.length; w++) {
        if (kinds[w].goal || kinds[w].boldOnly) { continue; }
        parts.push(settings['thresh' + kinds[w].key + 'Warn'],
            settings['thresh' + kinds[w].key + 'Danger']);
    }
    return parts.join('|');
}

module.exports = { renderSignature: renderSignature };
