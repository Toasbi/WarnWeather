#!/usr/bin/env bash

set -euo pipefail

# Assemble a platform's captured two-phase time-lapse frames into optimized,
# infinitely-looping GIFs using ffmpeg's two-pass palette workflow:
#   <platform>-forecast.gif    Phase A frames (a_NN.png) — forecast/calendar view
#   <platform>-radar-wind.gif  Phase B frames (b_NN.png) — radar + wind/gust view
#   <platform>-combined.gif    Phase A then Phase B as one continuous timeline
#
# Usage:   scripts/assemble-gif.sh <version> <platform> [fps]
# Example: scripts/assemble-gif.sh v1.1.0 emery 6

if [[ $# -lt 2 ]]; then
  printf 'Usage: %s <version> <platform> [fps]\n' "$0" >&2
  exit 1
fi

version="$1"
platform="$2"
fps="${3:-6}"

frames_dir="screenshot/$version/timelapse/frames/$platform"
out_dir="screenshot/$version/timelapse"

shopt -s nullglob

# make_gif <out> <glob...> — copy the (alphabetically sorted) matches of each
# glob into a temp dir under a continuous f_NNN counter, then run the two-pass
# palette workflow. Globs are expanded here so multiple phases concatenate in
# order. Skips with a notice if no frames matched.
make_gif() {
  local out="$1"
  shift
  local tmp
  tmp="$(mktemp -d -t ww-gif.XXXXXX)"
  local n=0 pat f
  for pat in "$@"; do
    for f in $pat; do
      [[ -e "$f" ]] || continue
      cp "$f" "$tmp/$(printf 'f_%03d.png' "$n")"
      n=$((n + 1))
    done
  done
  if [[ $n -eq 0 ]]; then
    printf 'No frames matched for %s; skipping\n' "$out" >&2
    rm -rf "$tmp"
    return 0
  fi
  local palette="$tmp/palette.png"
  ffmpeg -y -framerate "$fps" -start_number 0 -i "$tmp/f_%03d.png" \
    -vf "palettegen=stats_mode=diff" -update 1 "$palette"
  ffmpeg -y -framerate "$fps" -start_number 0 -i "$tmp/f_%03d.png" -i "$palette" \
    -lavfi "paletteuse=dither=bayer:bayer_scale=3" -loop 0 "$out"
  rm -rf "$tmp"
  printf 'Wrote %s\n' "$out"
}

mkdir -p "$out_dir"
make_gif "$out_dir/$platform-forecast.gif"   "$frames_dir/a_*.png"
make_gif "$out_dir/$platform-radar-wind.gif" "$frames_dir/b_*.png"
make_gif "$out_dir/$platform-combined.gif"   "$frames_dir/a_*.png" "$frames_dir/b_*.png"
