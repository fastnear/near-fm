#!/bin/bash
# Generate a promotional video for a song (cover + audio + equalizer visualization).
# Usage: generate-video.sh <audio_url> <cover_url> <output_path> [title]
#
# - Downloads audio and cover to a temp dir
# - Generates 1280x720 video: blurred background + centered cover + CQT equalizer
# - Cleans up temp files on exit

set -euo pipefail

AUDIO_URL="$1"
COVER_URL="${2:-}"
OUTPUT_PATH="$3"
TITLE="${4:-}"

TMPDIR=$(mktemp -d /tmp/nearfm-video.XXXXXX)
trap 'rm -rf "$TMPDIR"' EXIT

# Download audio
curl -sL -o "$TMPDIR/audio.mp3" "$AUDIO_URL"
if [ ! -s "$TMPDIR/audio.mp3" ]; then
  echo "ERROR: Failed to download audio" >&2
  exit 1
fi

# Download or generate cover
if [ -n "$COVER_URL" ]; then
  curl -sL -o "$TMPDIR/cover.png" "$COVER_URL"
fi
if [ ! -s "$TMPDIR/cover.png" ]; then
  # Generate a gradient placeholder if no cover
  ffmpeg -y -f lavfi -i "color=c=#1a0a2e:s=1024x1024:d=1" \
    -vf "drawtext=text='♫':fontsize=200:fontcolor=white@0.15:x=(w-tw)/2:y=(h-th)/2" \
    -frames:v 1 "$TMPDIR/cover.png" 2>/dev/null
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"

# Build filter: blurred bg + centered cover + dark gradient + CQT equalizer
# cscheme: left=purple(0.5,0,1) right=cyan(0,0.8,1) — near.fm brand colors
FILTER="
  [0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,boxblur=40:10,eq=brightness=-0.1[bg];
  [0:v]scale=-1:720[fg];
  [bg][fg]overlay=(W-w)/2:0[base];
  color=c=black@0.35:s=1280x220:d=600[darken];
  [base][darken]overlay=0:H-220:shortest=1[darkened];
  [1:a]showcqt=s=1280x720:fps=25:sono_h=0:bar_h=200:bar_v=12:bar_g=5:bar_t=0.85:basefreq=50:endfreq=15000:count=6:fcount=2:axis=0:tc=0.33:attack=0.5:cscheme=0.5|0|1|0|0.8|1,
  crop=1280:200:0:0,
  colorkey=black:0.15:0.25[bars];
  [darkened][bars]overlay=0:H-200:shortest=1[out]
"

# Write to temp file first, then atomically move to final path.
# This prevents the poller from seeing a partially-written file.
TMP_OUTPUT="$TMPDIR/output.mp4"

ffmpeg -y -loop 1 -i "$TMPDIR/cover.png" -i "$TMPDIR/audio.mp3" \
  -filter_complex "$FILTER" \
  -map "[out]" -map 1:a \
  -c:v libx264 -preset medium -crf 22 -pix_fmt yuv420p \
  -c:a aac -b:a 192k \
  -shortest -movflags +faststart \
  "$TMP_OUTPUT" 2>/dev/null

if [ -s "$TMP_OUTPUT" ]; then
  mv "$TMP_OUTPUT" "$OUTPUT_PATH"
  echo "OK: $(du -h "$OUTPUT_PATH" | cut -f1)"
else
  echo "ERROR: Video generation failed" >&2
  exit 1
fi
