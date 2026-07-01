'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  invariantViolations,
  driftViolations,
} = require('../scripts/check-aplite-twins');

const PALETTE = [
  'src/c/appendix/palette.c',
  'src/c/appendix/palette.h',
  'src/c/appendix/palette_aplite.c',
];

test('invariantViolations: clean when a twin has base and header', () => {
  assert.deepStrictEqual(invariantViolations(PALETTE), []);
});

test('invariantViolations: flags a twin missing its base .c', () => {
  const v = invariantViolations(['src/c/appendix/palette.h', 'src/c/appendix/palette_aplite.c']);
  assert.strictEqual(v.length, 1);
  assert.match(v[0], /no same-directory base/);
});

test('invariantViolations: flags a twin missing its header .h', () => {
  const v = invariantViolations(['src/c/appendix/palette.c', 'src/c/appendix/palette_aplite.c']);
  assert.strictEqual(v.length, 1);
  assert.match(v[0], /no shared header/);
});

test('invariantViolations: does not satisfy a twin from another directory', () => {
  // layers/foo_aplite.c must NOT be satisfied by appendix/foo.c + appendix/foo.h.
  const v = invariantViolations([
    'src/c/appendix/foo.c',
    'src/c/appendix/foo.h',
    'src/c/layers/foo_aplite.c',
  ]);
  assert.strictEqual(v.length, 2); // missing same-dir base AND header
});

test('driftViolations: flags a base changed without its twin', () => {
  const v = driftViolations(PALETTE, ['src/c/appendix/palette.c'], []);
  assert.strictEqual(v.length, 1);
  assert.match(v[0], /changed but .* did not/);
});

test('driftViolations: clean when the twin also changed', () => {
  const v = driftViolations(
    PALETTE,
    ['src/c/appendix/palette.c', 'src/c/appendix/palette_aplite.c'],
    []
  );
  assert.deepStrictEqual(v, []);
});

test('driftViolations: clean when the change is acknowledged', () => {
  const v = driftViolations(PALETTE, ['src/c/appendix/palette.c'], ['src/c/appendix/palette.c']);
  assert.deepStrictEqual(v, []);
});

test('driftViolations: ignores base files that have no twin', () => {
  const v = driftViolations(
    ['src/c/appendix/persist.c', 'src/c/appendix/persist.h'],
    ['src/c/appendix/persist.c'],
    []
  );
  assert.deepStrictEqual(v, []);
});
