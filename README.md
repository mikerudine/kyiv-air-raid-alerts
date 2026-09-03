# Тривоги Києва

Статичний публічний дашборд статистики повітряних тривог у **м. Києві** за офіційними даними [Київ Цифрового / KMDA](https://data.kyivcity.gov.ua/dataset/statystyka-povitrianykh-tryvoh-u-misti-kyievi-dep-municipal).

Джерело — XML-ресурс департаменту муніципалітету:

https://data.kyivcity.gov.ua/dataset/statystyka-povitrianykh-tryvoh-u-misti-kyievi-dep-municipal/resource/cbf3758e-031c-42b0-a477-e731cd79b261/data/download

Лише м. Київ. Без Telegram, без дронів, без області.

## Що показує дашборд

- KPI за 2026 рік: кількість закритих вікон, сума годин, середня та медіана тривалості, час останньої події
- Чотири тижневі графіки: сума годин, середня, медіана, кількість тривог
- Таблиця останніх закритих вікон
- Банер, якщо зараз триває тривога (незакритий старт)

## Локальний перегляд

```bash
python3 -m http.server 8765
```

Відкрийте http://127.0.0.1:8765 — сайт читає `data/*.csv` і `data/meta.json` (без запитів до XML у браузері).

## Оновлення даних

Живий дашборд на GitHub Pages читає таблиці з **Supabase REST** (`alerts`, `drones`, `districts`, `oblast`, `oblast_districts`, `city_meta`, `oblast_meta`). Файли в `data/` синхронізуються як дзеркало після refresh.


Workflow `.github/workflows/update-data.yml` щодня о 06:00 UTC (09:00 за Києвом) та вручну (`workflow_dispatch`):

1. Завантажує XML
2. Парує події (1 = початок, 0 = відбій)
3. Перегенеровує `data/alerts.csv`, `data/daily.csv`, `data/weekly.csv`, `data/meta.json`
4. Комітить зміни, якщо дані оновилися

Локально:

```bash
python3 scripts/update_data.py
```

## GitHub Pages

Workflow `.github/workflows/pages.yml` публікує корінь репозиторію на GitHub Pages при push у `main`.

**Увімкніть Pages:** Settings → Pages → Source: **GitHub Actions**.

## Структура

```
index.html          — дашборд
css/style.css       — темна тема
js/dashboard.js     — Chart.js, читає data/
data/               — CSV + meta.json (комітяться)
scripts/update_data.py
kaggle/             — метадані для Kaggle (не завантажуються автоматично)
```

## Ліцензія

Дані — відкриті дані КМДА / Київ Цифрового. Код дашборду — вільне використання.
