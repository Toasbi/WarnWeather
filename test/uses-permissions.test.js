'use strict';
// The watchface's permissions (package.template.json pebble.usesPermissions). SDK 4.44 builds a
// manifest version 2 pbw. With the Pebble app's permissions preview on, its PebbleKit JS and
// settings page reach only the domains the Internet entries list (each covering its subdomains),
// and the app asks before the rest it declares. Each entry says why (`reason`) and whether the app
// needs it from the start (`required`, app 1.18.0.1: installing waits for an answer on those). So
// every host the code requests must be declared, and every URL in the code that is NOT a request (a
// link in a hint, a source comment, a header value) is named below with why. A new URL fails
// here until it is one or the other. (Buy Me a Coffee, only linked, is declared all the same: the
// owner's, 2026-11-14.) scripts/lib/uses-permissions.js adds the build-injected
// endpoints' hosts (telemetry, the Rainbow proxy, news) at build time, as an entry of their own.
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
  'www.tomorrow.io': 'the Powered by Tomorrow.io link',
  'locationiq.com': 'the Search by LocationIQ.com link in the Manual location hint',
  'creativecommons.org': 'the CC BY 4.0 licence link in Setup › Privacy & data sources',
  'openweathermap.org': 'the OpenWeatherMap signup and plan links',
  'yandex.com': 'the Yandex Weather API key link',
  'apps.repebble.com': 'the store listing link in the news panel',
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

const uses = pebble.usesPermissions || [];
const domains = perms.declaredDomains(uses);
// The permissions this app declares. Names the phone app knows (its PermissionRegistry; Health is
// not enforced yet, and declared anyway as the docs ask).
const NAMES = ['Health', 'Internet', 'Location', 'ShowNotifications'];

/**
 * The Internet entry that lists `domain`.
 * @param {string} domain A declared domain.
 * @returns {?Object}
 */
function entryOf(domain) {
  return perms.internetEntries(uses).find((p) => p.parameters.domains.indexOf(domain) !== -1) || null;
}

test('the app is a manifest version 2 app, and every permission says why and whether it is required', () => {
  assert.notEqual(pebble.manifestVersion, 1, 'version 2, the SDK default');
  uses.forEach((p) => {
    assert.equal(typeof p, 'object', JSON.stringify(p) + ': an object, so it can carry a reason');
    assert.ok(NAMES.indexOf(p.name) !== -1, p.name + ' is a permission this app is meant to declare');
    // A short label under the permission's row (the owner's, 2026-11-14: "DWD weather provider",
    // no "To ..." sentence needed), which the phone cuts off past two lines.
    assert.equal(typeof p.reason, 'string', p.name + ' has a reason');
    assert.ok(p.reason.trim().length > 0, p.name + ' says why');
    assert.ok(p.reason.length <= 80 && !/\.$/.test(p.reason), p.name + ': "' + p.reason + '" is short, no full stop');
    assert.equal(typeof p.required, 'boolean', p.name + ' says whether it is required');
  });
  assert.deepEqual(Array.from(new Set(uses.map((p) => p.name))).sort(), NAMES);
  NAMES.filter((n) => n !== 'Internet').forEach((n) => {
    assert.equal(uses.filter((p) => p.name === n).length, 1, n + ' once');
  });
});

test('each Internet entry lists its domains, sorted, and no domain is in two entries', () => {
  const internet = perms.internetEntries(uses);
  assert.ok(internet.length > 1, 'grouped by what they are for');
  internet.forEach((p) => {
    const list = (p.parameters && p.parameters.domains) || [];
    assert.ok(list.length > 0, p.reason + ': an Internet entry without domains would reach every site');
    assert.deepEqual(list, list.slice().sort(), p.reason + ': its domains are sorted');
    // The phone drops anything but a plain hostname (no wildcard, port or scheme) silently.
    list.forEach((d) => assert.match(d, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, d + ' is a plain hostname'));
  });
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

test('every declared domain is one the code requests (or, Buy Me a Coffee, links to)', () => {
  const hosts = Object.keys(urlHosts());
  domains.forEach((domain) => {
    assert.ok(hosts.some((h) => perms.covered(h, [domain])), domain + ' is declared but nothing requests it');
  });
});

// Required (the owner's, 2026-11-13 and 2026-11-14): every weather service the app can fetch
// from (the forecast and radar services, keyed or not, air quality, DWD pollen), the town's name
// and the settings' place search, the public holidays (Nager.Date), Buy Me a Coffee and the app's
// own backend (the build adds its entry, required). Installing then waits for an answer on all of
// them, so switching services or opening settings never meets a first request that fails while
// the phone asks; a "no" is an answer too, and the install goes on. Optional, asked about when
// first used: LocationIQ (only a typed Manual location uses it), the update check, notifications
// and Health.
test('every weather service, place name, holidays and Buy Me a Coffee are required; the rest is not', () => {
  ['api.weather.com', 'www.wunderground.com', 'api.open-meteo.com', 'api.met.no', 'api.brightsky.dev',
    'api.openweathermap.org', 'api.tomorrow.io', 'api.weather.yandex.ru', 'api.rainbow.ai',
    'api.waqi.info', 'air-quality-api.open-meteo.com', 'maps.dwd.de',
    'geocode.arcgis.com', 'geocoding-api.open-meteo.com', 'date.nager.at', 'buymeacoffee.com'].forEach((d) => {
    assert.equal(entryOf(d).required, true, d + ' is required');
  });
  ['us1.locationiq.com', 'appstore-api.repebble.com', 'appstore-api.rebble.io'].forEach((d) => {
    assert.equal(entryOf(d).required, false, d + ' is optional');
  });
  assert.equal(uses.find((p) => p.name === 'Location').required, true, 'the forecast is for where you are');
  ['ShowNotifications', 'Health'].forEach((n) => assert.equal(uses.find((p) => p.name === n).required, false, n));
});

// The phone lists each domain as a row of its own ("Connect to <domain>"), its entry's reason under
// it: so each service has an entry of its own, whose reason names it (the owner's, 2026-11-14).
test('each service has an entry of its own, whose reason names it', () => {
  const NAMED = {
    'api.brightsky.dev': 'DWD', 'api.met.no': 'Met.no', 'api.open-meteo.com': 'Open-Meteo',
    'api.openweathermap.org': 'OpenWeatherMap', 'api.tomorrow.io': 'Tomorrow.io',
    'api.weather.com': 'Weather Underground', 'www.wunderground.com': 'Weather Underground',
    'api.weather.yandex.ru': 'Yandex', 'api.rainbow.ai': 'Rainbow',
    'air-quality-api.open-meteo.com': 'Open-Meteo', 'api.waqi.info': 'WAQI', 'maps.dwd.de': 'DWD',
    'geocode.arcgis.com': 'ArcGIS', 'geocoding-api.open-meteo.com': 'Open-Meteo',
    'date.nager.at': 'Nager.Date', 'buymeacoffee.com': 'Buy Me a Coffee', 'us1.locationiq.com': 'LocationIQ'
  };
  Object.keys(NAMED).forEach((d) => {
    const entry = entryOf(d);
    assert.ok(entry, d + ' is declared');
    assert.deepEqual(entry.parameters.domains, [d], d + ' has an entry of its own');
    assert.ok(entry.reason.indexOf(NAMED[d]) !== -1, d + ': "' + entry.reason + '" names ' + NAMED[d]);
  });
  // The two app stores are one service, the update check.
  assert.deepEqual(entryOf('appstore-api.rebble.io').parameters.domains, ['appstore-api.rebble.io', 'appstore-api.repebble.com']);
  domains.forEach((d) => assert.ok(NAMED[d] || /^appstore-api\./.test(d), d + ': name its service here'));
});

// Pebble app 1.18.0: Pebble.showSimpleNotificationOnPebble needs ShowNotifications, or the phone drops
// the notification; navigator.geolocation needs Location.
test('ShowNotifications and Location are declared because the code uses them', () => {
  const code = sources().map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.match(code, /showSimpleNotificationOnPebble/, 'premise: the code shows notifications on the watch');
  assert.ok(uses.some((p) => p.name === 'ShowNotifications'), 'ShowNotifications is declared');
  assert.match(code, /navigator\.geolocation/, 'premise: the code asks for the location');
  assert.ok(uses.some((p) => p.name === 'Location'), 'Location is declared');
});

test('the build adds the injected endpoints\' hosts as a required entry of their own, once', () => {
  const pkg = { usesPermissions: [{ name: 'Location', reason: 'To x', required: true },
    { name: 'Internet', parameters: { domains: ['api.met.no'] }, reason: 'To a', required: true },
    { name: 'Internet', parameters: { domains: ['date.nager.at'] }, reason: 'To b', required: false }] };
  const added = perms.addEndpointHosts(pkg, ['https://abc.supabase.co/functions/v1/telemetry-ingest',
    'https://abc.supabase.co/functions/v1/rainbow-nowcast', '', 'https://api.met.no/x']);
  assert.deepEqual(added, ['abc.supabase.co']);
  assert.deepEqual(pkg.usesPermissions[2], { name: 'Internet', parameters: { domains: ['abc.supabase.co'] },
    reason: perms.ENDPOINTS_REASON, required: true }, 'after the last required Internet entry');
  assert.equal(pkg.usesPermissions.length, 4);
  assert.deepEqual(perms.addEndpointHosts(pkg, ['https://abc.supabase.co/functions/v1/news']), [],
    'a host already declared adds nothing');
  // An optional entry covering the host leaves it to a question the user may decline: the app's
  // own backend still gets its required entry.
  const optional = { usesPermissions: [{ name: 'Internet', parameters: { domains: ['api.met.no'] }, reason: 'To a', required: true },
    { name: 'Internet', parameters: { domains: ['supabase.co'] }, reason: 'To b', required: false }] };
  assert.deepEqual(perms.addEndpointHosts(optional, ['https://abc.supabase.co/functions/v1/news']), ['abc.supabase.co']);
  assert.equal(optional.usesPermissions[1].required, true, 'its own required entry, after the required one');
  // A dev build without the endpoints adds no entry: one without domains would reach every site.
  const dev = { usesPermissions: [{ name: 'Internet', parameters: { domains: ['api.met.no'] }, reason: 'To a', required: true }] };
  assert.deepEqual(perms.addEndpointHosts(dev, ['', '', '']), []);
  assert.equal(dev.usesPermissions.length, 1);
  assert.throws(() => perms.addEndpointHosts({ usesPermissions: [{ name: 'Location' }] }, ['https://x.y']), /no Internet permission/);
  assert.equal(perms.hostOf('HTTPS://Abc.Supabase.co:443/f'), 'abc.supabase.co');
  assert.equal(perms.hostOf(''), null);
  assert.match(perms.ENDPOINTS_REASON, /^WarnWeather server: /, 'the label names the server');
  const script = fs.readFileSync(path.join(ROOT, 'scripts/prepare-package.sh'), 'utf8');
  assert.match(script, /addEndpointHosts\(pkg\.pebble,\s*\[telemetryEndpoint, rainbowEndpoint, newsEndpoint\]\)/,
    'prepare-package.sh passes all three endpoints');
});
