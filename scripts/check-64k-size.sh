#!/usr/bin/env bash
#
# Fail when a 64 KB watch's app image grows past its recorded ceiling.
#
# basalt, diorite and flint load the whole app image (text+data+bss) into a fixed
# 64 KB of app RAM (build/<platform>/pebble_app.ld.auto: APP LENGTH = 65536), and the
# heap is what the image leaves: every image byte is a heap byte, 1:1, as on aplite
# (check-aplite-size.sh). That heap then holds the AppMessage inbox (640 B) and outbox
# and every window, layer, font and PDC the watchface creates. The gate is the LOWEST
# free heap at runtime, measured with ENABLE_MEMORY_LOGGING=1 on the emulator: 4.5 KB
# on basalt and diorite (the custom-layout v2 heap gate, c24da813).
#
# The ceilings below are the measured release images; the script prints the boot free
# heap each leaves (65536 B less the image). The runtime low point is not measured yet.
# Lower a ceiling when bytes are reclaimed; never raise one without a measured runtime
# low point that allows it. A ceiling change edits only the numbers below: why it moved,
# and by how much, is in its commit message.
#
# PROVISIONAL: "Draw from: Top" (basalt +144 B, diorite/flint +192 B; stack +16 B on the
# forecast paint path, +16 B on the radar's), the temperature curve's margins with the
# hi/lo labels lined up on it (net basalt +252 B, diorite/flint +248 B; stack unchanged),
# the night re-shade setting its underlay colour per column (basalt +4 B; stack
# unchanged) and the health reads freeing the firmware's 2 KB health cache again
# (basalt/diorite/flint +52 B of image for 2052 B of runtime heap; stack +8 B on the
# health read paths) stay in these ceilings only if the basalt heap re-measure after the
# heap work shows 0 failed allocations with them in. Otherwise the owner picks a scope cut
# and the ceilings come down by what it saves.
#
# Emery's app RAM is 128 KB (8 KB gate), so it is not checked here.
#
# Measuring the low point: the ENABLE_MEMORY_LOGGING=1 build adds about 3.1 KB of image
# (its MEM| call sites; 3124 B on diorite/flint when measured at 60068 B), so a low
# point it logs sits about 3124 B below the release build's. Basalt's logging build
# links only while its release image is at most about 62392 B (the APP region
# overflowed by 116 B at 62508 B); above that its low point cannot be taken that way,
# and its release build's boot free heap is already its upper bound.
set -euo pipefail

wt_root=$(git rev-parse --show-toplevel)
. "$wt_root/scripts/lib/arm-size.sh"

ram=65536
# platform:ceiling (B of text+data+bss)
ceilings=(
  "basalt:${BASALT_IMAGE_CEILING:-58432}"
  "diorite:${DIORITE_IMAGE_CEILING:-56192}"
  "flint:${FLINT_IMAGE_CEILING:-56192}"
)

# Build if an ELF is missing (a prior `mise build` leaves them in place).
for entry in "${ceilings[@]}"; do
  if [ ! -f "$wt_root/build/${entry%%:*}/pebble-app.elf" ]; then
    echo "${entry%%:*} ELF not found; building…"
    mise build dev
    break
  fi
done

size_bin=$(arm_size_bin)
[ -n "$size_bin" ] || { echo "arm-none-eabi-size not found (PATH or Pebble SDK toolchain)" >&2; exit 1; }

fail=0
for entry in "${ceilings[@]}"; do
  platform=${entry%%:*}
  ceiling=${entry#*:}
  elf="$wt_root/build/$platform/pebble-app.elf"
  [ -f "$elf" ] || { echo "no $platform ELF at $elf after build" >&2; exit 1; }
  image=$("$size_bin" "$elf" | awk 'NR==2 {print $4}')
  label=$(printf '%s' "$platform" | tr '[:lower:]' '[:upper:]')
  echo "$label image (text+data+bss): ${image} bytes; approx boot free heap: $((ram - image)) bytes ($ram - image)"
  if [ "$image" -gt "$ceiling" ]; then
    echo "✖ $platform image ${image} B exceeds its ${ceiling} B ceiling (+$((image - ceiling)) B)." >&2
    fail=1
  else
    echo "✓ $platform image ${image} B is within its ${ceiling} B ceiling ($((ceiling - image)) B headroom)."
  fi
done

if [ "$fail" = 1 ]; then
  echo "" >&2
  echo "  The image comes out of the 64 KB of app RAM the heap lives in. Reclaim image bytes;" >&2
  echo "  raise a ceiling only with a measured runtime heap low point (see this script's header)." >&2
  exit 1
fi
