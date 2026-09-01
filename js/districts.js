(function () {
  "use strict";

  const K = window.KyivAlerts;
  let heatChart = null;

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

  function normalizeRaion(name) {
    return String(name || "")
      .replace(/\s*район\s*$/i, "")
      .replace(/\u2019/g, "'");
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

  function formatRangeCaption(range) {
    const start = K.parseDate(range[0]);
    const end = K.parseDate(range[1]);
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
    if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
      return months[start.getMonth()] + " " + start.getFullYear();
    }
    return months[start.getMonth()] + " — " + end.getDate() + " " + months[end.getMonth()] + " " + end.getFullYear();
  }

  function updateKPIs(data) {
    document.getElementById("kpi-mentions").textContent = data.n_city;
    document.getElementById("kpi-coverage").textContent =
      data.n_windows_with_mention + " / " + data.n_windows + " (" + data.coverage_pct + "%)";
    document.getElementById("kpi-range").textContent =
      data.date_range[0] + " — " + data.date_range[1];
    document.getElementById("period-caption").textContent = formatRangeCaption(data.date_range);
  }

  function fillTable(data) {
    const tbody = document.querySelector("#districts-table tbody");
    tbody.innerHTML = "";
    const sorted = [...data.raions].sort((a, b) => data.counts[b] - data.counts[a]);
    sorted.forEach((raion) => {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + raion + "</td><td class=\"num\">" + data.counts[raion] + "</td>";
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

  function collectBounds(geojson) {
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    geojson.features.forEach((feature) => {
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

  function buildLegend(min, max) {
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

  function initChoropleth(geojson, data) {
    const counts = data.counts;
    const values = Object.values(counts);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const bounds = collectBounds(geojson);
    const svg = document.getElementById("districts-map");
    const width = 920;
    const height = MAP_HEIGHT;
    const pad = 24;

    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    svg.innerHTML = "";

    const project = makeProjector(bounds, width, height, pad);
    const raionsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    raionsGroup.setAttribute("class", "raions-layer");
    const labelsGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    labelsGroup.setAttribute("class", "labels-layer");

    geojson.features.forEach((feature) => {
      const key = normalizeRaion(feature.properties.name);
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
    buildLegend(min, max);
  }

  function heatColor(value, maxVal) {
    if (maxVal <= 0) return "rgba(255,247,188,0.15)";
    const t = value / maxVal;
    const rgb = lerpColor(Math.min(1, t)).match(/\d+/g).map(Number);
    return "rgba(" + rgb.join(",") + ",0.95)";
  }

  function initHeatmap(data) {
    const raions = [...data.raions].sort((a, b) => data.counts[b] - data.counts[a]);

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
    if (heatChart) heatChart.destroy();

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

    const legendEl = document.getElementById("heatmap-legend");
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

  async function init() {
    try {
      const [dataRes, geoRes] = await Promise.all([
        fetch("data/districts-counts.json"),
        fetch("data/kyiv-raions.geojson"),
      ]);

      if (!dataRes.ok || !geoRes.ok) {
        throw new Error("Не вдалося завантажити дані");
      }

      const data = await dataRes.json();
      const geojson = await geoRes.json();

      document.getElementById("loading").style.display = "none";
      document.getElementById("dashboard").style.display = "block";

      updateKPIs(data);
      fillTable(data);
      initChoropleth(geojson, data);
      initHeatmap(data);
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
