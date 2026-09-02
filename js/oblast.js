(function () {
  "use strict";

  const K = window.KyivAlerts;
  const CACHE_BUST = K.CACHE_BUST;
  const CITY_RAIONS = K.OFFICIAL_RAIONS;
  const OBLAST_RAIONS = [
    "Білоцерківський",
    "Бориспільський",
    "Броварський",
    "Бучанський",
    "Вишгородський",
    "Обухівський",
    "Фастівський",
  ];

  const charts = {};
  let heatChart = null;
  let cityRows = [];
  let cityAlerts = [];
  let oblastRows = [];
  let oblastAlerts = [];
  let cityGeo = null;
  let oblastGeo = null;
  let oblastMeta = null;
  let cityWindowRaionMap = null;
  let oblastWindowRaionMap = null;
  let raionFilter = "all";
  let dataMin = "";
  let dataMax = "";

  const COLOR_LO = [255, 247, 188];
  const COLOR_HI = [127, 0, 0];
  const MAP_HEIGHT = 600;
  const LEGEND_TICKS = [0, 50, 100, 150, 200, 250];

  const FILTER_NOTE =
    "Не офіційний продукт KMDA. Фільтр лишає дані обраного району (місто або область), або обласні вікна без жодної обласної згадки («не указано»).";

  function showError(msg) {
    document.getElementById("loading").style.display = "none";
    const errEl = document.getElementById("error");
    errEl.classList.add("visible");
    errEl.textContent = "Помилка: " + msg;
  }

  function isCityRaion(value) {
    return CITY_RAIONS.indexOf(value) >= 0;
  }

  function isOblastRaion(value) {
    return OBLAST_RAIONS.indexOf(value) >= 0;
  }

  function resolveCombinedRaionParam(raw) {
    if (!raw || raw === "all") return "all";
    if (raw === "none") return "none";
    const decoded = decodeURIComponent(raw);
    if (isCityRaion(decoded) || isOblastRaion(decoded)) return decoded;
    return "all";
  }

  function getCombinedRaionFilter() {
    const params = new URLSearchParams(window.location.search);
    return resolveCombinedRaionParam(params.get("raion"));
  }

  function filterMode() {
    if (raionFilter === "all") {
      return { showCity: true, showOblast: true, showNoneMeta: true };
    }
    if (raionFilter === "none") {
      return { showCity: false, showOblast: false, showNoneMeta: true };
    }
    if (isCityRaion(raionFilter)) {
      return { showCity: true, showOblast: false, showNoneMeta: false };
    }
    if (isOblastRaion(raionFilter)) {
      return { showCity: false, showOblast: true, showNoneMeta: false };
    }
    return { showCity: true, showOblast: true, showNoneMeta: true };
  }

  function windowStartDateFromISO(iso) {
    return iso.slice(0, 10);
  }

  function cityRowDate(row) {
    return windowStartDateFromISO(row.window_start);
  }

  function oblastRowDate(row) {
    return windowStartDateFromISO(row.window_start);
  }

  function postId(row) {
    if (row.post_id) return parseInt(row.post_id, 10);
    const url = row.post_url || "";
    return parseInt(url.split("/").pop(), 10);
  }

  function oblastWindowKeyFromAlert(alert) {
    return alert.date + "|" + alert.hour_start + "|" + alert.hour_end + "|" + alert.hours;
  }

  function oblastWindowKeyFromRow(row) {
    return (
      row.date +
      "|" +
      row.hour_start +
      "|" +
      row.hour_end +
      "|" +
      row.hours
    );
  }

  function oblastWindowPairKey(row) {
    return row.window_start + "|" + row.window_end;
  }

  function buildOblastWindowRaionMap(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const raion = K.normalizeRaion(row.district);
      if (OBLAST_RAIONS.indexOf(raion) < 0) return;
      const key = oblastWindowKeyFromRow(row);
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(raion);
    });
    return map;
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

  function cityAlertsInRange(start, end) {
    return cityAlerts.filter(
      (a) => K.compareDates(a.date, start) >= 0 && K.compareDates(a.date, end) <= 0
    );
  }

  function oblastAlertsInRange(start, end) {
    return oblastAlerts.filter(
      (a) => K.compareDates(a.date, start) >= 0 && K.compareDates(a.date, end) <= 0
    );
  }

  function filteredCityAlerts(start, end) {
    const alerts = cityAlertsInRange(start, end);
    if (!filterMode().showCity) return [];
    if (raionFilter === "all" || raionFilter === "none") return alerts;
    if (isCityRaion(raionFilter)) {
      return K.filterAlertsByRaion(alerts, cityWindowRaionMap, raionFilter);
    }
    return [];
  }

  function filteredOblastAlerts(start, end) {
    const alerts = oblastAlertsInRange(start, end);
    if (raionFilter === "none") {
      return alerts.filter((a) => !oblastWindowRaionMap.has(oblastWindowKeyFromAlert(a)));
    }
    if (!filterMode().showOblast) return [];
    if (raionFilter === "all") return alerts;
    if (isOblastRaion(raionFilter)) {
      return alerts.filter((a) => {
        const raions = oblastWindowRaionMap.get(oblastWindowKeyFromAlert(a));
        return raions && raions.has(raionFilter);
      });
    }
    return [];
  }

  function cityRowsInRange(start, end) {
    return cityRows.filter((row) => {
      const d = cityRowDate(row);
      return K.compareDates(d, start) >= 0 && K.compareDates(d, end) <= 0;
    });
  }

  function oblastRowsInRange(start, end) {
    return oblastRows.filter((row) => {
      const d = oblastRowDate(row);
      return K.compareDates(d, start) >= 0 && K.compareDates(d, end) <= 0;
    });
  }

  function filteredCityRows(start, end) {
    if (!filterMode().showCity) return [];
    const rows = cityRowsInRange(start, end);
    if (raionFilter === "all") return rows;
    if (raionFilter === "none") return [];
    if (isCityRaion(raionFilter)) {
      const allowed = new Set(filteredCityAlerts(start, end).map(K.alertWindowKey));
      return rows.filter((row) => allowed.has(K.districtRowWindowKey(row)));
    }
    return [];
  }

  function filteredOblastRows(start, end) {
    if (raionFilter === "none") return [];
    const rows = oblastRowsInRange(start, end);
    if (!filterMode().showOblast && raionFilter !== "all") return [];
    if (raionFilter === "all") return rows;
    if (isOblastRaion(raionFilter)) {
      const allowed = new Set(filteredOblastAlerts(start, end).map(oblastWindowKeyFromAlert));
      return rows.filter((row) => allowed.has(oblastWindowKeyFromRow(row)));
    }
    return [];
  }

  function initRaionFilter(container) {
    container.className = "raion-controls";
    container.innerHTML =
      '<div class="raion-row">' +
      '<label for="raion-filter">район</label>' +
      '<select id="raion-filter" aria-label="Фільтр за районом"></select>' +
      "</div>" +
      '<p class="raion-filter-note">' +
      FILTER_NOTE +
      "</p>";

    const select = container.querySelector("#raion-filter");
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "усі";
    select.appendChild(allOpt);

    const cityGroup = document.createElement("optgroup");
    cityGroup.label = "10 міських районів";
    CITY_RAIONS.forEach((raion) => {
      const opt = document.createElement("option");
      opt.value = raion;
      opt.textContent = raion;
      cityGroup.appendChild(opt);
    });
    select.appendChild(cityGroup);

    const oblastGroup = document.createElement("optgroup");
    oblastGroup.label = "7 обласних районів";
    OBLAST_RAIONS.forEach((raion) => {
      const opt = document.createElement("option");
      opt.value = raion;
      opt.textContent = raion;
      oblastGroup.appendChild(opt);
    });
    select.appendChild(oblastGroup);

    const noneOpt = document.createElement("option");
    noneOpt.value = "none";
    noneOpt.textContent = "не указано";
    select.appendChild(noneOpt);

    select.value = raionFilter;

    select.addEventListener("change", () => {
      raionFilter = resolveCombinedRaionParam(select.value);
      K.syncQueryParams({ raion: K.raionToParam(raionFilter) });
      K.initNavLinks();
      renderDashboard();
    });
  }

  function aggregateCounts(rows, raionList, normalizeFn) {
    const counts = {};
    raionList.forEach((r) => {
      counts[r] = 0;
    });
    rows.forEach((row) => {
      const raion = normalizeFn(row.district);
      if (Object.prototype.hasOwnProperty.call(counts, raion)) counts[raion] += 1;
    });
    return counts;
  }

  function aggregateHourMatrix(rows, raionList, normalizeFn) {
    const hour = {};
    raionList.forEach((r) => {
      hour[r] = new Array(24).fill(0);
    });
    rows.forEach((row) => {
      const raion = normalizeFn(row.district);
      if (!Object.prototype.hasOwnProperty.call(hour, raion)) return;
      const h = parseInt(row.hour, 10);
      if (h >= 0 && h < 24) hour[raion][h] += 1;
    });
    return hour;
  }

  function sumAlertHours(alerts) {
    return Math.round(alerts.reduce((s, a) => s + (parseFloat(a.hours) || 0), 0) * 10) / 10;
  }

  function oblastCoverage(alerts) {
    const withRaion = alerts.filter((a) =>
      oblastWindowRaionMap.has(oblastWindowKeyFromAlert(a))
    ).length;
    const without = alerts.length - withRaion;
    return { withRaion, without, total: alerts.length };
  }

  function updateKPIs(start, end, cityAlertSlice, oblastAlertSlice, cityRowSlice, oblastRowSlice) {
    const allOblastInRange = oblastAlertsInRange(start, end);
    const coverage = oblastCoverage(allOblastInRange);

    document.getElementById("kpi-city-windows").textContent =
      filterMode().showCity ? cityAlertSlice.length + " вікон" : "—";
    document.getElementById("kpi-city-hours").textContent = filterMode().showCity
      ? String(sumAlertHours(cityAlertSlice))
      : "—";
    document.getElementById("kpi-oblast-windows").textContent =
      raionFilter === "none"
        ? coverage.without + " вікон"
        : filterMode().showOblast || raionFilter === "all"
          ? oblastAlertSlice.length + " вікон"
          : "—";
    document.getElementById("kpi-oblast-hours").textContent =
      raionFilter === "none"
        ? String(sumAlertHours(allOblastInRange.filter((a) => !oblastWindowRaionMap.has(oblastWindowKeyFromAlert(a)))))
        : filterMode().showOblast || raionFilter === "all"
          ? String(sumAlertHours(oblastAlertSlice))
          : "—";
    document.getElementById("kpi-city-mentions").textContent = filterMode().showCity
      ? cityRowSlice.length
      : "—";
    document.getElementById("kpi-oblast-mentions").textContent =
      raionFilter === "none" ? "0" : filterMode().showOblast || raionFilter === "all" ? oblastRowSlice.length : "—";

    if (raionFilter === "all" || raionFilter === "none") {
      const pct =
        coverage.total > 0
          ? Math.round((coverage.withRaion / coverage.total) * 1000) / 10
          : 0;
      document.getElementById("kpi-oblast-covered").textContent =
        coverage.withRaion + " / " + coverage.total + " (" + pct + "%)";
      const pctNone =
        coverage.total > 0
          ? Math.round((coverage.without / coverage.total) * 1000) / 10
          : 0;
      document.getElementById("kpi-oblast-unspecified").textContent =
        coverage.without + " / " + coverage.total + " (" + pctNone + "%)";
    } else {
      document.getElementById("kpi-oblast-covered").textContent = "—";
      document.getElementById("kpi-oblast-unspecified").textContent = "—";
    }

    document.getElementById("period-caption").textContent = formatRangeCaption(start, end);
    document.getElementById("range-caption").textContent =
      "Період: " + K.formatDayLabelLong(start) + " — " + K.formatDayLabelLong(end);
  }

  function fillUnitsTable(cityCounts, oblastCounts) {
    const tbody = document.querySelector("#units-table tbody");
    tbody.innerHTML = "";

    if (raionFilter === "none") return;

    const entries = [];
    if (filterMode().showCity || raionFilter === "all") {
      CITY_RAIONS.forEach((r) => {
        if (raionFilter === "all" || raionFilter === r) {
          entries.push({ name: r, layer: "місто", count: cityCounts[r] || 0 });
        }
      });
    }
    if (filterMode().showOblast || raionFilter === "all") {
      OBLAST_RAIONS.forEach((r) => {
        if (raionFilter === "all" || raionFilter === r) {
          entries.push({ name: r, layer: "область", count: oblastCounts[r] || 0 });
        }
      });
    }

    entries.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name, "uk");
    });

    entries.forEach((entry) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        entry.name +
        '</td><td class="layer-tag">' +
        entry.layer +
        '</td><td class="num">' +
        entry.count +
        "</td>";
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

  function collectBounds(features) {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    features.forEach((feature) => {
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

  function appendMapFeature(parent, feature, project, key, count, min, max, strokeWidth) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", featureToPath(feature, project));
    path.setAttribute("fill", colorForCount(count, min, max));
    path.setAttribute("stroke", "#1a1a1a");
    path.setAttribute("stroke-width", String(strokeWidth));
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("data-raion", key);
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = key + ": " + count + " згадок";
    path.appendChild(title);
    parent.appendChild(path);

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
    return label;
  }

  function initCombinedMap(cityCounts, oblastCounts) {
    const svg = document.getElementById("combined-map");
    svg.innerHTML = "";

    if (raionFilter === "none") {
      document.getElementById("map-legend").innerHTML = "";
      return;
    }

    const mode = filterMode();
    const visibleCounts = [];
    if (mode.showCity || raionFilter === "all") {
      CITY_RAIONS.forEach((r) => {
        if (raionFilter === "all" || raionFilter === r) visibleCounts.push(cityCounts[r] || 0);
      });
    }
    if (mode.showOblast || raionFilter === "all") {
      OBLAST_RAIONS.forEach((r) => {
        if (raionFilter === "all" || raionFilter === r) visibleCounts.push(oblastCounts[r] || 0);
      });
    }
    if (visibleCounts.length === 0) {
      document.getElementById("map-legend").innerHTML = "";
      return;
    }

    const min = Math.min(...visibleCounts);
    const max = Math.max(...visibleCounts);
    const allFeatures = oblastGeo.features.concat(cityGeo.features);
    const bounds = collectBounds(allFeatures);
    const width = 920;
    const height = MAP_HEIGHT;
    const pad = 24;
    const project = makeProjector(bounds, width, height, pad);

    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");

    const oblastLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    oblastLayer.setAttribute("class", "oblast-layer");
    const cityLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    cityLayer.setAttribute("class", "city-layer");
    const labelsLayer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    labelsLayer.setAttribute("class", "labels-layer");

    if (mode.showOblast || raionFilter === "all") {
      oblastGeo.features.forEach((feature) => {
        const key = feature.properties.NAME_SHORT;
        if (raionFilter !== "all" && raionFilter !== key) return;
        const count = oblastCounts[key] ?? 0;
        const label = appendMapFeature(oblastLayer, feature, project, key, count, min, max, 1.0);
        labelsLayer.appendChild(label);
      });
    }

    if (mode.showCity || raionFilter === "all") {
      cityGeo.features.forEach((feature) => {
        const key = K.normalizeRaion(feature.properties.name);
        if (raionFilter !== "all" && raionFilter !== key) return;
        const count = cityCounts[key] ?? 0;
        const label = appendMapFeature(cityLayer, feature, project, key, count, min, max, 1.4);
        labelsLayer.appendChild(label);
      });
    }

    svg.appendChild(oblastLayer);
    svg.appendChild(cityLayer);
    svg.appendChild(labelsLayer);
    buildLegend();
  }

  function computeFirstLast(rows, raionList, normalizeFn, windowPairFn) {
    const byWindow = {};
    rows.forEach((row) => {
      const key = windowPairFn(row);
      if (!byWindow[key]) byWindow[key] = [];
      byWindow[key].push(row);
    });

    const first = {};
    const last = {};
    raionList.forEach((r) => {
      first[r] = 0;
      last[r] = 0;
    });

    Object.keys(byWindow).forEach((key) => {
      const windowRows = byWindow[key];
      const posts = {};
      windowRows.forEach((row) => {
        const pid = postId(row);
        if (!posts[pid]) posts[pid] = new Set();
        posts[pid].add(normalizeFn(row.district));
      });
      const pids = Object.keys(posts).map(Number).filter((n) => !Number.isNaN(n));
      if (pids.length === 0) return;
      const minPid = Math.min.apply(null, pids);
      const maxPid = Math.max.apply(null, pids);
      posts[minPid].forEach((d) => {
        if (Object.prototype.hasOwnProperty.call(first, d)) first[d] += 1;
      });
      posts[maxPid].forEach((d) => {
        if (Object.prototype.hasOwnProperty.call(last, d)) last[d] += 1;
      });
    });

    return { first, last };
  }

  function sortedByCounts(counts, raionList) {
    return [...raionList].sort((a, b) => counts[b] - counts[a]);
  }

  function destroyChart(id) {
    if (charts[id]) {
      charts[id].destroy();
      delete charts[id];
    }
  }

  function makeHBarChart(canvasId, counts, raionList, color) {
    destroyChart(canvasId);
    const sorted = sortedByCounts(counts, raionList).filter((r) => counts[r] > 0);
    if (sorted.length === 0) return;

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

  function initFirstLastCharts(cityFL, oblastFL) {
    ["chart-city-first", "chart-city-last", "chart-oblast-first", "chart-oblast-last"].forEach(
      destroyChart
    );

    const mode = filterMode();
    if (mode.showCity) {
      const cityRaions =
        raionFilter === "all" ? CITY_RAIONS : isCityRaion(raionFilter) ? [raionFilter] : CITY_RAIONS;
      if (raionFilter === "all" || isCityRaion(raionFilter)) {
        makeHBarChart("chart-city-first", cityFL.first, cityRaions, "#5b9bd5");
        makeHBarChart("chart-city-last", cityFL.last, cityRaions, "#c45c4a");
      }
    }
    if (mode.showOblast) {
      const oblastRaions =
        raionFilter === "all" ? OBLAST_RAIONS : isOblastRaion(raionFilter) ? [raionFilter] : OBLAST_RAIONS;
      makeHBarChart("chart-oblast-first", oblastFL.first, oblastRaions, "#6aab6e");
      makeHBarChart("chart-oblast-last", oblastFL.last, oblastRaions, "#b07cc6");
    }
  }

  function formatCombinationLabel(districts, totalRaions) {
    if (districts.length === totalRaions) return "усі " + totalRaions + " районів";
    return districts.join(" + ");
  }

  function computeOblastCombinations(rows) {
    const byWindow = {};
    rows.forEach((row) => {
      const key = oblastWindowPairKey(row);
      if (!byWindow[key]) byWindow[key] = new Set();
      const raion = K.normalizeRaion(row.district);
      if (OBLAST_RAIONS.indexOf(raion) >= 0) byWindow[key].add(raion);
    });

    const comboCounts = {};
    Object.keys(byWindow).forEach((key) => {
      const set = byWindow[key];
      if (set.size === 0) return;
      const sorted = [...set].sort();
      const comboKey = sorted.join("\0");
      if (!comboCounts[comboKey]) comboCounts[comboKey] = { districts: sorted, count: 0 };
      comboCounts[comboKey].count += 1;
    });

    const entries = Object.keys(comboCounts).map((k) => comboCounts[k]);
    const totalWindows = entries.reduce((sum, e) => sum + e.count, 0);

    entries.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.districts.length !== b.districts.length) return a.districts.length - b.districts.length;
      return formatCombinationLabel(a.districts, OBLAST_RAIONS.length).localeCompare(
        formatCombinationLabel(b.districts, OBLAST_RAIONS.length),
        "uk"
      );
    });

    const size1Windows = entries
      .filter((e) => e.districts.length === 1)
      .reduce((sum, e) => sum + e.count, 0);

    return { entries, totalWindows, uniqueTypes: entries.length, size1Windows };
  }

  function fillCombinationsTable(combos) {
    const tbody = document.querySelector("#combos-table tbody");
    tbody.innerHTML = "";
    const caption = document.getElementById("combos-caption");
    if (!filterMode().showOblast || raionFilter === "none") {
      caption.textContent = "";
      return;
    }
    const total = combos.totalWindows;
    combos.entries.slice(0, 15).forEach((entry) => {
      const pct = total > 0 ? Math.round((entry.count / total) * 1000) / 10 : 0;
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        formatCombinationLabel(entry.districts, OBLAST_RAIONS.length) +
        '</td><td class="num">' +
        entry.districts.length +
        '</td><td class="num">' +
        entry.count +
        '</td><td class="num">' +
        pct +
        "%</td>";
      tbody.appendChild(tr);
    });
    caption.textContent =
      combos.uniqueTypes +
      " унікальних поєднань · " +
      combos.size1Windows +
      " вікон лише з 1 районом";
  }

  function sortToponymEntries(entries) {
    entries.sort((a, b) => {
      if (b.windows !== a.windows) return b.windows - a.windows;
      if (b.share !== a.share) return b.share - a.share;
      return a.term.localeCompare(b.term, "uk");
    });
    return entries;
  }

  function computeAbsentToponym(start, end) {
    const alerts = oblastAlertsInRange(start, end);
    const total = alerts.length;
    if (total < 1) return null;
    const absent = alerts.filter((a) => !oblastWindowRaionMap.has(oblastWindowKeyFromAlert(a))).length;
    return {
      term: "Топонім відсутній",
      raion: "не указано",
      windows: absent,
      denom: total,
      share: Math.round((absent / total) * 1000) / 10,
      isAbsent: true,
    };
  }

  function computeOblastToponyms(rows) {
    const raionWindows = {};
    const termWindows = {};

    rows.forEach((row) => {
      const raion = K.normalizeRaion(row.district);
      if (OBLAST_RAIONS.indexOf(raion) < 0) return;
      const pair = oblastWindowPairKey(row);
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
      if (isOblastRaion(raionFilter) && raion !== raionFilter) return;
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

    return sortToponymEntries(entries);
  }

  function fillToponymsTable(entries, absentEntry) {
    const tbody = document.querySelector("#toponyms-table tbody");
    const tableWrap = document.getElementById("toponyms-table-wrap");
    const captionEl = document.getElementById("toponyms-caption");
    const emptyEl = document.getElementById("toponyms-empty");
    tbody.innerHTML = "";

    const showToponyms =
      filterMode().showOblast || raionFilter === "all" || raionFilter === "none";
    if (!showToponyms) {
      tableWrap.hidden = true;
      emptyEl.hidden = false;
      emptyEl.textContent = "";
      captionEl.textContent = "";
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

    if (absentEntry) {
      captionEl.textContent =
        absentEntry.term +
        ": " +
        absentEntry.windows +
        "/" +
        absentEntry.denom +
        " вікон (" +
        absentEntry.share +
        "%).";
    } else if (entries.length > 0) {
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

  function heatColor(value, maxVal) {
    if (maxVal <= 0) return "rgba(255,247,188,0.15)";
    const t = value / maxVal;
    const rgb = lerpColor(Math.min(1, t))
      .match(/\d+/g)
      .map(Number);
    return "rgba(" + rgb.join(",") + ",0.95)";
  }

  function initHeatmap(hourMatrix, oblastCounts) {
    const legendEl = document.getElementById("heatmap-legend");
    if (heatChart) {
      heatChart.destroy();
      heatChart = null;
    }

    if (!filterMode().showOblast || raionFilter === "none") {
      legendEl.innerHTML = "";
      return;
    }

    let raions =
      raionFilter === "all"
        ? sortedByCounts(oblastCounts, OBLAST_RAIONS)
        : isOblastRaion(raionFilter)
          ? [raionFilter]
          : sortedByCounts(oblastCounts, OBLAST_RAIONS);

    if (raions.length === 0) {
      legendEl.innerHTML = "";
      return;
    }

    let maxVal = 0;
    raions.forEach((raion) => {
      hourMatrix[raion].forEach((v) => {
        if (v > maxVal) maxVal = v;
      });
    });

    const matrixData = [];
    raions.forEach((raion, y) => {
      hourMatrix[raion].forEach((v, x) => {
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

  function showOpenAlertBanner() {
    const banner = document.getElementById("alert-banner");
    if (oblastMeta && oblastMeta.alert_open && oblastMeta.last_event) {
      banner.classList.add("visible");
      banner.textContent =
        "Обласна тривога ще триває (остання подія @kievreal1: " +
        oblastMeta.last_event +
        "). Вікно не включено в oblast.csv, доки не закрито.";
    } else {
      banner.classList.remove("visible");
      banner.textContent = "";
    }
  }

  function renderDashboard() {
    const { start, end } = getRangeValues();
    const cityAlertSlice = filteredCityAlerts(start, end);
    const oblastAlertSlice = filteredOblastAlerts(start, end);
    const cityRowSlice = filteredCityRows(start, end);
    const oblastRowSlice = filteredOblastRows(start, end);

    const cityCounts = aggregateCounts(cityRowSlice, CITY_RAIONS, K.normalizeRaion);
    const oblastCounts = aggregateCounts(oblastRowSlice, OBLAST_RAIONS, K.normalizeRaion);
    const oblastHour = aggregateHourMatrix(oblastRowSlice, OBLAST_RAIONS, K.normalizeRaion);

    updateKPIs(start, end, cityAlertSlice, oblastAlertSlice, cityRowSlice, oblastRowSlice);
    fillUnitsTable(cityCounts, oblastCounts);
    initCombinedMap(cityCounts, oblastCounts);

    const cityFL = computeFirstLast(
      cityRowSlice,
      CITY_RAIONS,
      K.normalizeRaion,
      K.districtWindowPairKey
    );
    const oblastFL = computeFirstLast(
      oblastRowSlice,
      OBLAST_RAIONS,
      K.normalizeRaion,
      oblastWindowPairKey
    );

    try {
      initFirstLastCharts(cityFL, oblastFL);
    } catch (err) {
      console.error("First/last charts failed:", err);
    }

    const combos = computeOblastCombinations(oblastRowSlice);
    fillCombinationsTable(combos);

    const absentEntry =
      raionFilter === "all" || raionFilter === "none" ? computeAbsentToponym(start, end) : null;
    const toponymEntries = computeOblastToponyms(oblastRowSlice);
    const allToponymRows = absentEntry
      ? sortToponymEntries([absentEntry, ...toponymEntries])
      : toponymEntries;
    fillToponymsTable(allToponymRows, absentEntry);

    try {
      initHeatmap(oblastHour, oblastCounts);
    } catch (err) {
      console.error("Heatmap chart failed:", err);
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

  function bindControls() {
    document.getElementById("date-from").addEventListener("change", () => {
      setPresetActive(null);
      renderDashboard();
    });
    document.getElementById("date-to").addEventListener("change", () => {
      setPresetActive(null);
      renderDashboard();
    });
    document.getElementById("preset-7").addEventListener("click", () => applyPreset(7, "preset-7"));
    document.getElementById("preset-28").addEventListener("click", () => applyPreset(28, "preset-28"));
    document.getElementById("preset-90").addEventListener("click", () => applyPreset(90, "preset-90"));
    document.getElementById("preset-ytd").addEventListener("click", applyYTD);
  }

  function filter2026(rows, dateField) {
    return rows.filter((r) => String(r[dateField] || r.date || "").startsWith("2026"));
  }

  async function init() {
    try {
      const [
        cityRowsData,
        cityGeoRes,
        cityAlertsData,
        oblastRowsData,
        oblastGeoRes,
        oblastAlertsData,
        oblastMetaData,
      ] = await Promise.all([
        K.fetchTable("districts"),
        fetch("data/kyiv-raions.geojson?v=" + CACHE_BUST),
        K.fetchTable("alerts"),
        K.fetchTable("oblast_districts"),
        fetch("data/kyiv-oblast-raions.geojson?v=" + CACHE_BUST),
        K.fetchTable("oblast"),
        K.fetchOblastMeta(),
      ]);

      const geoResponses = [cityGeoRes, oblastGeoRes];
      if (geoResponses.some((r) => !r.ok)) {
        throw new Error("Не вдалося завантажити дані");
      }

      if (!cityRowsData.length) throw new Error("districts порожній");
      if (!oblastRowsData.length) throw new Error("oblast_districts порожній");

      cityRows = cityRowsData;
      oblastRows = oblastRowsData;
      cityGeo = await cityGeoRes.json();
      oblastGeo = await oblastGeoRes.json();
      cityAlerts = filter2026(cityAlertsData, "date");
      oblastAlerts = filter2026(oblastAlertsData, "date");
      oblastMeta = oblastMetaData;

      if (oblastGeo.features.length !== 7) {
        throw new Error("kyiv-oblast-raions.geojson: очікувалось 7 MultiPolygons");
      }

      cityWindowRaionMap = K.buildWindowRaionMap(cityRows);
      oblastWindowRaionMap = buildOblastWindowRaionMap(oblastRows);

      const allDates = [
        ...new Set([
          ...cityRows.map(cityRowDate),
          ...oblastRows.map(oblastRowDate),
          ...cityAlerts.map((a) => a.date),
          ...oblastAlerts.map((a) => a.date),
        ]),
      ].sort(K.compareDates);

      dataMin = allDates[0];
      dataMax = allDates[allDates.length - 1];

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
      initRaionFilter(document.getElementById("raion-filter-root"));
      raionFilter = getCombinedRaionFilter();
      document.getElementById("raion-filter").value = raionFilter;

      showOpenAlertBanner();
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
