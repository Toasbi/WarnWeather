#!/usr/bin/env bash

set -euo pipefail

# Builds the dev .pbw, installs it on each supported emulator platform,
# waits for the watchface to render, and saves screenshots to
# screenshot/<version>/raw/<platform>.png ready for mise composite <version>.
#
# Usage:   scripts/capture-screenshots.sh <version> [fixture]
# Example: scripts/capture-screenshots.sh v1.0.0
#          scripts/capture-screenshots.sh v1.0.0 berlin

if [[ $# -lt 1 ]]; then
  printf 'Usage: %s <version> [fixture]\n' "$0" >&2
  printf 'Example: %s v1.0.0 berlin\n' "$0" >&2
  exit 1
fi

version="$1"
export FIXTURE="${2:-berlin}"
raw_dir="screenshot/$version/raw"
# PLATFORMS (space-separated) overrides the default set — e.g. the showcase shoots only
# the three README platforms.
if [[ -n "${PLATFORMS:-}" ]]; then
  read -ra platforms <<< "$PLATFORMS"
else
  platforms=(aplite basalt diorite emery flint)
fi

# Wrist-flicks to send before the screenshot. FLICKS (an integer) overrides; otherwise 1
# for the radar fixtures (the watch boots on the calendar and needs a tap to reach the
# radar), else 0. WW_HEALTH_FIXTURE is read from the environment by the build (mise run
# build), so callers wanting canned health values just export it before invoking this.
radar_fixtures=(berlin rainy store-wind-radar)
flicks="${FLICKS:-}"
if [[ -z "$flicks" ]]; then
  flicks=0
  for radar_fixture in "${radar_fixtures[@]}"; do
    if [[ "$FIXTURE" == "$radar_fixture" ]]; then
      flicks=1
    fi
  done
fi

# Bound any command with a timeout so a wedged emulator can't hang the capture
# forever. Uses timeout/gtimeout when present (GNU coreutils), else a portable
# bash watchdog so no external dependency is required on stock macOS.
run_bounded() {
  local secs="$1"; shift
  # -k 10: if the command ignores SIGTERM at the deadline (a wedged `pebble
  # install` does), follow up with SIGKILL 10s later so the bound is enforced.
  if command -v timeout >/dev/null 2>&1; then
    timeout -k 10 "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout -k 10 "$secs" "$@"
  else
    "$@" &
    local pid=$!
    ( sleep "$secs"; kill "$pid" 2>/dev/null; sleep 10; kill -9 "$pid" 2>/dev/null ) &
    local watcher=$!
    local rc=0
    wait "$pid" 2>/dev/null || rc=$?
    kill "$watcher" 2>/dev/null || true
    wait "$watcher" 2>/dev/null || true
    return "$rc"
  fi
}

# `pebble screenshot` can wedge even on a booted emulator; bound it at 30s.
screenshot_bounded() {
  run_bounded 30 pebble screenshot "$1" --emulator "$2"
}

# `pebble kill` sometimes leaves the heavy QEMU/pypkjs processes alive (especially
# emery), which wedges the next install. Force-reap any stragglers too.
kill_emulators() {
  pebble kill >/dev/null 2>&1 || true
  pkill -f qemu   >/dev/null 2>&1 || true
  pkill -f pypkjs >/dev/null 2>&1 || true
}

# Full reset: reap stragglers AND wipe the emulator image. A force-killed QEMU
# can corrupt emery's saved state so it never re-boots; wiping guarantees a clean
# cold boot. Use on entry and install-retry recovery.
reset_emulator() {
  kill_emulators
  run_bounded 30 pebble wipe >/dev/null 2>&1 || true
}

# Reap on every exit path (set -e abort, screenshot-timeout, Ctrl-C) so a wedged
# emulator can never outlive the script — matches capture-timelapse.sh.
trap kill_emulators EXIT

mkdir -p "$raw_dir"

printf 'Building dev .pbw...\n'
mise run build -- dev

reset_emulator
sleep 2

for platform in "${platforms[@]}"; do
  printf '\n==> %s\n' "$platform"

  for attempt in 1 2 3; do
    # Bound the install so a wedged emulator can't hang the run; 60s clears a
    # cold boot but catches a wedge, after which we reap and retry.
    if run_bounded 60 pebble install build/warnweather-dev.pbw --emulator "$platform"; then
      break
    fi
    if [[ $attempt -eq 3 ]]; then
      printf 'ERROR: could not install on %s after 3 attempts\n' "$platform" >&2
      kill_emulators
      exit 1
    fi
    printf 'Install attempt %d failed, retrying...\n' "$attempt" >&2
    reset_emulator   # reap + wipe so the retry boots from a clean image
    sleep 4
  done

  # emery boots slower; give it extra time before screenshotting
  if [[ "$platform" == "emery" ]]; then
    sleep 12
  else
    sleep 5
  fi

  for (( k = 0; k < flicks; k++ )); do
    run_bounded 20 pebble emu-tap --emulator "$platform" || printf 'WARN: emu-tap failed on %s\n' "$platform" >&2
    sleep 1   # honor the ~500ms accel-tap debounce between flicks
  done

  output="$raw_dir/$platform.png"
  screenshot_bounded "$output" "$platform"
  printf 'Saved %s\n' "$output"

  reset_emulator   # reap + wipe so the next platform boots from a clean image
  sleep 4
done

printf '\nAll screenshots captured in %s\n' "$raw_dir"
printf 'Next: mise composite %s\n' "$version"
