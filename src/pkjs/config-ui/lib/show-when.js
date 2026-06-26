// src/pkjs/config-ui/lib/show-when.js — ES5. Dual-use: PConf.showWhen global + module.exports.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
PConf.showWhen = (function () {
  /**
   * Own-property check that is safe against inherited/overridden hasOwnProperty.
   * @param {Object} o Object to test.
   * @param {string} k Key name.
   * @returns {boolean} True if o has its own property k.
   */
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  /**
   * Evaluate a showWhen predicate against a context of current values/env.
   * Supports all/any/not combinators and eq/ne/in/nin/truthy leaf tests; an array is treated as { all: [...] }.
   * @param {(Object|Array|null|undefined)} pred Predicate tree; null/undefined is treated as always-true.
   * @param {Object} ctx Context with setting values by key and an optional .env map.
   * @returns {boolean} Whether the predicate is satisfied.
   */
  function evaluate(pred, ctx) {
    if (!pred) { return true; }
    if (Object.prototype.toString.call(pred) === '[object Array]') { return evaluate({ all: pred }, ctx); }
    if (pred.all) { for (var i = 0; i < pred.all.length; i += 1) { if (!evaluate(pred.all[i], ctx)) { return false; } } return true; }
    if (pred.any) { for (var j = 0; j < pred.any.length; j += 1) { if (evaluate(pred.any[j], ctx)) { return true; } } return false; }
    if (has(pred, 'not')) { return !evaluate(pred.not, ctx); }
    var subject = has(pred, 'env') ? (ctx.env ? ctx.env[pred.env] : undefined) : ctx[pred.key];
    if (has(pred, 'eq')) { return subject === pred.eq; }
    if (has(pred, 'ne')) { return subject !== pred.ne; }
    if (has(pred, 'in')) { return pred['in'].indexOf(subject) >= 0; }
    if (has(pred, 'nin')) { return pred.nin.indexOf(subject) < 0; }
    return Boolean(subject);
  }
  /**
   * Build the combined visibility predicate for a schema item from its
   * showWhen and a COLOR capability (which requires a color display).
   * @param {Object} item Schema item; may carry .showWhen and .capabilities.
   * @returns {(Object|null)} The predicate (single, or wrapped in { all }), or null when the item is unconditionally visible.
   */
  function itemPredicate(item) {
    var preds = [];
    if (item.showWhen) { preds.push(item.showWhen); }
    if (item.capabilities && item.capabilities.indexOf('COLOR') >= 0) { preds.push({ env: 'color' }); }
    if (preds.length === 0) { return null; }
    if (preds.length === 1) { return preds[0]; }
    return { all: preds };
  }
  /**
   * Whether a schema item should be visible given the current context.
   * @param {Object} item Schema item.
   * @param {Object} ctx Context with setting values and an optional .env map.
   * @returns {boolean} True if the item is visible.
   */
  function isVisible(item, ctx) { var p = itemPredicate(item); return p === null ? true : evaluate(p, ctx); }
  return { evaluate: evaluate, itemPredicate: itemPredicate, isVisible: isVisible };
})();
if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.showWhen; }
