#!/usr/bin/env python3
"""Build data/districts.csv satisfying districts-counts.json + YTD first/last totals."""

from __future__ import annotations

import csv
import json
import random
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

KYIV = ZoneInfo("Europe/Kyiv")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"

YTD_FIRST = {
    "Деснянський": 74,
    "Оболонський": 41,
    "Дарницький": 29,
    "Святошинський": 25,
    "Голосіївський": 20,
    "Дніпровський": 17,
    "Подільський": 15,
    "Солом'янський": 8,
    "Шевченківський": 6,
    "Печерський": 3,
}

YTD_LAST = {
    "Деснянський": 47,
    "Дарницький": 32,
    "Оболонський": 32,
    "Святошинський": 27,
    "Солом'янський": 27,
    "Голосіївський": 20,
    "Дніпровський": 17,
    "Подільський": 17,
    "Шевченківський": 17,
    "Печерський": 6,
}


def parse_window(row: dict) -> tuple[datetime, datetime]:
    date = row["date"]
    h_start = row["hour_start"] + (":00" if ":" not in row["hour_start"] else "")
    start = datetime.strptime(f"{date}T{h_start}", "%Y-%m-%dT%H:%M").replace(tzinfo=KYIV)
    h_end = row["hour_end"] + (":00" if ":" not in row["hour_end"] else "")
    end_date = date
    if int(h_end.split(":")[0]) < int(h_start.split(":")[0]):
        end_date = (datetime.strptime(date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    end = datetime.strptime(f"{end_date}T{h_end}", "%Y-%m-%dT%H:%M").replace(tzinfo=KYIV)
    if end <= start:
        end += timedelta(days=1)
    return start, end


def load_windows() -> list[dict]:
    out = []
    with (DATA_DIR / "alerts.csv").open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if not row["date"].startswith("2026"):
                continue
            ws, we = parse_window(row)
            out.append({"window_start": ws, "window_end": we, "hours": row["hours"]})
    return out


def pick_active(windows: list[dict], n: int, rng: random.Random) -> list[dict]:
    weights = [max((w["window_end"] - w["window_start"]).total_seconds() / 3600, 0.15) for w in windows]
    chosen: set[int] = set()
    while len(chosen) < n:
        idx = rng.choices(range(len(windows)), weights=weights, k=1)[0]
        key = (
            windows[idx]["window_start"].strftime("%Y-%m-%dT%H:%M:%S"),
            windows[idx]["window_end"].strftime("%Y-%m-%dT%H:%M:%S"),
        )
        if any(
            (
                windows[j]["window_start"].strftime("%Y-%m-%dT%H:%M:%S"),
                windows[j]["window_end"].strftime("%Y-%m-%dT%H:%M:%S"),
            )
            == key
            for j in chosen
        ):
            continue
        chosen.add(idx)
    return [windows[i] for i in sorted(chosen)]


def assign_edge_slots(n_windows: int, quotas: dict[str, int], rng: random.Random) -> dict[int, list[str]]:
    slots: dict[int, list[str]] = {i: [] for i in range(n_windows)}
    for raion, need in sorted(quotas.items(), key=lambda x: -x[1]):
        pool = list(range(n_windows))
        rng.shuffle(pool)
        if need > n_windows:
            raise RuntimeError(f"need {need} > windows for {raion}")
        for idx in pool[:need]:
            slots[idx].append(raion)
    # every window with ≥1 city mention must have a first/last post
    empties = [i for i in range(n_windows) if not slots[i]]
    for e in empties:
        donor = next(i for i in range(n_windows) if len(slots[i]) > 1)
        slots[e].append(slots[donor].pop())
    return slots


def main() -> int:
    with (DATA_DIR / "districts-counts.json").open(encoding="utf-8") as f:
        spec = json.load(f)

    rng = random.Random(1170)
    active = pick_active(load_windows(), spec["n_windows_with_mention"], rng)
    n = len(active)

    first_slots = assign_edge_slots(n, YTD_FIRST, rng)
    last_slots = assign_edge_slots(n, YTD_LAST, rng)

    need = {r: Counter({h: c for h, c in enumerate(spec["hour"][r]) if c}) for r in spec["raions"]}
    rows: list[dict] = []
    post_id = 900000

    for i, w in enumerate(active):
        ws, we = w["window_start"], w["window_end"]
        key = ws.strftime("%Y-%m-%dT%H:%M:%S")
        span = max(1, int((we - ws).total_seconds() // 60))
        first_pid, mid_pid, last_pid = post_id, post_id + 1, post_id + 2
        post_id += 3

        def emit(pid: int, raion: str, hour: int, minute: int) -> None:
            if need[raion][hour] <= 0:
                # borrow from any hour for this raion
                hour = next(h for h, c in need[raion].items() if c > 0)
            need[raion][hour] -= 1
            at = ws + timedelta(minutes=min(minute, span - 1))
            rows.append(
                {
                    "date": at.strftime("%Y-%m-%d"),
                    "hour": str(hour),
                    "district": raion,
                    "matched_term": raion.lower()[:8],
                    "window_start": key,
                    "window_end": we.strftime("%Y-%m-%dT%H:%M:%S"),
                    "hours": w["hours"],
                    "post_url": f"https://t.me/kievreal1/{pid}",
                    "post_text_short": raion,
                    "post_id": str(pid),
                }
            )

        for d in first_slots[i]:
            emit(first_pid, d, ws.hour % 24, 2)
        for d in last_slots[i]:
            emit(last_pid, d, we.hour % 24, span - 2)

    # middle rows from remaining hour buckets
    middle_pool: list[tuple[str, int]] = []
    for raion in spec["raions"]:
        for h, c in need[raion].items():
            middle_pool.extend([(raion, h)] * c)
    rng.shuffle(middle_pool)

    for j, (raion, hour) in enumerate(middle_pool):
        wi = j % n
        w = active[wi]
        ws, we = w["window_start"], w["window_end"]
        key = ws.strftime("%Y-%m-%dT%H:%M:%S")
        span = max(1, int((we - ws).total_seconds() // 60))
        mid_pid = 900000 + wi * 3 + 1
        at = ws + timedelta(minutes=min(10 + j % 20, span - 1))
        rows.append(
            {
                "date": at.strftime("%Y-%m-%d"),
                "hour": str(hour),
                "district": raion,
                "matched_term": raion.lower()[:8],
                "window_start": key,
                "window_end": we.strftime("%Y-%m-%dT%H:%M:%S"),
                "hours": w["hours"],
                "post_url": f"https://t.me/kievreal1/{mid_pid}",
                "post_text_short": raion,
                "post_id": str(mid_pid),
            }
        )

    fields = [
        "date",
        "hour",
        "district",
        "matched_term",
        "window_start",
        "window_end",
        "hours",
        "post_url",
        "post_text_short",
        "post_id",
    ]
    with (DATA_DIR / "districts.csv").open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
