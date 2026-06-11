// Standalone Node test for PayloadComparator.
// Run with: node scripts/test-payload-comparator.js
// Exits non-zero on the first failed assertion.

var assert = require('assert');

var store = {};
global.localStorage = {
    getItem: function(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
    setItem: function(key, value) { store[key] = String(value); },
    removeItem: function(key) { delete store[key]; }
};

var PayloadComparator = require('../src/pkjs/payload-comparator.js');

var CATEGORIES = [
    { name: 'forecast', cacheKey: 'testForecast', keys: ['TEMP', 'START'] },
    { name: 'status', cacheKey: 'testStatus', keys: ['CITY'] }
];

var comparator = new PayloadComparator(CATEGORIES);

// Nothing cached yet -> every present category reports changed
var result = comparator.compare({ TEMP: [1, 2], START: 100, CITY: 'Berlin' });
assert.strictEqual(result.categories.length, 2, 'both categories present');
assert.strictEqual(result.categories[0].name, 'forecast');
assert.strictEqual(result.categories[0].changed, true);
assert.deepStrictEqual(result.categories[0].subset, { TEMP: [1, 2], START: 100 });
assert.strictEqual(result.categories[0].cacheKey, 'testForecast');
assert.strictEqual(result.categories[0].serialized, JSON.stringify({ TEMP: [1, 2], START: 100 }));
assert.strictEqual(result.categories[1].changed, true);

// Cached category reports unchanged
localStorage.setItem('testStatus', JSON.stringify({ CITY: 'Berlin' }));
result = comparator.compare({ TEMP: [1, 2], START: 100, CITY: 'Berlin' });
assert.strictEqual(result.categories[1].changed, false, 'cached status must report unchanged');

// Categories absent from the payload are not listed
result = comparator.compare({ CITY: 'Berlin' });
assert.strictEqual(result.categories.length, 1);
assert.strictEqual(result.categories[0].name, 'status');

// Serialization is stable across payload property order
localStorage.setItem('testForecast', JSON.stringify({ TEMP: [1, 2], START: 100 }));
result = comparator.compare({ START: 100, TEMP: [1, 2], CITY: 'Berlin' });
assert.strictEqual(result.categories[0].changed, false, 'key order must not affect serialization');

console.log('All payload-comparator assertions passed.');
