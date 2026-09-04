(function () {
  "use strict";

  const K = window.KyivAlerts;
  const charts = {};
  let dailyMap = {};
  let dailyAll = [];
  let alertsAll = [];
  let windowRaionMap = null;
  let droneMap = null;
  let droneCompareDailyMap = null;
  let meta = null;
  let dataMin = "";
  let dataMax = "";
  let raionFilter = "all";

  function showError(msg) {
    document.getElementById("loading").style.display = "none";
    const errEl = document.getElementById("error");
    errEl.classList.add("visible");
    errEl.textContent = "Помилка: " + msg;
  }

  function buildDailyMap(rows) {
    const map = {};
    rows.forEach((r) => {
      map[r.date] = {
        n: parseInt(r.n, 10) || 0,
        sum_hours: parseFloat(r.sum_hours) || 0,
        mean_hours: parseFloat(r.mean_hours) || 0,
        median_hours: parseFloat(r.median_hours) || 0,
      };
    });
    return map;
  }

  function defaultRange() {
    const end = dataMax;
    const start = K.addDays(end, -27);
    return {
      start: K.clampDate(start, dataMin, dataMax),
      end,
    };
  }

  function getRangeValues() {
    const startEl = document.getElementById("date-from");
    const endEl = document.getElementById("date-to");
    let start = startEl.value;
    let end = endEl.value;
    if (K.compareDates(start, end) > 0) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    start = K.clampDate(start, dataMin, dataMax);
    end = K.clampDate(end, dataMin, dataMax);
    startEl.value = start;
    endEl.value = end;
    K.syncDateParams(start, end);
    return { start, end };
  }

  function filteredAlerts() {
    return K.filterAlertsByRaion(alertsAll, windowRaionMap, raionFilter);
  }

  function dailyDronesMap() {
    return K.computeDailyDronesFromAlerts(filteredAlerts(), droneMap);
  }

  function rangeDroneSum(start, end) {
    const alerts = filteredAlerts().filter(
      (a) => K.compareDates(a.date, start) >= 0 && K.compareDates(a.date, end) <= 0
    );
    return K.sumKnownDronesFromAlerts(alerts, droneMap);
  }

  function rebuildDailyMap() {
    if (raionFilter === "all") {
      dailyMap = buildDailyMap(dailyAll);
      return;
    }
    const filtered = K.filterAlertsByRaion(alertsAll, windowRaionMap, raionFilter);
    dailyMap = buildDailyMap(K.computeDailyFromAlerts(filtered));
  }

  function seriesForRange(start, end) {
    const dates = K.dateRangeInclusive(start, end);
    const dronesByDate = dailyDronesMap();
    return dates.map((date) => {
      const row = dailyMap[date];
      const droneRow = dronesByDate[date];
      return {
        date,
        n: row ? row.n : 0,
        sum_hours: row ? row.sum_hours : 0,
        mean_hours: row ? row.mean_hours : 0,
        median_hours: row ? row.median_hours : 0,
        drones_sum: droneRow && droneRow.n_known > 0 ? droneRow.sum : 0,
        drones_cell: K.formatDailyDronesCell(droneRow),
        incomplete: K.isIncompleteDay(date, meta.last_event),
      };
    });
  }

  function rangeKPIs(series) {
    const totalN = series.reduce((s, d) => s + d.n, 0);
    const totalSum = series.reduce((s, d) => s + d.sum_hours, 0);
    const alertHours = K.filterAlertsByRaion(alertsAll, windowRaionMap, raionFilter)
      .filter((a) => {
        return (
          K.compareDates(a.date, series[0].date) >= 0 &&
          K.compareDates(a.date, series[series.length - 1].date) <= 0
        );
      })
      .map((a) => parseFloat(a.hours));
    const overallMean = totalN > 0 ? totalSum / totalN : null;
    const overallMedian = K.median(alertHours);
    return {
      n: totalN,
      sum: totalSum,
      mean: overallMean,
      median: overallMedian,
    };
  }

  function destroyCharts() {
    Object.keys(charts).forEach((id) => {
      if (charts[id]) {
        charts[id].destroy();
        delete charts[id];
      }
    });
  }

  function makeChart(canvasId, yLabel, values, labels, normalColor, lastColor, yMax) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const opts = JSON.parse(JSON.stringify(K.CHART_DEFAULTS));
    opts.scales.y.title = { display: true, text: yLabel, color: "#aaa", font: { size: 11 } };
    if (yMax) opts.scales.y.max = yMax;
    K.applyMobileBarXAxis(opts, labels.length);

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

  function fillDronesRegionCompareTable(tableSeries) {
    const tbody = document.querySelector("#drones-region-compare-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    const dronesByDate = dailyDronesMap();
    tableSeries
      .slice()
      .reverse()
      .forEach((row) => {
      const stats = dronesByDate[row.date];
      const compare = K.lookupDroneCompareDaily(droneCompareDailyMap, row.date);
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        K.formatDayLabel(row.date) +
        "</td>" +
        '<td class="num">' +
        K.formatDailyDroneSourceCell(stats, "kievreal1") +
        "</td>" +
        '<td class="num">' +
        K.formatDailyDroneSourceCell(stats, "war_monitor") +
        "</td>" +
        '<td class="num">' +
        K.formatDailyDroneSourceCell(stats, "vanek_nikolaev") +
        "</td>" +
        '<td class="num">' +
        K.formatRegionCompareOblastCell(compare) +
        "</td>" +
        '<td class="num">' +
        K.formatRegionCompareNationwideCell(compare, "war_monitor") +
        "</td>" +
        '<td class="num">' +
        K.formatRegionCompareNationwideCell(compare, "vanek_nikolaev") +
        "</td>" +
        '<td class="num">' +
        K.formatRegionCompareNationwideCell(compare, "genstab") +
        "</td>";
      tbody.appendChild(tr);
    });
  }

  function makeDronesRegionChart(series, labels) {
    const canvas = document.getElementById("chart-drones-region");
    if (!canvas) return;

    const dronesByDate = dailyDronesMap();
    const cityValues = series.map((row) => {
      const stats = dronesByDate[row.date];
      if (!stats || stats.n_known === 0) return null;
      return stats.sum;
    });
    const oblastValues = series.map((row) => {
      const compare = K.lookupDroneCompareDaily(droneCompareDailyMap, row.date);
      return K.chartDroneValue(compare ? compare.oblast_drones : null);
    });

    const opts = K.groupedDronesRegionChartOptions();
    K.applyMobileBarXAxis(opts, labels.length);

    charts["chart-drones-region"] = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "м. Київ",
            data: cityValues,
            backgroundColor: "#d47a4a",
            borderWidth: 0,
            borderRadius: 2,
          },
          {
            label: "Київська область",
            data: oblastValues,
            backgroundColor: "#5b9bd5",
            borderWidth: 0,
            borderRadius: 2,
          },
        ],
      },
      options: opts,
      plugins: [K.valueLabelsPlugin()],
    });
  }

  function fillTable(tableSeries) {
    const tbody = document.querySelector("#days-table tbody");
    tbody.innerHTML = "";
    const dronesByDate = dailyDronesMap();
    tableSeries
      .slice()
      .reverse()
      .forEach((row) => {
        const tr = document.createElement("tr");
        if (row.incomplete) tr.classList.add("row-incomplete");
        tr.innerHTML =
          "<td>" +
          K.formatDayLabelLong(row.date) +
          " (" +
          K.weekdayNameUk(K.weekdayIndex(row.date)) +
          ")</td>" +
          '<td class="num">' +
          row.n +
          "</td>" +
          '<td class="num">' +
          row.sum_hours.toFixed(1) +
          "</td>" +
          '<td class="num">' +
          (row.n > 0 ? row.mean_hours.toFixed(1) : "—") +
          "</td>" +
          '<td class="num">' +
          (row.n > 0 ? row.median_hours.toFixed(1) : "—") +
          "</td>" +
          '<td class="num">' +
          row.drones_cell +
          "</td>" +
          '<td class="num">' +
          K.formatDailyDroneSourceCell(dronesByDate[row.date], "war_monitor") +
          "</td>" +
          '<td class="num">' +
          K.formatDailyDroneSourceCell(dronesByDate[row.date], "vanek_nikolaev") +
          "</td>" +
          (row.incomplete ? '<td class="incomplete-tag">неповний день</td>' : "<td></td>");
        tbody.appendChild(tr);
      });
  }

  function updateKPIs(kpi, droneSum) {
    document.getElementById("kpi-count").textContent = kpi.n;
    document.getElementById("kpi-sum").textContent = kpi.sum.toFixed(1);
    document.getElementById("kpi-mean").textContent =
      kpi.mean != null ? kpi.mean.toFixed(1) : "—";
    document.getElementById("kpi-median").textContent =
      kpi.median != null ? kpi.median.toFixed(1) : "—";
    document.getElementById("kpi-drones").textContent = String(droneSum);
  }

  function updateSourceFooters() {
    const text = "Джерело: Київ Цифровий • до " + meta.last_event;
    document.querySelectorAll(".chart-source:not(.chart-source-gantt):not(.chart-source-drones-region)").forEach((el) => {
      el.textContent = text;
    });
  }

  function updateRangeCaption(start, end) {
    const el = document.getElementById("range-caption");
    el.textContent =
      "Період: " + K.formatDayLabelLong(start) + " — " + K.formatDayLabelLong(end);
  }

  const GANTT_MONTHS_UK = [
    "січня",
    "лютого",
    "березня",
    "квітня",
    "травня",
    "червня",
    "липня",
    "серпня",
    "вересня",
    "жовтня",
    "листопада",
    "грудня",
  ];

  function ganttSevenDayRange() {
    const end = dataMax;
    const start = K.addDays(end, -6);
    return {
      start,
      end,
      dates: K.dateRangeInclusive(start, end),
    };
  }

  function tableSevenDaySeries() {
    const { start, end } = ganttSevenDayRange();
    return seriesForRange(start, end);
  }

  function ganttRangeSubtitle(start, end) {
    const s = K.parseDate(start);
    const e = K.parseDate(end);
    const y = s.getFullYear();
    if (s.getMonth() === e.getMonth()) {
      return s.getDate() + "–" + e.getDate() + " " + GANTT_MONTHS_UK[s.getMonth()] + " " + y;
    }
    return (
      s.getDate() +
      " " +
      GANTT_MONTHS_UK[s.getMonth()] +
      " – " +
      e.getDate() +
      " " +
      GANTT_MONTHS_UK[e.getMonth()] +
      " " +
      y
    );
  }

  function alertClockBounds(alert) {
    if (alert.window_start && alert.window_end) {
      return {
        start: new Date(alert.window_start),
        end: new Date(alert.window_end),
      };
    }
    return K.alertStartEnd(alert);
  }

  function splitAlertIntoDayFragments(alert) {
    const { start, end } = alertClockBounds(alert);
    const fragments = [];
    let cursor = new Date(start);
    while (cursor < end) {
      const dayStart = new Date(cursor);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const segmentEnd = end < dayEnd ? end : dayEnd;
      const xStart = (cursor - dayStart) / 3600000;
      const xEnd = (segmentEnd - dayStart) / 3600000;
      if (xEnd > xStart) {
        fragments.push({
          date: K.formatISO(dayStart),
          x: [Math.round(xStart * 1000) / 1000, Math.round(xEnd * 1000) / 1000],
        });
      }
      cursor = segmentEnd;
    }
    return fragments;
  }

  function buildGanttSegments(dates) {
    const allowed = new Set(dates);
    const segments = [];
    filteredAlerts().forEach((alert) => {
      splitAlertIntoDayFragments(alert).forEach((frag) => {
        if (allowed.has(frag.date)) {
          segments.push({
            x: frag.x,
            y: K.formatDayLabel(frag.date),
          });
        }
      });
    });
    return segments;
  }

  function updateGanttCaption(ganttEnd) {
    const el = document.getElementById("gantt-caption");
    if (!el) return;
    const parts = ["нічні вікна розрізаються на дві доби"];
    if (meta && meta.alert_open) {
      parts.unshift("відкрите вікно не входить");
    }
    if (meta && meta.last_event && ganttEnd === meta.last_event.slice(0, 10)) {
      const timePart = meta.last_event.slice(11, 16);
      parts.unshift(K.formatDayLabel(ganttEnd) + " до ~" + timePart);
    }
    el.textContent = parts.join(" · ");
  }

  function makeGanttChart() {
    const canvas = document.getElementById("chart-gantt");
    if (!canvas) return;

    const { start, end, dates } = ganttSevenDayRange();
    const labels = dates.map((d) => K.formatDayLabel(d));
    const segments = buildGanttSegments(dates);

    const rangeEl = document.getElementById("gantt-range-caption");
    if (rangeEl) {
      rangeEl.textContent = ganttRangeSubtitle(start, end);
    }
    updateGanttCaption(end);

    if (charts["chart-gantt"]) charts["chart-gantt"].destroy();

    charts["chart-gantt"] = new Chart(canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: segments,
            backgroundColor: "#c45c4a",
            borderWidth: 0,
            borderRadius: 0,
            barThickness: 16,
          },
        ],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        parsing: {
          xAxisKey: "x",
          yAxisKey: "y",
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#2a2a2a",
            titleColor: "#e8e8e8",
            bodyColor: "#ccc",
            borderColor: "#444",
            borderWidth: 1,
            callbacks: {
              label(ctx) {
                const x = ctx.raw.x;
                const h0 = Math.floor(x[0]);
                const m0 = String(Math.round((x[0] - h0) * 60)).padStart(2, "0");
                const h1 = Math.floor(x[1]);
                const m1 = String(Math.round((x[1] - h1) * 60)).padStart(2, "0");
                return (
                  String(h0).padStart(2, "0") +
                  ":" +
                  m0 +
                  " – " +
                  String(h1).padStart(2, "0") +
                  ":" +
                  m1
                );
              },
            },
          },
        },
        scales: (function () {
          const scales = {
          x: {
            min: 0,
            max: 24,
            ticks: {
              stepSize: 2,
              color: "#aaa",
              font: { size: 10 },
              callback(value) {
                return String(value).padStart(2, "0");
              },
            },
            grid: { color: "rgba(255,255,255,0.06)" },
            title: {
              display: true,
              text: "година (Europe/Kyiv)",
              color: "#aaa",
              font: { size: 11 },
            },
          },
          y: {
            reverse: true,
            ticks: { color: "#aaa", font: { size: 11 } },
            grid: { display: false },
          },
        };
          K.applyMobileGanttScales(scales, labels.length);
          return scales;
        })(),
      },
    });
  }

  function renderDashboard() {
    rebuildDailyMap();
    const { start, end } = getRangeValues();
    const series = seriesForRange(start, end);
    const tableSeries = tableSevenDaySeries();
    const labels = series.map((d) => K.formatDayLabel(d.date));
    const kpi = rangeKPIs(series);

    updateKPIs(kpi, rangeDroneSum(start, end));
    updateRangeCaption(start, end);
    fillTable(tableSeries);
    fillDronesRegionCompareTable(tableSeries);

    destroyCharts();
    makeChart(
      "chart-sum",
      "години",
      series.map((d) => d.sum_hours),
      labels,
      "#c45c4a",
      "#d4a017"
    );
    makeChart(
      "chart-mean",
      "години",
      series.map((d) => (d.n > 0 ? d.mean_hours : 0)),
      labels,
      "#5b9bd5",
      "#e8913a",
      2.5
    );
    makeChart(
      "chart-median",
      "години",
      series.map((d) => (d.n > 0 ? d.median_hours : 0)),
      labels,
      "#4a9b8e",
      "#e8913a",
      1.4
    );
    makeChart(
      "chart-count",
      "тривоги",
      series.map((d) => d.n),
      labels,
      "#9b8ec4",
      "#d4a017",
      60
    );
    makeDronesRegionChart(series, labels);
    makeGanttChart();
  }

  function applyPreset(days) {
    const end = dataMax;
    const start = K.clampDate(K.addDays(end, -(days - 1)), dataMin, dataMax);
    document.getElementById("date-from").value = start;
    document.getElementById("date-to").value = end;
    renderDashboard();
  }

  function applyYTD() {
    const year = dataMax.slice(0, 4);
    const start = K.clampDate(year + "-01-01", dataMin, dataMax);
    document.getElementById("date-from").value = start;
    document.getElementById("date-to").value = dataMax;
    renderDashboard();
  }

  function bindControls() {
    document.getElementById("date-from").addEventListener("change", renderDashboard);
    document.getElementById("date-to").addEventListener("change", renderDashboard);
    document.getElementById("preset-7").addEventListener("click", () => applyPreset(7));
    document.getElementById("preset-28").addEventListener("click", () => applyPreset(28));
    document.getElementById("preset-90").addEventListener("click", () => applyPreset(90));
    document.getElementById("preset-ytd").addEventListener("click", applyYTD);
  }

  async function init() {
    try {
      const [metaData, alertsData, districtRows, droneRows, compareDailyRows] =
        await Promise.all([
          K.fetchCityMeta(),
          K.fetchTable("alerts"),
          K.fetchTable("districts"),
          K.fetchTable("drones"),
          K.fetchTable("drones_compare_daily"),
        ]);

      meta = metaData;
      alertsAll = alertsData;
      dailyAll = K.computeDailyFromAlerts(alertsAll);
      windowRaionMap = K.buildWindowRaionMap(districtRows);
      droneMap = K.buildDroneMap(droneRows);
      droneCompareDailyMap = K.buildDroneCompareDailyMap(compareDailyRows);

      const dates = dailyAll.map((r) => r.date).sort(K.compareDates);
      dataMin = dates[0];
      dataMax = dates[dates.length - 1];

      const urlRange = K.readDateParams(dataMin, dataMax);
      const def = urlRange || defaultRange();
      document.getElementById("date-from").min = dataMin;
      document.getElementById("date-from").max = dataMax;
      document.getElementById("date-to").min = dataMin;
      document.getElementById("date-to").max = dataMax;
      document.getElementById("date-from").value = def.start;
      document.getElementById("date-to").value = def.end;

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
      bindControls();
      renderDashboard();
    } catch (err) {
      showError(err.message);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
