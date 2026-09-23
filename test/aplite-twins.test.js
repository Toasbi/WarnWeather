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

// main()'s handling of an unusable base ref, run as CI runs it: a child process
// in a scratch dir that has a src/c tree but is no git repo, so every git call
// throws (as `git diff origin/main...HEAD` does after a shallow checkout or a
// base fetched under another ref name).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'check-aplite-twins.js');

/**
 * Run the check script in a non-git scratch dir.
 * @param {string|undefined} base APLITE_TWINS_BASE, or undefined to leave it unset.
 * @returns {{status: number, stderr: string}} Exit status and stderr.
 */
function runOutsideGit(base) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aplite-twins-'));
  try {
    fs.mkdirSync(path.join(dir, 'src', 'c'), { recursive: true });
    const env = Object.assign({}, process.env, { GIT_CEILING_DIRECTORIES: path.dirname(dir) });
    delete env.APLITE_TWINS_BASE;
    delete env.GIT_DIR;
    if (base !== undefined) env.APLITE_TWINS_BASE = base;
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, env: env, encoding: 'utf8' });
    return { status: r.status, stderr: r.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('main: an explicit APLITE_TWINS_BASE that git cannot use FAILS the check (CI must not fail open)', () => {
  const r = runOutsideGit('origin/main');
  assert.strictEqual(r.status, 1, 'the required check must not pass with the drift guard skipped');
  assert.match(r.stderr, /Drift check could not run against APLITE_TWINS_BASE=origin\/main/);
});

test('main: the default base still skips the drift check gracefully (shallow local checkout)', () => {
  const r = runOutsideGit(undefined);
  assert.strictEqual(r.status, 0);
  assert.match(r.stderr, /Skipping drift check/);
});
