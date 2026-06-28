const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { hasValidNotification } = require('../scripts/check-release-notification.js');

test('hasValidNotification accepts a complete entry', () => {
  assert.equal(hasValidNotification({ '1.5.0': { title: 'New', body: 'Stuff' } }, '1.5.0'), true);
});

test('hasValidNotification rejects missing / blank / whitespace / partial entries', () => {
  assert.equal(hasValidNotification({}, '1.5.0'), false, 'missing entry');
  assert.equal(hasValidNotification({ '1.5.0': { title: '', body: 'B' } }, '1.5.0'), false, 'blank title');
  assert.equal(hasValidNotification({ '1.5.0': { title: 'T', body: '   ' } }, '1.5.0'), false, 'whitespace body');
  assert.equal(hasValidNotification({ '1.5.0': { title: 'T' } }, '1.5.0'), false, 'missing body');
});

test('the current package.template.json version has a valid notification entry', () => {
  const root = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.template.json'), 'utf8'));
  const notifications = JSON.parse(fs.readFileSync(path.join(root, 'release-notifications.json'), 'utf8'));
  assert.equal(hasValidNotification(notifications, String(pkg.version).trim()), true,
    'package.template.json version must have a non-empty release-notifications.json entry');
});
