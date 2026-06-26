// src/pkjs/config-ui/lib/schema-walk.js — ES5. Single-source schema traversal, dual-use.
// In the built page, all lib files share one concatenated PConf; in Node unit tests, dual-use
// modules attach to global.PConf so a test can require them in any order and share state.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
/**
 * Visit every item in the schema, walking tabs -> sections -> items.
 * @param {Object} schema The config schema with a .tabs array.
 * @param {function(Object, Object, Object): void} fn Callback invoked as (item, section, tab) per item.
 * @returns {void}
 */
function eachItem(schema, fn) {
  schema.tabs.forEach(function (t) {
    t.sections.forEach(function (sec) { sec.items.forEach(function (it) { fn(it, sec, t); }); });
  });
}
PConf.schemaWalk = { eachItem: eachItem };
if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.schemaWalk; }
