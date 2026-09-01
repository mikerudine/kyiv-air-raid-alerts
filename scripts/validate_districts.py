#!/usr/bin/env python3
"""Validate districts.csv aggregates and first/last mention counts."""

from __future__ import annotations

import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

YTD_FIRST = {
    "Деснянський": 74,
    "Оболонський": 41,
    "Дарницький": 29,
    "Святошинський": 26,
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
    "Подільський": 18,
    "Шевченківський": 17,
    "Печерський": 6,
}


def post_id(row: dict) -> int:
    if row.get("post_id"):
        return int(row["post_id"])
    url = row.get("post_url", "")
    if "/" in url:
        return int(url.rsplit("/", 1)[-1])
    raise ValueError("missing post_id")


def window_key(row: dict) -> str:
    return row["window_start"] + "|" + row["window_end"]


def compute_first_last(rows: list[dict]) -> tuple[Counter, Counter, int]:
    by_window: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_window[window_key(row)].append(row)

    first = Counter()
    last = Counter()
    n_windows = 0
    for window_rows in by_window.values():
        posts: dict[int, set[str]] = defaultdict(set)
        for row in window_rows:
            posts[post_id(row)].add(row["district"])
        if not posts:
            continue
        n_windows += 1
        min_pid = min(posts)
        max_pid = max(posts)
        for d in posts[min_pid]:
            first[d] += 1
        for d in posts[max_pid]:
            last[d] += 1
    return first, last, n_windows


def main() -> int:
    path = DATA_DIR / "districts.csv"
    if not path.stat().st_size:
        print("districts.csv is empty or missing", file=sys.stderr)
        return 1

    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))

    counts = Counter(r["district"] for r in rows)
    with (DATA_DIR / "districts-counts.json").open(encoding="utf-8") as f:
        expected = json.load(f)

    ok = True
    if sum(counts.values()) != expected["n_city"]:
        print(f"n_city mismatch: got {sum(counts.values())}, want {expected['n_city']}")
        ok = False

    for raion, n in expected["counts"].items():
        if counts.get(raion, 0) != n:
            print(f"count {raion}: got {counts.get(raion, 0)}, want {n}")
            ok = False

    first, last, n_win = compute_first_last(rows)
    if n_win != expected["n_windows_with_mention"]:
        print(f"windows with mention: got {n_win}, want {expected['n_windows_with_mention']}")
        ok = False

    for raion, n in YTD_FIRST.items():
        if first.get(raion, 0) != n:
            print(f"first {raion}: got {first.get(raion, 0)}, want {n}")
            ok = False

    for raion, n in YTD_LAST.items():
        if last.get(raion, 0) != n:
            print(f"last {raion}: got {last.get(raion, 0)}, want {n}")
            ok = False

    if ok:
        print(f"OK: {len(rows)} rows, {n_win} windows with mentions")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
