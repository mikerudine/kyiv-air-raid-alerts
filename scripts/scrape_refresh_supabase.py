#!/usr/bin/env python3
"""Scrape @kievreal1 public channel and build Supabase refresh SQL.

Parses oblast alert windows from banner posts, maps district mentions inside
KMDA city windows (from data/alerts.csv) and oblast windows, inserts drones
rows with NULL when unknown (never 0).
"""

from __future__ import annotations

import csv
import html as htmlmod
import json
import re
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

KYIV = ZoneInfo("Europe/Kyiv")
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CHANNEL = "kievreal1"
SCRAPE_JSON = Path("/tmp/kievreal1_scrape.json")
OUT_SQL = Path("/tmp/refresh_supabase_run.sql")

OBLAST_RAIONS = {
    "Білоцерківський",
    "Бориспільський",
    "Броварський",
    "Бучанський",
    "Вишгородський",
    "Обухівський",
    "Фастівський",
}


def esc(value: str) -> str:
    return str(value).replace("'", "''")


def norm_apos(text: str) -> str:
    return text.replace("ʼ", "'").replace("’", "'")


def load_term_map(path: Path) -> dict[str, str]:
    mapping: dict[str, str] = {}
    with path.open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            term = (row.get("matched_term") or "").strip()
            district = (row.get("district") or "").strip()
            if term and district and term not in mapping:
                mapping[term] = district
    return mapping


CITY_ALIASES = {
    "Пуща": "Оболонський",
    "Пуща-Водиця": "Оболонський",
    "Пуща Водиця": "Оболонський",
    "Лукʼянівка": "Шевченківський",
    "Лук'янівка": "Шевченківський",
    "Соломʼянський": "Солом'янський",
    "Соломʼянському": "Солом'янський",
    "Голосіївському": "Голосіївський",
    "Голосіївський": "Голосіївський",
    "Дарницькому": "Дарницький",
    "Дарницький": "Дарницький",
    "Печерськ": "Печерський",
    "Печерському": "Печерський",
    "Позняки": "Дарницький",
    "Осокорки": "Дарницький",
    "Бортничі": "Дарницький",
    "Дарниця": "Дарницький",
    "Жуляни": "Солом'янський",
    "Відрадний": "Солом'янський",
    "Нивки": "Шевченківський",
    "Оболонь": "Оболонський",
    "Поділ": "Подільський",
    "Троєщина": "Деснянський",
    "Борщагівка": "Святошинський",
    "Святошин": "Святошинський",
    "Лісники": "Голосіївський",
    "Конча-Заспа": "Голосіївський",
    "Чабани": "Голосіївський",
    "Феофанія": "Голосіївський",
    "Хотів": "Голосіївський",
    "Русанівка": "Дніпровський",
    "Русанів": "Дніпровський",
    "Академмістечко": "Святошинський",
}


def match_city(text: str, city_map: dict[str, str]) -> list[tuple[str, str]]:
    hits: list[tuple[str, str]] = []
    adj = {
        "голосіївському": "Голосіївський",
        "дарницькому": "Дарницький",
        "деснянському": "Деснянський",
        "дніпровському": "Дніпровський",
        "оболонському": "Оболонський",
        "печерському": "Печерський",
        "подільському": "Подільський",
        "святошинському": "Святошинський",
        "солом'янському": "Солом'янський",
        "соломʼянському": "Солом'янський",
        "шевченківському": "Шевченківський",
    }
    for match in re.finditer(r"([А-ЯІЇЄҐа-яіїєґ'ʼ\-]+)\s+районі", text, re.I):
        key = match.group(1).lower()
        if key in adj:
            hits.append((adj[key], match.group(1)))
    normalized = norm_apos(text)
    for term in sorted(city_map, key=len, reverse=True):
        if norm_apos(term) in normalized:
            hits.append((city_map[term], term))
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    for district, term in hits:
        key = (district, norm_apos(term))
        if key in seen:
            continue
        seen.add(key)
        out.append((district, term))
    return out


def match_oblast(text: str, oblast_map: dict[str, str]) -> list[tuple[str, str]]:
    hits: list[tuple[str, str]] = []
    normalized = norm_apos(text)
    for term in sorted(oblast_map, key=len, reverse=True):
        if norm_apos(term) in normalized:
            hits.append((oblast_map[term], term))
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    for district, term in hits:
        key = (district, norm_apos(term))
        if key in seen:
            continue
        seen.add(key)
        out.append((district, term))
    return out


def is_banner(text: str) -> bool:
    t = text.strip()
    if re.match(r"^[🚨❎]?\s*(КИЇВСЬКА ОБЛАСТЬ|М\.\s*КИЇВ|КИЇВ ТА ОБЛАСТЬ)", t):
        return True
    if "ОГОЛОШЕНА ПОВІТРЯНА ТРИВОГА" in t or "ВІДБІЙ ТРИВОГИ" in t:
        return True
    return False


def parse_oblast_windows(posts: list[dict]) -> list[dict]:
    open_start: datetime | None = None
    windows: list[dict] = []
    for post in posts:
        text = post["text"]
        dt = post["dt"]
        if not dt:
            continue
        if "КИЇВСЬКА ОБЛАСТЬ" in text and "ОГОЛОШЕНА" in text:
            open_start = dt
        elif open_start and ("КИЇВСЬКА ОБЛАСТЬ" in text or "КИЇВ ТА ОБЛАСТЬ" in text) and "ВІДБІЙ" in text:
            end = dt
            hours = round((end - open_start).total_seconds() / 3600, 1)
            if hours > 0:
                windows.append(
                    {
                        "start": open_start,
                        "end": end,
                        "hours": hours,
                        "date": open_start.strftime("%Y-%m-%d"),
                        "hour_start": open_start.hour,
                        "hour_end": end.hour if end.date() == open_start.date() else end.hour,
                    }
                )
            open_start = None
    return windows


def load_city_windows() -> list[dict]:
    rows: list[dict] = []
    with (DATA_DIR / "alerts.csv").open(encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if not row["date"].startswith("2026"):
                continue
            date = row["date"]
            hs = int(row["hour_start"])
            he = int(row["hour_end"])
            hours = float(row["hours"])
            start = datetime.strptime(f"{date} {hs:02d}:00", "%Y-%m-%d %H:%M").replace(tzinfo=KYIV)
            end = start + timedelta(hours=hours)
            rows.append(
                {
                    "date": date,
                    "hour_start": hs,
                    "hour_end": he,
                    "hours": hours,
                    "start": start,
                    "end": end,
                }
            )
    return rows


def scrape_posts(stop_id: int, max_pages: int = 40) -> list[dict]:
    if SCRAPE_JSON.exists():
        cached = json.loads(SCRAPE_JSON.read_text(encoding="utf-8"))
        if cached.get("stop_id") == stop_id and cached.get("posts"):
            return cached["posts"]

    def fetch(url: str) -> str:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; kyiv-alerts/1.0)"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return resp.read().decode("utf-8", "replace")

    posts: list[dict] = []
    seen: set[int] = set()
    url = f"https://t.me/s/{CHANNEL}"
    for _ in range(max_pages):
        html = fetch(url)
        chunks = re.split(r'<div class="tgme_widget_message\b', html)
        before = len(posts)
        for chunk in chunks[1:]:
            match_id = re.search(rf'data-post="{CHANNEL}/(\d+)"', chunk)
            if not match_id:
                continue
            pid = int(match_id.group(1))
            if pid in seen:
                continue
            seen.add(pid)
            match_dt = re.search(r'datetime="([^"]+)"', chunk)
            match_text = re.search(
                r'<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)</div>', chunk, re.S
            )
            text = (
                htmlmod.unescape(re.sub(r"<[^>]+>", "", match_text.group(1))) if match_text else ""
            )
            text = " ".join(text.split())
            text = re.sub(r"\s*Надіслати новину.*$", "", text)
            text = re.sub(r"\s*👉ПІДПИСАТИСЯ.*$", "", text).strip()
            dt = (
                datetime.fromisoformat(match_dt.group(1).replace("Z", "+00:00")).astimezone(KYIV)
                if match_dt
                else None
            )
            posts.append({"id": pid, "dt": dt.isoformat() if dt else None, "text": text})
        oldest = min(seen)
        url = f"https://t.me/s/{CHANNEL}/{oldest}"
        if len(posts) == before or oldest <= stop_id:
            break

    posts.sort(key=lambda p: p["id"])
    json.dump({"stop_id": stop_id, "posts": posts}, SCRAPE_JSON.open("w", encoding="utf-8"), ensure_ascii=False, indent=2)
    return posts


def post_dt(post: dict) -> datetime | None:
    if not post.get("dt"):
        return None
    return datetime.fromisoformat(post["dt"])


def build_payload(stop_id: int) -> dict:
    city_map = load_term_map(DATA_DIR / "districts.csv")
    for key, value in CITY_ALIASES.items():
        city_map.setdefault(key, value)
    oblast_map = load_term_map(DATA_DIR / "oblast-districts.csv")

    raw_posts = scrape_posts(stop_id)
    posts = []
    for post in raw_posts:
        posts.append({**post, "dt": post_dt(post)})

    new_posts = [p for p in posts if p["id"] > stop_id]
    city_windows = load_city_windows()
    target_dates = {w["date"] for w in city_windows if w["date"] >= "2026-09-04"}
    city_windows = [w for w in city_windows if w["date"] in target_dates]

    oblast_windows = parse_oblast_windows([p for p in posts if p["id"] > stop_id - 50])
    oblast_windows = [w for w in oblast_windows if w["date"] >= "2026-09-04"]

    city_rows: list[dict] = []
    for window in city_windows:
        ws, we = window["start"], window["end"]
        for post in posts:
            dt = post["dt"]
            if not dt or not (ws <= dt <= we):
                continue
            if is_banner(post["text"]):
                continue
            for district, term in match_city(post["text"], city_map):
                city_rows.append(
                    {
                        "date": dt.strftime("%Y-%m-%d"),
                        "hour": dt.hour,
                        "district": district,
                        "matched_term": term,
                        "window_start": ws.isoformat(),
                        "window_end": we.isoformat(),
                        "hours": window["hours"],
                        "post_id": str(post["id"]),
                        "post_url": f"https://t.me/{CHANNEL}/{post['id']}",
                        "post_text_short": post["text"][:120],
                    }
                )

    oblast_rows: list[dict] = []
    for window in oblast_windows:
        ws, we = window["start"], window["end"]
        for post in posts:
            dt = post["dt"]
            if not dt or not (ws <= dt <= we):
                continue
            if is_banner(post["text"]) and not match_oblast(post["text"], oblast_map):
                continue
            for district, term in match_oblast(post["text"], oblast_map):
                oblast_rows.append(
                    {
                        "date": window["date"],
                        "hour": dt.hour,
                        "district": district,
                        "matched_term": term,
                        "window_start": ws.isoformat(),
                        "window_end": we.isoformat(),
                        "hours": window["hours"],
                        "hour_start": window["hour_start"],
                        "hour_end": window["hour_end"],
                        "post_id": str(post["id"]),
                        "post_url": f"https://t.me/{CHANNEL}/{post['id']}",
                        "post_text_short": post["text"][:120],
                    }
                )

    missing_city_alerts = [
        w
        for w in city_windows
        if w["date"] >= "2026-09-04"
        and (w["date"], w["hour_start"], w["hour_end"], w["hours"])  # noqa: W503
    ]

    last_post = max(posts, key=lambda p: p["id"]) if posts else None
    return {
        "stop_id": stop_id,
        "new_posts": len(new_posts),
        "last_post_id": str(last_post["id"]) if last_post else str(stop_id),
        "last_post_kyiv": last_post["dt"].isoformat() if last_post and last_post["dt"] else None,
        "city_windows": city_windows,
        "oblast_windows": oblast_windows,
        "city_rows": city_rows,
        "oblast_rows": oblast_rows,
        "city_alerts": missing_city_alerts,
    }


def sql_for_payload(payload: dict) -> str:
    now = datetime.now(KYIV).isoformat()
    parts: list[str] = []

    for window in payload["city_windows"]:
        if window["date"] < "2026-09-04":
            continue
        parts.append(
            "INSERT INTO drones(date,hour_start,hour_end,hours,drones,confidence,drones_war_monitor,drones_vanek_nikolaev) "
            f"VALUES ('{window['date']}',{window['hour_start']},{window['hour_end']},{window['hours']},"
            "NULL,'low',NULL,NULL) ON CONFLICT DO NOTHING;"
        )

    if payload["city_rows"]:
        vals = []
        for row in payload["city_rows"]:
            vals.append(
                f"('{row['date']}',{row['hour']},'{esc(row['district'])}','{esc(row['matched_term'])}',"
                f"'{row['window_start']}','{row['window_end']}',{row['hours']},"
                f"'{esc(row['post_id'])}','{esc(row['post_url'])}','{esc(row['post_text_short'])}')"
            )
        parts.append(
            "INSERT INTO districts(date,hour,district,matched_term,window_start,window_end,hours,post_id,post_url,post_text_short) VALUES\n"
            + ",\n".join(vals)
            + ";"
        )

    if payload["oblast_windows"]:
        vals = []
        for window in payload["oblast_windows"]:
            vals.append(
                f"('{window['date']}',{window['hour_start']},{window['hour_end']},{window['hours']},'kievreal1')"
            )
        parts.append(
            "INSERT INTO oblast(date,hour_start,hour_end,hours,source) VALUES\n"
            + ",\n".join(vals)
            + "\nON CONFLICT DO NOTHING;"
        )

    if payload["oblast_rows"]:
        vals = []
        for row in payload["oblast_rows"]:
            vals.append(
                f"('{row['date']}',{row['hour']},'{esc(row['district'])}','{esc(row['matched_term'])}',"
                f"'{row['window_start']}','{row['window_end']}',{row['hours']},{row['hour_start']},{row['hour_end']},"
                f"'{esc(row['post_id'])}','{esc(row['post_url'])}','{esc(row['post_text_short'])}')"
            )
        parts.append(
            "INSERT INTO oblast_districts(date,hour,district,matched_term,window_start,window_end,hours,hour_start,hour_end,post_id,post_url,post_text_short) VALUES\n"
            + ",\n".join(vals)
            + ";"
        )

    n_oblast_new = len(payload["oblast_windows"])
    parts.append(
        f"""UPDATE oblast_meta SET
  scraped_at_kyiv='{now}',
  last_post_id='{payload['last_post_id']}',
  last_post_kyiv='{payload['last_post_kyiv']}',
  n_mention_rows = n_mention_rows + {len(payload['oblast_rows'])},
  n_windows = n_windows + {n_oblast_new},
  n_hours = n_hours + {round(sum(w['hours'] for w in payload['oblast_windows']), 1)},
  sources = jsonb_set(COALESCE(sources,'{{}}'::jsonb), '{{kievreal1}}', to_jsonb(COALESCE((sources->>'kievreal1')::int,0) + {n_oblast_new}))
WHERE id=1;"""
    )

    return "\n\n".join(parts)


def main() -> int:
    stop_id = int(sys.argv[1]) if len(sys.argv) > 1 else 129337
    payload = build_payload(stop_id)
    sql = sql_for_payload(payload)
    OUT_SQL.write_text(sql, encoding="utf-8")
    json.dump(payload, Path("/tmp/refresh_payload_run.json").open("w", encoding="utf-8"), ensure_ascii=False, indent=2, default=str)
    print(
        f"new_posts={payload['new_posts']} city_district_rows={len(payload['city_rows'])} "
        f"oblast_windows={len(payload['oblast_windows'])} oblast_district_rows={len(payload['oblast_rows'])} "
        f"sql_bytes={OUT_SQL.stat().st_size}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
