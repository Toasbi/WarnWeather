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
        // ...the per-kind "Show unit" toggles, which decide whether the phone bakes the
        // unit into the slot text at all (kph/hPa/d/°) — same rule: without them here a
        // flip sits invisible until the next scheduled fetch...
        settings.windSlotUnit, settings.gustSlotUnit, settings.pressureSlotUnit,
        settings.countdownSlotUnit, settings.tempSlotUnit, settings.dewSlotUnit,
        // ...and the night weather-pause window (a change flips whether fetching pauses
        // and the IS_SLEEPING glyph the forced fetch pushes)...
        settings.sleepNightEnabled, settings.sleepStartHour, settings.sleepEndHour];
    // ...and the twelve slot selections themselves.
    var slotKeys = statusCatalog.allSlotKeys();
    for (var i = 0; i < slotKeys.length; i++) {
        parts.push(settings[slotKeys[i]]);
    }
    // The four WEATHER threshold kinds are evaluated phone-side at weather-bake
    // time (STATUS_LEVELS_UINT8), so enabling one only shows up after a refetch —
    // without this the highlight would first appear on the next scheduled fetch
    // (15 min default, or after the overnight pause). Derived from the contract's
    // kind table so a reordered/renamed kind can't silently drop out.
    // Deliberately NOT the three health kinds (evaluated watch-side from the
    // Clay-delivered blob — already immediate) and NOT the threshold colours
    // (Clay-delivered, applied on the next paint): a refetch there is pure waste.
    var weatherKinds = statusThresholds.KINDS.slice(0, 4);
    for (var w = 0; w < weatherKinds.length; w++) {
        parts.push(settings['thresh' + weatherKinds[w].key + 'Warn'],
            settings['thresh' + weatherKinds[w].key + 'Danger']);
    }
    return parts.join('|');
}

module.exports = { renderSignature: renderSignature };
