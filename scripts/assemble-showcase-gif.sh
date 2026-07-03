#!/usr/bin/env bash

set -euo pipefail

# Assemble a platform's captured showcase scenes (scene_N.png) into one optimized,
# infinitely-looping GIF that shows each scene briefly and cross-fades between them,
# using ffmpeg's xfade filter followed by the two-pass palette workflow (for a clean,
# small GIF). Duplicated in spirit from assemble-gif.sh.
#
#   <platform>-showcase.gif    scene_1..N, each held `hold`s, `fade`s crossfade between
#
# Each scene is looped into a (hold+fade)-second segment; consecutive segments are
# chained with xfade at offset O_k = k*hold + (k-1)*fade (k = 1..N-1), so every scene is
# fully visible for `hold` then dissolves over `fade` into the next. The loop-around
# (last → first) is a hard cut, as is conventional for a looping GIF.
#
# Usage:   scripts/assemble-showcase-gif.sh <version> <platform> [hold_secs] [fade_secs] [fps]
# Example: scripts/assemble-showcase-gif.sh v1.6.0 basalt 1 0.35 15

if [[ $# -lt 2 ]]; then
  printf 'Usage: %s <version> <platform> [hold_secs] [fade_secs] [fps]\n' "$0" >&2
  exit 1
fi

version="$1"
platform="$2"
hold="${3:-1}"
fade="${4:-0.55}"
fps="${5:-15}"

frames_dir="screenshot/$version/showcase/frames/$platform"
out_dir="screenshot/$version/showcase"
out="$out_dir/$platform-showcase.gif"

shopt -s nullglob
scenes=("$frames_dir"/scene_*.png)
n=${#scenes[@]}
if [[ $n -eq 0 ]]; then
  printf 'No scene frames in %s; run capture-showcase.sh first\n' "$frames_dir" >&2
  exit 1
fi

tmp="$(mktemp -d -t ww-showcase-gif.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$out_dir"

# LC_ALL=C keeps awk's float formatting dot-decimal regardless of locale (ffmpeg needs ".").
fnum() { LC_ALL=C awk "BEGIN{printf \"%.4f\", $1}"; }

if [[ $n -eq 1 ]]; then
  # Single scene: nothing to fade — just hold it (no xfade).
  ffmpeg -y -loop 1 -t "$hold" -r "$fps" -i "${scenes[0]}" -map 0:v "$tmp/f_%04d.png"
else
  # Clip length C = hold + 2*fade. With equal clips, the k-th transition sits at offset
  # k*(hold+fade); this keeps each accumulated stream long enough for the next blend
  # (offset + fade <= accumulated length). A naive k*hold+(k-1)*fade offset with a
  # C=hold+fade clip ran the accumulated stream short, so ffmpeg dropped later scenes
  # (the GIF collapsed to the first couple). Middle scenes then hold ~= hold_secs;
  # the first and last hold hold_secs+fade.
  seg="$(fnum "$hold + 2 * $fade")"
  inputs=()
  for s in "${scenes[@]}"; do
    inputs+=(-loop 1 -t "$seg" -r "$fps" -i "$s")
  done
  # Chain: [0][1]xfade→[x1]; [x1][2]xfade→[x2]; …; last → [v].
  filter=""
  acc="[0]"
  for (( k = 1; k < n; k++ )); do
    off="$(fnum "$k * ($hold + $fade)")"
    if [[ $k -eq $((n - 1)) ]]; then outlabel="[v]"; else outlabel="[x$k]"; fi
    filter+="${acc}[$k]xfade=transition=fade:duration=$fade:offset=$off$outlabel;"
    acc="[x$k]"
  done
  filter="${filter%;}"
  ffmpeg -y "${inputs[@]}" -filter_complex "$filter" -map "[v]" "$tmp/f_%04d.png"
fi

# Two-pass palette on the rendered sequence → optimized looping GIF.
palette="$tmp/palette.png"
ffmpeg -y -framerate "$fps" -start_number 0 -i "$tmp/f_%04d.png" \
  -vf "palettegen=stats_mode=diff" -update 1 "$palette"
ffmpeg -y -framerate "$fps" -start_number 0 -i "$tmp/f_%04d.png" -i "$palette" \
  -lavfi "paletteuse=dither=bayer:bayer_scale=3" -loop 0 "$out"
printf 'Wrote %s (%d scenes, %ss hold, %ss fade)\n' "$out" "$n" "$hold" "$fade"
