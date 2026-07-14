#!/usr/bin/env bash
set -euo pipefail
# Capture per-option wizard screenshots on every platform the wizard can show them on, and inline
# them (keyed by platform) into src/pkjs/settings/wizard-screenshots.generated.js. RUN ON THE MAC
# (needs the Pebble SDK + emulator). Thin wrapper over capture-screenshots.sh. Usage:
#   scripts/capture-wizard-screenshots.sh [version]
version="${1:-wizard}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
stage="$here/screenshot/tmp/wizard"
export WW_HEALTH_FIXTURE=1          # canned health values for the health shots
# Each fixture carries its own platform set (see gen-wizard-fixtures.js). capture-screenshots.sh
# defaults WW_SKIP_TESTS=1 and builds only the PLATFORMS it's shooting, so each fixture compiles
# just its platforms with no tests.
node "$here/scripts/gen-wizard-fixtures.js"
rm -rf "$stage"; mkdir -p "$stage"

# Collect slug|flicks|platforms FIRST, then capture in a separate loop: running
# capture-screenshots.sh inside `while read < <(node …)` let its pebble/mise children drain the
# process-substitution fd, so the loop ran only once (the "only the first shot" bug).
slugs=(); flickss=(); platss=()
while IFS='|' read -r slug flicks plats; do
  [[ -n "$slug" ]] || continue
  slugs+=("$slug"); flickss+=("$flicks"); platss+=("$plats")
done < <(node -e "require('$here/scripts/gen-wizard-fixtures.js').SHOTS.forEach(function(s){console.log(s.slug + '|' + s.flicks + '|' + s.platforms);})")

for i in "${!slugs[@]}"; do
  slug="${slugs[$i]}"; flicks="${flickss[$i]}"; plats="${platss[$i]}"
  printf '\n######## wizard shot %s (flicks=%s, platforms=%s) ########\n' "$slug" "$flicks" "$plats"
  # </dev/null: keep capture-screenshots.sh (and pebble/mise) off this script's stdin.
  PLATFORMS="$plats" FLICKS="$flicks" "$here/scripts/capture-screenshots.sh" "$version" "wizard-$slug" </dev/null
  # capture-screenshots.sh writes raw/<platform>.png per shot platform; stage each under its own
  # platform dir + option name (what gen-wizard-screenshots.js reads). cksum makes distinct shots
  # visible — the same cksum for two different fixtures means that render didn't change.
  for plat in $plats; do
    mkdir -p "$stage/$plat"
    cp "$here/screenshot/$version/raw/$plat.png" "$stage/$plat/$slug.png"
    printf '  → staged %s/%s.png [cksum %s]\n' "$plat" "$slug" "$(cksum < "$stage/$plat/$slug.png" | cut -d' ' -f1)"
  done
done

echo ""
echo "Staged shots (distinct cksums expected within each platform):"
( cd "$stage" && cksum ./*/*.png )

node "$here/scripts/gen-wizard-screenshots.js" "$stage"
printf '\nWrote src/pkjs/settings/wizard-screenshots.generated.js — review the images, then commit it.\n'
