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

# One capture-screenshots run per scene fixture, filing raw/<platform>.png into the scene
# frame before the next scene overwrites raw/. Scene id + flick count + variant platforms
# are read from the generator so they never drift from the fixtures. Collect the rows
# FIRST, then capture in a separate loop: running capture-screenshots.sh inside
# `while read < <(node …)` let its pebble/mise children drain the process-substitution fd,
# so the loop ran only once.
ids=(); flickss=(); variantss=()
while IFS='|' read -r id flicks variants; do
  [[ -n "$id" ]] || continue
  ids+=("$id"); flickss+=("$flicks"); variantss+=("$variants")
done < <(node -e "require('$here/scripts/gen-showcase-fixtures.js').SCENES.forEach(function(s){console.log(s.id + '|' + s.flicks + '|' + Object.keys(s.variants || {}).join(' '));})")

# file_scene <id> <platform...> — copy each platform's raw/<platform>.png (from the capture
# just run) into its scene_<id>.png frame.
file_scene() {
  local id="$1"; shift
  local platform dest_dir
  for platform in "$@"; do
    dest_dir="$here/screenshot/$version/showcase/frames/$platform"
    mkdir -p "$dest_dir"
    cp "$here/screenshot/$version/raw/$platform.png" "$dest_dir/scene_$id.png"
  done
}

for i in "${!ids[@]}"; do
  id="${ids[$i]}"; flicks="${flickss[$i]}"; variants="${variantss[$i]}"

  # A scene with per-platform variants (emery pinning HR, aplite falling back off health
  # slots) shoots each variant platform from its own fixture; every other platform in
  # PLATFORMS shares the base fixture in one capture run. Variant platforms not in
  # PLATFORMS are simply skipped.
  base_plats=""
  for p in $PLATFORMS; do
    case " $variants " in *" $p "*) ;; *) base_plats+="$p " ;; esac
  done
  base_plats="${base_plats% }"

  if [[ -n "$base_plats" ]]; then
    printf '\n######## showcase scene %s (flicks=%s, base=%s) ########\n' "$id" "$flicks" "$base_plats"
    FLICKS="$flicks" PLATFORMS="$base_plats" "$here/scripts/capture-screenshots.sh" "$version" "showcase-$id" </dev/null
    file_scene "$id" $base_plats
  fi
  for plat in $variants; do
    case " $PLATFORMS " in *" $plat "*) ;; *) continue ;; esac
    printf '\n######## showcase scene %s (flicks=%s, %s variant) ########\n' "$id" "$flicks" "$plat"
    FLICKS="$flicks" PLATFORMS="$plat" "$here/scripts/capture-screenshots.sh" "$version" "showcase-$id-$plat" </dev/null
    file_scene "$id" "$plat"
  done
done

printf '\nShowcase frames captured under screenshot/%s/showcase/frames/<platform>/.\n' "$version"
printf 'Assemble the looping GIF per platform:\n'
for platform in $PLATFORMS; do
  printf '  scripts/assemble-showcase-gif.sh %s %s\n' "$version" "$platform"
done
