# Video Generation for Songs

Generates promotional MP4 videos from song audio + cover image, optimized for sharing on Twitter/X.

## How it works

1. Admin clicks "Generate Video" on a song's detail page
2. Server spawns `generate-video.sh` in background with the song's audio/cover URLs
3. Script downloads files to a temp dir, runs FFmpeg, saves to `/app/video/{uuid}.mp4`, cleans up
4. Frontend polls `/api/songs/:uuid/video` until the file appears (~2-5 min depending on track length)

## Output format

| Parameter     | Value                      |
|--------------|----------------------------|
| Format       | MP4 (H.264 + AAC)          |
| Resolution   | 1280×720 (16:9)            |
| Duration     | Matches audio length       |
| Typical size | 15-30 MB for a 4-min track |

## Visual design

- **Background**: cover image scaled to fill frame, heavily blurred + slightly darkened
- **Foreground**: cover image centered at full height (720px)
- **Equalizer**: CQT (Constant-Q Transform) frequency visualization at the bottom
  - 200px tall, semi-transparent bars
  - Purple/cyan color scheme matching near.fm brand (`cscheme=0.5|0|1|0|0.8|1`)
  - `colorkey` removes the black background so bars float over the image
  - Slight dark gradient behind bars for readability on bright covers
- **No text overlay** (title is in the tweet itself)

## Why these FFmpeg choices

- **`showcqt`** over `showfreqs`/`showwaves`: produces the most polished bar-graph equalizer look
- **`colorkey=black:0.15:0.25`**: removes the solid black background from CQT output, leaving only the glowing bars visible over the cover image
- **`cscheme=0.5|0|1|0|0.8|1`**: left channel = purple (near.fm primary), right channel = cyan (near.fm accent)
- **`bar_v=12, bar_g=5`**: balanced sensitivity — bars react to music without being too jumpy
- **`tc=0.33, attack=0.5`**: smooth transitions, bars don't flicker
- **`boxblur=40:10`** on background: heavy blur so the background doesn't compete with the centered cover
- **`-crf 22`**: good quality without bloating file size
- **`-movflags +faststart`**: enables progressive download (starts playing before fully downloaded)

## API

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/songs/:uuid/video` | Public | Check if video exists (`{ exists, url }`) |
| `POST /api/admin/songs/:uuid/video` | Admin | Start generation. Returns `{ status: "generating" }` or `{ status: "exists", url }` |
| `DELETE /api/admin/songs/:uuid/video` | Admin | Delete generated video file |

## Files

- `server/scripts/generate-video.sh` — FFmpeg generation script
- `video/` — output directory (bind-mounted from host, persists across deploys)
- Nginx serves `/video/` directly from the host directory

## Manual usage

```bash
# Generate from inside the server container:
/app/scripts/generate-video.sh \
  "https://example.com/audio.mp3" \
  "https://example.com/cover.png" \
  "/app/video/SONG-UUID.mp4"

# Or from the host:
docker exec near-fm-server-1 /app/scripts/generate-video.sh \
  "AUDIO_URL" "COVER_URL" "/app/video/UUID.mp4"
```
