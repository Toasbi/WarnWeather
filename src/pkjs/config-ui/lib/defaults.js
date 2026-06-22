// src/pkjs/config-ui/lib/defaults.js — ES5. Schema-derived defaults + color-key set.
var eachItem = require('./schema-walk.js').eachItem;
function deriveDefaults(schema) {
  var out = {};
  eachItem(schema, function (it) {
    if (it.messageKey && typeof it.defaultValue !== 'undefined') { out[it.messageKey] = it.defaultValue; }
  });
  return out;
}
function deriveColorKeys(schema) {
  var out = [];
  eachItem(schema, function (it) { if (it.type === 'color' && it.messageKey) { out.push(it.messageKey); } });
  return out;
}
module.exports = { deriveDefaults: deriveDefaults, deriveColorKeys: deriveColorKeys };
