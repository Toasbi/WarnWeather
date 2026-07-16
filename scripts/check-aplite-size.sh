#!/usr/bin/env bash
#
# Fail when the aplite app image exceeds the launch-safety ceiling.
#
# On aplite the whole image (text+data+bss) loads into the fixed 24 KB app RAM
# and the firmware needs ~2.5 KB of it left to start the process at all. Past
# that, the app SILENTLY never launches: install succeeds, PKJS runs, but the
# watch side never logs, never handshakes, never ACKs — no crash anywhere.
# Measured 2026-07-16 (SDK 4.17 emulator): a 22058 B image boots, 22102 B does
# not, so the hard limit sits in [22058, 22101]. The ceiling below keeps a
# safety margin under that band; if a change trips this check, reclaim image
# bytes on aplite (see docs/adr/0001-aplite-frozen-lean-fork.md for the
# mechanisms) rather than raising the ceiling.
set -euo pipefail

ceiling="${APLITE_IMAGE_CEILING:-21800}"

out=$(scripts/aplite-size.sh)
printf '%s\n' "$out"

image=$(printf '%s\n' "$out" | sed -n 's/^APLITE image (text+data+bss): \([0-9]*\) bytes$/\1/p')
if [ -z "$image" ]; then
  echo "check-aplite-size: could not parse image size from aplite-size.sh output" >&2
  exit 1
fi

if [ "$image" -gt "$ceiling" ]; then
  echo "" >&2
  echo "✖ aplite image ${image} B exceeds the ${ceiling} B launch-safety ceiling (+$((image - ceiling)) B)." >&2
  echo "  Above ~22.06 KB the firmware silently refuses to launch the app on aplite." >&2
  echo "  Reclaim image bytes (docs/adr/0001-aplite-frozen-lean-fork.md); do not raise the ceiling." >&2
  exit 1
fi

echo "✓ aplite image ${image} B is within the ${ceiling} B ceiling ($((ceiling - image)) B headroom)."
