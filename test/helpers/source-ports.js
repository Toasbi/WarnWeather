// test/helpers/source-ports.js — source ports (src/pkjs/weather/adapter/source-ports.js) for a
// test that runs the weather fetch chain with its network stubbed: no snapshot is reused or
// kept, and a UV fill brings nothing unless the test hands one in.
'use strict';

/**
 * @param {{fillUv: function(Object, number, number, Function): void}} [over] A UV fill that
 *   writes the provider's uvTrend; by default it brings nothing.
 * @returns {Object} The ports.
 */
function testPorts(over) {
  return {
    fillUv: (over && over.fillUv) || ((provider, lat, lon, done) => done()),
    now: () => Date.now(),
    refreshMs: 0,
    snapshots: { load: () => ({ entries: [], drops: 0 }), save: () => {} }
  };
}

module.exports = { testPorts };
