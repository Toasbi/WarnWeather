// src/pkjs/holidays/nager-source.js
//
// Nager.Date-backed holiday source: fetches public holidays per (country, year),
// caches them in localStorage for >= 30 days, and answers isHoliday() lookups
// synchronously from that cache. Country-agnostic; the registry binds a country.
// ES5 only (reaches the watch/aplite runtime) — no ES6 built-ins.

var storageKeys = require('../storage-keys.js');

var TTL_MS = 30 * 24 * 60 * 60 * 1000;   // cache a year's data for >= 1 month
var BACKOFF_MS = 60 * 60 * 1000;         // wait an hour after a failed fetch
var XHR_TIMEOUT_MS = 5000;

/**
 * Two-digit zero-pad.
 * @param {number} n Value 0-99.
 * @returns {string} Two-character string.
 */
function pad2(n) {
    return n < 10 ? '0' + n : '' + n;
}

/**
 * localStorage key for a country/year cache entry.
 * @param {string} country ISO-3166-1 alpha-2 code.
 * @param {number} year Full year.
 * @returns {string} Cache key.
 */
function cacheKey(country, year) {
    return storageKeys.HOLIDAY_CACHE_PREFIX + country + '_' + year;
}

/**
 * localStorage key for a country's fetch-backoff timestamp.
 * @param {string} country ISO-3166-1 alpha-2 code.
 * @returns {string} Backoff key.
 */
function backoffKey(country) {
    return storageKeys.HOLIDAY_BACKOFF_PREFIX + country;
}

/**
 * Read a cached year's holiday data.
 * @param {string} country ISO-3166-1 alpha-2 code.
 * @param {number} year Full year.
 * @returns {{f: number, h: Array}|null} Parsed cache entry, or null when absent/corrupt.
 */
function readCache(country, year) {
    var raw = localStorage.getItem(cacheKey(country, year));
    if (!raw) { return null; }
    try {
        return JSON.parse(raw);
    } catch (e) {
        return null;
    }
}

/**
 * Whether a local civil date is a holiday for the country/region per cached data.
 * @param {string} country ISO-3166-1 alpha-2 code.
 * @param {string} region ISO-3166-2 code, or 'all' for nationwide-only.
 * @param {Date} date Local date; only year/month/day are read.
 * @returns {boolean} True when a matching holiday is cached for that date.
 */
function isHoliday(country, region, date) {
    var data = readCache(country, date.getFullYear());
    if (!data || !data.h) { return false; }
    var md = pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
    var i, entry;
    for (i = 0; i < data.h.length; i++) {
        entry = data.h[i];
        if (entry[0] !== md) { continue; }
        if (entry[1] === null) { return true; }                       // nationwide
        if (region !== 'all' && entry[1].indexOf(region) !== -1) {     // regional match
            return true;
        }
    }
    return false;
}

/**
 * Transform a Nager.Date PublicHolidays array into the compact cache shape.
 * @param {Array} apiList Parsed API response (array of holiday objects).
 * @returns {Array} Array of [ "MM-DD", null | string[] ] entries.
 */
function compact(apiList) {
    var out = [];
    var i, item, regions;
    for (i = 0; i < apiList.length; i++) {
        item = apiList[i];
        if (!item || typeof item.date !== 'string' || item.date.length < 10) { continue; }
        // global wins over counties; a non-global entry with no counties becomes
        // an empty array (inert: matches no region and is not nationwide).
        regions = item.global ? null : (item.counties && item.counties.length ? item.counties : []);
        out.push([item.date.slice(5, 10), regions]);              // "YYYY-MM-DD" -> "MM-DD"
    }
    return out;
}

/**
 * Default XHR transport. Calls onOk(responseText) on 2xx, otherwise onErr().
 * @param {string} url Request URL.
 * @param {Function} onOk Success callback (responseText).
 * @param {Function} onErr Failure callback.
 * @returns {void}
 */
function defaultRequest(url, onOk, onErr) {
    var xhr = new XMLHttpRequest();
    xhr.timeout = XHR_TIMEOUT_MS;
    xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) { onOk(xhr.responseText); }
        else { onErr(); }
    };
    xhr.onerror = function () { onErr(); };
    xhr.ontimeout = function () { onErr(); };
    xhr.open('GET', url);
    xhr.send();
}

/**
 * Fetch and cache one (country, year) unless freshly cached or under backoff.
 * @param {string} country ISO-3166-1 alpha-2 code.
 * @param {number} year Full year.
 * @param {number} now Current epoch ms.
 * @param {Function} request Transport (url, onOk, onErr).
 * @param {Function} onUpdated Called after a successful fetch+cache.
 * @returns {void}
 */
function fetchYear(country, year, now, request, onUpdated) {
    var cached = readCache(country, year);
    if (cached && typeof cached.f === 'number' && (now - cached.f) < TTL_MS) {
        return;                                  // fresh enough
    }
    var backoffRaw = localStorage.getItem(backoffKey(country));
    if (backoffRaw && now < parseInt(backoffRaw, 10)) {
        return;                                  // backing off after a recent failure
    }
    var url = 'https://date.nager.at/api/v3/PublicHolidays/' + year + '/' + country;
    request(url, function (text) {
        var parsed;
        try {
            parsed = JSON.parse(text);
        } catch (e) {
            localStorage.setItem(backoffKey(country), '' + (now + BACKOFF_MS));
            return;
        }
        if (!parsed || typeof parsed.length !== 'number') {
            localStorage.setItem(backoffKey(country), '' + (now + BACKOFF_MS));
            return;
        }
        localStorage.setItem(cacheKey(country, year), JSON.stringify({ f: now, h: compact(parsed) }));
        localStorage.removeItem(backoffKey(country));
        if (onUpdated) { onUpdated(); }
    }, function () {
        localStorage.setItem(backoffKey(country), '' + (now + BACKOFF_MS));
    });
}

/**
 * Ensure cached holiday data for a country across the given years.
 * @param {string} country ISO-3166-1 alpha-2 code.
 * @param {number[]} years Years to ensure (usually one; two across a year boundary).
 * @param {Function} [onUpdated] Called after each successful year fetch.
 * @param {{now: Function, request: Function}} [opts] Test injection (clock, transport).
 * @returns {void}
 */
function ensure(country, years, onUpdated, opts) {
    opts = opts || {};
    var now = opts.now ? opts.now() : Date.now();
    var request = opts.request || defaultRequest;
    var i;
    for (i = 0; i < years.length; i++) {
        fetchYear(country, years[i], now, request, onUpdated);
    }
}

module.exports = { isHoliday: isHoliday, ensure: ensure };
