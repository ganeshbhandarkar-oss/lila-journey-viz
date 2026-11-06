#!/usr/bin/env python3
"""
Preprocess LILA BLACK parquet telemetry into compact JSON for the browser.

Usage:
    python scripts/preprocess.py --src /path/to/player_data [--out public]

Outputs:
    public/data/index.json          map configs, dates, per-match summary
    public/data/<MapId>.json        columnar event table for every event on that map
    public/minimaps/<MapId>.jpg     web-sized minimap (2048x2048)

Every event is kept (no downsampling) - the whole dataset is ~89k rows,
which is ~1-2 MB gzipped. World (x, z) is converted to minimap pixel space
(0..1024) here so the browser never has to know map configs to draw.
"""
import argparse
import json
import os
import re
from collections import Counter, defaultdict

import pandas as pd
import pyarrow.parquet as pq

MAPS = {
    "AmbroseValley": {"scale": 900, "origin_x": -370, "origin_z": -473, "image": "AmbroseValley_Minimap.png"},
    "GrandRift": {"scale": 581, "origin_x": -290, "origin_z": -290, "image": "GrandRift_Minimap.png"},
    "Lockdown": {"scale": 1000, "origin_x": -500, "origin_z": -500, "image": "Lockdown_Minimap.jpg"},
}
# Event code table shared with the frontend (src/data.ts). Order matters.
EVENTS = ["Position", "BotPosition", "Kill", "Killed", "BotKill", "BotKilled", "KilledByStorm", "Loot"]
EVENT_CODE = {e: i for i, e in enumerate(EVENTS)}
UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
IMG_SIZE = 1024  # README: minimap coordinate space is 1024x1024


def world_to_pixel(x, z, cfg):
    """README formula. Works on scalars or pandas Series."""
    u = (x - cfg["origin_x"]) / cfg["scale"]
    v = (z - cfg["origin_z"]) / cfg["scale"]
    return u * IMG_SIZE, (1 - v) * IMG_SIZE


def load(src):
    frames = []
    bad = 0
    for day in sorted(d for d in os.listdir(src) if d.startswith("February_")):
        folder = os.path.join(src, day)
        for fname in os.listdir(folder):
            try:
                t = pq.read_table(os.path.join(folder, fname)).to_pandas()
            except Exception:
                bad += 1
                continue
            t["date"] = day.replace("February_", "Feb ")
            frames.append(t)
    df = pd.concat(frames, ignore_index=True)
    df["event"] = df["event"].apply(lambda b: b.decode("utf-8") if isinstance(b, (bytes, bytearray)) else str(b))
    # ts is stored as timestamp[ms], but the integer values are match-clock *seconds*
    # (sampling interval of Position is 5 units, match length 1-15 units*60). See ARCHITECTURE.md.
    df["t_raw"] = df["ts"].astype("int64")
    df["match_id"] = df["match_id"].str.replace(r"\.nakama-0$", "", regex=True)
    df["human"] = df["user_id"].astype(str).str.match(UUID_RE)
    print(f"loaded {len(df):,} rows from {len(frames)} files ({bad} unreadable)")
    return df


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default="/workspace/lila-data/player_data")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "public"))
    ap.add_argument("--img", type=int, default=2048, help="output minimap edge length in px")
    args = ap.parse_args()
    out_data = os.path.join(args.out, "data")
    out_img = os.path.join(args.out, "minimaps")
    os.makedirs(out_data, exist_ok=True)
    os.makedirs(out_img, exist_ok=True)

    # sanity check against README example
    px, py = world_to_pixel(-301.45, -355.55, MAPS["AmbroseValley"])
    assert round(px) == 78 and round(py) == 890, (px, py)
    print(f"README example check OK: ({px:.1f}, {py:.1f}) ~ (78, 890)")

    df = load(args.src)

    # A match's date = the day folder holding most of its rows (one match spans midnight).
    match_date = df.groupby(["match_id", "date"]).size().reset_index().sort_values(0).drop_duplicates("match_id", keep="last")
    df["date"] = df["match_id"].map(dict(zip(match_date.match_id, match_date.date)))

    t0 = df.groupby("match_id")["t_raw"].transform("min")
    df["t"] = df["t_raw"] - t0  # seconds since match start

    dates = sorted(df["date"].unique(), key=lambda d: int(d.split()[1]))
    index = {"events": EVENTS, "dates": dates, "maps": {}, "matches": []}

    for map_id, cfg in MAPS.items():
        sub = df[df.map_id == map_id].copy()
        sub["px"], sub["py"] = world_to_pixel(sub["x"], sub["z"], cfg)
        sub = sub.sort_values(["match_id", "user_id", "t"])

        matches = sorted(sub["match_id"].unique())
        midx = {m: i for i, m in enumerate(matches)}
        users = sorted(sub["user_id"].astype(str).unique())
        uidx = {u: i for i, u in enumerate(users)}

        cols = {
            "m": sub["match_id"].map(midx).astype(int).tolist(),
            "u": sub["user_id"].astype(str).map(uidx).astype(int).tolist(),
            "e": sub["event"].map(EVENT_CODE).astype(int).tolist(),
            "t": sub["t"].astype(int).tolist(),
            "x": [round(v, 1) for v in sub["px"].tolist()],
            "y": [round(v, 1) for v in sub["py"].tolist()],
        }
        payload = {
            "map": map_id,
            "matches": matches,
            "users": users,
            "humans": [1 if UUID_RE.match(u) else 0 for u in users],
            **cols,
        }
        with open(os.path.join(out_data, f"{map_id}.json"), "w") as f:
            json.dump(payload, f, separators=(",", ":"))

        oob = ((sub.px < 0) | (sub.px > IMG_SIZE) | (sub.py < 0) | (sub.py > IMG_SIZE)).sum()
        index["maps"][map_id] = {**{k: v for k, v in cfg.items() if k != "image"}, "image": f"minimaps/{map_id}.jpg",
                                 "rows": int(len(sub)), "out_of_bounds": int(oob)}
        print(f"{map_id}: {len(sub):,} rows, {len(matches)} matches, {oob} out-of-bounds points")

        for m, g in sub.groupby("match_id"):
            ec = Counter(g["event"])
            index["matches"].append({
                "id": m, "map": map_id, "date": g["date"].iloc[0],
                "humans": int(g[g.human].user_id.nunique()),
                "bots": int(g[~g.human].user_id.nunique()),
                "duration": int(g["t"].max()),
                "events": {e: int(ec.get(e, 0)) for e in EVENTS if ec.get(e, 0)},
            })

        # web-sized minimap
        from PIL import Image
        Image.MAX_IMAGE_PIXELS = None
        im = Image.open(os.path.join(args.src, "minimaps", cfg["image"])).convert("RGB")
        im = im.resize((args.img, args.img), Image.LANCZOS)
        im.save(os.path.join(out_img, f"{map_id}.jpg"), quality=82, optimize=True, progressive=True)

    index["matches"].sort(key=lambda r: (r["date"], -r["humans"] - r["bots"], r["id"]))
    with open(os.path.join(out_data, "index.json"), "w") as f:
        json.dump(index, f, separators=(",", ":"))
    print(f"wrote {len(index['matches'])} matches to {out_data}")


if __name__ == "__main__":
    main()
