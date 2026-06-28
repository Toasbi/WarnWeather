const test = require('node:test');
const assert = require('node:assert/strict');
const updateCheck = require('../src/pkjs/update-check.js');

function storeJson(version) {
  return JSON.stringify({ data: [{ latest_release: { version: version } }] });
}

test('parseLatestVersion extracts a valid version', () => {
  assert.equal(updateCheck.parseLatestVersion(storeJson('1.5.0')), '1.5.0');
});

test('parseLatestVersion trims whitespace', () => {
  assert.equal(updateCheck.parseLatestVersion(storeJson(' 1.5.0 ')), '1.5.0');
});

test('parseLatestVersion returns null on malformed JSON', () => {
  assert.equal(updateCheck.parseLatestVersion('not json'), null);
});

test('parseLatestVersion returns null when data is missing', () => {
  assert.equal(updateCheck.parseLatestVersion(JSON.stringify({})), null);
});

test('parseLatestVersion returns null when data array is empty', () => {
  assert.equal(updateCheck.parseLatestVersion(JSON.stringify({ data: [] })), null);
});

test('parseLatestVersion returns null when latest_release is missing', () => {
  assert.equal(updateCheck.parseLatestVersion(JSON.stringify({ data: [{}] })), null);
});

test('parseLatestVersion returns null when version is not a string', () => {
  assert.equal(updateCheck.parseLatestVersion(storeJson(150)), null);
});

test('parseLatestVersion returns null on empty version string', () => {
  assert.equal(updateCheck.parseLatestVersion(storeJson('   ')), null);
});

test('commonAvailableVersion returns the semver min of all stores', () => {
  assert.equal(updateCheck.commonAvailableVersion(['1.6.0', '1.5.0']), '1.5.0');
});

test('commonAvailableVersion returns null if any store is null', () => {
  assert.equal(updateCheck.commonAvailableVersion(['1.6.0', null]), null);
});

test('commonAvailableVersion returns null on empty array', () => {
  assert.equal(updateCheck.commonAvailableVersion([]), null);
});

test('decide: newer common version notifies', () => {
  const d = updateCheck.decideUpdateNotification({
    storeVersions: ['1.6.0', '1.6.0'], appVersion: '1.5.0', updateNotifiedVersion: '0.0.0'
  });
  assert.equal(d.shouldNotify, true);
  assert.equal(d.version, '1.6.0');
});

test('decide: equal common version does not notify', () => {
  const d = updateCheck.decideUpdateNotification({
    storeVersions: ['1.5.0', '1.5.0'], appVersion: '1.5.0', updateNotifiedVersion: '0.0.0'
  });
  assert.equal(d.shouldNotify, false);
});

test('decide: older common version does not notify', () => {
  const d = updateCheck.decideUpdateNotification({
    storeVersions: ['1.4.0', '1.4.0'], appVersion: '1.5.0', updateNotifiedVersion: '0.0.0'
  });
  assert.equal(d.shouldNotify, false);
});

test('decide: already-notified version does not notify again', () => {
  const d = updateCheck.decideUpdateNotification({
    storeVersions: ['1.6.0', '1.6.0'], appVersion: '1.5.0', updateNotifiedVersion: '1.6.0'
  });
  assert.equal(d.shouldNotify, false);
});

test('decide: announces the min (lagging store), still newer than installed', () => {
  const d = updateCheck.decideUpdateNotification({
    storeVersions: ['1.6.0', '1.5.0'], appVersion: '1.4.1', updateNotifiedVersion: '0.0.0'
  });
  assert.equal(d.shouldNotify, true);
  assert.equal(d.version, '1.5.0');
});

test('decide: lagging store below installed blocks the nudge', () => {
  const d = updateCheck.decideUpdateNotification({
    storeVersions: ['1.6.0', '1.4.1'], appVersion: '1.5.0', updateNotifiedVersion: '0.0.0'
  });
  assert.equal(d.shouldNotify, false);
  assert.equal(d.version, '1.4.1');
});

test('decide: a null store version blocks notification', () => {
  const d = updateCheck.decideUpdateNotification({
    storeVersions: ['1.6.0', null], appVersion: '1.5.0', updateNotifiedVersion: '0.0.0'
  });
  assert.equal(d.shouldNotify, false);
  assert.equal(d.version, null);
});

test('commonAvailableVersion trims whitespace from version strings', () => {
  assert.equal(updateCheck.commonAvailableVersion([' 1.5.0 ', '1.6.0']), '1.5.0');
});
