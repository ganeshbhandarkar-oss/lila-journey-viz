# Architecture

## Stack and why

| Choice | Why |
|---|---|
| **Static Vite + React + TS** | The whole dataset is about 89k rows, so it fits in the browser. With no backend, it's free to host on Pages, Vercel or Netlify and links can be shared freely. TypeScript keeps the columnar data contract honest. |
| **Canvas 2D (not SVG / a map lib)** | The aggregate view draws about 70k path vertices plus about 16k markers. SVG would mean 10k+ DOM nodes. Canvas redraws fast enough for live playback and zoom. |
| **Offline Python preprocess** | Parquet in the browser (DuckDB-WASM or parquet-wasm) adds several MB of WASM and slow cold starts. Doing the work once in pyarrow gives a fast first paint. |

## Data flow

```
1,243 parquet files (one per player per match)
  └─ scripts/preprocess.py
       ├─ decode event bytes → utf-8, strip ".nakama-0", tag human (UUID) vs bot (numeric)
       ├─ t = ts − min(ts of match)            → seconds since match start
       ├─ (x, z) → minimap pixel (px, py)      → README formula, asserted on README example
       ├─ assign each match to the day folder holding most of its rows
       ├─ public/data/index.json               → dates + per-match summary (players, duration, event counts)
       ├─ public/data/<Map>.json               → columnar arrays m,u,e,t,x,y + match/user lookup tables
       └─ public/minimaps/<Map>.jpg            → 2048² web JPEGs (originals are up to 9000², 12 MB)
Browser
  ├─ loadMap() → typed arrays (Int32/Float32), cached per map
  ├─ App: filters (map, dates, match, humans/bots) → row index list
  ├─ timeline t → rows with t ≤ time
  └─ MapView: minimap → heatmap (256² grid, 3× box blur, p99.5 normalised) → paths → markers → tooltip hit-test
```

All events are kept. Nothing is downsampled because the payload is only about 0.5 MB gzipped. Rows are sorted by `(match, user, t)`, so each journey is a contiguous run that becomes a single polyline.

## Coordinate mapping

Each map has a `scale` and an `origin`. Only `x` and `z` are used; `y` is elevation.

```
u = (x − origin_x) / scale          v = (z − origin_z) / scale
pixel_x = u · 1024                  pixel_y = (1 − v) · 1024     # image Y grows downwards
```

**Worked example from the README (Ambrose Valley, scale 900, origin −370, −473):**
`x = −301.45 → u = 68.55 / 900 = 0.0762 → pixel_x = 78.0`
`z = −355.55 → v = 117.45 / 900 = 0.1305 → pixel_y = (1 − 0.1305) · 1024 = 890.4`
This gives **(78, 890)**, which matches the README. `preprocess.py` asserts this before writing any output.

Pixel space is always 1024² no matter the real image size. The renderer draws the minimap into a 1024-unit square, and pan/zoom is a single affine transform. Checks: 0 of 89,104 points fall outside the image, and plotting all positions puts them on roads, buildings and land, never in the ocean or the black margins.

## Assumptions

- **`ts` units.** The column is typed `timestamp[ms]`, but the integer values behave like match-clock **seconds**: Position samples are 5 units apart, and the median match lasts 382 units (about 6 minutes, consistent with "a match lasts several minutes"). The tool shows `t − min(t)` as m:ss.
- **Human vs bot** is decided by the `user_id` format (UUID means human), not by event name. Bot journey files contain some `Position` / `Loot` / `BotKilled` rows. They are drawn as bot events exactly as recorded.
- **Death attribution** (e.g. "killed by bot") is taken from human files, where the event name is unambiguous.
- **Bots are under-recorded.** 743 of 796 matches contain a single human and no bot files, but those humans still log `BotKill` events (2,232 human `BotKill` rows vs 183 logged on bot files). "Bots" counts in the UI therefore mean *bots with a recorded journey*. Distinct ids in the export: 245 humans and 94 bots.
- One match spans midnight (Feb 10→11). It is assigned to the day holding most of its rows. Feb 14 is partial.

## Tradeoffs

| Decision | Upside | Cost / what I'd do with more time |
|---|---|---|
| Pre-baked JSON instead of in-browser parquet | Instant load, tiny bundle | Requires a re-run when new data lands → schedule preprocess in CI |
| One file per map (not per match) | Aggregate heatmaps across any filter come for free | Ambrose file is 1.5 MB raw (330 KB gz). At 100× the data, switch to per-day chunks or a tile server |
| Canvas 2D | Simple and fast at this scale | WebGL (deck.gl) for millions of points |
| Grid heatmap (256², blur) | Deterministic, ~ms to rebuild, works during playback | Fixed cell size; no per-zone stats yet (planned: draw a region → get counts) |
| Downsized minimaps (2048²) | ~0.3 MB each instead of 3–12 MB | Slight blur at max zoom → serve tiled originals |
| URL hash state | Shareable views with no backend | No saved annotations / comments |
