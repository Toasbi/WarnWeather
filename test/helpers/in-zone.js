'use strict';
// test/helpers/in-zone.js
// Work on the host's clock in another time zone. Assigning process.env.TZ mid-run asks the
// runtime to swap its zone lazily, and it has been caught keeping GMT: a check then passed
// without running in the zone at all (test/page/weather/weather-tab/weather-tab-charts.test.js).
// So the work runs in a child process started in the zone, which reports the zone it got:
// inZone throws where it got another, and hands back what the work returned for the test to
// assert.
const { execFileSync } = require('node:child_process');

/**
 * @param {string} zone An IANA zone, the child's from its start.
 * @param {Object<string, string>} modules The modules the work takes, by name: each a path
 *   require takes (require.resolve in the test).
 * @param {function(Object<string, *>, *): *} work Run in the child with the modules by name
 *   and the input. It is sent as its source, so it uses nothing but its arguments; what it
 *   returns comes back through JSON.
 * @param {*} [input] The work's second argument, sent through JSON.
 * @returns {*} What the work returned.
 */
function inZone(zone, modules, work, input) {
  const required = Object.keys(modules)
    .map((name) => JSON.stringify(name) + ': require(' + JSON.stringify(modules[name]) + ')').join(', ');
  const sent = JSON.stringify(input === undefined ? null : input);
  const out = execFileSync(process.execPath, ['-e', 'const got = (' + work.toString() + ')({ ' + required + ' }, ' + sent + ');'
    + 'process.stdout.write(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, got: got }));'],
  { env: Object.assign({}, process.env, { TZ: zone }), encoding: 'utf8' });
  const result = JSON.parse(out);
  if (result.zone !== zone) { throw new Error('the child ran in ' + result.zone + ', not ' + zone); }
  return result.got;
}

module.exports = { inZone };
