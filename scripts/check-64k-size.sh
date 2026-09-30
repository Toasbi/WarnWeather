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
# 1.24.0 (On demand and the status slots' short forms, on top of 1.23.2) left the
# images at basalt 62660 B and diorite/flint 60236 B: about 2876 B and 5300 B of boot
# free heap before the first allocation. Basalt is under the 4.5 KB gate by construction, and the
# 640 B inbox alone takes diorite/flint to about 4.7 KB, at the gate before any window
# or layer. The runtime low point is not measured yet, and the owner has not decided
# between re-setting the gate to a measured floor and cutting image bytes. Until then
# the ceilings below are those measured images, set only so the next change cannot
# drift further. Lower a ceiling when bytes are reclaimed; never raise one without a
# measured runtime low point that allows it. (Two recorded exceptions, both for the
# heap-64k reclaim to take back: the final review's On demand layout fix, the slots
# back, added 180 B — less the 44 B (basalt) and 48 B (diorite, flint) its other
# fixes gave back, and basalt's 12 B of headroom, it raised basalt's ceiling by 124 B
# and diorite/flint's by 132 B; and merging the released 1.23.2 brought its own radar
# sky-row bytes, basalt +28 B and diorite/flint +36 B, which users already run.) The
# owner's make-room order of 2026-09-30 (the looks shorten last) gave 76 B back on all
# three, and the ceilings came down with it: basalt 62664 -> 62588, diorite/flint
# 60240 -> 60164.
# Emery's app RAM is 128 KB (8 KB gate), so it is not checked here.
#
# Measuring the low point: the ENABLE_MEMORY_LOGGING=1 build adds about 3.1 KB of image
# (its MEM| call sites; 3124 B on diorite/flint when measured at 60068 B). At the
# images above, diorite/flint's logging build is about 63360 B, which leaves about
# 2176 B of boot free heap, so a low point it logs sits about 3124 B below the release
# build's. Basalt's logging build does not link at all (the APP region overflowed by
# 116 B at 62508 B, so by about 268 B now), so its low point cannot be taken that way
# until image bytes come back; its release build's boot free heap (about 2876 B) is
# already its upper bound.
set -euo pipefail

wt_root=$(git rev-parse --show-toplevel)
. "$wt_root/scripts/lib/arm-size.sh"

ram=65536
# platform:ceiling (B of text+data+bss)
ceilings=(
  "basalt:${BASALT_IMAGE_CEILING:-62588}"
  "diorite:${DIORITE_IMAGE_CEILING:-60164}"
  "flint:${FLINT_IMAGE_CEILING:-60164}"
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
