// src/pkjs/notices/adapter/feature-tips-seen.js — ES5, watch runtime.
//
// Which new-feature tips this install has seen (domain/feature-tips.js): their ids, in
// localStorage. The settings page shows the others (index.js hands them over as
// userData.featureTips) until its card's Got it comes back with a save.

var KEYS = require('../../settings/domain/storage-keys.js');
var featureTips = require('../domain/feature-tips.js');

/**
 * @returns {?Array<string>} The ids seen; null while none were ever written, or the stored
 *   value is unreadable.
 */
function read() {
    var raw = localStorage.getItem(KEYS.FEATURE_TIPS_SEEN_KEY);
    if (!raw) { return null; }
    try {
        var parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    } catch (ex) {
        return null;
    }
}

/**
 * @param {Array<string>} ids The ids seen.
 * @returns {void}
 */
function write(ids) {
    localStorage.setItem(KEYS.FEATURE_TIPS_SEEN_KEY, JSON.stringify(ids));
}

/**
 * At boot: an install that kept no list yet gets one. A fresh install has seen every tip,
 * since nothing is new to it; an install from before the tips has seen none, so its next
 * settings open shows them. A list already kept stays as it is.
 * @param {boolean} hadExistingInstall Whether settings were stored before this boot
 *   (clay-settings.js hasStored, read before the defaults are seeded).
 * @returns {void}
 */
function init(hadExistingInstall) {
    if (read() !== null) { return; }
    write(hadExistingInstall ? [] : featureTips.allIds());
}

/**
 * The tips to show on this watch and phone: the ones not seen that it can use.
 * @param {?Object} env The page's env (feature-tips.js pending).
 * @returns {Array<Object>} Tips (feature-tips.js FeatureTip).
 */
function pending(env) {
    return featureTips.pending(read(), env);
}

/**
 * The card the settings page opens on, on this watch and phone (userData.featureTips).
 * @param {?Object} env The page's env (feature-tips.js pending).
 * @returns {?Array<Object>} The tips to show as plain data (feature-tips.js forPage), or
 *   null for none.
 */
function forPage(env) {
    return featureTips.forPage(pending(env));
}

/**
 * The card's Got it: the tips it showed are seen. A tip it did not show stays unseen: one
 * this watch or phone could not use can still show once it can, and the ones past the
 * card's limit show on a later open.
 * @param {?Object} env The env the card was built for.
 * @returns {void}
 */
function acknowledge(env) {
    var seen = read() || [];
    pending(env).forEach(function (tip) { seen.push(tip.id); });
    write(seen);
}

module.exports = {
    read: read,
    init: init,
    pending: pending,
    forPage: forPage,
    acknowledge: acknowledge
};
