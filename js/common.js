(function (global) {
  "use strict";

  global.KyivAlerts = global.KyivAlerts || {};

  const CHART_DEFAULTS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: "#2a2a2a",
        titleColor: "#e8e8e8",
        bodyColor: "#ccc",
        borderColor: "#444",
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        ticks: { color: "#aaa", maxRotation: 45, minRotation: 45, font: { size: 10 } },
        grid: { display: false },
      },
      y: {
        ticks: { color: "#aaa", font: { size: 10 } },
        grid: { color: "rgba(255,255,255,0.06)" },
        beginAtZero: true,
      },
    },
  };

  function parseCSV(text) {
    const lines = text.trim().split("\n");
    const headers = lines[0].split(",");
    return lines.slice(1).map((line) => {
      const vals = line.split(",");
      const row = {};
      headers.forEach((h, i) => {
        row[h.trim()] = vals[i]?.trim() ?? "";
      });
      return row;
    });
  }

  function parseDate(dateStr) {
    return new Date(dateStr + "T00:00:00");
  }

  function formatISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function addDays(dateStr, n) {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + n);
    return formatISO(d);
  }

  function compareDates(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function clampDate(dateStr, minStr, maxStr) {
    if (compareDates(dateStr, minStr) < 0) return minStr;
    if (compareDates(dateStr, maxStr) > 0) return maxStr;
    return dateStr;
  }

  function dateRangeInclusive(startStr, endStr) {
    const out = [];
    let cur = startStr;
    while (compareDates(cur, endStr) <= 0) {
      out.push(cur);
      cur = addDays(cur, 1);
    }
    return out;
  }

  function formatDayLabel(dateStr) {
    const d = parseDate(dateStr);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return dd + "." + mm;
  }

  function formatDayLabelLong(dateStr) {
    const d = parseDate(dateStr);
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return dd + "." + mm + "." + yyyy;
  }

  function weekdayIndex(dateStr) {
    return parseDate(dateStr).getDay();
  }

  function weekdayNameUk(dayIndex) {
    const names = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];
    return names[dayIndex];
  }

  function median(values) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  function percentile(values, p) {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 1) return sorted[0];
    const idx = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
  }

  function mean(values) {
    if (values.length === 0) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
  }

  function barColors(values, normalColor, lastColor) {
    return values.map((_, i) => (i === values.length - 1 ? lastColor : normalColor));
  }

  function valueLabelsPlugin() {
    return {
      id: "valueLabels",
      afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        chart.data.datasets.forEach((dataset, i) => {
          const meta = chart.getDatasetMeta(i);
          meta.data.forEach((bar, idx) => {
            const val = dataset.data[idx];
            if (val == null || val === 0) return;
            const display = Number.isInteger(val) ? String(val) : val.toFixed(1);
            ctx.save();
            ctx.fillStyle = "#fff";
            ctx.font = "10px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            ctx.fillText(display, bar.x, bar.y - 3);
            ctx.restore();
          });
        });
      },
    };
  }

  function isIncompleteDay(dateStr, lastEvent) {
    if (!lastEvent) return false;
    const eventDate = lastEvent.slice(0, 10);
    if (dateStr !== eventDate) return false;
    const timePart = lastEvent.slice(11);
    if (!timePart) return false;
    return timePart < "23:00:00";
  }

  function lastEventDate(lastEvent) {
    return lastEvent ? lastEvent.slice(0, 10) : null;
  }

  const CACHE_BUST = "f3a9b2e1";

  const OFFICIAL_RAIONS = [
    "Голосіївський",
    "Дарницький",
    "Деснянський",
    "Дніпровський",
    "Оболонський",
    "Печерський",
    "Подільський",
    "Святошинський",
    "Солом'янський",
    "Шевченківський",
  ];

  const RAION_FILTER_NOTE =
    "Не офіційний продукт KMDA. Фільтр лишає офіційні вікна, в яких @kievreal1 згадав цей район (або жодних міських районів).";

  function normalizeRaion(name) {
    return String(name || "")
      .replace(/\s*район\s*$/i, "")
      .replace(/\u2019/g, "'");
  }

  function hourFromISO(iso) {
    const m = String(iso).match(/T(\d{2}):/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function alertWindowKey(alert) {
    return alert.date + "|" + alert.hour_start + "|" + alert.hour_end + "|" + alert.hours;
  }

  function districtRowWindowKey(row) {
    const date = row.window_start.slice(0, 10);
    const hourStart = hourFromISO(row.window_start);
    const hourEnd = hourFromISO(row.window_end);
    return date + "|" + hourStart + "|" + hourEnd + "|" + row.hours;
  }

  function districtWindowPairKey(row) {
    return row.window_start + "|" + row.window_end;
  }

  function buildWindowRaionMap(districtRows) {
    const map = new Map();
    districtRows.forEach((row) => {
      const raion = normalizeRaion(row.district);
      if (OFFICIAL_RAIONS.indexOf(raion) < 0) return;
      const key = alertWindowKey({
        date: row.window_start.slice(0, 10),
        hour_start: String(hourFromISO(row.window_start)),
        hour_end: String(hourFromISO(row.window_end)),
        hours: row.hours,
      });
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(raion);
    });
    return map;
  }

  function resolveRaionParam(raw) {
    if (!raw || raw === "all") return "all";
    if (raw === "none") return "none";
    const decoded = decodeURIComponent(raw);
    const match = OFFICIAL_RAIONS.find((r) => r === decoded);
    return match || "all";
  }

  function getRaionFilter() {
    const params = new URLSearchParams(window.location.search);
    return resolveRaionParam(params.get("raion"));
  }

  function raionToParam(value) {
    if (value === "all") return "all";
    if (value === "none") return "none";
    return encodeURIComponent(value);
  }

  function filterAlertsByRaion(alerts, windowRaionMap, raionFilter) {
    if (raionFilter === "all") return alerts;
    if (raionFilter === "none") {
      return alerts.filter((a) => !windowRaionMap.has(alertWindowKey(a)));
    }
    return alerts.filter((a) => {
      const raions = windowRaionMap.get(alertWindowKey(a));
      return raions && raions.has(raionFilter);
    });
  }

  function alertStartEnd(alert) {
    const start = parseDate(alert.date);
    start.setHours(parseInt(alert.hour_start, 10), 0, 0, 0);
    const hours = parseFloat(alert.hours) || 0;
    const end = new Date(start.getTime() + hours * 3600000);
    return { start, end };
  }

  function isoWeekParts(d) {
    const target = new Date(d);
    const dayNr = (target.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = new Date(target.getFullYear(), 0, 4);
    const week =
      1 +
      Math.round(
        (target.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000)
      );
    const isoYear = target.getFullYear();
    return { iso_year: isoYear, iso_week: week };
  }

  function isoWeekBounds(isoYear, isoWeek) {
    const jan4 = new Date(isoYear, 0, 4);
    const dayNr = (jan4.getDay() + 6) % 7;
    const weekStart = new Date(jan4);
    weekStart.setDate(jan4.getDate() - dayNr + (isoWeek - 1) * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    return { week_start: formatISO(weekStart), week_end: formatISO(weekEnd) };
  }

  function splitHoursByIsoWeek(start, end) {
    const weekHours = new Map();
    let cursor = new Date(start);
    while (cursor < end) {
      const { iso_year, iso_week } = isoWeekParts(cursor);
      const weekKey = iso_year + "-" + iso_week;
      const dayNr = (cursor.getDay() + 6) % 7;
      const weekStart = new Date(cursor);
      weekStart.setDate(cursor.getDate() - dayNr);
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const segmentEnd = end < weekEnd ? end : weekEnd;
      const segmentHours = (segmentEnd - cursor) / 3600000;
      weekHours.set(weekKey, (weekHours.get(weekKey) || 0) + segmentHours);
      cursor = segmentEnd;
    }
    const out = {};
    weekHours.forEach((h, k) => {
      const [y, w] = k.split("-");
      out[k] = Math.round(h * 10) / 10;
    });
    return out;
  }

  function computeDailyFromAlerts(alerts) {
    const byDate = {};
    alerts.forEach((a) => {
      const h = parseFloat(a.hours) || 0;
      if (!byDate[a.date]) byDate[a.date] = [];
      byDate[a.date].push(h);
    });
    return Object.keys(byDate)
      .sort(compareDates)
      .map((date) => {
        const hrs = byDate[date];
        return {
          date,
          n: hrs.length,
          sum_hours: Math.round(hrs.reduce((s, v) => s + v, 0) * 10) / 10,
          mean_hours: Math.round(mean(hrs) * 10) / 10,
          median_hours: Math.round(median(hrs) * 10) / 10,
        };
      });
  }

  function computeWeeklyFromAlerts(alerts) {
    const startWeekCounts = {};
    const weekSumHours = {};

    alerts.forEach((a) => {
      const h = parseFloat(a.hours) || 0;
      const { start, end } = alertStartEnd(a);
      const { iso_year, iso_week } = isoWeekParts(start);
      const weekKey = iso_year + "-" + iso_week;
      if (!startWeekCounts[weekKey]) startWeekCounts[weekKey] = [];
      startWeekCounts[weekKey].push(h);

      const split = splitHoursByIsoWeek(start, end);
      Object.keys(split).forEach((k) => {
        weekSumHours[k] = (weekSumHours[k] || 0) + split[k];
      });
    });

    const allWeeks = new Set([
      ...Object.keys(startWeekCounts),
      ...Object.keys(weekSumHours),
    ]);

    return [...allWeeks]
      .sort()
      .map((weekKey) => {
        const [iso_year, iso_week] = weekKey.split("-").map(Number);
        const hrs = startWeekCounts[weekKey] || [];
        const bounds = isoWeekBounds(iso_year, iso_week);
        return {
          iso_year,
          iso_week,
          week_start: bounds.week_start,
          week_end: bounds.week_end,
          n_alerts: hrs.length,
          sum_hours: Math.round((weekSumHours[weekKey] || 0) * 10) / 10,
          mean_hours: hrs.length ? Math.round(mean(hrs) * 10) / 10 : 0,
          median_hours: hrs.length ? Math.round(median(hrs) * 10) / 10 : 0,
        };
      });
  }

  function syncQueryParams(updates) {
    const url = new URL(window.location.href);
    Object.keys(updates).forEach((key) => {
      const value = updates[key];
      if (value == null || value === "") url.searchParams.delete(key);
      else url.searchParams.set(key, value);
    });
    window.history.replaceState({}, "", url);
  }

  function initNavLinks() {
    document.querySelectorAll(".site-nav a").forEach((link) => {
      const page = link.getAttribute("href").split("?")[0];
      const params = new URLSearchParams(window.location.search);
      const next = new URLSearchParams();
      const raion = params.get("raion");
      if (raion) next.set("raion", raion);
      if (page === "days.html" || page === "districts.html") {
        const from = params.get("from");
        const to = params.get("to");
        if (from) next.set("from", from);
        if (to) next.set("to", to);
      }
      const qs = next.toString();
      link.setAttribute("href", page + (qs ? "?" + qs : ""));
    });
  }

  function mountRaionFilter(container, options) {
    const opts = options || {};
    let current = getRaionFilter();

    container.className = "raion-controls";
    container.innerHTML =
      '<div class="raion-row">' +
      '<label for="raion-filter">район</label>' +
      '<select id="raion-filter" aria-label="Фільтр за районом"></select>' +
      "</div>" +
      '<p class="raion-filter-note">' +
      RAION_FILTER_NOTE +
      "</p>";

    const select = container.querySelector("#raion-filter");
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "усі";
    select.appendChild(allOpt);

    OFFICIAL_RAIONS.forEach((raion) => {
      const opt = document.createElement("option");
      opt.value = raion;
      opt.textContent = raion;
      select.appendChild(opt);
    });

    const noneOpt = document.createElement("option");
    noneOpt.value = "none";
    noneOpt.textContent = "не указано";
    select.appendChild(noneOpt);

    select.value = current;

    select.addEventListener("change", () => {
      current = resolveRaionParam(select.value);
      syncQueryParams({ raion: raionToParam(current) });
      initNavLinks();
      if (typeof opts.onChange === "function") opts.onChange(current);
    });

    return {
      getValue() {
        return current;
      },
      setValue(value) {
        current = resolveRaionParam(value);
        select.value = current === "all" || current === "none" ? current : current;
      },
    };
  }

  function readDateParams(dataMin, dataMax) {
    const params = new URLSearchParams(window.location.search);
    const from = params.get("from");
    const to = params.get("to");
    if (!from && !to) return null;
    let start = from ? clampDate(from, dataMin, dataMax) : dataMin;
    let end = to ? clampDate(to, dataMin, dataMax) : dataMax;
    if (compareDates(start, end) > 0) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    return { start, end };
  }

  function syncDateParams(start, end) {
    syncQueryParams({ from: start, to: end });
    initNavLinks();
  }

  global.KyivAlerts.CHART_DEFAULTS = CHART_DEFAULTS;
  global.KyivAlerts.CACHE_BUST = CACHE_BUST;
  global.KyivAlerts.OFFICIAL_RAIONS = OFFICIAL_RAIONS;
  global.KyivAlerts.RAION_FILTER_NOTE = RAION_FILTER_NOTE;
  global.KyivAlerts.normalizeRaion = normalizeRaion;
  global.KyivAlerts.hourFromISO = hourFromISO;
  global.KyivAlerts.alertWindowKey = alertWindowKey;
  global.KyivAlerts.districtRowWindowKey = districtRowWindowKey;
  global.KyivAlerts.districtWindowPairKey = districtWindowPairKey;
  global.KyivAlerts.buildWindowRaionMap = buildWindowRaionMap;
  global.KyivAlerts.resolveRaionParam = resolveRaionParam;
  global.KyivAlerts.getRaionFilter = getRaionFilter;
  global.KyivAlerts.raionToParam = raionToParam;
  global.KyivAlerts.filterAlertsByRaion = filterAlertsByRaion;
  global.KyivAlerts.computeDailyFromAlerts = computeDailyFromAlerts;
  global.KyivAlerts.computeWeeklyFromAlerts = computeWeeklyFromAlerts;
  global.KyivAlerts.syncQueryParams = syncQueryParams;
  global.KyivAlerts.initNavLinks = initNavLinks;
  global.KyivAlerts.mountRaionFilter = mountRaionFilter;
  global.KyivAlerts.readDateParams = readDateParams;
  global.KyivAlerts.syncDateParams = syncDateParams;
  global.KyivAlerts.parseCSV = parseCSV;
  global.KyivAlerts.parseDate = parseDate;
  global.KyivAlerts.formatISO = formatISO;
  global.KyivAlerts.addDays = addDays;
  global.KyivAlerts.compareDates = compareDates;
  global.KyivAlerts.clampDate = clampDate;
  global.KyivAlerts.dateRangeInclusive = dateRangeInclusive;
  global.KyivAlerts.formatDayLabel = formatDayLabel;
  global.KyivAlerts.formatDayLabelLong = formatDayLabelLong;
  global.KyivAlerts.weekdayIndex = weekdayIndex;
  global.KyivAlerts.weekdayNameUk = weekdayNameUk;
  global.KyivAlerts.median = median;
  global.KyivAlerts.percentile = percentile;
  global.KyivAlerts.mean = mean;
  global.KyivAlerts.barColors = barColors;
  global.KyivAlerts.valueLabelsPlugin = valueLabelsPlugin;
  global.KyivAlerts.isIncompleteDay = isIncompleteDay;
  global.KyivAlerts.lastEventDate = lastEventDate;
})(typeof window !== "undefined" ? window : globalThis);
