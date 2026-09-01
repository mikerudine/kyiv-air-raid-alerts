(function () {
  "use strict";

  const YEAR = 2026;
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

  const charts = {};

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

  function formatWeekLabel(weekStart) {
    const d = new Date(weekStart + "T00:00:00");
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return dd + "." + mm;
  }

  function barColors(values, normalColor, lastColor) {
    return values.map((_, i) => (i === values.length - 1 ? lastColor : normalColor));
  }

  function makeChart(canvasId, yLabel, dataKey, normalColor, lastColor, yMax) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const weekly2026 = window.__weekly2026 || [];
    const labels = weekly2026.map((w) => formatWeekLabel(w.week_start));
    const values = weekly2026.map((w) => parseFloat(w[dataKey]));

    const opts = JSON.parse(JSON.stringify(CHART_DEFAULTS));
    opts.scales.y.title = { display: true, text: yLabel, color: "#aaa", font: { size: 11 } };
    if (yMax) opts.scales.y.max = yMax;

    charts[canvasId] = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: barColors(values, normalColor, lastColor),
            borderWidth: 0,
            borderRadius: 2,
          },
        ],
      },
      options: opts,
      plugins: [
        {
          id: "valueLabels",
          afterDatasetsDraw(chart) {
            const ctx = chart.ctx;
            chart.data.datasets.forEach((dataset, i) => {
              const meta = chart.getDatasetMeta(i);
              meta.data.forEach((bar, idx) => {
                const val = dataset.data[idx];
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
        },
      ],
    });
  }

  function updateKPIs(meta, alerts2026) {
    const hours = alerts2026.map((a) => parseFloat(a.hours));
    const mean =
      hours.length > 0 ? (hours.reduce((s, h) => s + h, 0) / hours.length).toFixed(1) : "—";
    const sorted = [...hours].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length === 0
        ? "—"
        : sorted.length % 2 === 0
          ? ((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1)
          : sorted[mid].toFixed(1);

    document.getElementById("kpi-count").textContent = meta.n_closed_2026;
    document.getElementById("kpi-sum").textContent = meta.sum_hours_2026.toFixed(1);
    document.getElementById("kpi-mean").textContent = mean;
    document.getElementById("kpi-median").textContent = median;
    document.getElementById("kpi-last").textContent = meta.last_event;
  }

  function fillRecentTable(alerts) {
    const tbody = document.querySelector("#recent-table tbody");
    tbody.innerHTML = "";
    const recent = alerts.slice(-20).reverse();
    recent.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        row.date +
        "</td><td>" +
        row.hour_start +
        "</td><td>" +
        row.hour_end +
        '</td><td class="num">' +
        row.hours +
        "</td>";
      tbody.appendChild(tr);
    });
  }

  function updateSourceFooters(meta) {
    const text =
      "Джерело: Київ Цифровий • до " +
      meta.last_event.replace(" ", " ") +
      " ";
    document.querySelectorAll(".chart-source").forEach((el) => {
      el.textContent = text;
    });
  }

  async function init() {
    try {
      const [metaRes, weeklyRes, alertsRes] = await Promise.all([
        fetch("data/meta.json"),
        fetch("data/weekly.csv"),
        fetch("data/alerts.csv"),
      ]);

      if (!metaRes.ok || !weeklyRes.ok || !alertsRes.ok) {
        throw new Error("Не вдалося завантажити дані");
      }

      const meta = await metaRes.json();
      const weekly = parseCSV(await weeklyRes.text());
      const alerts = parseCSV(await alertsRes.text());

      window.__weekly2026 = weekly
        .filter((w) => parseInt(w.iso_year, 10) === YEAR)
        .sort((a, b) => {
          if (a.iso_year !== b.iso_year) return a.iso_year - b.iso_year;
          return a.iso_week - b.iso_week;
        });

      const alerts2026 = alerts.filter((a) => a.date.startsWith(String(YEAR)));

      document.getElementById("loading").style.display = "none";
      document.getElementById("dashboard").style.display = "block";

      if (meta.alert_open) {
        const banner = document.getElementById("alert-banner");
        banner.classList.add("visible");
        banner.textContent = "⚠ Зараз триває повітряна тривога у м. Києві";
      }

      updateKPIs(meta, alerts2026);
      fillRecentTable(alerts);
      updateSourceFooters(meta);

      makeChart("chart-sum", "години", "sum_hours", "#c45c4a", "#d4a017");
      makeChart("chart-mean", "години", "mean_hours", "#5b9bd5", "#e8913a", 2.5);
      makeChart("chart-median", "години", "median_hours", "#4a9b8e", "#e8913a", 1.4);
      makeChart("chart-count", "тривоги", "n_alerts", "#9b8ec4", "#d4a017", 60);
    } catch (err) {
      document.getElementById("loading").style.display = "none";
      const errEl = document.getElementById("error");
      errEl.classList.add("visible");
      errEl.textContent = "Помилка: " + err.message;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
