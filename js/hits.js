(function () {
  "use strict";

  const K = window.KyivAlerts;
  const raionList = K.OFFICIAL_RAIONS;
  let hitsChart = null;
  let dataMin = "";
  let dataMax = "";
  let hitsMeta = null;
  let lastStats = [];
  let sortKey = "hit_rate";
  let sortDir = -1;

  let weaponFilter = "all";
  let impactOnly = false;

  function showError(msg) {
    document.getElementById("loading").style.display = "none";
    const errEl = document.getElementById("error");
    errEl.classList.add("visible");
    errEl.textContent = "Помилка: " + msg;
  }

  function formatRangeCaption(start, end) {
    const months = [
      "січень",
      "лютий",
      "березень",
      "квітень",
      "травень",
      "червень",
      "липень",
      "серпень",
      "вересень",
      "жовтень",
      "листопад",
      "грудень",
    ];
    const s = K.parseDate(start);
    const e = K.parseDate(end);
    if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
      return months[s.getMonth()] + " " + s.getFullYear();
    }
    return K.formatDayLabelLong(start) + " — " + K.formatDayLabelLong(end);
  }

  function defaultRange() {
    const end = dataMax;
    const start = K.clampDate(K.addDays(end, -27), dataMin, dataMax);
    return { start, end };
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
    syncFilterParams();
    return { start, end };
  }

  function readFilterParams() {
    const params = new URLSearchParams(window.location.search);
    weaponFilter = params.get("weapon") === "drone" ? "drone" : "all";
    impactOnly = params.get("impact") === "1";
  }

  function syncFilterParams() {
    const updates = { weapon: weaponFilter === "drone" ? "drone" : null, impact: impactOnly ? "1" : null };
    K.syncQueryParams(updates);
    K.initNavLinks();
  }

  function applyFilterUi() {
    document.getElementById("weapon-all").classList.toggle("preset-active", weaponFilter === "all");
    document.getElementById("weapon-drone").classList.toggle("preset-active", weaponFilter === "drone");
    document.getElementById("impact-only").checked = impactOnly;
  }

  function statsByRaion(rows) {
    const map = {};
    rows.forEach((row) => {
      map[K.normalizeRaion(row.district)] = row;
    });
    return map;
  }

  function orderedStats(rows) {
    const byRaion = statsByRaion(rows);
    return raionList.map((r) => byRaion[r]).filter(Boolean);
  }

  function sortStats(rows) {
    const copy = rows.slice();
    copy.sort((a, b) => {
      let av = a[sortKey];
      let bv = b[sortKey];
      if (sortKey === "district") {
        av = a.district;
        bv = b.district;
        return sortDir * av.localeCompare(bv, "uk");
      }
      av = Number(av) || 0;
      bv = Number(bv) || 0;
      if (av !== bv) return sortDir * (av - bv);
      return a.district.localeCompare(b.district, "uk");
    });
    return copy;
  }

  function formatPct(rate) {
    if (rate == null || Number.isNaN(rate)) return "—";
    return (Math.round(Number(rate) * 1000) / 10).toFixed(1) + "%";
  }

  function shortRaionLabel(name) {
    if (!K.isNarrowViewport()) return name;
    const short = {
      Голосіївський: "Голосіїв.",
      Дарницький: "Дарниц.",
      Деснянський: "Деснян.",
      Дніпровський: "Дніпр.",
      Оболонський: "Обол.",
      Печерський: "Печер.",
      Подільський: "Поділ.",
      Святошинський: "Свят.",
      "Солом'янський": "Солом.",
      Шевченківський: "Шевч.",
    };
    return short[name] || name.replace("ський", ".");
  }

  function destroyRadarChart() {
    if (hitsChart) {
      hitsChart.destroy();
      hitsChart = null;
    }
  }

  function initRadarChart(rows) {
    destroyRadarChart();
    const ordered = orderedStats(rows);
    const labels = ordered.map((r) => shortRaionLabel(r.district));
    const mentioned = ordered.map((r) => r.windows_mentioned);
    const hit = ordered.map((r) => r.windows_hit);

    const opts = JSON.parse(JSON.stringify(K.CHART_DEFAULTS));
    opts.plugins.legend = {
      display: true,
      position: K.isNarrowViewport() ? "bottom" : "top",
      labels: { color: "#aaa", font: { size: 11 }, boxWidth: 14, padding: 10 },
    };
    opts.scales = {
      r: {
        beginAtZero: true,
        ticks: { color: "#888", backdropColor: "transparent", font: { size: 9 } },
        grid: { color: "rgba(255,255,255,0.08)" },
        angleLines: { color: "rgba(255,255,255,0.12)" },
        pointLabels: {
          color: "#ccc",
          font: { size: K.isNarrowViewport() ? 8 : 10 },
        },
      },
    };
    opts.elements = { line: { borderWidth: 2 }, point: { radius: K.isNarrowViewport() ? 2 : 3 } };

    hitsChart = new Chart(document.getElementById("chart-hits-radar"), {
      type: "radar",
      data: {
        labels,
        datasets: [
          {
            label: "вікон із згадкою району",
            data: mentioned,
            borderColor: "#5b9bd5",
            backgroundColor: "rgba(91, 155, 213, 0.15)",
            pointBackgroundColor: "#5b9bd5",
          },
          {
            label: "вікон з ураженням (Кличко)",
            data: hit,
            borderColor: "#e8913a",
            backgroundColor: "rgba(232, 145, 58, 0.12)",
            pointBackgroundColor: "#e8913a",
          },
        ],
      },
      options: opts,
    });
  }

  function fillTable(rows) {
    const sorted = sortStats(rows);
    const tbody = document.querySelector("#hits-table tbody");
    tbody.innerHTML = "";
    sorted.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        row.district +
        '</td><td class="num">' +
        row.windows_mentioned +
        '</td><td class="num">' +
        row.windows_hit +
        '</td><td class="num">' +
        row.windows_hit_and_mentioned +
        '</td><td class="num">' +
        row.windows_hit_not_mentioned +
        '</td><td class="num">' +
        formatPct(row.hit_rate) +
        "</td>";
      tbody.appendChild(tr);
    });
    updateSortHeaders();
  }

  function updateSortHeaders() {
    document.querySelectorAll("#hits-table th[data-sort]").forEach((th) => {
      const key = th.getAttribute("data-sort");
      let label = th.getAttribute("data-label") || th.textContent.replace(/[\s↑↓]+$/, "");
      th.setAttribute("data-label", label);
      if (key === sortKey) {
        label += sortDir < 0 ? " ↓" : " ↑";
      }
      th.textContent = label;
    });
  }

  function bindSortHeaders() {
    document.querySelectorAll("#hits-table th[data-sort]").forEach((th) => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const key = th.getAttribute("data-sort");
        if (sortKey === key) sortDir = -sortDir;
        else {
          sortKey = key;
          sortDir = key === "district" ? 1 : -1;
        }
        fillTable(lastStats);
      });
    });
  }

  function updateFreshnessNote() {
    const el = document.getElementById("hits-source-note");
    if (!hitsMeta) {
      el.textContent = "";
      return;
    }
    const lagH = hitsMeta.lag_minutes != null ? Math.round(hitsMeta.lag_minutes / 60) : 5;
    el.innerHTML =
      "Джерело уражень і уламків: офіційний канал " +
      '<a href="https://t.me/vitaliy_klitschko" target="_blank" rel="noopener">@vitaliy_klitschko</a> ' +
      "(місто Київ). Згадки районів — ті самі офіційні вікна KMDA, що й на сторінці «Райони» (@kievreal1). " +
      "Ураження прив’язуються до вікна тривоги, якщо пост опубліковано під час нього або до " +
      lagH +
      " год після закриття (і до наступного вікна). " +
      "Останній пост у даних: <strong>" +
      (hitsMeta.last_post_time_display || "—") +
      "</strong> · оновлено " +
      (hitsMeta.scraped_at || "—") +
      ".";
  }

  function updateRangeCaption(start, end) {
    document.getElementById("range-caption").textContent =
      "Період (window_start): " + K.formatDayLabelLong(start) + " — " + K.formatDayLabelLong(end);
    document.getElementById("period-caption").textContent = formatRangeCaption(start, end);
    const weaponLabel = weaponFilter === "drone" ? "лише БпЛА (drone/mixed)" : "усі засоби";
    const impactLabel = impactOnly ? "лише фізичні ураження" : "усі типи постів";
    document.getElementById("filter-caption").textContent =
      "Зброя: " + weaponLabel + " · " + impactLabel;
  }

  async function renderDashboard() {
    const { start, end } = getRangeValues();
    updateRangeCaption(start, end);
    const rows = await K.fetchHitsRaionStats(start, end, weaponFilter, impactOnly);
    lastStats = orderedStats(rows);
    fillTable(lastStats);
    try {
      initRadarChart(lastStats);
    } catch (err) {
      console.error("Radar chart failed:", err);
    }
  }

  function setPresetActive(activeId) {
    document.querySelectorAll(".date-controls .preset-btn").forEach((btn) => {
      btn.classList.toggle("preset-active", Boolean(activeId) && btn.id === activeId);
    });
  }

  function applyPreset(days, presetId) {
    const end = dataMax;
    const start = K.clampDate(K.addDays(end, -(days - 1)), dataMin, dataMax);
    document.getElementById("date-from").value = start;
    document.getElementById("date-to").value = end;
    setPresetActive(presetId);
    renderDashboard().catch(showError);
  }

  function applyYTD() {
    const year = dataMax.slice(0, 4);
    const start = K.clampDate(year + "-01-01", dataMin, dataMax);
    document.getElementById("date-from").value = start;
    document.getElementById("date-to").value = dataMax;
    setPresetActive("preset-ytd");
    renderDashboard().catch(showError);
  }

  function onDateInputChange() {
    setPresetActive(null);
    renderDashboard().catch(showError);
  }

  function bindControls() {
    document.getElementById("date-from").addEventListener("change", onDateInputChange);
    document.getElementById("date-to").addEventListener("change", onDateInputChange);
    document.getElementById("preset-7").addEventListener("click", () => applyPreset(7, "preset-7"));
    document.getElementById("preset-28").addEventListener("click", () => applyPreset(28, "preset-28"));
    document.getElementById("preset-90").addEventListener("click", () => applyPreset(90, "preset-90"));
    document.getElementById("preset-ytd").addEventListener("click", applyYTD);

    document.getElementById("weapon-all").addEventListener("click", () => {
      weaponFilter = "all";
      applyFilterUi();
      syncFilterParams();
      renderDashboard().catch(showError);
    });
    document.getElementById("weapon-drone").addEventListener("click", () => {
      weaponFilter = "drone";
      applyFilterUi();
      syncFilterParams();
      renderDashboard().catch(showError);
    });
    document.getElementById("impact-only").addEventListener("change", (e) => {
      impactOnly = e.target.checked;
      syncFilterParams();
      renderDashboard().catch(showError);
    });

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (lastStats.length) initRadarChart(lastStats);
      }, 200);
    });
  }

  async function init() {
    try {
      readFilterParams();
      const [meta, alertsData] = await Promise.all([K.fetchHitsMeta(), K.fetchTable("alerts")]);
      hitsMeta = meta;
      updateFreshnessNote();

      const alertDates = [...new Set(alertsData.filter((a) => a.date.startsWith("2026")).map((a) => a.date))].sort(
        K.compareDates
      );
      dataMin = meta.scraped_from || alertDates[0] || "2026-01-01";
      dataMax = alertDates[alertDates.length - 1] || dataMin;
      if (K.compareDates(dataMax, hitsMeta.last_post_time.slice(0, 10)) < 0 && hitsMeta.last_post_time) {
        dataMax = K.clampDate(hitsMeta.last_post_time.slice(0, 10), dataMin, "2099-12-31");
      }

      const urlRange = K.readDateParams(dataMin, dataMax);
      const def = urlRange || defaultRange();
      document.getElementById("date-from").min = dataMin;
      document.getElementById("date-from").max = dataMax;
      document.getElementById("date-to").min = dataMin;
      document.getElementById("date-to").max = dataMax;
      document.getElementById("date-from").value = def.start;
      document.getElementById("date-to").value = def.end;

      applyFilterUi();
      bindSortHeaders();
      bindControls();

      document.getElementById("loading").style.display = "none";
      document.getElementById("dashboard").style.display = "block";

      K.initNavLinks();
      await renderDashboard();
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
