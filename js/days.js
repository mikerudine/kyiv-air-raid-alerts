(function () {
  "use strict";

  const K = window.KyivAlerts;
  const charts = {};
  let dailyMap = {};
  let dailyAll = [];
  let alertsAll = [];
  let windowRaionMap = null;
  let droneMap = null;
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

  function fillTable(series) {
    const tbody = document.querySelector("#days-table tbody");
    tbody.innerHTML = "";
    series
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
    document.querySelectorAll(".chart-source:not(.chart-source-drones)").forEach((el) => {
      el.textContent = text;
    });
  }

  function updateRangeCaption(start, end) {
    const el = document.getElementById("range-caption");
    el.textContent =
      "Період: " + K.formatDayLabelLong(start) + " — " + K.formatDayLabelLong(end);
  }

  function renderDashboard() {
    rebuildDailyMap();
    const { start, end } = getRangeValues();
    const series = seriesForRange(start, end);
    const labels = series.map((d) => K.formatDayLabel(d.date));
    const kpi = rangeKPIs(series);

    updateKPIs(kpi, rangeDroneSum(start, end));
    updateRangeCaption(start, end);
    fillTable(series);

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
    makeChart(
      "chart-drones",
      "БпЛА",
      series.map((d) => d.drones_sum),
      labels,
      "#d47a4a",
      "#e8b84a"
    );
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
      const bust = K.CACHE_BUST;
      const [metaRes, dailyRes, alertsRes, districtsRes, dronesRes] = await Promise.all([
        fetch("data/meta.json?v=" + bust),
        fetch("data/daily.csv?v=" + bust),
        fetch("data/alerts.csv?v=" + bust),
        fetch("data/districts.csv?v=" + bust),
        fetch("data/drones.csv?v=" + bust),
      ]);

      if (!metaRes.ok || !dailyRes.ok || !alertsRes.ok || !districtsRes.ok || !dronesRes.ok) {
        throw new Error("Не вдалося завантажити дані");
      }

      meta = await metaRes.json();
      dailyAll = K.parseCSV(await dailyRes.text());
      alertsAll = K.parseCSV(await alertsRes.text());
      const districtRows = K.parseCSV(await districtsRes.text());
      windowRaionMap = K.buildWindowRaionMap(districtRows);
      droneMap = K.buildDroneMap(K.parseCSV(await dronesRes.text()));

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
