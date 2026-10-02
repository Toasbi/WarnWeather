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
var lineStyle = require('./line-style.js');
var onDemand = require('./on-demand.js');
var lineAlert = require('./line-alert.js');

/**
 * Does a top stripe change the weather bake? Under one the bake leaves the top of a
 * drawn feels/dew curve's joint temperature band unpadded (forecast-series.js
 * topStripeDrawn -> padJointTempAxisBand), re-baking TEMP_TREND_UINT8 and the curve's
 * bytes; with no such curve there is no band to pad. Platform-free: the bake's watch
 * gate (aplite draws no stripes) at worst costs aplite one redundant fetch.
 * @param {Object} settings Clay settings.
 * @returns {boolean} True when a drawn top stripe sits over a temperature-axis curve.
 */
function topStripeOverTempAxis(settings) {
    if (!lineStyle.topStripeLineDrawn(settings)) { return false; }
    for (var i = 0; i < lineStyle.FORECAST_LINES.length; i++) {
        if (lineStyle.isTempAxisMetric(
                lineStyle.effectiveLineMetric(settings, lineStyle.FORECAST_LINES[i].key))) {
            return true;
        }
    }
    return false;
}

/**
 * The drawn metrics whose line is a stripe: a stripe line's bytes are level bytes on the
 * metric's own scale (forecast-series.js stripeBytes, stripe-levels.js), so moving a
 * line between a stripe and a curve, dots or marks re-bakes it. Signed as the metrics
 * (each line's effective metric, line-style.js effectiveLineMetric, with its effective
 * style, lineStyleValue — never a stripe on a metric that cannot be one), so a stripe
 * moved between the top and the bottom edge, or a stored stripe on a line that is off
 * or draws no stripe, signs nothing new. Platform-free: the bake's watch gate (aplite
 * draws no stripes) at worst costs aplite one redundant fetch.
 * @param {Object} settings Clay settings.
 * @returns {string} e.g. 'cloud,uv'; '' for none.
 */
function stripeMetrics(settings) {
    var out = [];
    for (var i = 0; i < lineStyle.FORECAST_LINES.length; i++) {
        var line = lineStyle.FORECAST_LINES[i];
        var metric = lineStyle.effectiveLineMetric(settings, line.key);
        if (metric && lineStyle.isStripeStyle(settings, line.styleKey)) { out.push(metric); }
    }
    return out.join(',');
}

/**
 * @param {*} code A status item code.
 * @returns {boolean} whether a metric weather alert has that code (ALERT_KINDS)
 */
function isAlertCode(code) {
    return statusThresholds.ALERT_KINDS.some(function (a) { return a.code === code; });
}

/**
 * The edge slots that merge the weather alert of their metric (status-lines.js
 * mergedAlert): each bar's left or right slot whose selection (stored, else its
 * default) is an alert's code while that alert is ticked on the slot's side of the
 * bar. Such a slot bakes the alert's value into its text, so moving the alert onto
 * or off that side re-bakes it; moving it anywhere else does not.
 * @param {Object} settings Clay settings.
 * @returns {string} e.g. 'radar.left.uv', comma-joined; '' for none
 */
function mergedSlots(settings) {
    var out = [];
    for (var l = 0; l < statusCatalog.LINES.length; l++) {
        var line = statusCatalog.LINES[l];
        for (var s = 0; s < 3; s += 2) {
            var key = line.slots[s];
            var code = settings[key] || statusCatalog.slotDefault(key);
            var side = s ? 'right' : 'left';
            if (isAlertCode(code) && onDemand.sideOf(settings, line.id, code) === side) {
                out.push(line.id + '.' + side + '.' + code);
            }
        }
    }
    return out.join(',');
}

/**
 * Join the render-affecting settings into a change-detection signature.
 *
 * @param {Object} settings Clay settings.
 * @returns {string} Pipe-joined signature, or '' when settings is falsy.
 */
function renderSignature(settings) {
    if (!settings) { return ''; }
    // Series selection and encoding — fourthLine/fifthLine change which series the phone
    // bakes (and fetches — UV), so it joins. NOT the theme or the area-fill toggle:
    // the line colours, the fill flag, the ...LineStyle keys and the
    // threshold auto-colours all ride the Clay message now (line-style.js,
    // palette-wire.js, status-wire.js' buildSettingsBlob), and the auto theme
    // switch already flips with a Clay-only resend. The two style facts the bake does
    // read — a top stripe over a feels/dew curve, and which lines are stripes at all
    // (their level bytes) — join as derived values, so a style edit that bakes nothing
    // forces no fetch...
    var parts = [settings.secondaryLine, settings.thirdLine, settings.fourthLine, settings.fifthLine,
        topStripeOverTempAxis(settings) ? 'topStripe' : '', stripeMetrics(settings),
        // ...the wind, gust and UV lines' Show: Alert (line-alert.js: gaps below the
        // warn level, the line scaled from it), signed as the drawn metrics set to it, so
        // the page hydrating an absent key to 'all', or picking Alert for a metric no line
        // draws, forces no fetch. The band's other inputs (the lines, windScale,
        // windUnits, the resolved pairs below) are signed on their own...
        lineAlert.signature(settings),
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
    // time (STATUS_LEVELS_UINT8 and the alert entries), so a pair edit only
    // shows up after a refetch — without this the new level would first
    // appear on the next scheduled fetch (15 min default,
    // or after the overnight pause). The highlight toggle thresh<Kind>On does NOT
    // join: levels pack whatever it says and it only flips the Clay blob's enable
    // bit, which is already immediate. Selected by the SAME
    // predicate status-wire.js packWeatherLevels packs by (isWeatherKind), so a
    // kind the phone levels can never be omitted here — KINDS.slice(0, 4)
    // silently dropped UV when it joined as kind 7.
    // Deliberately NOT the health kinds (goal: true — evaluated watch-side from
    // the Clay-delivered blob, already immediate) and NOT the threshold colours
    // (Clay-delivered, applied on the next paint): a refetch there is pure waste.
    // Signed as the RESOLVED pair — the numbers the bake reads (resolvedPair:
    // the stored pair when it is ordered, else the kind's seed) — not the raw
    // strings: a pair dragged onto the seed and a blank one bake the same
    // numbers, and a unit or AQI-scale change moves a blank pair's numbers with
    // no stored string changing. The seed's own inputs (windUnits, aqiSource,
    // aqiScale) are signed above.
    var kinds = statusThresholds.KINDS;
    for (var w = 0; w < kinds.length; w++) {
        if (!statusThresholds.isWeatherKind(kinds[w])) { continue; }
        var held = statusThresholds.resolvedPair(kinds[w].key, settings);
        parts.push(held.warn, held.danger);
    }
    // The metric alerts (On demand's weather alerts): whether an alert is on — its
    // item ticked on a side of any bar — changes both the bake (the
    // ALERT_ENTRIES_UINT8 entries, status-wire.js bakeAlerts) and the fetch set (a
    // placed alert fetches its metric and day peaks with no slot showing it), and
    // alert<Kind>Display changes the baked bytes (a value after the icon), as do
    // alert<Kind>Days (whether tomorrow's peak may raise the alert) and
    // alert<Kind>NextDayMark (the mark code a tomorrow entry carries). Signed as
    // what the bake reads, through the bake's own list (enabledAlerts), with a watch
    // that draws On demand: one entry per placed alert (the union over every bar and
    // side), its code, '+v' while its Look shows the value, and '>' + its mark while
    // it looks ahead to tomorrow — so the page hydrating an absent key to its default
    // forces no fetch, and moving an item between sides or bars, or disabling one of
    // two sides that both carry it, signs nothing new.
    // NOT signed: the side keys as such, the Battery, Bluetooth, Quiet time and Sleep
    // items, the rain alert's placement, window and look, the warn looks and the
    // colours — all ride the Clay message (the cells, the Battery byte, the horizon,
    // byte 34), already immediate.
    parts.push(statusThresholds.enabledAlerts(settings).map(function (a) {
        return a.code + (a.showValue ? '+v' : '') + (a.days === 'tomorrow' ? '>' + a.mark : '');
    }).join(','));
    // The one placement that does bake: an alert on the side whose slot shows its
    // metric, which merges into that slot's text (mergedSlots).
    parts.push(mergedSlots(settings));
    return parts.join('|');
}

module.exports = { renderSignature: renderSignature };
