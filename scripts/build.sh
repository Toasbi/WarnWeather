#!/usr/bin/env bash

set -euo pipefail

profile="dev"

if [[ "${1:-}" == "release" || "${1:-}" == "dev" ]]; then
  profile="$1"
  shift
fi

if [[ "${1:-}" == "--" ]]; then
  shift
fi

scripts/ensure-pebble-sdk.sh
mise run prepare-package -- "$profile"

# Install the locked Node dependency (suncalc) before the test suite and
# pebble build. CI checks out fresh with no node_modules, so `node --test`
# would otherwise fail to load src/pkjs/weather/provider.js with "Cannot find
# module 'suncalc'". Runs after prepare-package so the generated package.json
# version matches package-lock.json for npm ci.
npm ci

node scripts/prepare-fixture.js
node scripts/build-config-page.js
# WW_SKIP_TESTS=1 skips the unit suites — used by batch screenshot/time-lapse
# captures that build dozens of fixtures back-to-back after the suites have already
# been run once, so a flake can't abort the whole capture and each build is fast.
if [[ "${WW_SKIP_TESTS:-0}" == "1" ]]; then
  echo "build.sh: WW_SKIP_TESTS=1 — skipping node --test + host C tests"
else
  # Scoped to the two Node test trees explicitly: an unscoped `node --test`
  # also recurses into supabase/functions/**/*_test.ts (Deno tests, e.g.
  # rainbow-nowcast's handler_test.ts), which Node can't run (they import
  # Deno's @std/assert) — those run separately via `deno test`.
  node --test 'test/**/*.test.js' 'src/pkjs/config-ui/test/**/*.test.js'
  # Host-compiled layout golden-rect tests (no Pebble SDK needed). Run them here so a
  # C geometry change can't build green and only surface later under `mise test`.
  scripts/test-c.sh
fi
pebble build "$@"

# pebble build names the pbw after the project-directory basename, so it lands
# as build/WarnWeather.pbw (or build/<worktree-dir>.pbw in a git worktree)
# rather than the canonical build/warnweather.pbw the install scripts expect.
# Normalize with mv, not cp: on a case-insensitive filesystem (macOS) the two
# names are the SAME file, where cp fails with "are identical" and the
# case-sensitive find below would delete the freshly built pbw — mv is a plain
# case-rename there and a real rename everywhere else.
pbw_built=$(ls -1t build/*.pbw 2>/dev/null | head -n1)
if [[ -z "$pbw_built" ]]; then
  echo "build.sh: no .pbw produced by pebble build" >&2
  exit 1
fi
if [[ "$pbw_built" != "build/warnweather.pbw" ]]; then
  mv "$pbw_built" build/warnweather.pbw
fi

if [[ "$profile" == "dev" ]]; then
  cp build/warnweather.pbw build/warnweather-dev.pbw
fi

# pebble build also leaves a bundle named after the project directory
# (build/ForecasWetter.pbw, or build/<worktree-dir>.pbw in a worktree). Drop
# any non-canonical pbw so only the warnweather bundles remain.
find build -maxdepth 1 -name '*.pbw' \
  ! -name 'warnweather.pbw' ! -name 'warnweather-dev.pbw' -delete
