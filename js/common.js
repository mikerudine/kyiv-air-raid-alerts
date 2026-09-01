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

  global.KyivAlerts.CHART_DEFAULTS = CHART_DEFAULTS;
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
