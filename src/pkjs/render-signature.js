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
    // Series selection and encoding — fourthLine changes which series the phone
    // bakes (and fetches — UV), so it joins. NOT the theme or the area-fill toggle:
    // the line colours, the fill flag, the three ...LineStyle keys and the
    // threshold auto-colours all ride the Clay message now (line-style.js,
    // palette-wire.js, status-thresholds.js' buildSettingsBlob), and the auto theme
    // switch already flips with a Clay-only resend...
    var parts = [settings.secondaryLine, settings.thirdLine, settings.fourthLine,
        settings.barSource, settings.windScale, settings.pressureScale,
        // Status-line bake inputs: value formatting...
        settings.temperatureUnits, settings.tempSlotDisplay,
        settings.axisTimeFormat,
        settings.timeShowAmPm, settings.timeLeadingZero, settings.healthMode,
        // ...the temp slot's two-value presentation (status-pair.js: separator,
        // spacing, order, and the custom separator text -- editing that re-bakes the
        // pair while the separator itself stays 'custom'; the day-max kinds' own
        // mode and pair settings join from the catalog's table below)...
        settings.tempSlotSeparator, settings.tempSlotSeparatorCustom,
        settings.tempSlotSeparatorSpaced, settings.tempSlotOrder,
        // ...the unit pickers (change baked/fetched values: wind & distance rebake,
        // AQI source/scale refetch)...
        settings.windUnits, settings.distanceUnits, settings.aqiScale, settings.aqiSource,
        // ...the feels-like formula (swaps the provider's value for Steadman in
        // FEELS_TREND / FEELS_CURRENT, so it re-bakes the series AND the temp slot)...
        settings.feelsFormula,
        // ...the per-kind wind-direction arrows (baked into the wind/gust slot text as a
        // trailing sentinel byte, so a flip only shows after a re-bake)...
        settings.windSlotDirection, settings.gustSlotDirection,
        // ...and the night weather-pause window (a change flips whether fetching pauses
        // and the IS_SLEEPING glyph the forced fetch pushes). The battery saver's own
        // toggle and hour pair — sleep-window.js reads no others — or an edit sits
        // invisible until the next scheduled fetch, which, inside a pause, is the very
        // thing being edited. The Nighttime card's other two features ride the Clay
        // message (the backlight tint) or need no fetch at all (the theme flip), so
        // neither belongs here...
        settings.sleepNightEnabled, settings.sleepStartHour, settings.sleepEndHour];
    // ...the per-kind "Show unit" toggles (whether the phone bakes the unit
    // into the slot text at all — kph/hPa/d/°; same rule: without them here a
    // flip sits invisible until the next scheduled fetch), derived from the
    // catalog's table so a new unit-bearing kind can never be omitted...
    var unitToggles = statusCatalog.UNIT_TOGGLES;
    for (var u = 0; u < unitToggles.length; u++) {
        parts.push(settings[unitToggles[u].key]);
    }
    // ...the day-max slots' display modes and pair presentation (UV, wind, gusts,
    // AQI — status-pair.js), from the catalog's table for the same reason...
    var dayMaxKeys = statusCatalog.dayMaxSettingKeys();
    for (var d = 0; d < dayMaxKeys.length; d++) {
        parts.push(settings[dayMaxKeys[d]]);
    }
    // ...and the twelve slot selections themselves, each followed by its countdown
    // target date (status-lines.js bakes the day count from '<slot>Countdown') —
    // but only while that slot shows the countdown. The page hydrates every slot's
    // date to today whether it is used or not, so signing the inert ones would force
    // a needless fetch on the first save that writes them. The '' keeps the
    // position fixed, so no two keys can ever share a signature slot.
    var slotKeys = statusCatalog.allSlotKeys();
    for (var i = 0; i < slotKeys.length; i++) {
        var slotKey = slotKeys[i];
        parts.push(settings[slotKey],
            settings[slotKey] === 'countdown' ? settings[slotKey + 'Countdown'] : '');
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
