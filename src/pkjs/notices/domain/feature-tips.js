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
var statusLineCatalog = require('../../status-bars/domain/status-line-catalog.js');
var platformLib = require('../../config-ui/lib/platform.js');

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

/**
 * Where the status lists offer the Plugin value slot (status-line-catalog.js 'pluginValue'): a
 * Pebble app that reads plugins, and not on aplite, whose feature set is frozen.
 * @param {?Object} env The page's env.
 * @returns {boolean}
 */
function pluginValueOffered(env) {
    return statusLineCatalog.itemAvailable(statusLineCatalog.byCode('pluginValue'), null, env);
}

/**
 * Where the status lists offer the sun and moon slots worked out on the phone (status-line-catalog.js
 * 'twilight', 'dayLength' and 'moon', whose rule is the same): every watch but aplite.
 * @param {?Object} env The page's env.
 * @returns {boolean}
 */
function skySlotsOffered(env) {
    return Boolean(env) && statusLineCatalog.itemAvailable(statusLineCatalog.byCode('moon'), null, env);
}

/**
 * Where the Alerts tab and its items are (platform.js isOnDemandPlatform, the page's
 * env.onDemand): every watch but aplite, whose feature set is frozen.
 * @param {?Object} env The page's env.
 * @returns {boolean}
 */
function onDemandOffered(env) {
    return Boolean(env) && platformLib.isOnDemandPlatform(env.platform);
}

// In the card's order: a new release's tips go on top.
/** @type {FeatureTip[]} */
var TIPS = [
    {
        id: 'sunAndMoon',
        since: '3.6.0',
        title: 'Moon phase, dawn and dusk, day length',
        // The three slots the phone works out from the clock and the place (status-bars/domain/
        // sky-slots.js), in the slot lists' Sun and moon group, and the Moon phase slot's dialog,
        // whose Shows row picks how much of the moon is lit or the next full moon's day
        // (page/settings/schema.js moonSlotSheet). Show me opens the Status bars tab.
        html: 'Status bar slots can now show the moon\'s phase, the next dawn or dusk, and how long the ' +
            'day is. Set a slot to Moon phase, Dawn/dusk or Day length. Tap Edit beside Moon phase to show ' +
            'how much of the moon is lit or the day of the next full moon.',
        open: { tab: 'watch' },
        when: skySlotsOffered
    },
    {
        id: 'openMeteoModel',
        since: '3.6.0',
        title: 'Pick Open-Meteo\'s weather model',
        // The Weather dialog's Model row, under the Provider while it is Open-Meteo
        // (page/weather/weather-sources-schema.js), and the precipitation amount a model
        // goes without, which the dialog's Other sources list asks a source for
        // (weather-sources-page.js missingAmount). Every watch: the phone fetches.
        html: 'With Open-Meteo as the Provider, you can pick the weather model it uses, such as your ' +
            'country\'s own. On the Setup tab, open Weather under Data sources and pick one under Model. ' +
            'Some bring no precipitation amount: pick a source for it under Other sources.',
        open: { sheet: 'weatherSources' }
    },
    {
        id: 'pollenEveryProvider',
        since: '3.6.0',
        title: 'Pollen with every weather provider',
        // The Pollen slot (status-line-catalog.js 'pollen'), offered with every Provider now: its
        // level comes from the pollen source the Provider reads (weather/domain/pollen-days.js
        // sourceOf), the CAMS forecast for Europe with all but the DWD. The tip shows under every
        // Provider, so it names no source or area: the slot's dialog names the one in use. Every
        // watch: the phone fetches it. Show me opens the Status bars tab.
        html: 'The Pollen slot now works with every weather provider. Set a slot to Pollen ' +
            'to see today\'s level.',
        open: { tab: 'watch' }
    },
    {
        id: 'moonOnDemand',
        since: '3.6.0',
        title: 'The moon at the edge of a status bar',
        // The On demand Moon phase item (status-bars/domain/moon-item.js), on no bar until the
        // user places it, in the Alerts tab's Sky card: its dialog's Shows on grid, its Show row
        // (at full moon by default) and Days' Today + tomorrow, which shows the moon the day
        // before too, with a mark (page/alerts/alerts-schema.js moonSheet). Show me opens it.
        html: 'A status bar can show the moon at its edge: at full moon, at new moon or every day. ' +
            'On the Alerts tab, open Moon phase under Sky and choose which status bars show it. ' +
            'Pick Today + tomorrow under Days to see it the day before too.',
        open: { sheet: 'odMoon' },
        when: onDemandOffered
    },
    {
        id: 'pluginValues',
        since: '3.5.0',
        title: 'More than one plugin value',
        // Each slot's Plugin value is its own, set in the slot's own dialog
        // (page/status-bars/plugin-value-schema.js), a bar may hold the item in several slots
        // (status-line-catalog.js repeatsInBar), and its Which row picks one of several things a
        // plugin offers the value for (plugin-value-page.js whichShown).
        html: 'Each Plugin value slot now shows a value of its own, and one bar can hold several. Set ' +
            'another slot to Plugin value and tap its Edit button to pick what it shows. If a plugin has ' +
            'the value for several things, such as rooms, pick one under Which.',
        open: { tab: 'watch' },
        when: pluginValueOffered
    },
    {
        id: 'pluginValueIcon',
        since: '3.5.0',
        title: 'An icon for a plugin value',
        // The Plugin value slot's dialog: its Look and Icon rows (page/status-bars/plugin-value-page.js),
        // whose icons that turn are offered for a value that is on or off, its Label row beside one
        // (plugin-values.js labelText), and its Updates row's new choice (EVERY_CHOICES).
        html: 'A Plugin value slot can show an icon. Tap its Edit button and pick Icon + text or Icon ' +
            'under Look. Switch, Wi-Fi and Bluetooth turn off while the value is off, and can have a Label ' +
            'such as Lamp beside them. Under Updates, you can now pick Every 15 minutes.',
        open: { tab: 'watch' },
        when: pluginValueOffered
    },
    {
        id: 'complications',
        since: '3.5.0',
        title: 'Your complications in a status bar',
        // The Plugin value slot's dialog lists the complications the user picked in the Pebble
        // app under Complications, right after None (page/status-bars/plugin-value-page.js).
        html: 'Status bar slots can show the complications you picked in the Pebble app. Set a slot ' +
            'to Plugin value, tap Edit, then pick Complications and the one to show.',
        open: { tab: 'watch' },
        when: pluginValueOffered
    },
    {
        id: 'pluginValue',
        since: '3.4.0',
        title: 'Plugin values',
        // The Plugin value slot (status-line-catalog.js 'pluginValue'), in any bar, so Show me
        // opens the Status bars tab. Its dialog lists what the phone's plugins serve.
        html: 'Status bar slots can show plugin values, such as your phone\'s network type. Set a slot ' +
            'to Plugin value, tap Edit, then pick the plugin and its value.',
        open: { tab: 'watch' },
        when: pluginValueOffered
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
            'can show how many days the watch has left. Tap its Edit button in the Watch bar, ' +
            batteryDays.DAYS_STEPS,
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
