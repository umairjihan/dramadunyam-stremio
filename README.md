# DramaDünyam — Stremio Addon

A [Stremio](https://www.stremio.com/) stream & catalog addon for **DramaDünyam** short drama series.

## Features
- **Today List**: Most watched series today.
- **This Week List**: Top trending series this week.
- **This Month List**: Top trending series this month.
- **Popular List**: Most watched short dramas (paginated).
- **New List**: Newly added short dramas (paginated).
- **Most Liked List**: Top series with the most likes from community lists.
- **Most Saved List**: Top series saved the most across user lists.
- **Search**: Full title search covering 32,000+ short drama series.
- **Direct Play**: Instant HLS stream playback (`.m3u8`) with complete episode navigation.

## Run Locally
```bash
cd dramadunyam-stremio
node server.js
# Runs on port 7040 by default (http://localhost:7040/manifest.json)
```

## Install in Stremio
Paste the manifest URL into Stremio's Addon search / install bar:
```
https://addons.umairjihan.com/dramadunyam/manifest.json
```
