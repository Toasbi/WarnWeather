'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC_ROOT = 'src/c';
const APLITE_SUFFIX = '_aplite.c';

/**
 * Recursively list every file under a directory, repo-relative with forward slashes.
 * @param {string} dir Directory to walk.
 * @returns {string[]} Repo-relative file paths.
 */
function listFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFiles(full));
    } else {
      out.push(full.split(path.sep).join('/'));
    }
  }
  return out;
}

/**
 * Pair each aplite lean twin with its expected same-directory base .c and shared .h.
 * @param {string[]} files Repo-relative source paths.
 * @returns {Array<{twin: string, base: string, header: string}>} Twin pairs.
 */
function twinPairs(files) {
  return files
    .filter((f) => f.endsWith(APLITE_SUFFIX))
    .map((twin) => {
      const dir = twin.slice(0, twin.length - path.basename(twin).length);
      const stem = path.basename(twin).slice(0, -APLITE_SUFFIX.length);
      return { twin: twin, base: dir + stem + '.c', header: dir + stem + '.h' };
    });
}

/**
 * Invariant 1: every lean twin must have a same-directory base .c and shared .h.
 * Note: requiring the shared .h here is intentionally STRICTER than the
 * wscript build filter, which swaps in foo_aplite.c for foo.c on aplite
 * regardless of whether a shared foo.h exists. Don't relax this to match the
 * build — the .h requirement is what keeps a twin's public surface honest.
 * @param {string[]} files Repo-relative source paths.
 * @returns {string[]} Violation messages (empty when clean).
 */
function invariantViolations(files) {
  const present = new Set(files);
  const violations = [];
  for (const pair of twinPairs(files)) {
    if (!present.has(pair.base)) {
      violations.push(`${pair.twin} has no same-directory base ${pair.base}`);
    }
    if (!present.has(pair.header)) {
      violations.push(`${pair.twin} has no shared header ${pair.header}`);
    }
  }
  return violations;
}

/**
 * Drift guard: a base .c that has a lean twin changed without the twin also
 * changing, and the change was not acknowledged. Feature changes legitimately
 * skip the twin (feature-frozen), so the author confirms the decision with an
 * `Aplite-Twin-Reviewed: <base>` commit-body trailer.
 * @param {string[]} files All repo-relative source paths.
 * @param {string[]} changed Repo-relative paths changed in the PR.
 * @param {string[]} acknowledged Base paths acknowledged via commit trailer.
 * @returns {string[]} Violation messages (empty when clean).
 */
function driftViolations(files, changed, acknowledged) {
  const changedSet = new Set(changed);
  const ackSet = new Set(acknowledged);
  const violations = [];
  for (const pair of twinPairs(files)) {
    if (changedSet.has(pair.base) && !changedSet.has(pair.twin) && !ackSet.has(pair.base)) {
      violations.push(
        `${pair.base} changed but ${pair.twin} did not. Port the change if it is ` +
        `a bugfix, or add "Aplite-Twin-Reviewed: ${pair.base}" to a commit body ` +
        `to confirm no port is needed (e.g. a feature aplite intentionally lacks).`
      );
    }
  }
  return violations;
}

/**
 * Repo-relative paths changed between the base ref and HEAD.
 * @param {string} base Git base ref (e.g. origin/main).
 * @returns {string[]} Changed paths.
 */
function changedFiles(base) {
  const out = execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' });
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * Base paths acknowledged via `Aplite-Twin-Reviewed:` trailers since the base ref.
 * @param {string} base Git base ref (e.g. origin/main).
 * @returns {string[]} Acknowledged base paths.
 */
function acknowledgedBases(base) {
  const log = execSync(`git log ${base}..HEAD --format=%B`, { encoding: 'utf8' });
  const acks = [];
  for (const line of log.split('\n')) {
    const m = line.match(/^Aplite-Twin-Reviewed:\s*(.+)$/);
    if (m) {
      acks.push(m[1].trim());
    }
  }
  return acks;
}

function main() {
  const base = process.env.APLITE_TWINS_BASE || 'origin/main';
  const files = listFiles(SRC_ROOT);

  const violations = invariantViolations(files);
  // The drift guard needs a git base ref; skip it gracefully when unavailable
  // (e.g. a shallow local checkout) — the invariant check always runs.
  try {
    violations.push(...driftViolations(files, changedFiles(base), acknowledgedBases(base)));
  } catch (error) {
    console.warn(`Skipping drift check (no base ref ${base}): ${error.message}`);
  }

  if (violations.length) {
    console.error('Aplite lean-twin check failed:');
    for (const v of violations) {
      console.error('  - ' + v);
    }
    process.exit(1);
  }
  console.log('Aplite lean-twin invariants OK.');
}

if (require.main === module) {
  main();
}

module.exports = {
  listFiles: listFiles,
  twinPairs: twinPairs,
  invariantViolations: invariantViolations,
  driftViolations: driftViolations,
  acknowledgedBases: acknowledgedBases,
  changedFiles: changedFiles,
  main: main,
};
