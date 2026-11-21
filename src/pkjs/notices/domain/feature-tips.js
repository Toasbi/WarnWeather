// src/pkjs/notices/domain/feature-tips.js — ES5, watch runtime.
//
// The new features the settings page offers to try. After an update, a card at the top of
// the page names what is new on this watch and phone and says how to switch it on, with a
// button that opens the place it is set in (page/notices/feature-tips-panel.js). The card
// stays until the user taps Got it.
//
// A tip is for something the user has to switch on to get. What changes on its own needs
// none: the release's toast and its news row say that (RELEASE.md).
//
// Which tips an install has not seen is kept by id (adapter/feature-tips-seen.js), not by
// version: a fresh install has seen them all, since nothing is new to it, and an install
// from before the tips has seen none. So a build shows its tips whatever its version says,
// a dev build too.

var batteryDays = require('../../status-bars/domain/battery-days.js');

/**
 * @typedef {Object} FeatureTip
 * @property {string} id Its name in storage. Never reused and never renamed: a stored id
 *   is how an install remembers it has seen the tip.
 * @property {string} since The release that brought the feature, e.g. '3.3.0': what says
 *   when a tip is old enough to drop.
 * @property {string} title What is new, as the card's line names it.
 * @property {string} html How to switch it on. Markup written here, trusted like a
 *   notice's (notices.js).
 * @property {{sheet: (string|undefined), tab: (string|undefined)}} open What Show me
 *   opens: a dialog by its sheet id, or a tab by its id.
 * @property {function(Object): boolean} [when] Whether this watch and phone can use the
 *   feature, from the page's env; absent for one every watch can.
 */

// In the card's order: a new release's tips go on top.
/** @type {FeatureTip[]} */
var TIPS = [
    {
        id: 'batteryDays',
        since: '3.3.0',
        title: 'Days left on your watch battery',
        html: 'With the ' + batteryDays.MUNINN_LINK + ' on your watch, the Watch battery slot ' +
            'can show how many days the watch has left. In the Watch bar, set the right slot to ' +
            'Watch battery and tap Edit. Set Look to Icon + text or Text, then choose Days left ' +
            'or Both.',
        open: { sheet: 'bar-top' },
        // The days are read from another app's plugin, and aplite's battery slot has no text look.
        when: function (env) { return Boolean(env) && env.plugins === true && env.platform !== 'aplite'; }
    },
    {
        id: 'blackTheme',
        since: '3.3.0',
        title: 'A black settings page',
        html: 'This page can match the Pebble app\'s Black theme. On the Setup tab, open Advanced ' +
            'and set Settings Theme to Black.',
        open: { tab: 'setup' }
    }
];

// The most tips the card shows at once. An install that skipped several releases gets the
// newest ones first and the next ones on a later open, once these are seen.
var MAX_SHOWN = 3;

/**
 * @returns {string[]} Every tip's id: what a fresh install has seen from the start.
 */
function allIds() {
    return TIPS.map(function (tip) { return tip.id; });
}

/**
 * The tips the card shows an install: the ones it has not seen and can use, in the list's
 * order, MAX_SHOWN at most.
 * @param {?Array<string>} seen The ids it has seen (feature-tips-seen.js); null reads as none.
 * @param {?Object} env The page's env: the watch's platform and what the phone can do
 *   (platform.js computeEnv, plus index.js' plugins).
 * @returns {FeatureTip[]}
 */
function pending(seen, env) {
    var known = seen || [];
    return TIPS.filter(function (tip) {
        return known.indexOf(tip.id) === -1 && (!tip.when || tip.when(env));
    }).slice(0, MAX_SHOWN);
}

/**
 * Tips as the settings page gets them (userData.featureTips): plain data, the rule of who
 * can use one already applied.
 * @param {FeatureTip[]} tips Tips (pending).
 * @returns {?Array<{id: string, title: string, html: string, sheet: ?string, tab: ?string}>}
 *   null for none, so nothing rides the page's URL then.
 */
function forPage(tips) {
    if (!tips || !tips.length) { return null; }
    return tips.map(function (tip) {
        return { id: tip.id, title: tip.title, html: tip.html,
            sheet: tip.open.sheet || null, tab: tip.open.tab || null };
    });
}

module.exports = {
    TIPS: TIPS,
    MAX_SHOWN: MAX_SHOWN,
    allIds: allIds,
    pending: pending,
    forPage: forPage
};
