#!/bin/bash

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: mise composite <version>"
  echo "Example: mise composite v1.33.0"
  exit 64
fi

version="$1"
store_dir="screenshot/$version/store"
composite_dir="screenshot/$version/composite"

if [ ! -d "$store_dir" ]; then
  echo "Missing store screenshot directory: $store_dir"
  echo "Run scripts/capture-store-shots.sh $version first."
  exit 66
fi

mkdir -p "$composite_dir"

# Frame the README hero shots from the per-platform store captures
# (screenshot/<ver>/store/<platform>/<config>.png). The config chosen for each
# device frame is deliberate — one calendar, one wind, one radar — for variety.
composite_shot() {
  local platform="$1"
  local config="$2"
  local frame="$3"
  local output_name="$4"
  local src="$store_dir/$platform/$config.png"

  if [ ! -f "$src" ]; then
    echo "Missing $src — skipping $output_name"
    return
  fi

  echo "Compositing $src -> $composite_dir/$output_name.png"
  screenshot/composite_svg.sh "$frame" "$src" "$composite_dir/$output_name.png"
}

composite_shot "flint"  "1-calendar"         "pebble-time-red"   "pebble-time-red"
composite_shot "flint"  "3-wind-gust"        "pebble2-duo-white" "pebble2-duo-white"
composite_shot "emery"  "2-radar-multicolor" "pebble-time2-red"  "pebble-time2-red"
