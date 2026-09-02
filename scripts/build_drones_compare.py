#!/usr/bin/env python3
"""Build data/drones-compare-daily.csv and data/drones-compare-weekly.csv.

Nationwide GenStab launched strike UAV (Shahed/Gerbera/Banderol overnight waves only).
Source: Petro Ivaniuk «Massive Missile Attacks on Ukraine» (Kaggle piterfm/massive-missile-attacks-on-ukraine),
compiled from official Air Force / General Staff morning air-attack reports.
NOT the daily OT-UAV combat-losses infographic.

Usage:
  python scripts/build_drones_compare.py /path/to/missile_attacks_daily.csv

Optional manual overrides (verified Telegram @GeneralStaffZSU morning posts):
  2026-09-01: 218 launched (ніч на 1 вересня)
  2026-09-02: 174 launched (ніч на 2 вересня)

Oblast @kievreal1 and nationwide @war_monitor / @vanek_nikolaev columns stay empty until
a follow-up supplies real overlays (do not invent).
"""

from __future__ import annotations

import csv
import sys
from datetime import datetime, timedelta
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

MANUAL_GENSTAB_LAUNCHED: dict[str, int] = {
    "2026-09-01": 218,
    "2026-09-02": 174,
}

STRIKE_MODEL_MARKERS = ("Shahed", "Gerbera", "Banderol")


def parse_dt(raw: str) -> datetime | None:
    if not raw:
        return None
    raw = raw.strip()
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def is_strike_uav(row: dict) -> bool:
    model = row.get("model") or ""
    if row.get("is_shahed") == "True":
        return True
    return any(marker in model for marker in STRIKE_MODEL_MARKERS)


def is_overnight_wave(row: dict) -> bool:
    start = parse_dt(row.get("time_start") or "")
    end = parse_dt(row.get("time_end") or "")
    if not start or not end:
        return False
    if end.hour > 12:
        return False
    if start.hour >= 18:
        return True
    return start.date() < end.date()


def iso_week_bounds(iso_year: int, iso_week: int) -> tuple[str, str]:
    jan4 = datetime(iso_year, 1, 4)
    week_start = jan4 - timedelta(days=(jan4.weekday() + 6) % 7) + timedelta(weeks=iso_week - 1)
    week_end = week_start + timedelta(days=6)
    return week_start.strftime("%Y-%m-%d"), week_end.strftime("%Y-%m-%d")


def build_genstab_daily(rows: list[dict]) -> dict[str, int]:
    by_date: dict[str, int] = {}
    for row in rows:
        if not is_strike_uav(row) or not is_overnight_wave(row):
            continue
        launched = row.get("launched")
        if not launched:
            continue
        end = parse_dt(row.get("time_end") or "")
        if not end:
            continue
        date = end.strftime("%Y-%m-%d")
        value = int(float(launched))
        by_date[date] = max(by_date.get(date, 0), value)
    by_date.update(MANUAL_GENSTAB_LAUNCHED)
    return by_date


def write_compare_csvs(genstab_by_date: dict[str, int]) -> None:
    daily_rows = []
    for date in sorted(genstab_by_date):
        if date < "2026-01-01":
            continue
        daily_rows.append(
            {
                "date": date,
                "oblast_drones": "",
                "nationwide_drones_war_monitor": "",
                "nationwide_drones_vanek_nikolaev": "",
                "genstab_launched": str(genstab_by_date[date]),
            }
        )

    week_sums: dict[tuple[int, int], int] = {}
    for date, launched in genstab_by_date.items():
        if not date.startswith("2026"):
            continue
        dt = datetime.strptime(date, "%Y-%m-%d")
        iso = dt.isocalendar()
        week_sums[(iso.year, iso.week)] = week_sums.get((iso.year, iso.week), 0) + launched

    weekly_rows = []
    for (iso_year, iso_week), total in sorted(week_sums.items()):
        week_start, _ = iso_week_bounds(iso_year, iso_week)
        weekly_rows.append(
            {
                "iso_year": str(iso_year),
                "iso_week": str(iso_week),
                "week_start": week_start,
                "oblast_drones": "",
                "nationwide_drones_war_monitor": "",
                "nationwide_drones_vanek_nikolaev": "",
                "genstab_launched": str(total),
            }
        )

    daily_path = DATA_DIR / "drones-compare-daily.csv"
    weekly_path = DATA_DIR / "drones-compare-weekly.csv"
    daily_fields = [
        "date",
        "oblast_drones",
        "nationwide_drones_war_monitor",
        "nationwide_drones_vanek_nikolaev",
        "genstab_launched",
    ]
    weekly_fields = [
        "iso_year",
        "iso_week",
        "week_start",
        "oblast_drones",
        "nationwide_drones_war_monitor",
        "nationwide_drones_vanek_nikolaev",
        "genstab_launched",
    ]
    with daily_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=daily_fields)
        writer.writeheader()
        writer.writerows(daily_rows)
    with weekly_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=weekly_fields)
        writer.writeheader()
        writer.writerows(weekly_rows)
    print(f"Wrote {len(daily_rows)} daily rows -> {daily_path}")
    print(f"Wrote {len(weekly_rows)} weekly rows -> {weekly_path}")


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    source = Path(sys.argv[1])
    if not source.is_file():
        print(f"Missing source CSV: {source}", file=sys.stderr)
        return 1
    with source.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    genstab_by_date = build_genstab_daily(rows)
    write_compare_csvs(genstab_by_date)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
