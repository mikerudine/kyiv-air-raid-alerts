(function () {
  "use strict";

  const K = window.KyivAlerts;
  const CACHE_BUST = K.CACHE_BUST;
  const charts = {};
  let heatChart = null;
  let allRows = [];
  let allAlerts = [];
  let geojson = null;
  let windowRaionMap = null;
  let raionList = K.OFFICIAL_RAIONS;
  let raionFilter = "all";
  let dataMin = "";
  let dataMax = "";

  const COLOR_LO = [255, 247, 188];
  const COLOR_HI = [127, 0, 0];
  const MAP_HEIGHT = 600;
  const LEGEND_TICKS = [0, 50, 100, 150, 200, 250];

  function showError(msg) {
    document.getElementById("loading").style.display = "none";
    const errEl = document.getElementById("error");
    errEl.classList.add("visible");
    errEl.textContent = "Помилка: " + msg;
  }

  function windowStartDate(row) {
    return row.window_start.slice(0, 10);
  }

  function postId(row) {
    if (row.post_id) return parseInt(row.post_id, 10);
    const url = row.post_url || "";
    const part = url.split("/").pop();
    return parseInt(part, 10);
  }

  function lerpColor(t) {
    const clamped = Math.min(1, Math.max(0, t));
    const rgb = COLOR_LO.map((v, i) => Math.round(v + (COLOR_HI[i] - v) * clamped));
    return "rgb(" + rgb.join(",") + ")";
  }

  function colorForCount(count, min, max) {
    if (max <= min) return lerpColor(0.5);
    return lerpColor((count - min) / (max - min));
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
    return { start, end };
  }

  function alertsInRange(start, end) {
    return allAlerts.filter(
      (a) => K.compareDates(a.date, start) >= 0 && K.compareDates(a.date, end) <= 0
    );
  }

  function filteredAlertsInRange(start, end) {
    return K.filterAlertsByRaion(alertsInRange(start, end), windowRaionMap, raionFilter);
  }

  function rowsInRange(start, end) {
    return allRows.filter((row) => {
      const d = windowStartDate(row);
      return K.compareDates(d, start) >= 0 && K.compareDates(d, end) <= 0;
    });
  }

  function filteredRowsInRange(start, end) {
    if (raionFilter === "none") return [];
    const allowed = new Set(filteredAlertsInRange(start, end).map(K.alertWindowKey));
    return rowsInRange(start, end).filter((row) => allowed.has(K.districtRowWindowKey(row)));
  }

  function windowKey(row) {
    return row.window_start + "|" + row.window_end;
  }

  function aggregate(rows, filteredAlerts, start, end) {
    const counts = {};
    raionList.forEach((r) => {
      counts[r] = 0;
    });
    const hour = {};
    raionList.forEach((r) => {
      hour[r] = new Array(24).fill(0);
    });

    rows.forEach((row) => {
      const raion = K.normalizeRaion(row.district);
      if (!Object.prototype.hasOwnProperty.call(counts, raion)) return;
      counts[raion] += 1;
      const h = parseInt(row.hour, 10);
      if (h >= 0 && h < 24) hour[raion][h] += 1;
    });

    const mentionedWindows = new Set(rows.map(windowKey));
    const nWindows = filteredAlerts.length;
    const sumHours = filteredAlerts.reduce((s, a) => s + (parseFloat(a.hours) || 0), 0);

    return {
      raions: raionList,
      counts,
      hour,
      n_city: rows.length,
      n_windows: nWindows,
      n_windows_with_mention: mentionedWindows.size,
      sum_hours: Math.round(sumHours * 10) / 10,
      coverage_pct:
        nWindows > 0 ? Math.round((mentionedWindows.size / nWindows) * 1000) / 10 : 0,
      date_range: [start, end],
    };
  }

  function formatCombinationLabel(districts) {
    if (districts.length === raionList.length) return "усі 10 районів";
    return districts.join(" + ");
  }

  function computeCombinations(rows) {
    const byWindow = {};
    rows.forEach((row) => {
      const key = windowKey(row);
      if (!byWindow[key]) byWindow[key] = new Set();
      const raion = K.normalizeRaion(row.district);
      if (raionList.indexOf(raion) >= 0) byWindow[key].add(raion);
    });

    const comboCounts = {};
    Object.keys(byWindow).forEach((key) => {
      const set = byWindow[key];
      if (set.size === 0) return;
      const sorted = [...set].sort();
      const comboKey = sorted.join("\0");
      if (!comboCounts[comboKey]) {
        comboCounts[comboKey] = { districts: sorted, count: 0 };
      }
      comboCounts[comboKey].count += 1;
    });

    const entries = Object.keys(comboCounts).map((k) => comboCounts[k]);
    const totalWindows = entries.reduce((sum, e) => sum + e.count, 0);

    entries.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.districts.length !== b.districts.length) return a.districts.length - b.districts.length;
      return formatCombinationLabel(a.districts).localeCompare(
        formatCombinationLabel(b.districts),
        "uk"
      );
    });

    const size1Windows = entries
      .filter((e) => e.districts.length === 1)
      .reduce((sum, e) => sum + e.count, 0);

    return {
      entries,
      totalWindows,
      uniqueTypes: entries.length,
      size1Windows,
    };
  }

  function computeToponyms(rows) {
    const raionWindows = {};
    const termWindows = {};

    rows.forEach((row) => {
      const raion = K.normalizeRaion(row.district);
      if (raionList.indexOf(raion) < 0) return;
      const pair = K.districtWindowPairKey(row);
      const term = row.matched_term;
      if (!raionWindows[raion]) raionWindows[raion] = new Set();
      raionWindows[raion].add(pair);
      const key = term + "\0" + raion;
      if (!termWindows[key]) termWindows[key] = new Set();
      termWindows[key].add(pair);
    });

    const entries = [];
    Object.keys(termWindows).forEach((key) => {
      const splitAt = key.indexOf("\0");
      const term = key.slice(0, splitAt);
      const raion = key.slice(splitAt + 1);
      if (raionFilter !== "all" && raion !== raionFilter) return;
      const windows = termWindows[key].size;
      const denom = raionWindows[raion] ? raionWindows[raion].size : 0;
      if (windows < 1 || denom < 1) return;
      entries.push({
        term,
        raion,
        windows,
        denom,
        share: Math.round((windows / denom) * 1000) / 10,
      });
    });

    entries.sort((a, b) => {
      if (b.windows !== a.windows) return b.windows - a.windows;
      if (b.share !== a.share) return b.share - a.share;
      return a.term.localeCompare(b.term, "uk");
    });

    return entries;
  }

  function fillCombinationsTable(combos) {
    const tbody = document.querySelector("#combos-table tbody");
    tbody.innerHTML = "";
    if (raionFilter === "none") return;
    const total = combos.totalWindows;
    combos.entries.slice(0, 15).forEach((entry) => {
      const pct = total > 0 ? Math.round((entry.count / total) * 1000) / 10 : 0;
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        formatCombinationLabel(entry.districts) +
        '</td><td class="num">' +
        entry.districts.length +
        '</td><td class="num">' +
        entry.count +
        '</td><td class="num">' +
        pct +
        "%</td>";
      tbody.appendChild(tr);
    });
    document.getElementById("combos-caption").textContent =
      combos.uniqueTypes +
      " унікальних поєднань · " +
      combos.size1Windows +
      " вікон лише з 1 районом";
  }

  function fillToponymsTable(entries) {
    const tbody = document.querySelector("#toponyms-table tbody");
    const tableWrap = document.getElementById("toponyms-table-wrap");
    const captionEl = document.getElementById("toponyms-caption");
    const emptyEl = document.getElementById("toponyms-empty");
    tbody.innerHTML = "";

    if (raionFilter === "none") {
      tableWrap.hidden = true;
      captionEl.textContent = "";
      emptyEl.hidden = false;
      emptyEl.textContent =
        "Для «не указано» немає міських згадок @kievreal1 — таблиця топонімів порожня.";
      return;
    }

    tableWrap.hidden = false;
    emptyEl.hidden = true;

    entries.forEach((entry) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        entry.term +
        "</td><td>" +
        entry.raion +
        '</td><td class="num">' +
        entry.windows +
        '</td><td class="num">' +
        entry.share +
        "%</td>";
      tbody.appendChild(tr);
    });

    if (entries.length > 0) {
      const top = entries[0];
      captionEl.textContent =
        top.term +
        ": " +
        top.windows +
        "/" +
        top.denom +
        " вікон " +
        top.raion +
        " (" +
        top.share +
        "%).";
    } else {
      captionEl.textContent = "";
    }
  }

  function computeFirstLast(rows) {
    const byWindow = {};
    rows.forEach((row) => {
      const key = windowKey(row);
      if (!byWindow[key]) byWindow[key] = [];
      byWindow[key].push(row);
    });

    const first = {};
    const last = {};
    raionList.forEach((r) => {
      first[r] = 0;
      last[r] = 0;
    });

    let nWindows = 0;
    Object.keys(byWindow).forEach((key) => {
      const windowRows = byWindow[key];
      const posts = {};
      windowRows.forEach((row) => {
        const pid = postId(row);
        if (!posts[pid]) posts[pid] = new Set();
        posts[pid].add(K.normalizeRaion(row.district));
      });
      const pids = Object.keys(posts).map(Number);
      if (pids.length === 0) return;
      nWindows += 1;
      const minPid = Math.min.apply(null, pids);
      const maxPid = Math.max.apply(null, pids);
      posts[minPid].forEach((d) => {
        first[d] = (first[d] || 0) + 1;
      });
      posts[maxPid].forEach((d) => {
        last[d] = (last[d] || 0) + 1;
      });
    });

    return { first, last, nWindows };
  }

  function sortedRaionsByCounts(counts) {
    return [...raionList].sort((a, b) => counts[b] - counts[a]);
  }

  function updateKPIs(data) {
    document.getElementById("kpi-mentions").textContent = data.n_city;
    if (raionFilter === "none") {
      document.getElementById("kpi-coverage").textContent =
        data.n_windows + " вікон · " + data.sum_hours + " год";
    } else {
      document.getElementById("kpi-coverage").textContent =
        data.n_windows_with_mention +
        " / " +
        data.n_windows +
        " (" +
        data.coverage_pct +
        "%)";
    }
    document.getElementById("kpi-range").textContent =
      data.date_range[0] + " — " + data.date_range[1];
    document.getElementById("period-caption").textContent = formatRangeCaption(
      data.date_range[0],
      data.date_range[1]
    );
  }

  function updateRangeCaption(start, end) {
    document.getElementById("range-caption").textContent =
      "Період (window_start): " + K.formatDayLabelLong(start) + " — " + K.formatDayLabelLong(end);
  }

  function fillTable(data) {
    const tbody = document.querySelector("#districts-table tbody");
    tbody.innerHTML = "";
    if (raionFilter === "none") return;
    sortedRaionsByCounts(data.counts).forEach((raion) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + raion + '</td><td class="num">' + data.counts[raion] + "</td>";
      tbody.appendChild(tr);
    });
  }

  function iterRings(geometry, fn) {
    if (geometry.type === "Polygon") {
      geometry.coordinates.forEach(fn);
    } else if (geometry.type === "MultiPolygon") {
      geometry.coordinates.forEach((poly) => poly.forEach(fn));
    }
  }

  function collectBounds(geo) {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    geo.features.forEach((feature) => {
      iterRings(feature.geometry, (ring) => {
        ring.forEach(([lon, lat]) => {
          minLon = Math.min(minLon, lon);
          maxLon = Math.max(maxLon, lon);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        });
      });
    });
    return { minLon, maxLon, minLat, maxLat };
  }

  function makeProjector(bounds, width, height, pad) {
    const spanLon = bounds.maxLon - bounds.minLon || 1;
    const spanLat = bounds.maxLat - bounds.minLat || 1;
    const innerW = width - pad * 2;
    const innerH = height - pad * 2;
    const scale = Math.min(innerW / spanLon, innerH / spanLat);
    const usedW = spanLon * scale;
    const usedH = spanLat * scale;
    const offsetX = pad + (innerW - usedW) / 2;
    const offsetY = pad + (innerH - usedH) / 2;
    return function project([lon, lat]) {
      return [
        offsetX + (lon - bounds.minLon) * scale,
        offsetY + (bounds.maxLat - lat) * scale,
      ];
    };
  }

  function ringToPath(ring, project) {
    return (
      ring
        .map((pt, i) => {
          const [x, y] = project(pt);
          return (i === 0 ? "M" : "L") + x.toFixed(2) + "," + y.toFixed(2);
        })
        .join(" ") + " Z"
    );
  }

  function featureToPath(feature, project) {
    const parts = [];
    iterRings(feature.geometry, (ring) => {
      parts.push(ringToPath(ring, project));
    });
    return parts.join(" ");
  }

  function ringArea(ring) {
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return Math.abs(area / 2);
  }

  function ringCentroid(ring) {
    let cx = 0;
    let cy = 0;
    let area = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const cross = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      cx += (ring[i][0] + ring[i + 1][0]) * cross;
      cy += (ring[i][1] + ring[i + 1][1]) * cross;
      area += cross;
    }
    area *= 0.5;
    if (Math.abs(area) < 1e-12) {
      const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      return [lon, lat];
    }
    return [cx / (6 * area), cy / (6 * area)];
  }

  function featureCentroid(feature) {
    let bestRing = null;
    let bestArea = -1;
    iterRings(feature.geometry, (ring) => {
      const area = ringArea(ring);
      if (area > bestArea) {
        bestArea = area;
        bestRing = ring;
      }
    });
    return bestRing ? ringCentroid(bestRing) : [0, 0];
  }

  function buildLegend() {
    const el = document.getElementById("map-legend");
    el.innerHTML = "";

    const bar = document.createElement("div");
    bar.className = "legend-bar legend-bar-vertical map-legend-bar";
    for (let i = 20; i >= 0; i--) {
      const seg = document.createElement("span");
      seg.style.background = lerpColor(i / 20);
      bar.appendChild(seg);
    }
    el.appendChild(bar);

    const labels = document.createElement("div");
    labels.className = "legend-labels legend-labels-vertical map-legend-labels";
    LEGEND_TICKS.slice()
      .reverse()
      .forEach((tick) => {
        const span = document.createElement("span");
        span.textContent = String(tick);
        labels.appendChild(span);
      });
    el.appendChild(labels);

    const cap = document.createElement("div");
    cap.className = "legend-caption map-legend-caption";
    cap.textContent = "згадок району в постах під час тривоги";
    el.appendChild(cap);
  }

  function initChoropleth(data) {
    const svg = document.getElementById("districts-map");
    svg.innerHTML = "";

    if (raionFilter === "none") {
      document.getElementById("map-legend").innerHTML = "";
      return;
    }

    const counts = data.counts;
    const values = Object.values(counts);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const bounds = collectBounds(geojson);
    const width = 920;
    const height = MAP_HEIGHT;
    const pad = 24;

    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    const project = makeProjector(bounds, width, height, pad);
    const raionsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    raionsGroup.setAttribute("class", "raions-layer");
    const labelsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    labelsGroup.setAttribute("class", "labels-layer");

    geojson.features.forEach((feature) => {
      const key = K.normalizeRaion(feature.properties.name);
      const count = counts[key] ?? 0;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", featureToPath(feature, project));
      path.setAttribute("fill", colorForCount(count, min, max));
      path.setAttribute("stroke", "#1a1a1a");
      path.setAttribute("stroke-width", "1.2");
      path.setAttribute("fill-rule", "evenodd");
      path.setAttribute("data-raion", key);
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent = key + ": " + count + " згадок";
      path.appendChild(title);
      raionsGroup.appendChild(path);

      const [lon, lat] = featureCentroid(feature);
      const [x, y] = project([lon, lat]);
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", x.toFixed(2));
      label.setAttribute("y", y.toFixed(2));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("class", "raion-svg-label");
      label.innerHTML =
        '<tspan x="' +
        x.toFixed(2) +
        '" dy="-0.35em">' +
        key +
        '</tspan><tspan x="' +
        x.toFixed(2) +
        '" dy="1.2em">' +
        count +
        "</tspan>";
      labelsGroup.appendChild(label);
    });

    svg.appendChild(raionsGroup);
    svg.appendChild(labelsGroup);
    buildLegend();
  }

  function heatColor(value, maxVal) {
    if (maxVal <= 0) return "rgba(255,247,188,0.15)";
    const t = value / maxVal;
    const rgb = lerpColor(Math.min(1, t))
      .match(/\d+/g)
      .map(Number);
    return "rgba(" + rgb.join(",") + ",0.95)";
  }

  function initHeatmap(data) {
    const legendEl = document.getElementById("heatmap-legend");
    if (heatChart) {
      heatChart.destroy();
      heatChart = null;
    }

    if (raionFilter === "none") {
      legendEl.innerHTML = "";
      return;
    }

    const raions = sortedRaionsByCounts(data.counts);

    let maxVal = 0;
    raions.forEach((raion) => {
      data.hour[raion].forEach((v) => {
        if (v > maxVal) maxVal = v;
      });
    });

    const matrixData = [];
    raions.forEach((raion, y) => {
      data.hour[raion].forEach((v, x) => {
        matrixData.push({ x, y, v, raion, hour: x });
      });
    });

    const canvas = document.getElementById("chart-heatmap");
    heatChart = new Chart(canvas, {
      type: "matrix",
      data: {
        datasets: [
          {
            label: "згадок",
            data: matrixData,
            backgroundColor(ctx) {
              return heatColor(ctx.raw.v, maxVal);
            },
            borderColor: "rgba(0,0,0,0.35)",
            borderWidth: 1,
            width: ({ chart }) => (chart.chartArea || {}).width / 24 - 1 || 12,
            height: ({ chart }) => (chart.chartArea || {}).height / raions.length - 1 || 18,
          },
        ],
      },
      options: {
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
            callbacks: {
              title(items) {
                const raw = items[0].raw;
                return raw.raion + ", " + String(raw.hour).padStart(2, "0") + ":00";
              },
              label(item) {
                return "згадок: " + item.raw.v;
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            offset: true,
            min: -0.5,
            max: 23.5,
            ticks: {
              stepSize: 1,
              color: "#aaa",
              font: { size: 10 },
              callback(v) {
                return String(v).padStart(2, "0");
              },
            },
            title: {
              display: true,
              text: "година (Europe/Kyiv)",
              color: "#aaa",
              font: { size: 11 },
            },
            grid: { display: false },
          },
          y: {
            type: "linear",
            offset: true,
            min: -0.5,
            max: raions.length - 0.5,
            ticks: {
              stepSize: 1,
              color: "#aaa",
              font: { size: 10 },
              callback(v) {
                return raions[v] || "";
              },
            },
            grid: { display: false },
          },
        },
      },
    });

    legendEl.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "legend-bar legend-bar-vertical";
    for (let i = 0; i <= 20; i++) {
      const seg = document.createElement("span");
      seg.style.background = heatColor(Math.round((maxVal * i) / 20), maxVal);
      bar.appendChild(seg);
    }
    legendEl.appendChild(bar);
    const labels = document.createElement("div");
    labels.className = "legend-labels legend-labels-vertical";
    labels.innerHTML = "<span>" + maxVal + "+</span><span>0</span>";
    legendEl.appendChild(labels);
    const cap = document.createElement("div");
    cap.className = "legend-caption";
    cap.textContent = "згадок";
    legendEl.appendChild(cap);
  }

  function destroyBarCharts() {
    ["chart-first", "chart-last"].forEach((id) => {
      if (charts[id]) {
        charts[id].destroy();
        delete charts[id];
      }
    });
  }

  function makeHBarChart(canvasId, counts, color) {
    const sorted = sortedRaionsByCounts(counts).filter((r) => counts[r] > 0);
    const labels = sorted;
    const values = sorted.map((r) => counts[r]);

    const opts = JSON.parse(JSON.stringify(K.CHART_DEFAULTS));
    opts.indexAxis = "y";
    opts.scales.x.beginAtZero = true;
    opts.scales.x.ticks.color = "#aaa";
    opts.scales.y.ticks.color = "#aaa";
    opts.scales.y.grid = { display: false };
    opts.scales.x.grid = { color: "rgba(255,255,255,0.06)" };

    charts[canvasId] = new Chart(document.getElementById(canvasId), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: color,
            borderWidth: 0,
            borderRadius: 2,
          },
        ],
      },
      options: opts,
      plugins: [K.valueLabelsPlugin()],
    });
  }

  function initFirstLastCharts(firstLast) {
    destroyBarCharts();
    if (raionFilter === "none") return;
    makeHBarChart("chart-first", firstLast.first, "#5b9bd5");
    makeHBarChart("chart-last", firstLast.last, "#c45c4a");
  }

  function renderDashboard() {
    const { start, end } = getRangeValues();
    const filteredAlerts = filteredAlertsInRange(start, end);
    const rows = filteredRowsInRange(start, end);
    const data = aggregate(rows, filteredAlerts, start, end);
    const firstLast = computeFirstLast(rows);
    const combos = computeCombinations(rows);
    const toponyms = computeToponyms(rows);

    updateKPIs(data);
    updateRangeCaption(start, end);
    fillTable(data);
    fillCombinationsTable(combos);
    fillToponymsTable(toponyms);
    initChoropleth(data);

    try {
      initHeatmap(data);
    } catch (err) {
      console.error("Heatmap chart failed:", err);
    }

    try {
      initFirstLastCharts(firstLast);
    } catch (err) {
      console.error("First/last charts failed:", err);
    }
  }

  function setPresetActive(activeId) {
    document.querySelectorAll(".preset-btn").forEach((btn) => {
      btn.classList.toggle("preset-active", Boolean(activeId) && btn.id === activeId);
    });
  }

  function applyPreset(days, presetId) {
    const end = dataMax;
    const start = K.clampDate(K.addDays(end, -(days - 1)), dataMin, dataMax);
    document.getElementById("date-from").value = start;
    document.getElementById("date-to").value = end;
    setPresetActive(presetId);
    renderDashboard();
  }

  function applyYTD() {
    const year = dataMax.slice(0, 4);
    const start = K.clampDate(year + "-01-01", dataMin, dataMax);
    document.getElementById("date-from").value = start;
    document.getElementById("date-to").value = dataMax;
    setPresetActive("preset-ytd");
    renderDashboard();
  }

  function onDateInputChange() {
    setPresetActive(null);
    renderDashboard();
  }

  function bindControls() {
    document.getElementById("date-from").addEventListener("change", onDateInputChange);
    document.getElementById("date-to").addEventListener("change", onDateInputChange);
    document.getElementById("preset-7").addEventListener("click", () => applyPreset(7, "preset-7"));
    document.getElementById("preset-28").addEventListener("click", () => applyPreset(28, "preset-28"));
    document.getElementById("preset-90").addEventListener("click", () => applyPreset(90, "preset-90"));
    document.getElementById("preset-ytd").addEventListener("click", applyYTD);
  }

  function buildAlertDates(alerts) {
    return alerts.filter((a) => a.date.startsWith("2026"));
  }

  async function init() {
    try {
      const [csvRes, geoRes, alertsRes] = await Promise.all([
        fetch("data/districts.csv?v=" + CACHE_BUST),
        fetch("data/kyiv-raions.geojson?v=" + CACHE_BUST),
        fetch("data/alerts.csv?v=" + CACHE_BUST),
      ]);

      if (!csvRes.ok || !geoRes.ok || !alertsRes.ok) {
        throw new Error("Не вдалося завантажити дані");
      }

      const csvText = await csvRes.text();
      if (!csvText.trim()) {
        throw new Error("data/districts.csv порожній — потрібен валідний файл даних");
      }

      allRows = K.parseCSV(csvText);
      geojson = await geoRes.json();
      allAlerts = buildAlertDates(K.parseCSV(await alertsRes.text()));
      windowRaionMap = K.buildWindowRaionMap(allRows);

      const windowDates = [...new Set(allRows.map(windowStartDate))].sort(K.compareDates);
      const alertDates = [...new Set(allAlerts.map((a) => a.date))].sort(K.compareDates);

      dataMin = windowDates[0] || alertDates[0];
      dataMax = windowDates[windowDates.length - 1] || alertDates[alertDates.length - 1];

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

      K.initNavLinks();
      K.mountRaionFilter(document.getElementById("raion-filter-root"), {
        onChange(value) {
          raionFilter = value;
          renderDashboard();
        },
      });
      raionFilter = K.getRaionFilter();

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
