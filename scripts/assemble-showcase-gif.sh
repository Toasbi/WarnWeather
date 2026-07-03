#!/usr/bin/env bash

set -euo pipefail

# Assemble a platform's captured showcase scenes (scene_N.png) into one optimized,
# infinitely-looping GIF that shows each scene briefly and cross-fades between them,
# using ffmpeg's xfade filter followed by the two-pass palette workflow (for a clean,
# small GIF). Duplicated in spirit from assemble-gif.sh.
#
#   <platform>-showcase.gif    scene_1..N, each held `hold`s, `fade`s crossfade between
#
# Each scene is looped into a (hold + 2*fade)-second segment; consecutive segments are
# chained with xfade at offset O_k = k*(hold+fade) (k = 1..N-1), so every scene is
# fully visible for `hold` then dissolves over `fade` into the next. For a seamless
# endless loop, scene_1 is appended once more (only `fade` long — its real hold already
# plays at the start) and the final xfade dissolves the last scene back into it, so the
# GIF ends fully resolved on scene_1, matching frame 0 — the loop-around has no seam.
#
# Usage:   scripts/assemble-showcase-gif.sh <version> <platform> [hold_secs] [fade_secs] [fps]
# Example: scripts/assemble-showcase-gif.sh v1.6.0 basalt 1 0.35 15
# Env:     MAX_SCENES=N  include only the first N captured scenes in the GIF (default 3;
#                        0 = all captured scenes).

if [[ $# -lt 2 ]]; then
  printf 'Usage: %s <version> <platform> [hold_secs] [fade_secs] [fps]\n' "$0" >&2
  exit 1
fi

version="$1"
platform="$2"
hold="${3:-1}"
fade="${4:-0.55}"
fps="${5:-15}"
# Cap how many of the captured scenes land in the GIF (first N by scene id). All scenes
# are still captured by capture-showcase.sh; this only trims what the GIF shows. Set
# MAX_SCENES=0 to include every captured scene.
max_scenes="${MAX_SCENES:-3}"

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

# Glob expands in sorted (scene id) order, so slicing keeps the first N scenes.
if [[ $max_scenes -gt 0 && $max_scenes -lt $n ]]; then
  scenes=("${scenes[@]:0:max_scenes}")
  n=${#scenes[@]}
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
  # Seamless wrap: append scene_1 again as input N. It's a still image, so `fade`
  # seconds is enough for the closing dissolve — no extra hold (its real hold plays at
  # the start of the GIF), which avoids a double-hold of scene_1 across the loop seam.
  inputs+=(-loop 1 -t "$fade" -r "$fps" -i "${scenes[0]}")
  # Chain: [0][1]xfade→[x1]; …; [x_{N-2}][N-1]xfade→[x_{N-1}]; then the wrap
  # [x_{N-1}][N]xfade→[v] dissolves scene_N back into the appended scene_1. Every
  # xfade sits at offset k*(hold+fade); the accumulated stream is exactly long enough
  # for each (offset+fade == accumulated length), including the wrap at k=N.
  filter=""
  acc="[0]"
  for (( k = 1; k < n; k++ )); do
    off="$(fnum "$k * ($hold + $fade)")"
    filter+="${acc}[$k]xfade=transition=fade:duration=$fade:offset=$off[x$k];"
    acc="[x$k]"
  done
  wrap_off="$(fnum "$n * ($hold + $fade)")"
  filter+="${acc}[$n]xfade=transition=fade:duration=$fade:offset=$wrap_off[v]"
  ffmpeg -y "${inputs[@]}" -filter_complex "$filter" -map "[v]" "$tmp/f_%04d.png"
fi

# Two-pass palette on the rendered sequence → optimized looping GIF.
palette="$tmp/palette.png"
ffmpeg -y -framerate "$fps" -start_number 0 -i "$tmp/f_%04d.png" \
  -vf "palettegen=stats_mode=diff" -update 1 "$palette"
ffmpeg -y -framerate "$fps" -start_number 0 -i "$tmp/f_%04d.png" -i "$palette" \
  -lavfi "paletteuse=dither=bayer:bayer_scale=3" -loop 0 "$out"
printf 'Wrote %s (%d scenes, %ss hold, %ss fade)\n' "$out" "$n" "$hold" "$fade"
