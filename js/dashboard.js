(function () {
  "use strict";

  const K = window.KyivAlerts;
  const YEAR = 2026;
  const charts = {};

  let meta = null;
  let weeklyAll = [];
  let alertsAll = [];
  let windowRaionMap = null;
  let droneMap = null;
  let raionFilter = "all";

  function formatWeekLabel(weekStart) {
    return K.formatDayLabel(weekStart);
  }

  function makeChart(canvasId, yLabel, dataKey, normalColor, lastColor, yMax) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const weekly2026 = window.__weekly2026 || [];
    const labels = weekly2026.map((w) => formatWeekLabel(w.week_start));
    const values = weekly2026.map((w) => parseFloat(w[dataKey]));

    const opts = JSON.parse(JSON.stringify(K.CHART_DEFAULTS));
    opts.scales.y.title = { display: true, text: yLabel, color: "#aaa", font: { size: 11 } };
    if (yMax) opts.scales.y.max = yMax;

    if (charts[canvasId]) charts[canvasId].destroy();

    charts[canvasId] = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: K.barColors(values, normalColor, lastColor),
            borderWidth: 0,
            borderRadius: 2,
          },
        ],
      },
      options: opts,
      plugins: [K.valueLabelsPlugin()],
    });
  }

  function refreshCharts() {
    makeChart("chart-sum", "години", "sum_hours", "#c45c4a", "#d4a017");
    makeChart("chart-mean", "години", "mean_hours", "#5b9bd5", "#e8913a", 2.5);
    makeChart("chart-median", "години", "median_hours", "#4a9b8e", "#e8913a", 1.4);
    makeChart("chart-count", "тривоги", "n_alerts", "#9b8ec4", "#d4a017", 60);
    makeDronesChart();
  }

  function fillDronesCompareTable() {
    const tbody = document.querySelector("#drones-compare-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    const weeklyDrones = window.__weeklyDrones2026 || [];
    weeklyDrones.forEach((w) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        formatWeekLabel(w.week_start) +
        "</td>" +
        '<td class="num">' +
        K.formatWeeklyDroneSourceCell(w, "kievreal1") +
        "</td>" +
        '<td class="num">' +
        K.formatWeeklyDroneSourceCell(w, "war_monitor") +
        "</td>" +
        '<td class="num">' +
        K.formatWeeklyDroneSourceCell(w, "vanek_nikolaev") +
        "</td>";
      tbody.appendChild(tr);
    });
  }

  function makeDronesChart() {
    const canvas = document.getElementById("chart-drones");
    if (!canvas) return;

    const weeklyDrones = window.__weeklyDrones2026 || [];
    const labels = weeklyDrones.map((w) => formatWeekLabel(w.week_start));
    const values = weeklyDrones.map((w) => w.drones || 0);

    const opts = JSON.parse(JSON.stringify(K.CHART_DEFAULTS));
    opts.scales.y.title = { display: true, text: "БпЛА", color: "#aaa", font: { size: 11 } };

    if (charts["chart-drones"]) charts["chart-drones"].destroy();

    charts["chart-drones"] = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: K.barColors(values, "#d47a4a", "#e8b84a"),
            borderWidth: 0,
            borderRadius: 2,
          },
        ],
      },
      options: opts,
      plugins: [K.valueLabelsPlugin()],
    });
  }

  function filteredAlerts2026() {
    const alerts2026 = alertsAll.filter((a) => a.date.startsWith(String(YEAR)));
    return K.filterAlertsByRaion(alerts2026, windowRaionMap, raionFilter);
  }

  function updateWeeklyData() {
    if (raionFilter === "all") {
      window.__weekly2026 = weeklyAll;
    } else {
      const filtered = filteredAlerts2026();
      window.__weekly2026 = K.computeWeeklyFromAlerts(filtered);
    }
    const filtered = filteredAlerts2026();
    const computed = K.computeWeeklyDronesFromAlerts(filtered, droneMap);
    const byKey = {};
    computed.forEach((w) => {
      byKey[w.iso_year + "-" + w.iso_week] = w;
    });
    window.__weeklyDrones2026 = weeklyAll.map((w) => {
      const row = byKey[w.iso_year + "-" + w.iso_week];
      return {
        week_start: w.week_start,
        week_end: w.week_end,
        iso_year: w.iso_year,
        iso_week: w.iso_week,
        drones: row ? row.drones : 0,
        drones_war_monitor: row ? row.drones_war_monitor : 0,
        drones_vanek_nikolaev: row ? row.drones_vanek_nikolaev : 0,
        n_known: row ? row.n_known : 0,
        n_known_war_monitor: row ? row.n_known_war_monitor : 0,
        n_known_vanek_nikolaev: row ? row.n_known_vanek_nikolaev : 0,
        n_windows: row ? row.n_windows : 0,
      };
    });
  }

  function updateKPIs() {
    const filtered = filteredAlerts2026();
    const hours = filtered.map((a) => parseFloat(a.hours));
    const mean =
      hours.length > 0 ? (hours.reduce((s, h) => s + h, 0) / hours.length).toFixed(1) : "—";
    const sorted = [...hours].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianVal =
      sorted.length === 0
        ? "—"
        : sorted.length % 2 === 0
          ? ((sorted[mid - 1] + sorted[mid]) / 2).toFixed(1)
          : sorted[mid].toFixed(1);
    const sum = hours.length > 0 ? hours.reduce((s, h) => s + h, 0).toFixed(1) : "—";

    document.getElementById("kpi-count").textContent = String(filtered.length);
    document.getElementById("kpi-sum").textContent = sum;
    document.getElementById("kpi-mean").textContent = mean;
    document.getElementById("kpi-median").textContent = medianVal;
    document.getElementById("kpi-last").textContent = meta.last_event;
    document.getElementById("kpi-drones").textContent = String(
      K.sumKnownDronesFromAlerts(filtered, droneMap)
    );
  }

  function fillRecentTable() {
    const tbody = document.querySelector("#recent-table tbody");
    tbody.innerHTML = "";
    const recent = filteredAlerts2026().slice(-20).reverse();
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

  function updateSourceFooters() {
    const text =
      "Джерело: Київ Цифровий • до " + meta.last_event.replace(" ", " ") + " ";
    document.querySelectorAll(".chart-source:not(.chart-source-drones)").forEach((el) => {
      el.textContent = text;
    });
  }

  function renderDashboard() {
    updateWeeklyData();
    updateKPIs();
    fillRecentTable();
    fillDronesCompareTable();
    refreshCharts();
  }

  async function init() {
    try {
      const [metaData, alertsData, districtRows, droneRows] = await Promise.all([
        K.fetchCityMeta(),
        K.fetchTable("alerts"),
        K.fetchTable("districts"),
        K.fetchTable("drones"),
      ]);

      meta = metaData;
      alertsAll = alertsData;
      windowRaionMap = K.buildWindowRaionMap(districtRows);
      droneMap = K.buildDroneMap(droneRows);

      weeklyAll = K.computeWeeklyFromAlerts(
        alertsAll.filter((a) => a.date.startsWith(String(YEAR)))
      ).sort((a, b) => {
        if (a.iso_year !== b.iso_year) return a.iso_year - b.iso_year;
        return a.iso_week - b.iso_week;
      });

      document.getElementById("loading").style.display = "none";
      document.getElementById("dashboard").style.display = "block";

      if (meta.alert_open) {
        const banner = document.getElementById("alert-banner");
        banner.classList.add("visible");
        banner.textContent = "⚠ Зараз триває повітряна тривога у м. Києві";
      }

      K.initNavLinks();
      K.mountRaionFilter(document.getElementById("raion-filter-root"), {
        onChange(value) {
          raionFilter = value;
          renderDashboard();
        },
      });
      raionFilter = K.getRaionFilter();

      updateSourceFooters();
      renderDashboard();
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
