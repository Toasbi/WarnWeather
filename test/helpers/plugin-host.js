// test/helpers/plugin-host.js
//
// The Pebble app's side of the plugin reads, for their tests:
//   - A Pebble app with plugins for the readers that read another app's plugin once at a time
//     (plugin-read-schedule.js and its readers, battery-estimate.js and plugin-value-source.js)
//     and for complication-list.js: it records each subscription and lets the test answer it,
//     lists the plugins it is given, and holds a read's timeout for the test to fire. The fake
//     for a reader that stays subscribed, which answers the latest request, is fake-battery.js
//     fakePluginPebble.
//   - A plugin's reading as the reader hands it over (reading), and the Pebble app's
//     Preferences plugin with the user's complications: its source's declaration, its answer,
//     the plugins the complications' readings come from and the permissions an app declares.

const pluginValues = require('../../src/pkjs/status-bars/domain/plugin-values.js');

/** The fields of a subscription's config a request carries (plugin-reader.js watch). */
const REQUEST_FIELDS = ['category', 'item', 'properties', 'plugin', 'limit'];

/**
 * @param {Array<Object>} [plugins] What its Pebble.enumeratePlugins() lists. Without them it has
 *   no enumeratePlugins: a Pebble app that cannot list its plugins.
 * @returns {Object} The fake Pebble object, with .subs: each {request, push(envelope),
 *   fail(code), unsubscribed}, its request holding only the fields the config set.
 */
function fakePebble(plugins) {
  const pebble = { subs: [] };
  if (plugins) { pebble.enumeratePlugins = () => plugins; }
  pebble.subscribeToSource = (config) => {
    const request = {};
    REQUEST_FIELDS.forEach((k) => { if (config[k] !== undefined) { request[k] = config[k]; } });
    const sub = {
      request: request,
      unsubscribed: 0,
      push: (envelope) => config.onData(envelope),
      fail: (code) => config.onError({ code: code, message: code })
    };
    pebble.subs.push(sub);
    return { unsubscribe: () => { sub.unsubscribed += 1; } };
  };
  return pebble;
}

/**
 * Timers for a read's timeout (plugin-reader.js readOnce) that only the test fires.
 * @param {Array<{fn: function(): void, ms: number}>} into Where each timer set goes.
 * @returns {{setTimeout: function, clearTimeout: function}}
 */
function heldTimers(into) {
  return {
    setTimeout: (fn, ms) => { into.push({ fn: fn, ms: ms }); return into.length; },
    clearTimeout: () => {}
  };
}

/**
 * A reading as plugin-reader.js readingOf hands it over, and as plugin-value-reads.js valueOf
 * keeps it.
 * @param {Object} fields The fields that are set.
 * @returns {Object} The reading, every other field null.
 */
function reading(fields) {
  return Object.assign({ short: null, time: null, number: null, unit: null, state: null, long: null }, fields);
}

/**
 * What an app declares, as the Pebble app keys it (plugin-reads.js declaredKeys): Internet for
 * one domain, and no Calendar, which the calendars here ask for.
 */
const PERMS = ['Location', 'Internet/api.met.no', 'ShowNotifications', 'Health'];

/** The Preferences plugin's source of the user's complications, as it declares it. */
const COMPLICATIONS_SOURCE = { category: 'preferences', items: ['complications'], supportsMultiple: true,
  properties: { category: ['shortText'], item: ['shortText'], index: ['numericValue'], property: ['shortText'] } };

/**
 * @param {Array<Object>} [sources] Its sources' declarations (default: the complications'
 *   alone).
 * @returns {Object} The Pebble app's Preferences plugin, as Pebble.enumeratePlugins() lists it.
 */
function preferencesPlugin(sources) {
  return { uuid: pluginValues.PREFERENCES, name: 'Preferences', sources: sources || [COMPLICATIONS_SOURCE],
    actions: [] };
}

/**
 * One place of the Preferences plugin's answer, as the Pebble app sends it.
 * @param {string} instanceId The place.
 * @param {string} category The reading's source: its category.
 * @param {string} item Its item.
 * @param {number} index Which instance.
 * @param {string} property Which property.
 * @returns {Object} The instance.
 */
function complicationPlace(instanceId, category, item, index, property) {
  return { instanceId: instanceId, properties: { category: { shortText: { text: category } },
    item: { shortText: { text: item } }, index: { numericValue: { value: index } },
    property: { shortText: { text: property } } } };
}

/**
 * The Preferences plugin's answer: the user's complications, as the Pebble app sends them.
 * @param {Array<Array>} places [instanceId, category, item, index, property] for each place.
 * @returns {Object} The envelope.
 */
function complicationsAnswer(places) {
  return { pluginUuid: pluginValues.PREFERENCES, validUntilMs: null,
    instances: places.map((place) => complicationPlace(...place)) };
}

/**
 * Plugins the complications' readings come from, as Pebble.enumeratePlugins() lists them: the
 * weather asks for Location, the phone for nothing, the calendar for Calendar.
 */
const PLUGINS = [
  { uuid: 'w', name: 'Weather', sources: [{ category: 'weather', items: ['location'], callerPermissions: ['Location'] }] },
  { uuid: 'p', name: 'Phone', sources: [{ category: 'phone', items: ['phone_state'] }] },
  { uuid: 'c', name: 'Calendar', sources: [{ category: 'calendar', items: ['event'], callerPermissions: ['Calendar'] }] }];

module.exports = {
  fakePebble, heldTimers, reading, PERMS, COMPLICATIONS_SOURCE, preferencesPlugin, complicationPlace,
  complicationsAnswer, PLUGINS
};
