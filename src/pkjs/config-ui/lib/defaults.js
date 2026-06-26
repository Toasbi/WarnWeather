// src/pkjs/config-ui/lib/defaults.js — ES5. Schema-derived defaults + color-key set.
var eachItem = require('./schema-walk.js').eachItem;
/**
 * Build a messageKey -> defaultValue map from every schema item that has both.
 * @param {Object} schema The config schema (tabs/sections/items).
 * @returns {Object} Map of messageKey to its defaultValue.
 */
function deriveDefaults(schema) {
  var out = {};
  eachItem(schema, function (it) {
    if (it.messageKey && typeof it.defaultValue !== 'undefined') { out[it.messageKey] = it.defaultValue; }
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
