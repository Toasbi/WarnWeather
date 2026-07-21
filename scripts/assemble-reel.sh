#!/usr/bin/env bash
set -euo pipefail

# Assemble a platform's promo reel from the manifest (gen-reel-fixtures.js): each line is
# "<frame-path>|<hold-secs>|<fade-secs>". Frames are stills; each becomes a clip of
# length (hold + fade) and consecutive clips are chained with xfade at accumulated
# offsets, so every frame is visible for its hold then dissolves over its fade into the
# next. The first frame is appended once more for a seamless loop, then the two-pass
# palette workflow produces an optimized looping GIF (same palette recipe as
# assemble-showcase-gif.sh). Variable holds are the reason this can't reuse the hero
# assembler's fixed-offset math.
#
# Usage:   scripts/assemble-reel.sh <version> <platform> [fps]

if [[ $# -lt 2 ]]; then
  printf 'Usage: %s <version> <platform> [fps]\n' "$0" >&2
  exit 1
fi
version="$1"
platform="$2"
fps="${3:-15}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out_dir="$here/screenshot/$version/promo"
out="$out_dir/$platform-reel.gif"
mkdir -p "$out_dir"

# Read the manifest into parallel arrays.
frames=(); holds=(); fades=()
while IFS='|' read -r frame hold fade; do
  [[ -n "$frame" ]] || continue
  [[ -e "$here/$frame" ]] || { printf 'Missing frame: %s\n' "$frame" >&2; exit 1; }
  frames+=("$here/$frame"); holds+=("$hold"); fades+=("$fade")
done < <(cd "$here" && node scripts/gen-reel-fixtures.js manifest "$platform" "$version")

n=${#frames[@]}
[[ $n -gt 0 ]] || { printf 'Empty manifest for %s\n' "$platform" >&2; exit 1; }

fnum() { LC_ALL=C awk "BEGIN{printf \"%.4f\", $1}"; }

tmp="$(mktemp -d -t ww-reel.XXXXXX)"
trap 'rm -rf "$tmp"' EXIT

if [[ $n -eq 1 ]]; then
  ffmpeg -y -loglevel error -loop 1 -t "$(fnum "${holds[0]}")" -r "$fps" -i "${frames[0]}" -map 0:v "$tmp/f_%05d.png"
else
  # clip i length = hold_i + fade_i (its hold, plus the fade tail into the next clip).
  # Append frame 0 again (fade-length only) to dissolve the last frame back to the start.
  inputs=()
  for i in "${!frames[@]}"; do
    clip="$(fnum "${holds[$i]} + ${fades[$i]}")"
    inputs+=(-loop 1 -t "$clip" -r "$fps" -i "${frames[$i]}")
  done
  wrap_fade="${fades[$((n - 1))]}"
  inputs+=(-loop 1 -t "$(fnum "$wrap_fade")" -r "$fps" -i "${frames[0]}")

  # Chain with accumulated offsets: acc starts at clip_0 length; each xfade sits at
  # (acc - fade) and acc grows by (next_clip - fade).
  filter=""
  acc="$(fnum "${holds[0]} + ${fades[0]}")"
  prev="[0]"
  for (( k = 1; k <= n; k++ )); do
    if (( k < n )); then f="${fades[$((k - 1))]}"; clip="$(fnum "${holds[$k]} + ${fades[$k]}")";
    else f="$wrap_fade"; clip="$wrap_fade"; fi
    off="$(fnum "$acc - $f")"
    label="[x$k]"; (( k == n )) && label="[v]"
    filter+="${prev}[$k]xfade=transition=fade:duration=$f:offset=$off$label;"
    acc="$(fnum "$acc + $clip - $f")"
    prev="[x$k]"
  done
  filter="${filter%;}"
  ffmpeg -y -loglevel error "${inputs[@]}" -filter_complex "$filter" -map "[v]" "$tmp/f_%05d.png"
fi

palette="$tmp/palette.png"
ffmpeg -y -loglevel error -framerate "$fps" -start_number 0 -i "$tmp/f_%05d.png" \
  -vf "palettegen=stats_mode=diff" -update 1 "$palette"
ffmpeg -y -loglevel error -framerate "$fps" -start_number 0 -i "$tmp/f_%05d.png" -i "$palette" \
  -lavfi "paletteuse=dither=bayer:bayer_scale=3" -loop 0 "$out"
printf 'Wrote %s (%d segments, %d fps)\n' "$out" "$n" "$fps"
