#!/usr/bin/env bash
#
# Print the aplite app image footprint via arm-none-eabi-size on the built ELF.
# On aplite the whole image (.text+.data+.bss) loads into the fixed 24 KB app
# RAM and the heap is whatever's left, so every byte the image shrinks is one
# byte of heap headroom gained (1:1). A lean twin's recovery is the decrease in
# the image total (equivalently, the increase in free heap) before vs after.
# (The SDK's own "APP MEMORY USAGE" report is not emitted by a local
# `pebble build`, so we read the ELF directly.) Runtime *peak* headroom is
# measured separately on the diorite proxy — see AGENTS.md.
set -euo pipefail

wt_root=$(git rev-parse --show-toplevel)
elf="$wt_root/build/aplite/pebble-app.elf"

# Build if the aplite ELF is missing (a prior `mise build` leaves it in place).
if [ ! -f "$elf" ]; then
  echo "aplite ELF not found; building…"
  mise build dev
fi
[ -f "$elf" ] || { echo "no aplite ELF at $elf after build" >&2; exit 1; }

# Locate arm-none-eabi-size: PATH first, else the Pebble SDK toolchain. The SDK
# persist dir is OS-specific (coredevices/pebble-tool get_persist_dir): macOS uses
# ~/Library/Application Support/Pebble SDK, Linux (the CI runner) uses ~/.pebble-sdk
# or $XDG_DATA_HOME/pebble-sdk (default ~/.local/share/pebble-sdk). The toolchain
# is not on PATH there — `pebble build` finds it internally — so probe every root.
# Any installed toolchain works: arm-none-eabi-size reads ELF section sizes
# identically across builds, so the specific pick is arbitrary.
size_bin=$(command -v arm-none-eabi-size 2>/dev/null || true)
if [ -z "$size_bin" ]; then
  for sdk_root in \
    "$HOME/Library/Application Support/Pebble SDK" \
    "$HOME/.pebble-sdk" \
    "${XDG_DATA_HOME:-$HOME/.local/share}/pebble-sdk"; do
    [ -d "$sdk_root/SDKs" ] || continue
    size_bin=$(find "$sdk_root/SDKs" -name arm-none-eabi-size 2>/dev/null | sort | tail -1)
    [ -n "$size_bin" ] && break
  done
fi
[ -n "$size_bin" ] || { echo "arm-none-eabi-size not found (PATH or Pebble SDK toolchain)" >&2; exit 1; }

"$size_bin" "$elf"
dec=$("$size_bin" "$elf" | awk 'NR==2 {print $4}')
free=$((24576 - dec))
echo "APLITE image (text+data+bss): ${dec} bytes"
echo "APLITE approx boot free heap: ${free} bytes (24576 - image)"
echo "Lean-twin recovery = increase in free heap (decrease in image) vs the pre-fork baseline."
