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
(cd "$here" && node scripts/gen-reel-fixtures.js)
python3 "$here/scripts/gen-text-cards.py" "$version" $PLATFORMS

# 2. Capture each segment's platforms grouped by shared fixture — platforms with no
# variant for a segment share its base fixture and are captured together in one
# capture-screenshots.sh call (mirroring capture-showcase.sh's batching); only genuine
# per-platform variants get their own call. Collect rows first, then capture, to keep
# pebble/mise children off this script's stdin (the showcase "only first shot" bug).
rows=()
while IFS='|' read -r id flicks plats fixture; do
  [[ -n "$id" ]] || continue
  group=""
  for p in $plats; do
    case " $PLATFORMS " in *" $p "*) group+="$p " ;; esac
  done
  group="${group% }"
  [[ -n "$group" ]] || continue
  rows+=("$id|$flicks|$group|$fixture")
done < <(cd "$here" && node -e '
  const r = require("./scripts/gen-reel-fixtures.js");
  for (const s of r.SEGMENTS) {
    const byFixture = {};
    for (const p of r.segmentPlatforms(s)) {
      const f = r.fixtureFor(s, p);
      (byFixture[f] = byFixture[f] || []).push(p);
    }
    for (const [fixture, plats] of Object.entries(byFixture)) {
      console.log(s.id + "|" + s.flicks + "|" + plats.join(" ") + "|" + fixture);
    }
  }
')

for row in "${rows[@]}"; do
  IFS='|' read -r id flicks group fixture <<< "$row"
  printf '\n######## reel %s → %s (fixture=%s, flicks=%s) ########\n' "$id" "$group" "$fixture" "$flicks"
  FLICKS="$flicks" PLATFORMS="$group" "$here/scripts/capture-screenshots.sh" "$version" "$fixture" </dev/null
  for plat in $group; do
    dest="$here/screenshot/$version/promo/frames/$plat"
    mkdir -p "$dest"
    cp "$here/screenshot/$version/raw/$plat.png" "$dest/$id.png"
  done
done

# 3. Assemble each platform's reel.
for platform in $PLATFORMS; do
  "$here/scripts/assemble-reel.sh" "$version" "$platform"
done

printf '\nReels written to screenshot/%s/promo/<platform>-reel.gif — review them, then upload manually.\n' "$version"
