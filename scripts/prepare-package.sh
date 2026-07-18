#!/usr/bin/env bash

set -euo pipefail

profile="${1:-dev}"

if [[ "$profile" != "release" && "$profile" != "dev" ]]; then
  printf 'usage: %s [release|dev]\n' "$0" >&2
  exit 1
fi

template_file="package.template.json"
profile_file="profiles/package.${profile}.json"
output_file="package.json"

if [[ ! -f "$template_file" ]]; then
  printf 'missing template: %s\n' "$template_file" >&2
  exit 1
fi

if [[ ! -f "$profile_file" ]]; then
  printf 'missing profile: %s\n' "$profile_file" >&2
  exit 1
fi

npx --yes mustache "$profile_file" "$template_file" > "$output_file"
WW_BUILD_PROFILE="$profile" node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
delete pkg.releaseNotification;
delete pkg.releaseNotifications;

function parseSemver(v) {
  const core = String(v || '0.0.0').replace(/^v/, '').split('-')[0].split('+')[0];
  const parts = core.split('.');
  return [
    parseInt(parts[0], 10) || 0,
    parseInt(parts[1], 10) || 0,
    parseInt(parts[2], 10) || 0
  ];
}

function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa[0] !== pb[0]) return pa[0] > pb[0] ? 1 : -1;
  if (pa[1] !== pb[1]) return pa[1] > pb[1] ? 1 : -1;
  if (pa[2] !== pb[2]) return pa[2] > pb[2] ? 1 : -1;
  return 0;
}

function normalizeReleaseNotificationEntry(manifest, version) {
  const entry = manifest[version];
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error('release-notifications.json[' + JSON.stringify(version) + '] must be an object with title and body');
  }
  const title = typeof entry.title === 'string' ? entry.title.trim() : '';
  const body = typeof entry.body === 'string' ? entry.body.trim() : '';
  if (title.length === 0) {
    throw new Error('release-notifications.json[' + JSON.stringify(version) + '].title must be a non-empty string');
  }
  if (body.length === 0) {
    throw new Error('release-notifications.json[' + JSON.stringify(version) + '].body must be a non-empty string');
  }
  return { title, body };
}

const manifestPath = 'release-notifications.json';
let manifest = {};
if (fs.existsSync(manifestPath)) {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (e) {
    throw new Error('release-notifications.json: invalid JSON (' + e.message + ')');
  }
}
if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
  throw new Error('release-notifications.json must be a JSON object');
}

const ver = typeof pkg.version === 'string' ? pkg.version : '';
const releaseNotifications = {};
Object.keys(manifest).sort(compareSemver).forEach((version) => {
  if (ver && compareSemver(version, ver) <= 0) {
    releaseNotifications[version] = normalizeReleaseNotificationEntry(manifest, version);
  }
});

if (Object.keys(releaseNotifications).length > 0) {
  pkg.releaseNotifications = releaseNotifications;
}

if (ver && Object.prototype.hasOwnProperty.call(releaseNotifications, ver)) {
  pkg.releaseNotification = Object.assign({ enabled: true }, releaseNotifications[ver]);
}

const telemetryEndpoint = typeof process.env.TELEMETRY_ENDPOINT === 'string' ? process.env.TELEMETRY_ENDPOINT.trim() : '';

pkg.telemetry = {
  enabled: telemetryEndpoint.length > 0,
  endpoint: telemetryEndpoint,
};

// Rainbow nowcast proxy URL baked into the bundle. The config UI always offers
// Rainbow radar (and defaults to it), and PKJS gates purely on endpoint !== ''
// — an empty endpoint does NOT hide the option; it makes every 'rainbow'
// selection fail soft (fetchRadarTuplesAt returns null → no radar reaches the
// watch). On a release build that would silently break radar for every user, so
// the guard below hard-fails instead. Dev/fork builds may ship empty on purpose.
const rainbowEndpoint = typeof process.env.RAINBOW_PROXY_ENDPOINT === 'string' ? process.env.RAINBOW_PROXY_ENDPOINT.trim() : '';

const buildProfile = process.env.WW_BUILD_PROFILE || 'dev';
if (buildProfile === 'release' && rainbowEndpoint.length === 0) {
  throw new Error(
    'RAINBOW_PROXY_ENDPOINT is empty for a release build. Rainbow radar is the ' +
    'default provider, so every release device would silently receive no radar ' +
    '(fetchRadarTuplesAt fails soft on an empty endpoint). Set the ' +
    'RAINBOW_PROXY_ENDPOINT_RELEASE GitHub Actions secret (or export ' +
    'RAINBOW_PROXY_ENDPOINT locally) before building the release profile.'
  );
}

pkg.rainbow = {
  endpoint: rainbowEndpoint,
};

// News edge-function URL baked into the bundle. PKJS passes it to the config
// page via userData; an empty endpoint disables the news pill entirely. A
// release build with an empty endpoint would silently kill the feature for
// every user (see the v1.7.0 rainbow-endpoint incident), so hard-fail instead.
const newsEndpoint = typeof process.env.NEWS_ENDPOINT === 'string' ? process.env.NEWS_ENDPOINT.trim() : '';

if (buildProfile === 'release' && newsEndpoint.length === 0) {
  throw new Error(
    'NEWS_ENDPOINT is empty for a release build. The config-page news pill ' +
    'would be silently disabled for every release user. Set the ' +
    'NEWS_ENDPOINT_RELEASE GitHub Actions secret (or export NEWS_ENDPOINT ' +
    'locally) before building the release profile.'
  );
}

pkg.news = {
  endpoint: newsEndpoint,
};

// WAQI (aqicn.org) shared token baked into the bundle. WAQI is the DEFAULT AQI
// source, so an empty token would silently degrade every release user to
// Open-Meteo (air-quality.js falls back on an empty token). On a release build
// that is a silent feature downgrade, so hard-fail — mirroring the rainbow/news
// guards above. Dev/fork builds may ship empty on purpose (they degrade to
// Open-Meteo).
const aqicnToken = typeof process.env.AQICN_TOKEN === 'string' ? process.env.AQICN_TOKEN.trim() : '';

if (buildProfile === 'release' && aqicnToken.length === 0) {
  throw new Error(
    'AQICN_TOKEN is empty for a release build. WAQI is the default AQI source, ' +
    'so every release device would silently fall back to Open-Meteo. Set the ' +
    'AQICN_TOKEN_RELEASE GitHub Actions secret (or export AQICN_TOKEN locally) ' +
    'before building the release profile.'
  );
}

pkg.waqi = {
  token: aqicnToken,
};

// WW_BUILD_PLATFORMS (space/comma-separated) narrows the build to a subset of the
// template's targetPlatforms — screenshot captures that shoot a single platform set it
// so \`pebble build\` compiles just that one instead of all five. Unset → build every
// platform (unchanged default). Unknown names hard-fail rather than silently build nothing.
const wantPlatforms = String(process.env.WW_BUILD_PLATFORMS || '').split(/[\s,]+/).filter(Boolean);
if (wantPlatforms.length && pkg.pebble && Array.isArray(pkg.pebble.targetPlatforms)) {
  const all = pkg.pebble.targetPlatforms;
  const unknown = wantPlatforms.filter((p) => all.indexOf(p) === -1);
  if (unknown.length) {
    throw new Error('WW_BUILD_PLATFORMS has unknown platform(s): ' + unknown.join(', ') + ' (valid: ' + all.join(', ') + ')');
  }
  pkg.pebble.targetPlatforms = all.filter((p) => wantPlatforms.indexOf(p) !== -1);
  console.error('prepare-package: building only ' + pkg.pebble.targetPlatforms.join(', ') + ' (WW_BUILD_PLATFORMS)');
}

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

printf 'prepared %s using %s\n' "$output_file" "$profile_file"
