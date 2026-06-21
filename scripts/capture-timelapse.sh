#!/usr/bin/env bash

set -euo pipefail

# Capture the two-phase time-lapse on all five platforms (one rebuild per frame,
# because watch.now is compile-time). Phase A frames (timelapse-a-NN) are shot on
# the forecast/calendar view; Phase B frames (timelapse-b-NN) are shot on the
# radar view after a tap. Each shot runs on a freshly-booted emulator that is
# force-reaped afterwards: `pebble kill` alone can leave QEMU/pypkjs stragglers
# (especially emery) that wedge the next install, and reusing live emulators
# wedges the slow-to-boot platforms (flint), so we boot one at a time and reap
# everything between shots. RUN ON THE MAC (needs the Pebble SDK + emulator).
#
# Usage:   scripts/capture-timelapse.sh <version>
# Example: scripts/capture-timelapse.sh v1.1.0

if [[ $# -lt 1 ]]; then
  printf 'Usage: %s <version>\n' "$0" >&2
  exit 1
fi

version="$1"
platforms=(emery basalt aplite diorite flint)
frames_root="screenshot/$version/timelapse/frames"

# Run `pebble screenshot` with a 30s bound so a wedged emulator can't hang the
# capture forever. Uses timeout/gtimeout when present (GNU coreutils), else a
# portable bash watchdog so no external dependency is required on stock macOS.
screenshot_bounded() {
  local out="$1" plat="$2"
  if command -v timeout >/dev/null 2>&1; then
    timeout 30 pebble screenshot "$out" --emulator "$plat"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout 30 pebble screenshot "$out" --emulator "$plat"
  else
    pebble screenshot "$out" --emulator "$plat" &
    local pid=$!
    ( sleep 30; kill "$pid" 2>/dev/null ) &
    local watcher=$!
    local rc=0
    wait "$pid" 2>/dev/null || rc=$?
    kill "$watcher" 2>/dev/null || true
    wait "$watcher" 2>/dev/null || true
    return "$rc"
  fi
}

# `pebble kill` sometimes leaves the heavy QEMU/pypkjs processes alive (especially
# emery), which wedges the next install. Force-reap any stragglers too.
kill_emulators() {
  pebble kill >/dev/null 2>&1 || true
  pkill -f qemu   >/dev/null 2>&1 || true
  pkill -f pypkjs >/dev/null 2>&1 || true
}

trap kill_emulators EXIT

# install_with_retries <platform> — install on a fresh emulator, reaping any
# wedged stragglers before each retry.
install_with_retries() {
  local platform="$1"
  local attempt
  for attempt in 1 2 3; do
    if pebble install build/warnweather-dev.pbw --emulator "$platform"; then
      return 0
    fi
    if [[ $attempt -eq 3 ]]; then
      printf 'ERROR: could not install on %s after 3 attempts; giving up\n' "$platform" >&2
      kill_emulators
      exit 1
    fi
    printf 'Install attempt %d on %s failed, retrying...\n' "$attempt" "$platform" >&2
    kill_emulators
    sleep 4
  done
}

# boot_wait <platform> — emery boots slower than the others.
boot_wait() {
  if [[ "$1" == "emery" ]]; then sleep 12; else sleep 5; fi
}

# capture_frame <platform> <out.png> <tap?>
capture_frame() {
  local platform="$1" out="$2" tap="$3"
  install_with_retries "$platform"
  boot_wait "$platform"
  if [[ "$tap" == "tap" ]]; then
    pebble emu-tap --emulator "$platform"   # calendar -> radar
    sleep 1
  fi
  screenshot_bounded "$out" "$platform"
  printf 'Saved %s\n' "$out"
  kill_emulators
  sleep 4
}

node scripts/gen-timelapse-fixtures.js

shopt -s nullglob
a_fixtures=(fixtures/timelapse-a-*.json)
b_fixtures=(fixtures/timelapse-b-*.json)
if [[ ${#a_fixtures[@]} -eq 0 || ${#b_fixtures[@]} -eq 0 ]]; then
  printf 'No two-phase fixtures were generated\n' >&2
  exit 1
fi

for platform in "${platforms[@]}"; do
  mkdir -p "$frames_root/$platform"
done

kill_emulators
sleep 2

# Phase A: forecast/calendar view (no tap).
for fixture in "${a_fixtures[@]}"; do
  base="$(basename "$fixture" .json)"   # timelapse-a-00
  nn="${base##*-}"                      # 00
  printf '\n==> Phase A frame %s\n' "$nn"
  FIXTURE="$base" mise run build -- dev
  for platform in "${platforms[@]}"; do
    capture_frame "$platform" "$frames_root/$platform/a_$nn.png" "no-tap"
  done
done

# Phase B: radar view (tap once after each install).
for fixture in "${b_fixtures[@]}"; do
  base="$(basename "$fixture" .json)"   # timelapse-b-00
  nn="${base##*-}"                      # 00
  printf '\n==> Phase B frame %s\n' "$nn"
  FIXTURE="$base" mise run build -- dev
  for platform in "${platforms[@]}"; do
    capture_frame "$platform" "$frames_root/$platform/b_$nn.png" "tap"
  done
done

printf '\nDone. Next, per platform:\n'
for platform in "${platforms[@]}"; do
  printf '  scripts/assemble-gif.sh %s %s\n' "$version" "$platform"
done
