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
node scripts/prepare-fixture.js
pebble build "$@"

# pebble build names the pbw after the project-directory basename, so in a
# git worktree it lands as build/<worktree-dir>.pbw rather than the canonical
# build/warnweather.pbw the install scripts expect. Normalize the name.
pbw_built=$(ls -1t build/*.pbw 2>/dev/null | head -n1)
if [[ -z "$pbw_built" ]]; then
  echo "build.sh: no .pbw produced by pebble build" >&2
  exit 1
fi
if [[ "$pbw_built" != "build/warnweather.pbw" ]]; then
  cp "$pbw_built" build/warnweather.pbw
fi

if [[ "$profile" == "dev" ]]; then
  cp build/warnweather.pbw build/warnweather-dev.pbw
fi

# pebble build also leaves a bundle named after the project directory
# (build/ForecasWetter.pbw, or build/<worktree-dir>.pbw in a worktree). Drop
# any non-canonical pbw so only the warnweather bundles remain.
find build -maxdepth 1 -name '*.pbw' \
  ! -name 'warnweather.pbw' ! -name 'warnweather-dev.pbw' -delete
