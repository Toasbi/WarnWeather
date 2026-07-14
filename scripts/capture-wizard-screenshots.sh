#!/usr/bin/env bash
set -euo pipefail
# Capture one basalt screenshot per wizard-selectable option and inline them into
# src/pkjs/settings/wizard-screenshots.generated.js. RUN ON THE MAC (needs the Pebble SDK + emulator).
# Thin wrapper over capture-screenshots.sh (same pattern as capture-showcase.sh). Usage:
#   scripts/capture-wizard-screenshots.sh [version]
version="${1:-wizard}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stage="$here/screenshot/tmp/wizard"
export WW_HEALTH_FIXTURE=1          # canned health values for the health shots
export PLATFORMS="basalt"           # color-only; used for all watches in the wizard
node "$here/scripts/gen-wizard-fixtures.js"
rm -rf "$stage"; mkdir -p "$stage"
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  slug="${line%% *}"; flicks="${line##* }"
  printf '\n######## wizard shot %s (flicks=%s) ########\n' "$slug" "$flicks"
  FLICKS="$flicks" "$here/scripts/capture-screenshots.sh" "$version" "wizard-$slug"
  cp "$here/screenshot/$version/raw/basalt.png" "$stage/$slug.png"
done < <(node -e "require('$here/scripts/gen-wizard-fixtures.js').SHOTS.forEach(function(s){console.log(s.slug + ' ' + s.flicks);})")
node "$here/scripts/gen-wizard-screenshots.js" "$stage"
printf '\nWrote src/pkjs/settings/wizard-screenshots.generated.js — review the images, then commit it.\n'
