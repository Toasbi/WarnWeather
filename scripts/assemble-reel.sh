#!/usr/bin/env bash
set -euo pipefail

# Assemble a platform's promo reel from the manifest (gen-reel-fixtures.js): each line is
# "<frame-path>|<hold-secs>|<fade-secs>". Frames are stills; each becomes a clip of
# length (hold + fade) and consecutive clips are chained with xfade at accumulated
# offsets, so every frame is visible for its hold then dissolves over its fade into the
# next. Variable holds are the reason this can't reuse the hero assembler's fixed-offset
# math. The two-pass palette workflow produces an optimized looping GIF (same palette
# recipe as assemble-showcase-gif.sh).
#
# The loop-back seam does NOT crossfade the last frame directly into the first: the last
# frame holds an extra beat (OUTRO_EXTRA_HOLD), fades to a synthesized black frame (no
# capture needed — an ffmpeg lavfi color source), holds briefly (BLACK_HOLD), then fades
# into the first frame to restart the loop.
#
# Usage:   scripts/assemble-reel.sh <version> <platform> [fps]

if [[ $# -lt 2 ]]; then
  printf 'Usage: %s <version> <platform> [fps]\n' "$0" >&2
  exit 1
fi
version="$1"
platform="$2"
fps="${3:-15}"
# Extra seconds the last frame holds before fading to black, and how long that black
# interstitial holds before fading into the loop restart (frame 0).
outro_extra_hold="${OUTRO_EXTRA_HOLD:-0.6}"
black_hold="${BLACK_HOLD:-0.4}"

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
  # clip i length = hold_i + fade_i (its hold, plus the fade tail into the next clip);
  # the last real frame gets outro_extra_hold added, since its fade tail now leads into
  # the black interstitial (input n) instead of the next real frame. Frame 0 is appended
  # once more (fade-length only) after black to dissolve into the loop restart.
  last="$((n - 1))"
  wrap_fade="${fades[$last]}"
  inputs=()
  for i in "${!frames[@]}"; do
    if (( i == last )); then
      clip="$(fnum "${holds[$i]} + $outro_extra_hold + ${fades[$i]}")"
    else
      clip="$(fnum "${holds[$i]} + ${fades[$i]}")"
    fi
    inputs+=(-loop 1 -t "$clip" -r "$fps" -i "${frames[$i]}")
  done
  res="$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${frames[0]}")"
  black_clip="$(fnum "$black_hold + $wrap_fade")"
  inputs+=(-f lavfi -t "$black_clip" -r "$fps" -i "color=c=black:s=$res")
  inputs+=(-loop 1 -t "$(fnum "$wrap_fade")" -r "$fps" -i "${frames[0]}")

  # n real frames (0..n-1) + black (index n) + wraparound frame 0 (index n+1): n+2 inputs
  # chained with n+1 xfades. Chain with accumulated offsets: acc starts at clip_0 length;
  # each xfade sits at (acc - fade) and acc grows by (next_clip - fade).
  total="$((n + 1))"
  filter=""
  acc="$(fnum "${holds[0]} + ${fades[0]}")"
  prev="[0]"
  for (( k = 1; k <= total; k++ )); do
    if (( k < n )); then f="${fades[$((k - 1))]}"; clip="$(fnum "${holds[$k]} + ${fades[$k]}")";
    elif (( k == n )); then f="$wrap_fade"; clip="$black_clip";  # last real frame -> black
    else f="$wrap_fade"; clip="$wrap_fade"; fi                   # black -> frame 0 (loop restart)
    off="$(fnum "$acc - $f")"
    label="[x$k]"; (( k == total )) && label="[v]"
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
