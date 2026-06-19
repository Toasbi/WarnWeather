#!/usr/bin/env bash

set -euo pipefail

# Captures the four curated store screenshot configs on every supported
# platform and files them per-platform, so each platform ends up with all
# four shots (the Pebble appstore wants at least one screenshot per platform).
#
# Each config is a fixture that bundles its own Clay settings + weather/radar
# data. capture-screenshots.sh shoots all platforms for one fixture into
# screenshot/<version>/raw/<platform>.png; this wrapper copies that run's
# output into screenshot/<version>/store/<platform>/<label>.png before the
# next fixture overwrites raw/.
#
# Usage:   scripts/capture-store-shots.sh [version]
# Example: scripts/capture-store-shots.sh v1.0.0

version="${1:-v1.0.0}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

platforms=(aplite basalt diorite emery flint)

# Parallel arrays: fixture -> output label. Order is the shot order.
fixtures=(store-calendar berlin            windy        store-wind-radar)
labels=(  1-calendar     2-radar-multicolor 3-wind-gust 4-radar-white-wind)

for i in "${!fixtures[@]}"; do
  fixture="${fixtures[$i]}"
  label="${labels[$i]}"

  printf '\n######## %s -> %s ########\n' "$fixture" "$label"
  "$here/scripts/capture-screenshots.sh" "$version" "$fixture"

  for platform in "${platforms[@]}"; do
    raw="$here/screenshot/$version/raw/$platform.png"
    dest_dir="$here/screenshot/$version/store/$platform"
    mkdir -p "$dest_dir"
    cp "$raw" "$dest_dir/$label.png"
  done
done

printf '\nAll store shots captured under screenshot/%s/store/<platform>/\n' "$version"
printf 'Each platform has %d screenshots; upload them to that platform in the store.\n' "${#fixtures[@]}"
