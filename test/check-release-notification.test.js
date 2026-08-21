const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { hasValidNotification, isFeatureRelease } = require('../scripts/check-release-notification.js');

test('hasValidNotification accepts a complete entry', () => {
  assert.equal(hasValidNotification({ '1.5.0': { title: 'New', body: 'Stuff' } }, '1.5.0'), true);
});

test('hasValidNotification rejects missing / blank / whitespace / partial entries', () => {
  assert.equal(hasValidNotification({}, '1.5.0'), false, 'missing entry');
  assert.equal(hasValidNotification({ '1.5.0': { title: '', body: 'B' } }, '1.5.0'), false, 'blank title');
  assert.equal(hasValidNotification({ '1.5.0': { title: 'T', body: '   ' } }, '1.5.0'), false, 'whitespace body');
  assert.equal(hasValidNotification({ '1.5.0': { title: 'T' } }, '1.5.0'), false, 'missing body');
});

// The boot toast interrupts the user on first launch after an upgrade, so it is
// spent on releases that give them something to do. Release Please bumps a feat
// to x.(y+1).0 and a fix to x.y.(z+1), which makes a zero patch component the
// feature/patch discriminator on its own.

test('isFeatureRelease: a zero patch component is a feature release', () => {
  assert.equal(isFeatureRelease('1.13.0'), true);
  assert.equal(isFeatureRelease('2.0.0'), true);
  assert.equal(isFeatureRelease('0.1.0'), true);
});

test('isFeatureRelease: a non-zero patch component is a fix-only release', () => {
  assert.equal(isFeatureRelease('1.13.1'), false);
  assert.equal(isFeatureRelease('1.13.2'), false);
  assert.equal(isFeatureRelease('1.13.10'), false, 'two-digit patch, not a string compare');
});

test('isFeatureRelease fails CLOSED on anything it cannot parse', () => {
  // A spurious failure costs one line of JSON; a miss ships a feature with no
  // "what's new" at all. So an unparseable version demands the toast.
  ['', '1.13', 'v1.13.0', '1.13.0-beta', 'nonsense', null, undefined]
    .forEach((v) => assert.equal(isFeatureRelease(v), true, JSON.stringify(v)));
});

test('the current package.template.json version satisfies the toast policy', () => {
  // Required for a feature release, optional for a patch — but ALWAYS valid when
  // present, because prepare-package.sh throws on a half-filled entry.
  const root = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.template.json'), 'utf8'));
  const notifications = JSON.parse(fs.readFileSync(path.join(root, 'release-notifications.json'), 'utf8'));
  const version = String(pkg.version).trim();
  const present = Object.prototype.hasOwnProperty.call(notifications, version);

  if (isFeatureRelease(version)) {
    assert.equal(hasValidNotification(notifications, version), true,
      `feature release ${version} must have a non-empty release-notifications.json entry`);
    return;
  }
  if (present) {
    assert.equal(hasValidNotification(notifications, version), true,
      `${version} has an entry, so it must be complete`);
  }
});

test('every entry in the shipped manifest is complete', () => {
  // prepare-package.sh normalizes EVERY entry at or below the built version, not
  // just the current one, and throws on any that is half-filled — so a stale
  // broken entry for an old version breaks the build, not just its own release.
  const root = path.resolve(__dirname, '..');
  const notifications = JSON.parse(fs.readFileSync(path.join(root, 'release-notifications.json'), 'utf8'));
  Object.keys(notifications).forEach((version) => {
    assert.equal(hasValidNotification(notifications, version), true, `${version} entry is complete`);
  });
});
