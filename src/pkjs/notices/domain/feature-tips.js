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
        id: 'pluginValue',
        since: '3.4.0',
        title: 'A value from another app',
        // The Plugin value slot (status-line-catalog.js 'pluginValue'), in any bar, so Show me
        // opens the Status bars tab. Its dialog lists what the phone's plugins serve.
        html: 'A status slot can show a value that another app\'s plugin serves, such as your phone\'s ' +
            'network type. In any bar, set a slot to Plugin value and tap Edit, then pick the plugin and ' +
            'its value.',
        open: { tab: 'watch' },
        // The value is read from another app's plugin, and aplite's feature set is frozen.
        when: function (env) { return Boolean(env) && env.plugins === true && env.platform !== 'aplite'; }
    },
    {
        id: 'weatherFrom',
        since: '3.3.0',
        title: 'Weather from more than one provider',
        // In the page's words: the Weather dialog (Setup › Data sources › Weather), its Other
        // sources list (page/weather/weather-sources-page.js). Every watch: the phone mixes the
        // readings, and the watch gets the same messages.
        html: 'Each value can come from a provider of its own. On the Setup tab, open Weather under ' +
            'Data sources and tap Use another source.',
        open: { sheet: 'weatherSources' }
    },
    {
        id: 'batteryIconText',
        since: '3.3.0',
        title: 'Icon and text for your watch battery',
        html: 'The Watch battery slot can show the battery icon and the percentage side by side. ' +
            'In the Watch bar, set the right slot to Watch battery and tap Edit. Set Look to Icon + text.',
        open: { sheet: 'bar-top' },
        // Every watch but aplite, whose battery slot has no Look. The percentage is the watch's
        // own reading, so unlike the days below it needs no plugin.
        when: function (env) { return Boolean(env) && env.platform !== 'aplite'; }
    },
    {
        id: 'batteryDays',
        since: '3.3.0',
        title: 'Days left on your watch battery',
        // The tip above says how to put the Watch battery in its slot; this one starts from the
        // slot's Edit button, so the two don't say it twice. Days left shows in either text look.
        html: 'With the ' + batteryDays.MUNINN_LINK + ' on your watch, the Watch battery slot ' +
            'can show how many days the watch has left. Tap its Edit button in the Watch bar, set ' +
            'Look to Icon + text or Text, then set Value selection to Days left or Both.',
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
