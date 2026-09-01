(function () {
  "use strict";

  const K = window.KyivAlerts;
  const MIN_WEEKDAY_SAMPLES = 3;
  const BASE_DAYS = 28;
  const FORECAST_DAYS = 7;
  let meta = null;
  let chartHours = null;
  let chartHourly = null;

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
      };
    });
    return map;
  }

  function lastCompleteDay(dailyDates, lastEvent) {
    const lastDate = dailyDates[dailyDates.length - 1];
    if (K.isIncompleteDay(lastDate, lastEvent)) {
      return dailyDates[dailyDates.length - 2] || lastDate;
    }
    return lastDate;
  }

  function baseWindow(dailyDates, lastEvent, dataMin) {
    const end = lastCompleteDay(dailyDates, lastEvent);
    let start = K.addDays(end, -(BASE_DAYS - 1));
    if (K.compareDates(start, dataMin) < 0) start = dataMin;
    const dates = K.dateRangeInclusive(start, end);
    return { start, end, dates };
  }

  function valuesByWeekday(dates, dailyMap, field) {
    const byWd = [[], [], [], [], [], [], []];
    dates.forEach((date) => {
      const row = dailyMap[date];
      byWd[K.weekdayIndex(date)].push(row ? row[field] : 0);
    });
    return byWd;
  }

  function estimateForWeekday(wd, byWdHours, byWdN, allHours, allN) {
    const wdHours = byWdHours[wd];
    const wdN = byWdN[wd];
    const hoursSamples = wdHours.length >= MIN_WEEKDAY_SAMPLES ? wdHours : allHours;
    const nSamples = wdN.length >= MIN_WEEKDAY_SAMPLES ? wdN : allN;
    return {
      hours: K.mean(hoursSamples) || 0,
      hoursLo: K.percentile(hoursSamples, 10) ?? 0,
      hoursHi: K.percentile(hoursSamples, 90) ?? 0,
      n: K.mean(nSamples) || 0,
      nLo: K.percentile(nSamples, 10) ?? 0,
      nHi: K.percentile(nSamples, 90) ?? 0,
      usedWeekday: wdHours.length >= MIN_WEEKDAY_SAMPLES,
    };
  }

  function buildForecast(dailyMap, dailyDates, lastEvent) {
    const dataMin = dailyDates[0];
    const base = baseWindow(dailyDates, lastEvent, dataMin);
    const baseRows = base.dates.map((d) => dailyMap[d] || { n: 0, sum_hours: 0 });
    const allHours = baseRows.map((r) => r.sum_hours);
    const allN = baseRows.map((r) => r.n);
    const byWdHours = valuesByWeekday(base.dates, dailyMap, "sum_hours");
    const byWdN = valuesByWeekday(base.dates, dailyMap, "n");

    const anchor = K.lastEventDate(lastEvent) || base.end;
    const days = [];
    for (let i = 1; i <= FORECAST_DAYS; i++) {
      const date = K.addDays(anchor, i);
      const wd = K.weekdayIndex(date);
      const est = estimateForWeekday(wd, byWdHours, byWdN, allHours, allN);
      days.push({ date, wd, ...est });
    }
    return { base, days, allHours, allN };
  }

  function hourlyStartProbability(alerts, baseDates) {
    const dateSet = new Set(baseDates);
    const baseAlerts = alerts.filter((a) => dateSet.has(a.date));
    const dayCount = baseDates.length;
    const hourCounts = new Array(24).fill(0);
    baseAlerts.forEach((a) => {
      const h = parseInt(a.hour_start, 10);
      if (!Number.isNaN(h) && h >= 0 && h < 24) hourCounts[h] += 1;
    });
    return hourCounts.map((c) => (dayCount > 0 ? c / dayCount : 0));
  }

  function fillTable(model) {
    const tbody = document.querySelector("#forecast-table tbody");
    tbody.innerHTML = "";
    model.days.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        K.formatDayLabelLong(row.date) +
        " (" +
        K.weekdayNameUk(row.wd) +
        ")</td>" +
        '<td class="num">' +
        row.hours.toFixed(1) +
        "</td>" +
        '<td class="num">' +
        row.hoursLo.toFixed(1) +
        "–" +
        row.hoursHi.toFixed(1) +
        "</td>" +
        '<td class="num">' +
        row.n.toFixed(1) +
        "</td>" +
        '<td class="num">' +
        row.nLo.toFixed(1) +
        "–" +
        row.nHi.toFixed(1) +
        "</td>" +
        "<td>" +
        (row.usedWeekday ? "день тижня" : "загальне середнє") +
        "</td>";
      tbody.appendChild(tr);
    });
  }

  function updateMetaText(model) {
    document.getElementById("base-range").textContent =
      K.formatDayLabelLong(model.base.start) + " — " + K.formatDayLabelLong(model.base.end);
    document.getElementById("forecast-from").textContent = K.formatDayLabelLong(model.days[0].date);
    document.getElementById("forecast-to").textContent = K.formatDayLabelLong(model.days[model.days.length - 1].date);
  }

  function renderCharts(model, hourlyProb) {
    const labels = model.days.map((d) => K.formatDayLabel(d.date));
    const hours = model.days.map((d) => d.hours);
    const hoursLo = model.days.map((d) => d.hoursLo);
    const hoursHi = model.days.map((d) => d.hoursHi);

    if (chartHours) chartHours.destroy();
    const opts = JSON.parse(JSON.stringify(K.CHART_DEFAULTS));
    opts.scales.y.title = { display: true, text: "години", color: "#aaa", font: { size: 11 } };

    chartHours = new Chart(document.getElementById("chart-forecast-hours"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "діапазон 10–90%",
            data: model.days.map((d) => [d.hoursLo, d.hoursHi]),
            backgroundColor: "rgba(232, 145, 58, 0.3)",
            borderWidth: 0,
            borderRadius: 2,
            order: 2,
          },
          {
            label: "очікувані години",
            type: "line",
            data: hours,
            borderColor: "#e8913a",
            backgroundColor: "#e8913a",
            pointRadius: 4,
            pointHoverRadius: 5,
            borderWidth: 2,
            order: 1,
          },
        ],
      },
      options: {
        ...opts,
        plugins: {
          ...opts.plugins,
          tooltip: {
            ...opts.plugins.tooltip,
            callbacks: {
              label(ctx) {
                const i = ctx.dataIndex;
                if (ctx.dataset.label === "очікувані години") {
                  return "очікувано: " + hours[i].toFixed(1) + " год";
                }
                return "10–90%: " + hoursLo[i].toFixed(1) + "–" + hoursHi[i].toFixed(1) + " год";
              },
            },
          },
        },
      },
    });

    if (chartHourly) chartHourly.destroy();
    const hourLabels = [];
    for (let h = 0; h < 24; h++) hourLabels.push(String(h).padStart(2, "0"));

    chartHourly = new Chart(document.getElementById("chart-hourly-prob"), {
      type: "bar",
      data: {
        labels: hourLabels,
        datasets: [
          {
            data: hourlyProb.map((p) => +(p * 100).toFixed(1)),
            backgroundColor: "#5b9bd5",
            borderWidth: 0,
            borderRadius: 2,
          },
        ],
      },
      options: {
        ...JSON.parse(JSON.stringify(K.CHART_DEFAULTS)),
        scales: {
          ...K.CHART_DEFAULTS.scales,
          y: {
            ...K.CHART_DEFAULTS.scales.y,
            title: { display: true, text: "ймовірність, %", color: "#aaa", font: { size: 11 } },
            max: Math.max(10, ...hourlyProb.map((p) => p * 100)) * 1.2,
          },
        },
      },
    });
  }

  async function init() {
    try {
      const [metaRes, dailyRes, alertsRes] = await Promise.all([
        fetch("data/meta.json"),
        fetch("data/daily.csv"),
        fetch("data/alerts.csv"),
      ]);

      if (!metaRes.ok || !dailyRes.ok || !alertsRes.ok) {
        throw new Error("Не вдалося завантажити дані");
      }

      meta = await metaRes.json();
      const dailyRows = K.parseCSV(await dailyRes.text());
      const alerts = K.parseCSV(await alertsRes.text());
      const dailyMap = buildDailyMap(dailyRows);
      const dailyDates = dailyRows.map((r) => r.date).sort(K.compareDates);

      const model = buildForecast(dailyMap, dailyDates, meta.last_event);
      const hourlyProb = hourlyStartProbability(alerts, model.base.dates);

      document.getElementById("loading").style.display = "none";
      document.getElementById("dashboard").style.display = "block";

      if (meta.alert_open) {
        const banner = document.getElementById("alert-banner");
        banner.classList.add("visible");
        banner.textContent = "⚠ Зараз триває повітряна тривога у м. Києві";
      }

      updateMetaText(model);
      fillTable(model);
      renderCharts(model, hourlyProb);

      document.querySelector(".chart-source").textContent =
        "Джерело: Київ Цифровий • до " + meta.last_event;
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
