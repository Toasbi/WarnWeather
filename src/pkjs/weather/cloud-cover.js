// src/pkjs/weather/cloud-cover.js — ES5. Cloud cover as the watch draws it:
// the low, mid and high layers combined with thin high cloud at half weight.
//
// A model's TOTAL cloud cover counts a thin veil of high cloud (cirrus the sun
// shines through) as a fully covered sky, so a sunny day under cirrus drew as
// overcast (GitHub #88; checked against EUMETSAT satellite cloud and sun).
// Shared by the radar's cloud row (radar-sky.js) and the forecast graph's cloud
// line from the providers that report the layers (Open-Meteo, Met.no); the
// others report only the total, which their line keeps.

// How much a high-cloud layer counts toward the cover. Half weight cut the full
// cloud row during strong sun from 32 % of those quarter hours to 6 % in the
// satellite comparison, while overcast skies still draw full.
var HIGH_CLOUD_WEIGHT = 0.5;

/**
 * A raw reading as a finite number, or null when it is missing (null,
 * undefined) or not numeric (NaN, 'x', Infinity).
 * @param {*} v Raw reading.
 * @returns {?number} The number, or null.
 */
function reading(v) {
    if (v === null || v === undefined) { return null; }
    var n = Number(v);
    return isFinite(n) ? n : null;
}

/**
 * A cloud-cover percentage as a 0..1 fraction, clamped.
 * @param {number} pct Percent.
 * @returns {number} Fraction 0..1.
 */
function coverFraction(pct) {
    return Math.max(0, Math.min(1, pct / 100));
}

/**
 * The drawn cover: the low, mid and high layers combined as independent
 * overlaps, 100 * (1 - (1 - L)(1 - M)(1 - HIGH_CLOUD_WEIGHT * H)), so a sky of
 * thin high cloud alone draws half. Capped at the model's own total cover:
 * treating the layers as independent can sum above the total the model reports
 * for overlapping layers (4 % of hours in a 15-city sample, e.g. layers
 * 50/60/76 % over a 77 % total), and the half weight is meant to lower the
 * cover, never to raise it. When any layer is missing or not a number the model
 * has no layer split for that hour, and the total cover stands in as it is;
 * without that either, the sky reads clear.
 * @param {*} low Low cloud cover, percent.
 * @param {*} mid Mid cloud cover, percent.
 * @param {*} high High cloud cover, percent.
 * @param {*} total Total cloud cover, percent (the fallback).
 * @returns {number} Weighted cover, percent 0..100.
 */
function weightedCloudCover(low, mid, high, total) {
    var l = reading(low);
    var m = reading(mid);
    var h = reading(high);
    var t = reading(total);
    var totalPct = t === null ? null : Math.max(0, Math.min(100, t));
    if (l === null || m === null || h === null) {
        return totalPct === null ? 0 : totalPct;
    }
    var weighted = 100 * (1 - (1 - coverFraction(l)) * (1 - coverFraction(m))
        * (1 - HIGH_CLOUD_WEIGHT * coverFraction(h)));
    return totalPct === null ? weighted : Math.min(weighted, totalPct);
}

module.exports = {
    HIGH_CLOUD_WEIGHT: HIGH_CLOUD_WEIGHT,
    weightedCloudCover: weightedCloudCover
};
