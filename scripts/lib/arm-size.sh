# Sourced by scripts/aplite-size.sh and scripts/check-64k-size.sh (not run on its own).
#
# arm_size_bin prints the path of an arm-none-eabi-size: PATH first, else the Pebble
# SDK toolchain. The SDK persist dir is OS-specific (coredevices/pebble-tool
# get_persist_dir): macOS uses ~/Library/Application Support/Pebble SDK, Linux (the CI
# runner) uses ~/.pebble-sdk or $XDG_DATA_HOME/pebble-sdk (default
# ~/.local/share/pebble-sdk). The toolchain is not on PATH there — `pebble build` finds
# it internally — so probe every root. Any installed toolchain works:
# arm-none-eabi-size reads ELF section sizes identically across builds, so the specific
# pick is arbitrary. Prints nothing when none is found.
arm_size_bin() {
  local size_bin
  size_bin=$(command -v arm-none-eabi-size 2>/dev/null || true)
  if [ -z "$size_bin" ]; then
    local sdk_root
    for sdk_root in \
      "$HOME/Library/Application Support/Pebble SDK" \
      "$HOME/.pebble-sdk" \
      "${XDG_DATA_HOME:-$HOME/.local/share}/pebble-sdk"; do
      [ -d "$sdk_root/SDKs" ] || continue
      size_bin=$(find "$sdk_root/SDKs" -name arm-none-eabi-size 2>/dev/null | sort | tail -1)
      [ -n "$size_bin" ] && break
    done
  fi
  printf '%s' "$size_bin"
}
