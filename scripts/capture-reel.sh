#!/usr/bin/env bash
set -euo pipefail

# Capture the promo-reel chapter frames per platform and assemble each platform's reel.
# Thin wrapper over capture-screenshots.sh (same pattern as capture-showcase.sh). Intro
# frames are REUSED from a prior `capture-showcase.sh <version>` run
# (showcase/frames/<platform>/scene_{1,2,3,5}.png) — run that first. RUN ON THE MAC
# (needs the Pebble SDK + emulator).
#
# Usage:   scripts/capture-reel.sh <version>
#          PLATFORMS="emery" scripts/capture-reel.sh <version>   # subset

version="${1:-v0.0.0}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export WW_HEALTH_FIXTURE=1
export PLATFORMS="${PLATFORMS:-emery basalt flint aplite}"

# 0. Intro frames must already exist (from capture-showcase.sh).
for platform in $PLATFORMS; do
  for n in 1 2 3 5; do
    f="$here/screenshot/$version/showcase/frames/$platform/scene_$n.png"
    [[ -e "$f" ]] || { printf 'Missing intro frame %s — run scripts/capture-showcase.sh %s first.\n' "$f" "$version" >&2; exit 1; }
  done
done

# 1. (Re)generate reel fixtures + text cards.
node "$here/scripts/gen-reel-fixtures.js"
python3 "$here/scripts/gen-text-cards.py" "$version" $PLATFORMS

# 2. Capture each segment per platform. A segment is captured per platform using its
# variant fixture if it has one, else the base fixture; segments not applicable to a
# platform are skipped. Collect (id|flicks|platform|fixture) rows first, then capture,
# to keep pebble/mise children off this script's stdin (the showcase "only first shot" bug).
rows=()
while IFS='|' read -r id flicks plat fixture; do
  [[ -n "$id" ]] || continue
  case " $PLATFORMS " in *" $plat "*) rows+=("$id|$flicks|$plat|$fixture") ;; esac
done < <(node -e '
  const r = require("'"$here"'/scripts/gen-reel-fixtures.js");
  for (const s of r.SEGMENTS) for (const p of r.segmentPlatforms(s))
    console.log(s.id + "|" + s.flicks + "|" + p + "|" + r.fixtureFor(s, p));
')

for row in "${rows[@]}"; do
  IFS='|' read -r id flicks plat fixture <<< "$row"
  printf '\n######## reel %s → %s (fixture=%s, flicks=%s) ########\n' "$id" "$plat" "$fixture" "$flicks"
  FLICKS="$flicks" PLATFORMS="$plat" "$here/scripts/capture-screenshots.sh" "$version" "$fixture" </dev/null
  dest="$here/screenshot/$version/promo/frames/$plat"
  mkdir -p "$dest"
  cp "$here/screenshot/$version/raw/$plat.png" "$dest/$id.png"
done

# 3. Assemble each platform's reel.
for platform in $PLATFORMS; do
  "$here/scripts/assemble-reel.sh" "$version" "$platform"
done

printf '\nReels written to screenshot/%s/promo/<platform>-reel.gif — review them, then upload manually.\n' "$version"
