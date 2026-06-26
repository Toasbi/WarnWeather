#!/usr/bin/env bash

set -euo pipefail

# Capture the two-phase time-lapse on all five platforms. watch.now is
# compile-time, so every frame is its own build; a build produces one
# multi-platform .pbw, so we build each fixture once up front and stash its
# .pbw, then capture platform-by-platform. Within a platform the live emulator
# is reused across every frame (a plain reinstall, no kill); `pebble kill` is
# only run when switching platforms — and as a force-reap of QEMU/pypkjs
# stragglers, because plain `pebble kill` leaves them alive (esp. emery) and
# running all five emulators at once wedges the slow-booting flint.
# RUN ON THE MAC (needs the Pebble SDK + emulator).
#
# Stashed .pbws are reused on re-run (fixtures are deterministic), so a capture
# that dies partway only needs to re-capture, not rebuild. Delete
# build/timelapse-pbw to force a full rebuild.
#
# An optional platform list captures only those platforms (the .pbws are still
# built once and stashed, so a later run for a deferred platform — e.g. the
# slow-booting flint — reuses them and only re-captures). With no list, all
# five are captured.
#
# Usage:   scripts/capture-timelapse.sh <version> [platform ...]
# Example: scripts/capture-timelapse.sh v1.1.0                       # all five
#          scripts/capture-timelapse.sh v1.1.0 emery basalt aplite diorite
#          scripts/capture-timelapse.sh v1.1.0 flint                 # defer flint

if [[ $# -lt 1 ]]; then
  printf 'Usage: %s <version> [platform ...]\n' "$0" >&2
  exit 1
fi

version="$1"
shift
all_platforms=(emery basalt aplite diorite flint)
if [[ $# -gt 0 ]]; then
  platforms=("$@")
  for p in "${platforms[@]}"; do
    case " ${all_platforms[*]} " in
      *" $p "*) ;;
      *) printf 'Unknown platform: %s (valid: %s)\n' "$p" "${all_platforms[*]}" >&2; exit 1 ;;
    esac
  done
else
  platforms=("${all_platforms[@]}")
fi

# Optional PHASE env filter: "a" or "b" builds and captures only that phase;
# unset does both. Lets a single phase be (re)done on its own — e.g.
# PHASE=b scripts/capture-timelapse.sh v1.3.2 emery grabs just the radar frames.
phase="${PHASE:-}"
case "$phase" in
  ""|a|b) ;;
  *) printf 'Invalid PHASE=%s (use a, b, or leave unset for both)\n' "$phase" >&2; exit 1 ;;
esac
want_a() { [[ "$phase" != "b" ]]; }
want_b() { [[ "$phase" != "a" ]]; }

frames_root="screenshot/$version/timelapse/frames"
pbw_dir="build/timelapse-pbw"

# --- diagnostics -------------------------------------------------------------
# Verbose, timestamped trace of every emulator command (duration + exit status)
# to stderr AND a per-run logfile, so a misbehaving capture leaves something
# shareable instead of a frozen terminal. Set WW_WATCH_LOGS=1 to also tail the
# watch's own APP_LOG output per platform into <frames>/<platform>/watch.log.
log_dir="screenshot/$version/timelapse"
mkdir -p "$log_dir"
log_file="$log_dir/capture.log"
printf '\n===== capture-timelapse %s [%s] platforms=%s =====\n' \
  "$version" "$(date '+%Y-%m-%d %H:%M:%S')" "${platforms[*]}" >>"$log_file"

log() {
  local line="[$(date '+%H:%M:%S')] $*"
  printf '%s\n' "$line" >&2
  printf '%s\n' "$line" >>"$log_file"
}

# Count matching processes portably (macOS pgrep lacks -c).
proc_count() { pgrep -f "$1" 2>/dev/null | wc -l | tr -d ' '; }

# Optional watch-side log tail (WW_WATCH_LOGS=1). Tied to the emulator lifecycle:
# reaping the emulator stops the tail, and the next boot restarts it.
watch_log_pid=""
start_watch_logs() {
  [[ "${WW_WATCH_LOGS:-0}" == "1" ]] || return 0
  if [[ -n "$watch_log_pid" ]] && kill -0 "$watch_log_pid" 2>/dev/null; then return 0; fi
  local platform="$1" wl="$frames_root/$platform/watch.log"
  mkdir -p "$frames_root/$platform"
  log "watch-logs: tailing $platform -> $wl"
  pebble logs --emulator "$platform" >>"$wl" 2>&1 &
  watch_log_pid=$!
}
stop_watch_logs() {
  [[ -n "$watch_log_pid" ]] || return 0
  kill "$watch_log_pid" 2>/dev/null || true
  wait "$watch_log_pid" 2>/dev/null || true
  watch_log_pid=""
}

# Bound any command with a timeout so a wedged emulator can't hang the capture
# forever. Uses timeout/gtimeout when present (GNU coreutils), else a portable
# bash watchdog so no external dependency is required on stock macOS.
run_bounded() {
  local secs="$1"; shift
  local start end rc=0
  log "run (<=${secs}s): $*"
  start=$(date +%s)
  # -k 10: if the command ignores SIGTERM at the deadline (a wedged `pebble
  # install` does), follow up with SIGKILL 10s later so the bound is enforced.
  if command -v timeout >/dev/null 2>&1; then
    timeout -k 10 "$secs" "$@" || rc=$?
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout -k 10 "$secs" "$@" || rc=$?
  else
    "$@" &
    local pid=$!
    ( sleep "$secs"; kill "$pid" 2>/dev/null; sleep 10; kill -9 "$pid" 2>/dev/null ) &
    local watcher=$!
    wait "$pid" 2>/dev/null || rc=$?
    kill "$watcher" 2>/dev/null || true
    wait "$watcher" 2>/dev/null || true
  fi
  end=$(date +%s)
  if [[ $rc -ne 0 && $((end - start)) -ge $secs ]]; then
    log "TIMED OUT after $((end - start))s (rc=$rc): $*"
  else
    log "done in $((end - start))s (rc=$rc): $*"
  fi
  return "$rc"
}

# `pebble screenshot` can wedge even on a booted emulator; bound it at 30s.
screenshot_bounded() {
  run_bounded 30 pebble screenshot "$1" --emulator "$2"
}

# `pebble kill` sometimes leaves the heavy QEMU/pypkjs processes alive (especially
# emery), which wedges the next install. Force-reap any stragglers too. Only run
# this when switching platforms or recovering from a wedge — never between frames
# of the same platform, where the live emulator is reused.
kill_emulators() {
  stop_watch_logs
  log "reap: before qemu=$(proc_count qemu) pypkjs=$(proc_count pypkjs)"
  pebble kill >>"$log_file" 2>&1 || true
  pkill -f qemu   >/dev/null 2>&1 || true
  pkill -f pypkjs >/dev/null 2>&1 || true
  sleep 1
  log "reap: after  qemu=$(proc_count qemu) pypkjs=$(proc_count pypkjs)"
}

# Full reset: reap stragglers AND wipe the emulator image. A force-killed QEMU
# can corrupt emery's saved state so it never re-boots (the v1.1.0 boot wedge);
# wiping guarantees a clean cold boot. Use on platform entry and wedge recovery.
reset_emulator() {
  kill_emulators
  log "wipe: resetting emulator state"
  run_bounded 30 pebble wipe || log "WARN: pebble wipe failed"
}

trap kill_emulators EXIT

# install_with_retries <platform> <pbw> — reinstall onto the live emulator
# (boots it on the first call per platform). On failure, force-reap the wedged
# emulator and retry from a fresh boot. Sets REBOOTED=1 if it had to reap, so
# the caller waits for a full boot rather than a quick settle. Returns non-zero
# after 3 attempts so the caller can skip this platform rather than abort the
# whole run.
REBOOTED=0
install_with_retries() {
  local platform="$1" pbw="$2" attempt
  REBOOTED=0
  for attempt in 1 2 3; do
    # Bound the install: emery wedges after repeated reinstalls onto the live
    # emulator, and a bare `pebble install` then hangs forever (no return = the
    # retry below never fires). 60s clears a cold emery boot but catches a wedge.
    if run_bounded 60 pebble install "$pbw" --emulator "$platform"; then
      return 0
    fi
    if [[ $attempt -eq 3 ]]; then
      printf 'ERROR: could not install on %s after 3 attempts; giving up on this platform\n' "$platform" >&2
      kill_emulators
      return 1
    fi
    printf 'Install attempt %d on %s failed, retrying...\n' "$attempt" "$platform" >&2
    reset_emulator
    REBOOTED=1
    sleep 4
  done
}

# boot_wait <platform> — emery boots slower than the others.
boot_wait() {
  if [[ "$1" == "emery" ]]; then sleep 12; else sleep 5; fi
}

# need_boot is reset to 1 at the start of each platform; the first install (and
# any forced reboot) waits for a full boot, later reinstalls settle briefly.
need_boot=1

# capture_one <platform> <pbw> <out.png> <tap?> — install, settle, optionally
# tap, then grab the screenshot. `pebble screenshot` can time out even on a
# booted emulator (the screenshot service wedges, esp. on the slow flint), so
# retry the whole install+grab from a fresh boot rather than letting one timeout
# abort the run. Returns non-zero after 3 attempts so the caller skips the rest
# of this platform.
capture_one() {
  local platform="$1" pbw="$2" out="$3" tap="$4" attempt
  log "frame: $(basename "$out") on $platform (tap=$tap)"
  for attempt in 1 2 3; do
    if ! install_with_retries "$platform" "$pbw"; then
      return 1
    fi
    if [[ $need_boot -eq 1 || $REBOOTED -eq 1 ]]; then
      log "boot-wait $platform (need_boot=$need_boot rebooted=$REBOOTED)"
      boot_wait "$platform"
    else
      sleep 2
    fi
    need_boot=0
    start_watch_logs "$platform"
    if [[ "$tap" == "tap" ]]; then
      run_bounded 20 pebble emu-tap --emulator "$platform" || log "WARN: emu-tap failed on $platform"   # calendar -> radar
      sleep 1
    fi
    if screenshot_bounded "$out" "$platform"; then
      log "saved $out"
      return 0
    fi
    log "screenshot attempt $attempt on $platform timed out, reaping and retrying..."
    reset_emulator
    need_boot=1
    sleep 4
  done
  printf 'ERROR: screenshot kept timing out on %s after 3 attempts; skipping rest of this platform\n' "$platform" >&2
  return 1
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

# Build phase: one build per fixture, stash the .pbw. Skip fixtures already
# stashed so a re-run resumes at capture instead of rebuilding. The unit suite
# is skipped per build (WW_SKIP_TESTS) — it's a screenshot capture, not a test
# run, and re-running the suite for every fixture only adds time and a chance for
# a flake to abort the whole capture. Run `mise test` before capturing.
export WW_SKIP_TESTS=1
mkdir -p "$pbw_dir"
build_fixtures=()
if want_a; then build_fixtures+=("${a_fixtures[@]}"); fi
if want_b; then build_fixtures+=("${b_fixtures[@]}"); fi
for fixture in "${build_fixtures[@]}"; do
  base="$(basename "$fixture" .json)"
  if [[ -f "$pbw_dir/$base.pbw" ]]; then
    printf 'Reusing stashed build for %s\n' "$base"
    continue
  fi
  printf '\n==> build %s\n' "$base"
  FIXTURE="$base" mise run build -- dev
  cp build/warnweather-dev.pbw "$pbw_dir/$base.pbw"
done

# capture_platform <platform> — capture every frame of one platform, reusing
# the live emulator across all of them; reap only on entry/exit. Returns
# non-zero if any frame gives up, so the caller can skip to the next platform.
capture_platform() {
  local platform="$1" fixture base nn
  printf '\n######## platform %s ########\n' "$platform"
  log "######## platform $platform ########"
  reset_emulator
  sleep 2
  need_boot=1

  # Phase A: forecast/calendar view (no tap).
  if want_a; then
    for fixture in "${a_fixtures[@]}"; do
      base="$(basename "$fixture" .json)"   # timelapse-a-00
      nn="${base##*-}"                      # 00
      capture_one "$platform" "$pbw_dir/$base.pbw" "$frames_root/$platform/a_$nn.png" "no-tap" || return 1
    done
  fi

  # Phase B: radar view (tap once after each reinstall).
  if want_b; then
    for fixture in "${b_fixtures[@]}"; do
      base="$(basename "$fixture" .json)"   # timelapse-b-00
      nn="${base##*-}"                      # 00
      capture_one "$platform" "$pbw_dir/$base.pbw" "$frames_root/$platform/b_$nn.png" "tap" || return 1
    done
  fi

  kill_emulators
}

# Capture phase: one platform at a time. A platform that can't be captured is
# skipped (and reported at the end as re-runnable) rather than aborting the run.
failed_platforms=()
for platform in "${platforms[@]}"; do
  if ! capture_platform "$platform"; then
    failed_platforms+=("$platform")
    kill_emulators
  fi
done

done_platforms=()
for platform in "${platforms[@]}"; do
  skip=0
  for f in "${failed_platforms[@]+"${failed_platforms[@]}"}"; do
    [[ "$f" == "$platform" ]] && skip=1
  done
  [[ $skip -eq 0 ]] && done_platforms+=("$platform")
done

if [[ ${#done_platforms[@]} -gt 0 ]]; then
  printf '\nDone. Next, per platform:\n'
  for platform in "${done_platforms[@]}"; do
    printf '  scripts/assemble-gif.sh %s %s\n' "$version" "$platform"
  done
fi

if [[ ${#failed_platforms[@]} -gt 0 ]]; then
  printf '\nIncomplete platforms (re-run later; stashed .pbws are reused):\n' >&2
  for platform in "${failed_platforms[@]}"; do
    printf '  scripts/capture-timelapse.sh %s %s\n' "$version" "$platform" >&2
  done
  exit 1
fi
