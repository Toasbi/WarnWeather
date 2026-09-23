// test/index-startup-clay.test.js — the boot-time Clay send, driven through the REAL
// index.js (ready handler, clay-migrations, the channel scheduler's first tick and
// the outbox) under test/helpers/index-runtime.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { installIndexRuntime } = require('./helpers/index-runtime');

const COLORS = { white: 0xFFFFFF, folly: 0xFF0055, holiday: 0x0055FF };

// A boot whose migrations need a Clay send, with Theme switching on: ready() sends
// the migration Clay and then runs the first scheduler tick synchronously, before
// any ACK can arrive. That tick's flip reconcile must not push the same ~500 B
// payload a second time while the first is still in flight.
test('a migration boot with Theme switching on sends ONE Clay message, not two', (t) => {
  const h = installIndexRuntime({ now: new Date(2026, 8, 23, 12, 0, 0).getTime() });
  t.after(h.restore);
  h.quietNetwork();
  const cs = h.mod('clay-settings.js');
  cs.seedDefaults(COLORS);
  cs.save(Object.assign(cs.read(), { themeAuto: true, themeAutoMode: 'manual',
    themeAutoStartHour: '20', themeAutoEndHour: '7', holidayCountry: 'none' }));
  // No migration marker is set, so this boot's ledger requires a Clay send.
  h.policy = () => 'hold';

  h.boot().ready({});

  assert.equal(h.claySends().length, 1, 'the first tick doubled the in-flight startup Clay');
  h.ack(h.sent[0]);
  h.advance(60 * 1000);
  assert.equal(h.claySends().length, 1, 'nothing left to send once it was ACKed');
});
