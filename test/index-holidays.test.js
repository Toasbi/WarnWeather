// test/index-holidays.test.js — the holiday prefetch and resend, driven through the
// REAL index.js (ready handler, scheduler ticks, clay-payload, holiday-mask and
// nager-source) under test/helpers/index-runtime.js.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { installIndexRuntime, decodeHolidays } = require('./helpers/index-runtime');

const COLORS = { white: 0xFFFFFF, folly: 0xFF0055, holiday: 0x0055FF };
const NAGER = 'https://date.nager.at/api/v3/PublicHolidays/';

/**
 * Store a seeded settings blob with `changes` applied, before the boot.
 *
 * @param {Object} h Harness.
 * @param {Object} changes Settings to override.
 * @returns {void}
 */
function seedSettings(h, changes) {
  const cs = h.mod('clay-settings.js');
  cs.seedDefaults(COLORS);
  cs.save(Object.assign(cs.read(), changes));
}

// The 3-row calendar (fullCal) with "Previous week first" leads with the previous
// week, so on Tue 2 Jan 2029 (Monday start) its top row is Mon 25 - Sun 31 Dec 2028
// and the HOLIDAYS window anchors there. The prefetch has to keep 2028 cached:
// nagerSource.ensure() prunes every year outside the list it is handed.
const FULL_CAL_DE = {
  layoutPreset: 'fullCal', firstWeek: 'prev', weekStartDay: 'mon',
  holidayCountry: 'DE', holidayRegion: 'all', holidaysEnabled: true
};

test('the prefetch keeps the previous year the 3-row calendar top row still shows', (t) => {
  const h = installIndexRuntime({ now: new Date(2029, 0, 2, 12, 0, 0).getTime() });
  t.after(h.restore);
  h.quietNetwork();
  seedSettings(h, FULL_CAL_DE);
  h.store.holidays_DE_2028 = JSON.stringify({ f: h.now(), h: [['12-25', null], ['12-26', null]] });
  h.store.holidays_DE_2029 = JSON.stringify({ f: h.now(), h: [['01-01', null]] });

  h.boot().ready({});

  assert.notEqual(h.store.holidays_DE_2028, undefined,
    'the prefetch pruned 2028 while the calendar top row still shows 25-31 Dec 2028');
  // Every later Clay send builds the mask from this cache.
  const cs = h.mod('clay-settings.js');
  const payload = h.mod('clay-payload.js').buildClayPayload(cs.read(), h.watchInfo);
  const win = decodeHolidays(payload.HOLIDAYS);
  const serial = h.mod('holidays/serial-day.js');
  assert.equal(win.anchor, serial(2028, 12, 25), 'the window anchors on the previous week');
  assert.equal(win.mask & 0x83, 0x83, 'Christmas, Boxing Day and New Year stay highlighted');
});

test('a fresh install in early January fetches the previous year for the 3-row top row', (t) => {
  const h = installIndexRuntime({ now: new Date(2029, 0, 2, 12, 0, 0).getTime() });
  t.after(h.restore);
  h.quietNetwork();
  seedSettings(h, FULL_CAL_DE);

  h.boot().ready({});

  const asked = h.xhrs.map((x) => x.url).filter((u) => u.indexOf(NAGER) === 0);
  assert.ok(asked.indexOf(NAGER + '2028/DE') !== -1, 'never asked for 2028: ' + JSON.stringify(asked));
  assert.ok(asked.indexOf(NAGER + '2029/DE') !== -1, 'never asked for 2029: ' + JSON.stringify(asked));
});

// Switching Holiday country: the config-close Clay goes out with an empty mask (no
// cache for the new country yet) and the Nager answer lands a moment later, often
// while that send is still in flight — so its resend can NACK. The cache is fresh
// from then on, so nothing fetches it again; unless the NACK is retried, the watch
// shows no holidays until the next midnight.
test('a NACKed holiday-data resend is retried on the next minute tick', (t) => {
  const h = installIndexRuntime({ now: new Date(2026, 11, 1, 10, 0, 0).getTime() });
  t.after(h.restore);
  h.quietNetwork();
  seedSettings(h, { layoutPreset: 'compactCal', weekStartDay: 'mon', holidayCountry: 'DE',
    holidayRegion: 'all', holidaysEnabled: true });
  h.store.holidays_DE_2026 = JSON.stringify({ f: h.now(), h: [['12-25', null], ['12-26', null]] });
  h.boot().ready({});
  const serial = h.mod('holidays/serial-day.js');
  const bitOf = (m, d) => (m >>> (serial(2026, 12, d) - serial(2026, 11, 30))) & 1;

  h.closeSettings({ holidayCountry: 'AT' });
  const closed = h.claySends();
  assert.equal(decodeHolidays(closed[closed.length - 1].dict.HOLIDAYS).mask, 0,
    'the config-close Clay has no Austrian data yet');

  const before = h.sent.length;
  h.policy = () => 'nack';             // the resend collides with an in-flight send
  h.answer(NAGER + '2026/AT', 200, [{ date: '2026-12-08', global: true },
    { date: '2026-12-25', global: true }, { date: '2026-12-26', global: true }]);
  h.advance(0);
  const nacked = h.claySends(before);
  assert.equal(nacked.length, 1, 'the landing resends Clay once');
  assert.equal(nacked[0].outcome, 'nack');

  h.policy = () => 'ack';
  h.advance(60 * 1000);                // the next minute tick
  const retried = h.claySends(before).filter((m) => m.outcome === 'ack');
  assert.equal(retried.length, 1, 'the tick retried the NACKed resend');
  const mask = decodeHolidays(retried[0].dict.HOLIDAYS).mask;
  assert.equal(bitOf(mask, 8), 1, 'Mariä Empfängnis (8 Dec) reached the watch');
  assert.equal(bitOf(mask, 25), 1);

  h.advance(60 * 1000);
  assert.equal(h.claySends(before).length, 2, 'and nothing more once it was ACKed');
});

test('the compact calendar keeps its current-week window (no previous-year fetch)', (t) => {
  const h = installIndexRuntime({ now: new Date(2029, 0, 2, 12, 0, 0).getTime() });
  t.after(h.restore);
  h.quietNetwork();
  seedSettings(h, Object.assign({}, FULL_CAL_DE, { layoutPreset: 'compactCal' }));

  h.boot().ready({});

  const asked = h.xhrs.map((x) => x.url).filter((u) => u.indexOf(NAGER) === 0);
  assert.deepEqual(asked, [NAGER + '2029/DE'], 'the 2-row calendar starts on Mon 1 Jan 2029');
});
