'use strict';

const fs = require('fs');

/**
 * Read and parse a JSON file.
 * @param {string} filePath Absolute or relative path to JSON file.
 * @returns {Object} Parsed JSON object.
 */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Validate required release notification fields for a version key.
 * @param {Object} notifications release-notifications.json object.
 * @param {string} version Version string from package.template.json.
 * @returns {boolean} True when entry exists with non-empty title/body.
 */
function hasValidNotification(notifications, version) {
  const entry = notifications && notifications[version];
  const title = entry && typeof entry.title === 'string' ? entry.title.trim() : '';
  const body = entry && typeof entry.body === 'string' ? entry.body.trim() : '';
  return Boolean(title && body);
}

/**
 * Whether a version is a FEATURE release, and so owes a boot toast.
 *
 * The toast interrupts the user on first launch after an upgrade, so it is spent
 * on releases that give them something to do — not on fix-only patches. Release
 * Please bumps a `feat:` commit to x.(y+1).0 and a `fix:` to x.y.(z+1), so a ZERO
 * patch component already IS the feature/patch discriminator: no extra metadata,
 * and nothing that can fall out of sync with the version it describes.
 *
 * Fails CLOSED — a version that does not parse counts as a feature release —
 * because a spurious failure costs one line of JSON while a miss ships a feature
 * with no "what's new" at all.
 *
 * CAVEAT: a `Release-As:` trailer pinning a FEATURE to a patch version (as 1.13.1
 * did) reads as a patch here, so the toast stops being *required* for exactly the
 * release that most wants one. Add it by hand there — a present entry is always
 * honoured and always validated, whatever shape the version has.
 *
 * @param {string} version Version string from package.template.json.
 * @returns {boolean} True when a release notification is required.
 */
function isFeatureRelease(version) {
  const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  return parts ? Number(parts[3]) === 0 : true;
}

function main() {
  const pkg = readJson('package.template.json');
  const notifications = readJson('release-notifications.json');

  const version = String(pkg.version || '').trim();
  if (!version) {
    throw new Error('package.template.json must contain a non-empty "version"');
  }

  const present = Boolean(notifications)
    && Object.prototype.hasOwnProperty.call(notifications, version);

  // A present-but-broken entry fails whatever the version shape:
  // prepare-package.sh throws on one, so waving it through here would only move
  // the same failure to the build.
  if (present && !hasValidNotification(notifications, version)) {
    throw new Error(
      `release-notifications.json["${version}"] exists but is invalid. ` +
      `"title" and "body" must both be non-empty — fill it in, or drop the entry.`
    );
  }

  if (!present) {
    if (isFeatureRelease(version)) {
      throw new Error(
        `Missing release notification for feature release ${version}. ` +
        `Add release-notifications.json["${version}"] with non-empty "title" and "body".`
      );
    }
    console.log(
      `No release notification for patch release ${version} — not required. ` +
      `The boot toast is for feature releases; the public.news row still is not optional.`
    );
    return;
  }

  console.log(`Release notification is valid for ${version}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { hasValidNotification: hasValidNotification, isFeatureRelease: isFeatureRelease, readJson: readJson, main: main };
