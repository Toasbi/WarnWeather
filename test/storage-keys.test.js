const test = require('node:test');
const assert = require('node:assert/strict');
const KEYS = require('../src/pkjs/storage-keys');

test('LAST_HOLIDAY_DAY_KEY matches the literal existing installs already persist', function () {
    // Must stay exactly 'last_holiday_day': changing it strands the day stamp of
    // every upgrading install, causing a spurious first-tick holiday resend.
    assert.equal(KEYS.LAST_HOLIDAY_DAY_KEY, 'last_holiday_day');
});
