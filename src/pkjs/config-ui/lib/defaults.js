// src/pkjs/config-ui/lib/defaults.js — ES5. Schema-derived defaults + color-key set.
var eachItem = require('./schema-walk.js').eachItem;
/**
 * Build a messageKey -> defaultValue map from every schema item that has both.
 * Items using `defaultFrom` (e.g. the status slots) are intentionally OMITTED here:
 * their env-aware default is resolved at hydrate/bake time, and hydrate favors
 * injected/saved values over resolved ones. Seeding them here would make a stale
 * seed value win over the correct resolved default (e.g. HR vs distance by platform).
 * So is a `sticky: false` item, which the page leaves out of its save blob while it
 * holds its default (engine.js serialize): it stays absent in the store, where a seed
 * backfill would pin it again on the next boot.
 * @param {Object} schema The config schema (tabs/sections/items).
 * @returns {Object} Map of messageKey to its defaultValue.
 */
function deriveDefaults(schema) {
  var out = {};
  eachItem(schema, function (it) {
    // Only static defaultValue items are seeded; defaultFrom items stay unseeded (see
    // above), even one that also carries a defaultValue (resolveDefaultFrom ignores it),
    // and so do sticky: false ones. A page-only item (uiOnly) is never stored, so it is
    // never seeded either.
    if (it.messageKey && !it.defaultFrom && it.sticky !== false && !it.uiOnly
        && typeof it.defaultValue !== 'undefined') {
      out[it.messageKey] = it.defaultValue;
    }
  });
  return out;
}
/**
 * Collect the messageKeys of all color-type items in the schema.
 * @param {Object} schema The config schema (tabs/sections/items).
 * @returns {string[]} List of color-item messageKeys.
 */
function deriveColorKeys(schema) {
  var out = [];
  eachItem(schema, function (it) { if (it.type === 'color' && it.messageKey) { out.push(it.messageKey); } });
  return out;
}
module.exports = { deriveDefaults: deriveDefaults, deriveColorKeys: deriveColorKeys };
