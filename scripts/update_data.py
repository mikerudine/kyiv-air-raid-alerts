#!/usr/bin/env python3
"""Download Kyiv Digital air-raid alert XML and generate data/*.csv + meta.json."""

from __future__ import annotations

import csv
import json
import statistics
import sys
import urllib.request
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

SOURCE_URL = (
    "https://data.kyivcity.gov.ua/dataset/statystyka-povitrianykh-tryvoh-u-m"
    "isti-kyievi-dep-municipal/resource/cbf3758e-031c-42b0-a477-e731cd79b261"
    "/data/download"
)
KYIV = ZoneInfo("Europe/Kyiv")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def download_xml(url: str = SOURCE_URL) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "kyiv-alerts-dashboard/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def parse_items(xml_bytes: bytes) -> list[tuple[datetime, int]]:
    root = ET.fromstring(xml_bytes)
    items: list[tuple[datetime, int]] = []
    for item in root.findall(".//item"):
        state = int(item.findtext("state", "0"))
        created = datetime.strptime(item.findtext("created_at", ""), "%Y-%m-%d %H:%M:%S")
        items.append((created, state))
    items.sort(key=lambda x: x[0])
    return items


def pair_windows(items: list[tuple[datetime, int]]) -> tuple[list[tuple[datetime, datetime]], bool]:
    """Pair start(1)/clear(0) events. Returns closed windows and whether alert is open."""
    closed: list[tuple[datetime, datetime]] = []
    open_start: datetime | None = None

    for ts, state in items:
        if state == 1:
            if open_start is None:
                open_start = ts
        elif state == 0:
            if open_start is not None:
                if ts > open_start:
                    closed.append((open_start, ts))
                open_start = None

    return closed, open_start is not None


def hours_between(start: datetime, end: datetime) -> float:
    return round((end - start).total_seconds() / 3600, 1)


def split_hours_by_iso_week(start: datetime, end: datetime) -> dict[tuple[int, int], float]:
    """Split alert duration across ISO weeks by actual occupancy."""
    if end <= start:
        return {}

    week_hours: dict[tuple[int, int], float] = defaultdict(float)
    cursor = start
    while cursor < end:
        iso = cursor.isocalendar()
        week_key = (iso.year, iso.week)
        week_start = datetime.fromisocalendar(iso.year, iso.week, 1)
        week_end = week_start + timedelta(days=7)
        segment_end = min(end, week_end)
        segment_hours = (segment_end - cursor).total_seconds() / 3600
        week_hours[week_key] += segment_hours
        cursor = segment_end

    return {k: round(v, 1) for k, v in week_hours.items()}


def iso_week_bounds(iso_year: int, iso_week: int) -> tuple[str, str]:
    start = datetime.fromisocalendar(iso_year, iso_week, 1)
    end = start + timedelta(days=6)
    return start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")


def build_alerts_csv(closed: list[tuple[datetime, datetime]]) -> list[dict]:
    rows = []
    for start, end in closed:
        rows.append(
            {
                "date": start.strftime("%Y-%m-%d"),
                "hour_start": start.strftime("%H:%M"),
                "hour_end": end.strftime("%H:%M"),
                "hours": f"{hours_between(start, end):.1f}",
                "start_iso": start.strftime("%Y-%m-%dT%H:%M:%S"),
                "end_iso": end.strftime("%Y-%m-%dT%H:%M:%S"),
            }
        )
    return rows


def build_daily_stats(closed: list[tuple[datetime, datetime]]) -> list[dict]:
    by_date: dict[str, list[float]] = defaultdict(list)
    for start, end in closed:
        by_date[start.strftime("%Y-%m-%d")].append(hours_between(start, end))

    rows = []
    for date in sorted(by_date):
        hrs = by_date[date]
        rows.append(
            {
                "date": date,
                "n": len(hrs),
                "sum_hours": f"{sum(hrs):.1f}",
                "mean_hours": f"{statistics.mean(hrs):.1f}",
                "median_hours": f"{statistics.median(hrs):.1f}",
            }
        )
    return rows


def build_weekly_stats(closed: list[tuple[datetime, datetime]]) -> list[dict]:
    start_week_counts: dict[tuple[int, int], list[float]] = defaultdict(list)
    week_sum_hours: dict[tuple[int, int], float] = defaultdict(float)

    for start, end in closed:
        h = hours_between(start, end)
        iso = start.isocalendar()
        start_week_counts[(iso.year, iso.week)].append(h)
        for week_key, wh in split_hours_by_iso_week(start, end).items():
            week_sum_hours[week_key] += wh

    all_weeks = sorted(set(start_week_counts) | set(week_sum_hours))
    rows = []
    for iso_year, iso_week in all_weeks:
        hrs = start_week_counts.get((iso_year, iso_week), [])
        ws, we = iso_week_bounds(iso_year, iso_week)
        rows.append(
            {
                "iso_year": iso_year,
                "iso_week": iso_week,
                "week_start": ws,
                "week_end": we,
                "n_alerts": len(hrs),
                "sum_hours": f"{week_sum_hours.get((iso_year, iso_week), 0.0):.1f}",
                "mean_hours": f"{statistics.mean(hrs):.1f}" if hrs else "0.0",
                "median_hours": f"{statistics.median(hrs):.1f}" if hrs else "0.0",
            }
        )
    return rows


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    xml_bytes = download_xml()
    items = parse_items(xml_bytes)
    if not items:
        print("No items in feed", file=sys.stderr)
        return 1

    closed, is_open = pair_windows(items)
    last_event = items[-1][0]

    alerts_rows = build_alerts_csv(closed)
    daily_rows = build_daily_stats(closed)
    weekly_rows = build_weekly_stats(closed)

    closed_2026 = [(s, e) for s, e in closed if s.year == 2026]
    sum_2026 = round(sum(hours_between(s, e) for s, e in closed_2026), 1)

    now_kyiv = datetime.now(KYIV).strftime("%Y-%m-%d %H:%M:%S")

    meta = {
        "last_event": last_event.strftime("%Y-%m-%d %H:%M:%S"),
        "n_closed_2026": len(closed_2026),
        "sum_hours_2026": sum_2026,
        "generated_at_kyiv": now_kyiv,
        "source_url": SOURCE_URL,
        "alert_open": is_open,
    }

    write_csv(
        DATA_DIR / "alerts.csv",
        alerts_rows,
        ["date", "hour_start", "hour_end", "hours", "start_iso", "end_iso"],
    )
    write_csv(
        DATA_DIR / "weekly.csv",
        weekly_rows,
        [
            "iso_year",
            "iso_week",
            "week_start",
            "week_end",
            "n_alerts",
            "sum_hours",
            "mean_hours",
            "median_hours",
        ],
    )
    write_csv(
        DATA_DIR / "daily.csv",
        daily_rows,
        ["date", "n", "sum_hours", "mean_hours", "median_hours"],
    )

    with (DATA_DIR / "meta.json").open("w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(
        f"Generated {len(alerts_rows)} closed windows; "
        f"2026: {len(closed_2026)} windows, {sum_2026} h; "
        f"open={is_open}; last={last_event}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
