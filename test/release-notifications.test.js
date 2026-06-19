// test/release-notifications.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const rn = require('../src/pkjs/release-notifications');

test('parseSemver tolerates prefixes and pre-release/build metadata', () => {
  assert.deepEqual(rn.parseSemver('v1.25.3-beta+build'), [1, 25, 3]);
  assert.deepEqual(rn.parseSemver('2.0'), [2, 0, 0]);
  assert.deepEqual(rn.parseSemver(undefined), [0, 0, 0]);
});

test('compareSemver orders by major, minor, patch', () => {
  assert.equal(rn.compareSemver('1.2.0', '1.1.9'), 1);
  assert.equal(rn.compareSemver('1.1.0', '1.1.0'), 0);
  assert.equal(rn.compareSemver('1.0.0', '2.0.0'), -1);
});

test('getLatestUnseenReleaseNotification picks newest <= appVersion and > maxNotified', () => {
  const pkg = {
    version: '1.4.0',
    releaseNotifications: {
      '1.2.0': { title: 'a', body: 'A' },
      '1.3.0': { title: 'b', body: 'B' },
      '1.9.0': { title: 'c', body: 'C' } // newer than appVersion → excluded
    }
  };
  const out = rn.getLatestUnseenReleaseNotification(pkg, '1.2.0', '1.4.0');
  assert.deepEqual(out, { version: '1.3.0', title: 'b', body: 'B' });
});

test('decideReleaseNotification: upgrade shows newest unseen', () => {
  const pkg = { version: '1.3.0', releaseNotifications: { '1.3.0': { title: 't', body: 'b' } } };
  const d = rn.decideReleaseNotification({
    pkg, manifest: null, hadExistingInstall: true, forceVersionSpec: '', maxNotified: '1.2.0'
  });
  assert.equal(d.shouldNotify, true);
  assert.equal(d.shouldNotifyUpgrade, true);
  assert.equal(d.title, 't');
  assert.equal(d.unseenVersion, '1.3.0');
});

test('decideReleaseNotification: force from manifest overrides, no upgrade flag', () => {
  const pkg = { version: '1.3.0', releaseNotifications: {} };
  const manifest = { '1.0.0': { title: 'forced', body: 'fb' } };
  const d = rn.decideReleaseNotification({
    pkg, manifest, hadExistingInstall: true, forceVersionSpec: '1.0.0', maxNotified: '9.9.9'
  });
  assert.equal(d.shouldNotifyForce, true);
  assert.equal(d.shouldNotifyUpgrade, false);
  assert.equal(d.title, 'forced');
});

test('decideReleaseNotification: nothing to show on fresh install', () => {
  const pkg = { version: '1.3.0', releaseNotifications: { '1.3.0': { title: 't', body: 'b' } } };
  const d = rn.decideReleaseNotification({
    pkg, manifest: null, hadExistingInstall: false, forceVersionSpec: '', maxNotified: '0.0.0'
  });
  assert.equal(d.shouldNotify, false);
  assert.equal(d.isNewer, true); // first-install marker path handled by index.js
});
