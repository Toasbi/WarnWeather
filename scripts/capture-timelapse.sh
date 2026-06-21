#!/usr/bin/env bash

set -euo pipefail

# Capture the two-phase time-lapse on all five platforms (one rebuild per frame,
# because watch.now is compile-time). Phase A frames (timelapse-a-NN) are shot on
# the forecast/calendar view; Phase B frames (timelapse-b-NN) are shot on the
# radar view after a tap. To minimize emulator boots, each platform's emulator is
# started once (on its first install) and reused across every frame; all are
# killed at the end. RUN ON THE MAC (needs the Pebble SDK + emulator).
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

# `timeout` is GNU coreutils, absent on stock macOS; fall back to gtimeout.
if command -v timeout >/dev/null 2>&1; then
  timeout_cmd=(timeout 30)
elif command -v gtimeout >/dev/null 2>&1; then
  timeout_cmd=(gtimeout 30)
else
  timeout_cmd=()
fi

# Track which platforms have already booted so the first install waits longer.
# Plain string membership (no associative arrays) keeps this bash 3.2 safe for
# stock macOS /bin/bash.
booted=""
is_booted()   { case " $booted " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
mark_booted() { is_booted "$1" || booted="$booted $1"; }
mark_unbooted() {
  local p new=""
  for p in $booted; do
    if [[ "$p" != "$1" ]]; then new="$new $p"; fi
  done
  booted="$new"
}

cleanup() { pebble kill 2>/dev/null || true; }
trap cleanup EXIT

# install_with_retries <platform> — install onto the (possibly already-running)
# emulator, retrying transient failures. Falls back to a kill+reinstall if the
# live emulator wedges.
install_with_retries() {
  local platform="$1"
  local attempt
  for attempt in 1 2 3; do
    if pebble install build/warnweather-dev.pbw --emulator "$platform"; then
      return 0
    fi
    if [[ $attempt -eq 3 ]]; then
      printf 'ERROR: could not install on %s after 3 attempts; giving up\n' "$platform" >&2
      exit 1
    fi
    printf 'Install attempt %d on %s failed, retrying...\n' "$attempt" "$platform" >&2
    if [[ $attempt -eq 2 ]]; then
      # Second failure: drop the wedged emulator so attempt 3 boots fresh.
      pebble kill 2>/dev/null || true
      mark_unbooted "$platform"
    fi
    sleep 4
  done
}

# settle <platform> — first boot is slow (emery slowest); reinstalls settle fast.
settle() {
  local platform="$1"
  if is_booted "$platform"; then
    sleep 2
  else
    mark_booted "$platform"
    if [[ "$platform" == "emery" ]]; then sleep 12; else sleep 6; fi
  fi
}

# capture_frame <platform> <out.png> <tap?>
capture_frame() {
  local platform="$1" out="$2" tap="$3"
  install_with_retries "$platform"
  settle "$platform"
  if [[ "$tap" == "tap" ]]; then
    pebble emu-tap --emulator "$platform"   # calendar -> radar
    sleep 1
  fi
  "${timeout_cmd[@]+"${timeout_cmd[@]}"}" pebble screenshot "$out" --emulator "$platform"
  printf 'Saved %s\n' "$out"
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

pebble kill 2>/dev/null || true
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
