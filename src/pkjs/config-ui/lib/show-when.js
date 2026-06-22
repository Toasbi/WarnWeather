// src/pkjs/config-ui/lib/show-when.js — ES5. Dual-use: PConf.showWhen global + module.exports.
var PConf = (typeof PConf !== 'undefined') ? PConf
  : (typeof global !== 'undefined') ? (global.PConf = global.PConf || {}) : {};
PConf.showWhen = (function () {
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
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
  function itemPredicate(item) {
    var preds = [];
    if (item.showWhen) { preds.push(item.showWhen); }
    if (item.capabilities && item.capabilities.indexOf('COLOR') >= 0) { preds.push({ env: 'color' }); }
    if (preds.length === 0) { return null; }
    if (preds.length === 1) { return preds[0]; }
    return { all: preds };
  }
  function isVisible(item, ctx) { var p = itemPredicate(item); return p === null ? true : evaluate(p, ctx); }
  return { evaluate: evaluate, itemPredicate: itemPredicate, isVisible: isVisible };
})();
if (typeof module !== 'undefined' && module.exports) { module.exports = PConf.showWhen; }
