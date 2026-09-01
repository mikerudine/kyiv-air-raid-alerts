# Kyiv air-raid alerts — Kaggle datapackage

Derived from the official [Kyiv Digital XML feed](https://data.kyivcity.gov.ua/dataset/statystyka-povitrianykh-tryvoh-u-misti-kyievi-dep-municipal/resource/cbf3758e-031c-42b0-a477-e731cd79b261).

## Files

### alerts.csv

Closed alert windows (start → all-clear pairs).

| Column | Description |
|--------|-------------|
| `date` | Start date in Europe/Kyiv (`YYYY-MM-DD`) |
| `hour_start` | Start time (`HH:MM`) |
| `hour_end` | End time (`HH:MM`) |
| `hours` | Duration in hours (1 decimal) |
| `start_iso` | Start timestamp (`YYYY-MM-DDTHH:MM:SS`) |
| `end_iso` | End timestamp |

### daily.csv

Daily aggregates by alert **start** date.

| Column | Description |
|--------|-------------|
| `date` | Date (`YYYY-MM-DD`) |
| `n` | Number of alerts starting that day |
| `sum_hours` | Total duration (hours) |
| `mean_hours` | Mean duration |
| `median_hours` | Median duration |

### weekly.csv

Weekly aggregates (ISO weeks).

| Column | Description |
|--------|-------------|
| `iso_year` | ISO year |
| `iso_week` | ISO week number |
| `week_start` | Monday of the week |
| `week_end` | Sunday of the week |
| `n_alerts` | Alerts whose **start** falls in this week |
| `sum_hours` | Total occupancy hours (split across week boundaries) |
| `mean_hours` | Mean duration of alerts starting in this week |
| `median_hours` | Median duration of alerts starting in this week |

## Processing

- Events paired chronologically: state `1` = start, `0` = all-clear.
- Extra unmatched starts/clears are ignored.
- An unmatched trailing start (open alert) is excluded from duration stats.

## License

Data source: Kyiv Digital / KMDA open data. Package metadata uses CC0-1.0.
