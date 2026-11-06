'use strict';
// The watchface's permissions (package.template.json pebble.usesPermissions). SDK 4.44 builds a
// manifest version 2 pbw, and the phone app lets its PebbleKit JS reach only the domains the
// Internet permission lists (each covering its subdomains) and asks before Location. So every
// host the code requests must be declared, and every URL in the code that is NOT a request (a
// link in a hint, a source comment, a header value) is named below with why. A new URL fails
// here until it is one or the other. scripts/lib/uses-permissions.js adds the build-injected
// endpoints' hosts (telemetry, the Rainbow proxy, news) at build time.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pebble = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.template.json'), 'utf8')).pebble;
const perms = require('../scripts/lib/uses-permissions.js');

// URLs in the code the app never requests.
const NOT_REQUESTED = {
  'airindex.eea.europa.eu': 'a reference link in the AQI scale hints',
  'www.airnow.gov': 'a reference link in the AQI scale hints',
  'www.who.int': 'a reference link in a level hint',
  'www.weather.gov': 'a reference link in a level hint',
  'weather.metoffice.gov.uk': 'a reference link in a level hint',
  'www.dwd.de': 'reference links in the gust and pollen hints',
  'app.tomorrow.io': 'the Tomorrow.io signup and API-keys links',
  'developer.rainbow.ai': 'the Rainbow signup and profile links',
  'rainbow.ai': 'the Powered by Rainbow link',
  'openweathermap.org': 'the OpenWeatherMap signup and plan links',
  'yandex.com': 'the Yandex Weather API key link',
  'apps.repebble.com': 'the store listing link in the news panel',
  'buymeacoffee.com': 'the Support link',
  'github.com': 'the issues links, and the User-Agent and Origin values met.no asks for',
  'toasbi.github.io': 'the emulator\'s settings page helper, opened with Pebble.openURL under the emulator only',
  'developer.repebble.com': 'a source comment',
  'tabler.io': 'the icons\' attribution comment',
  'www.w3.org': 'the XLink namespace',
  'aa.quae.nl': 'a source comment in the vendored SunCalc',
  'idlastro.gsfc.nasa.gov': 'a source comment in the vendored SunCalc',
  'www.stargazing.net': 'a source comment in the vendored SunCalc'
};

/**
 * Every shipped source under src/pkjs: the phone-side code and the settings page's sources, its
 * HTML shell included (the generated page is built from them; tests are not shipped).
 * @returns {string[]} Paths.
 */
function sources() {
  const out = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'test') { walk(p); } return; }
      if (/\.(js|html)$/.test(e.name) && !/\.generated\.js$/.test(e.name)) { out.push(p); }
    });
  })(path.join(ROOT, 'src/pkjs'));
  return out;
}

/** @returns {Object<string, string>} Each URL host in the code -> the first file it is in. */
function urlHosts() {
  const hosts = {};
  sources().forEach((file) => {
    const text = fs.readFileSync(file, 'utf8');
    (text.match(/\b(?:https?|wss?):\/\/[A-Za-z0-9.-]+/g) || []).forEach((url) => {
      const host = url.replace(/^[a-z]+:\/\//i, '').toLowerCase();
      if (!hosts[host]) { hosts[host] = path.relative(ROOT, file); }
    });
  });
  return hosts;
}

const internet = (pebble.usesPermissions || []).find((p) => p && p.name === 'Internet');
const domains = (internet && internet.parameters && internet.parameters.domains) || [];

test('the app is a manifest version 2 app declaring Location, Health and the Internet domains it uses', () => {
  assert.notEqual(pebble.manifestVersion, 1, 'version 2, the SDK default');
  const names = pebble.usesPermissions.map((p) => (typeof p === 'string' ? p : p.name));
  assert.deepEqual(names.slice().sort(), ['Health', 'Internet', 'Location']);
  assert.ok(domains.length > 0, 'Internet lists its domains: a bare Internet would reach every site');
  assert.deepEqual(domains, domains.slice().sort(), 'the domains are sorted');
  assert.equal(new Set(domains).size, domains.length, 'each domain once');
});

test('every host the code requests is declared, and every other URL is named with why', () => {
  const hosts = urlHosts();
  Object.keys(hosts).forEach((host) => {
    assert.ok(perms.covered(host, domains) || NOT_REQUESTED[host],
      host + ' (' + hosts[host] + ') is neither in usesPermissions\' Internet domains nor named in '
      + 'NOT_REQUESTED: a request to it would be refused on the phone');
    assert.ok(!(perms.covered(host, domains) && NOT_REQUESTED[host]), host + ' is both declared and named');
  });
});

test('every declared domain is one the code requests', () => {
  const hosts = Object.keys(urlHosts());
  domains.forEach((domain) => {
    assert.ok(hosts.some((h) => perms.covered(h, [domain])), domain + ' is declared but nothing requests it');
  });
});

test('the build adds the injected endpoints\' hosts once, and nothing for an empty one', () => {
  const pkg = { usesPermissions: ['Location', { name: 'Internet', parameters: { domains: ['api.met.no'] } }] };
  const added = perms.addEndpointHosts(pkg, ['https://abc.supabase.co/functions/v1/telemetry-ingest',
    'https://abc.supabase.co/functions/v1/rainbow-nowcast', '', 'https://api.met.no/x']);
  assert.deepEqual(added, ['abc.supabase.co']);
  assert.deepEqual(pkg.usesPermissions[1].parameters.domains, ['api.met.no', 'abc.supabase.co']);
  assert.throws(() => perms.addEndpointHosts({ usesPermissions: ['Location'] }, ['https://x.y']), /no Internet permission/);
  assert.equal(perms.hostOf('HTTPS://Abc.Supabase.co:443/f'), 'abc.supabase.co');
  assert.equal(perms.hostOf(''), null);
  const script = fs.readFileSync(path.join(ROOT, 'scripts/prepare-package.sh'), 'utf8');
  assert.match(script, /addEndpointHosts\(pkg\.pebble,\s*\[telemetryEndpoint, rainbowEndpoint, newsEndpoint\]\)/,
    'prepare-package.sh passes all three endpoints');
});
