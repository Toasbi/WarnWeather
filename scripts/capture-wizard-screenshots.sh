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
# capture-screenshots.sh defaults WW_SKIP_TESTS=1 and narrows the build to $PLATFORMS.
node "$here/scripts/gen-wizard-fixtures.js"
rm -rf "$stage"; mkdir -p "$stage"

# Collect the slug/flicks pairs FIRST, then capture in a separate loop. Running the captures
# directly inside `while read … done < <(node …)` let capture-screenshots.sh's children
# (pebble/mise) drain the process-substitution fd, so the loop ran only ONCE — that was the
# "only the first basalt went through" bug. The read loop below has no such children.
slugs=(); flickss=()
while IFS= read -r line; do
  [[ -n "$line" ]] || continue
  slugs+=("${line%% *}"); flickss+=("${line##* }")
done < <(node -e "require('$here/scripts/gen-wizard-fixtures.js').SHOTS.forEach(function(s){console.log(s.slug + ' ' + s.flicks);})")

for i in "${!slugs[@]}"; do
  slug="${slugs[$i]}"; flicks="${flickss[$i]}"
  printf '\n######## wizard shot %s (flicks=%s) ########\n' "$slug" "$flicks"
  # </dev/null: keep capture-screenshots.sh (and pebble/mise) off this script's stdin.
  FLICKS="$flicks" "$here/scripts/capture-screenshots.sh" "$version" "wizard-$slug" </dev/null
  cp "$here/screenshot/$version/raw/basalt.png" "$stage/$slug.png"
done

node "$here/scripts/gen-wizard-screenshots.js" "$stage"
printf '\nWrote src/pkjs/settings/wizard-screenshots.generated.js — review the images, then commit it.\n'
