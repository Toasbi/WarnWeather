// test/polyfills.test.js
//
// aplite (Pebble Classic / Steel) runs an old JavaScriptCore that predates
// ES6, so Object.assign and several Array.prototype methods are undefined.
// The PKJS bundle calls Object.assign on the weather-fetch path, which threw
// "undefined is not a function" and aborted every fetch on aplite.
//
// These tests delete the natives to simulate that runtime, then assert the
// polyfills module restores correct, ES5-safe behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const installPolyfills = require('../src/pkjs/polyfills');

// Run `body` with `name` removed from `obj`, then restore the original as a
// non-enumerable, configurable, writable property (matching how natives sit).
function withoutOwn(obj, name, body) {
  const had = Object.prototype.hasOwnProperty.call(obj, name);
  const original = obj[name];
  delete obj[name];
  try {
    body();
  } finally {
    if (had) {
      Object.defineProperty(obj, name, {
        value: original,
        configurable: true,
        writable: true,
        enumerable: false
      });
    }
  }
}

test('Object.assign polyfill merges sources left-to-right into the target', () => {
  withoutOwn(Object, 'assign', () => {
    installPolyfills();
    assert.equal(typeof Object.assign, 'function');

    const target = { a: 1 };
    const result = Object.assign(target, { b: 2 }, { b: 3, c: 4 });

    assert.equal(result, target); // returns the same target reference
    assert.deepEqual(target, { a: 1, b: 3, c: 4 });
  });
});

test('Object.assign polyfill ignores null and undefined sources', () => {
  withoutOwn(Object, 'assign', () => {
    installPolyfills();
    const result = Object.assign({}, null, undefined, { x: 1 });
    assert.deepEqual(result, { x: 1 });
  });
});

test('Array.prototype.find / findIndex polyfills locate by predicate', () => {
  withoutOwn(Array.prototype, 'find', () => {
    withoutOwn(Array.prototype, 'findIndex', () => {
      installPolyfills();

      assert.equal([1, 2, 3].find((x) => x === 2), 2);
      assert.equal([1, 2, 3].find((x) => x === 9), undefined);
      assert.equal([1, 2, 3].findIndex((x) => x === 3), 2);
      assert.equal([1, 2, 3].findIndex((x) => x === 9), -1);

      // honours the optional thisArg
      const ctx = { target: 2 };
      assert.equal([1, 2, 3].find(function (x) { return x === this.target; }, ctx), 2);
    });
  });
});

test('Array.prototype.includes polyfill matches values and NaN', () => {
  withoutOwn(Array.prototype, 'includes', () => {
    installPolyfills();
    assert.equal([1, 2, 3].includes(2), true);
    assert.equal([1, 2, 3].includes(9), false);
    assert.equal([NaN].includes(NaN), true); // SameValueZero, unlike indexOf
  });
});

test('polyfilled Array.prototype methods are non-enumerable', () => {
  withoutOwn(Array.prototype, 'find', () => {
    withoutOwn(Array.prototype, 'findIndex', () => {
      withoutOwn(Array.prototype, 'includes', () => {
        installPolyfills();

        assert.equal(Array.prototype.propertyIsEnumerable('find'), false);
        assert.equal(Array.prototype.propertyIsEnumerable('findIndex'), false);
        assert.equal(Array.prototype.propertyIsEnumerable('includes'), false);

        // for...in over an array must still only see its index keys.
        const keys = [];
        for (const k in ['a', 'b']) keys.push(k);
        assert.deepEqual(keys, ['0', '1']);
      });
    });
  });
});

test('does not clobber native implementations when they already exist', () => {
  const nativeAssign = Object.assign;
  const nativeFind = Array.prototype.find;
  installPolyfills();
  assert.equal(Object.assign, nativeAssign);
  assert.equal(Array.prototype.find, nativeFind);
});
