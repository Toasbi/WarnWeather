'use strict';

// Normalized forecasts by place, kept in localStorage between requests: a plugin is started fresh
// for each request, and a subscribed watchface asks again every refresh interval.
//
// One localStorage entry holds them all. The places of a request are fetched side by side, and one
// read at the start plus one write at the end can't lose each other's updates the way a
// read-modify-write per place would.

const STORAGE_KEY = 'forecasts';

/** Bumped whenever the normalized forecast changes shape: older entries are then dropped. */
const VERSION = 1;

/** A forecast older than a day is no use even as a fallback. */
const KEEP_MS = 24 * 3600 * 1000;

/** Places a user switches between: enough for every weather location and some travel. */
const MAX_ENTRIES = 12;

/**
 * The stored entries, keyed by place, or none when nothing (readable) is stored.
 *
 * @returns {Object<string, {fetchedAt: number, expiresAt: number, forecast: Object}>} Entries.
 */
function load() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && stored.v === VERSION && stored.entries && typeof stored.entries === 'object') {
      return stored.entries;
    }
  } catch (error) {
    // Unreadable: start over.
  }
  return {};
}

/**
 * Drop entries past KEEP_MS, then all but the MAX_ENTRIES newest.
 *
 * @param {Object} entries Entries by key; changed in place.
 * @param {number} nowMs Now.
 * @returns {Object} The same entries.
 */
function prune(entries, nowMs) {
  Object.keys(entries).forEach((key) => {
    if (!entries[key] || nowMs - entries[key].fetchedAt > KEEP_MS) {
      delete entries[key];
    }
  });
  const keys = Object.keys(entries).sort((a, b) => entries[b].fetchedAt - entries[a].fetchedAt);
  keys.slice(MAX_ENTRIES).forEach((key) => {
    delete entries[key];
  });
  return entries;
}

/**
 * Store the entries (pruned).
 *
 * @param {Object} entries Entries by key.
 * @param {number} nowMs Now.
 * @returns {void}
 */
function save(entries, nowMs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: VERSION, entries: prune(entries, nowMs) }));
  } catch (error) {
    // Full or unavailable: the next request fetches again.
  }
}

/**
 * The forecast for one place: the stored one while it's fresh, else a new one, else the stored
 * one while it isn't too old (with a short validity, so it's retried soon).
 *
 * @param {Object} entries Entries by key (from load()); a new forecast is added in place.
 * @param {string} key The place's key.
 * @param {Object} options {nowMs, ttlMs, staleMs, retryMs, fetch: () => Promise<Object>}.
 * @returns {Promise<{forecast: Object, validUntilMs: number, updated: boolean, stale: boolean}>}
 *   Rejects with the fetch's error when nothing usable is stored.
 */
async function cached(entries, key, options) {
  const entry = entries[key];
  if (entry && options.nowMs < entry.expiresAt && options.nowMs >= entry.fetchedAt) {
    return { forecast: entry.forecast, validUntilMs: entry.expiresAt, updated: false, stale: false };
  }
  try {
    const forecast = await options.fetch();
    const expiresAt = options.nowMs + options.ttlMs;
    entries[key] = { fetchedAt: options.nowMs, expiresAt, forecast };
    return { forecast, validUntilMs: expiresAt, updated: true, stale: false };
  } catch (error) {
    if (entry && options.nowMs - entry.fetchedAt < options.staleMs) {
      return {
        forecast: entry.forecast,
        validUntilMs: options.nowMs + options.retryMs,
        updated: false,
        stale: true,
      };
    }
    throw error;
  }
}

module.exports = {
  STORAGE_KEY,
  VERSION,
  KEEP_MS,
  MAX_ENTRIES,
  load,
  prune,
  save,
  cached,
};
