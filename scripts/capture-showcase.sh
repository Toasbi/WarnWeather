#!/usr/bin/env bash

set -euo pipefail

# Capture the showcase scenes for the animated README hero. Thin wrapper over
# capture-screenshots.sh — the same pattern as capture-store-shots.sh — so all the
# emulator lifecycle (build, install/retry, reap/wipe, bounded commands) lives in one
# place. For each scene it exports WW_HEALTH_FIXTURE=1 (canned health values via the
# health_fixture.c twin) and FLICKS=<scene flicks> (to reach the intended view), shoots
# the chosen platforms, and files the per-platform frame. Scenes + flick counts come from
# scripts/gen-showcase-fixtures.js (one source of truth); the rain-countdown strip is
# baked per scene via its fixture's countdown block. Assemble the GIF afterwards with
# assemble-showcase-gif.sh. RUN ON THE MAC (needs the Pebble SDK + emulator).
#
# Usage:   scripts/capture-showcase.sh [version]
# Example: scripts/capture-showcase.sh v1.6.0
#          PLATFORMS="basalt" scripts/capture-showcase.sh v1.6.0   # one platform

version="${1:-v1.0.0}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Canned health values for every scene; the default platforms unless overridden.
export WW_HEALTH_FIXTURE=1
export PLATFORMS="${PLATFORMS:-aplite basalt flint emery}"

# (Re)generate the scene fixtures so the on-disk set matches the scene table.
node "$here/scripts/gen-showcase-fixtures.js"

# One capture-screenshots run per scene, filing raw/<platform>.png into the scene frame
# before the next scene overwrites raw/. Scene id + flick count are read from the
# generator so they never drift from the fixtures.
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  id="${line%% *}"
  flicks="${line##* }"
  printf '\n######## showcase scene %s (flicks=%s) ########\n' "$id" "$flicks"
  FLICKS="$flicks" "$here/scripts/capture-screenshots.sh" "$version" "showcase-$id"
  for platform in $PLATFORMS; do
    raw="$here/screenshot/$version/raw/$platform.png"
    dest_dir="$here/screenshot/$version/showcase/frames/$platform"
    mkdir -p "$dest_dir"
    cp "$raw" "$dest_dir/scene_$id.png"
  done
done < <(node -e "require('$here/scripts/gen-showcase-fixtures.js').SCENES.forEach(function(s){console.log(s.id + ' ' + s.flicks);})")

printf '\nShowcase frames captured under screenshot/%s/showcase/frames/<platform>/.\n' "$version"
printf 'Assemble the looping GIF per platform:\n'
for platform in $PLATFORMS; do
  printf '  scripts/assemble-showcase-gif.sh %s %s\n' "$version" "$platform"
done
