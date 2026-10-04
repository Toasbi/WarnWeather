// test/helpers/alert-entries.js
//
// A test-side reader of the weather alerts' entry tuple (ALERT_ENTRIES_UINT8), walked
// the way src/c/appendix/alert_set.c parses it (a header byte has bit 7, a value
// runs to the next header), so the tests that decode what the phone bakes share
// one reader instead of each re-deriving the header bits. The constants it reads
// are the phone's, which test/alert-entries-contract.test.js pins to the C header.
'use strict';
const assert = require('node:assert');
const th = require('../../src/pkjs/status-thresholds.js');
const wire = require('../../src/pkjs/status-wire.js');

/**
 * Decode an ALERT_ENTRIES_UINT8 byte array. Asserts the tuple is well formed the
 * way the watch's alert_set_bytes_ok requires: it opens on a header, and every
 * other byte is either a header or a printable-ASCII value byte.
 * @param {number[]} bytes the baked tuple
 * @returns {Array<{kind: number, level: number, day: number, mark: ?string,
 *     value: string}>} kind the ThreshKind; level 1 warn / 2 danger; day the wire's
 *     day code (0 today, else tomorrow's mark code); mark tomorrow's
 *     ALERT_NEXT_DAY_MARKS key, null for a today entry; value the printed text
 */
function decodeAlerts(bytes) {
  const out = [];
  bytes.forEach((b, i) => {
    if (b & wire.ALERT_HEADER) {
      const day = (b >> wire.ALERT_DAY_SHIFT) & 7;
      out.push({
        kind: b & 7,
        level: (b & wire.ALERT_DANGER) ? 2 : 1,
        day: day,
        mark: day === 0 ? null : th.ALERT_NEXT_DAY_MARKS[day - 1],
        value: ''
      });
      return;
    }
    assert.ok(out.length > 0, 'byte ' + i + ' is a value byte before any header');
    assert.ok(b >= 0x20 && b <= 0x7E, 'byte ' + i + ' (' + b + ') is printable ASCII');
    out[out.length - 1].value += String.fromCharCode(b);
  });
  return out;
}

module.exports = { decodeAlerts };
