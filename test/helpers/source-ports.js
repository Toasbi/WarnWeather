// test/helpers/source-ports.js — source ports (src/pkjs/weather/adapter/source-ports.js) for a
// test that runs the weather fetch chain with its network stubbed: no snapshot is reused or
// kept, and a fill brings nothing unless the test hands one in.
'use strict';

/**
 * @param {{fillUv: (Function|undefined), fillReadings: (Function|undefined)}} [over] A UV fill
 *   that writes the provider's uvTrend, a fill of the other readings; by default each brings
 *   nothing.
 * @returns {Object} The ports.
 */
function testPorts(over) {
  return {
    fillUv: (over && over.fillUv) || ((provider, lat, lon, done) => done()),
    fillReadings: (over && over.fillReadings) || ((provider, lat, lon, readings, done) => done()),
    now: () => Date.now(),
    refreshMs: 0,
    snapshots: { load: () => ({ entries: [], drops: 0 }), save: () => {} }
  };
}

module.exports = { testPorts };
