#!/usr/bin/env bash

set -euo pipefail

# Capture the store art's watch screens (scripts/gen-store-art-fixtures.js) on every platform
# they belong to, into screenshot/<version>/store-art/frames/<platform>/<scene>.png, for
# scripts/store-art.py to build the store's showcase GIF and five store screens from.
#
# watch.now is compile-time, so every scene is its own build: each fixture is built once into
# build/store-art-pbw/ (all five platforms in one .pbw), then captured platform by platform: a
# platform's first scene on a freshly booted emulator with a fresh phone (see fresh_phone), the
# rest installed on that running emulator (every scene's settings name every key a scene
# changes, so none keeps the last one's: gen-store-art-fixtures.js). A stashed .pbw is reused
# while its fixture is unchanged (its sha256 sits beside it); delete build/store-art-pbw to
# rebuild them all, e.g. after a C change.
#
# Usage:   scripts/capture-store-art.sh <version> [scene ...]
# Example: scripts/capture-store-art.sh v2.3.0                     # every scene
#          scripts/capture-store-art.sh v2.3.0 alerts-on max-both   # just these
#          PLATFORMS="emery basalt" scripts/capture-store-art.sh v2.3.0

if [[ $# -lt 1 ]]; then
  printf 'Usage: %s <version> [scene ...]\n' "$0" >&2
  exit 1
fi

version="$1"
shift
wanted=("$@")
frames_root="screenshot/$version/store-art/frames"
pbw_dir="build/store-art-pbw"
read -ra platforms <<< "${PLATFORMS:-emery basalt diorite flint aplite}"

node scripts/gen-store-art-fixtures.js
manifest="$(node scripts/gen-store-art-fixtures.js --manifest)"

# scene_rows: "<id> <platform> <slug>" for every capture, filtered by the scene args.
scene_rows() {
  node -e '
    const m = JSON.parse(process.argv[1]);
    const want = process.argv.slice(2);
    for (const s of m) {
      if (want.length && !want.includes(s.id)) { continue; }
      for (const p of s.platforms) { console.log([s.id, p, s.fixtures[p]].join(" ")); }
    }' "$manifest" "${wanted[@]+"${wanted[@]}"}"
}

# Bound a command so a wedged emulator can't hang the run (-k: SIGKILL 10 s after SIGTERM).
run_bounded() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout -k 10 "$secs" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then gtimeout -k 10 "$secs" "$@"
  else "$@"; fi
}

# `pebble kill` can leave QEMU/pypkjs alive (emery especially): reap the stragglers too, and
# wait until they are gone. A pypkjs that outlives the kill by a moment is reused by the next
# install, and writes its own copy of the app's localStorage back (see fresh_phone).
kill_emulators() {
  local i
  pebble kill >/dev/null 2>&1 || true
  pkill -f qemu-pebble >/dev/null 2>&1 || true
  pkill -f pypkjs >/dev/null 2>&1 || true
  for (( i = 0; i < 20; i++ )); do
    pgrep -f 'qemu-pebble|pypkjs' >/dev/null 2>&1 || return 0
    pkill -9 -f qemu-pebble >/dev/null 2>&1 || true
    pkill -9 -f pypkjs >/dev/null 2>&1 || true
    sleep 0.5
  done
  printf 'kill_emulators: QEMU or pypkjs is still running\n' >&2
  return 1
}
trap kill_emulators EXIT

# A platform's run starts from a fresh phone. A fixture's settings are merged into what the
# app's localStorage holds (clay-settings.js applyFixtureSettings), so a scene keeps what the last
# run left there unless it names it (the scenes name everything they change among themselves,
# not what some other run set). Two things carry the last run's settings over: the localStorage
# pypkjs keeps across installs, and pypkjs's cached copy of the last build, whose JS it runs
# (with that build's fixture) when the booting watch reopens the old watchface, before the new
# install lands. fresh_phone stops the emulator for good and deletes both from pebble-tool's
# persist directory (pebble_tool/util get_persist_dir, per SDK and platform); the next install
# boots the watch again, and the fresh phone sends it the fixture's settings whole.
dev_uuid="$(node -p "require('./profiles/package.dev.json').uuid")"
sdk_version="$(tr -d '\r\n' < pebble-sdk-version)"
case "$(uname -s)" in
  Darwin) persist_root="$HOME/Library/Application Support/Pebble SDK" ;;
  *) if [[ -d "$HOME/.pebble-sdk" ]]; then persist_root="$HOME/.pebble-sdk"
     else persist_root="${XDG_DATA_HOME:-$HOME/.local/share}/pebble-sdk"; fi ;;
esac
fresh_phone() {
  local dir="$persist_root/$sdk_version/$1"
  kill_emulators || return 1
  rm -f "$dir/localstorage/$dev_uuid".* "$dir/app_cache/$dev_uuid.pbw"
  if ls "$dir/localstorage/$dev_uuid".* "$dir/app_cache/$dev_uuid.pbw" >/dev/null 2>&1; then
    printf "fresh_phone: the app's localStorage or cached build is still there\n" >&2
    return 1
  fi
}

# Build phase: one build per fixture the platforms capture, skipping a stash whose fixture hasn't
# changed. The unit
# suites are skipped per build (run `mise test` before capturing); WW_HEALTH_FIXTURE=1 bakes
# the canned health numbers the health view and slots show.
export WW_SKIP_TESTS=1 WW_HEALTH_FIXTURE=1
mkdir -p "$pbw_dir"
for slug in $(scene_rows | awk -v ps=" ${platforms[*]} " 'index(ps, " " $2 " ") {print $3}' | sort -u); do
  sum="$(shasum -a 256 "fixtures/$slug.json" 2>/dev/null || sha256sum "fixtures/$slug.json")"
  sum="${sum%% *}"
  if [[ -f "$pbw_dir/$slug.pbw" && "$(cat "$pbw_dir/$slug.sha256" 2>/dev/null)" == "$sum" ]]; then
    printf 'Reusing the stashed build of %s\n' "$slug"
    continue
  fi
  printf '\n==> build %s\n' "$slug"
  FIXTURE="$slug" mise run build -- dev
  cp build/warnweather-dev.pbw "$pbw_dir/$slug.pbw"
  printf '%s\n' "$sum" > "$pbw_dir/$slug.sha256"
done

# capture <platform> <id> <slug> <fresh>: install the scene's build and screenshot it. A fresh
# capture (a platform's first, or the next after one that failed) starts from a fresh phone and
# boots the watch (WW_BOOT_WAIT, 8 s, 12 on emery, which boots slowest); the others install on
# the running emulator and wait for the phone's send (WW_LIVE_WAIT, 5 s, 7 on emery). One retry
# from a fresh phone when the install or the screenshot wedges.
capture() {
  local platform="$1" id="$2" slug="$3" fresh="$4" out attempt wait boot live
  out="$frames_root/$platform/$id.png"
  boot="${WW_BOOT_WAIT:-8}" live="${WW_LIVE_WAIT:-5}"
  if [[ "$platform" == "emery" ]]; then boot="${WW_BOOT_WAIT:-12}" live="${WW_LIVE_WAIT:-7}"; fi
  for attempt in 1 2; do
    if [[ "$fresh" == 1 || "$attempt" == 2 ]]; then
      fresh_phone "$platform" || return 1
      wait="$boot"
    else
      wait="$live"
    fi
    if run_bounded 120 pebble install "$pbw_dir/$slug.pbw" --emulator "$platform" > "$pbw_dir/install.log" 2>&1; then
      sleep "$wait"
      if run_bounded 30 pebble screenshot "$out" --emulator "$platform" >/dev/null 2>&1; then
        printf '  %s\n' "$out"
        return 0
      fi
    fi
    printf '  %s on %s wedged (attempt %d); wiping the emulator\n' "$id" "$platform" "$attempt" >&2
    grep -v -i 'available\|update with' "$pbw_dir/install.log" | tail -3 | sed 's/^/    /' >&2
    kill_emulators
    run_bounded 30 pebble wipe >/dev/null 2>&1 || true
  done
  return 1
}

failed=()
for platform in "${platforms[@]}"; do
  rows="$(scene_rows | awk -v p="$platform" '$2 == p')"
  [[ -n "$rows" ]] || continue
  printf '\n######## %s ########\n' "$platform"
  mkdir -p "$frames_root/$platform"
  fresh=1
  while read -r id _ slug; do
    if capture "$platform" "$id" "$slug" "$fresh"; then fresh=0
    else failed+=("$platform/$id"); fresh=1; fi
  done <<< "$rows"
  kill_emulators || true
done

if [[ ${#failed[@]} -gt 0 ]]; then
  printf '\nNot captured (re-run with the scene ids): %s\n' "${failed[*]}" >&2
  exit 1
fi
printf '\nDone. Next: python3 -I scripts/store-art.py %s\n' "$version"
