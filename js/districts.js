(function () {
  "use strict";

  const K = window.KyivAlerts;
  let map = null;
  let heatChart = null;

  const COLOR_STOPS = [
    { t: 0, c: [255, 247, 188] },
    { t: 0.35, c: [254, 196, 79] },
    { t: 0.65, c: [244, 109, 67] },
    { t: 0.85, c: [215, 48, 31] },
    { t: 1, c: [127, 0, 0] },
  ];

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
    let lo = COLOR_STOPS[0];
    let hi = COLOR_STOPS[COLOR_STOPS.length - 1];
    for (let i = 0; i < COLOR_STOPS.length - 1; i++) {
      if (t >= COLOR_STOPS[i].t && t <= COLOR_STOPS[i + 1].t) {
        lo = COLOR_STOPS[i];
        hi = COLOR_STOPS[i + 1];
        break;
      }
    }
    const span = hi.t - lo.t || 1;
    const f = (t - lo.t) / span;
    const rgb = lo.c.map((v, i) => Math.round(v + (hi.c[i] - v) * f));
    return "rgb(" + rgb.join(",") + ")";
  }

  function colorForCount(count, min, max) {
    if (max <= min) return lerpColor(0.5);
    return lerpColor((count - min) / (max - min));
  }

  function formatDateUk(dateStr) {
    const d = K.parseDate(dateStr);
    const months = [
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
    return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
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
        "<td>" +
        raion +
        "</td>" +
        '<td class="num">' +
        data.counts[raion] +
        "</td>";
      tbody.appendChild(tr);
    });
  }

  function buildLegend(min, max) {
    const el = document.getElementById("map-legend");
    el.innerHTML = "";
    const bar = document.createElement("div");
    bar.className = "legend-bar";
    for (let i = 0; i <= 20; i++) {
      const seg = document.createElement("span");
      seg.style.background = lerpColor(i / 20);
      bar.appendChild(seg);
    }
    el.appendChild(bar);
    const labels = document.createElement("div");
    labels.className = "legend-labels";
    labels.innerHTML =
      '<span>' +
      max +
      "+</span><span>" +
      Math.round((max + min) / 2) +
      "</span><span>" +
      min +
      "</span>";
    el.appendChild(labels);
    const cap = document.createElement("div");
    cap.className = "legend-caption";
    cap.textContent = "згадок району в постах під час тривоги";
    el.appendChild(cap);
  }

  function initMap(geojson, data) {
    const counts = data.counts;
    const values = Object.values(counts);
    const min = Math.min(...values);
    const max = Math.max(...values);

    map = L.map("districts-map", {
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    const layer = L.geoJSON(geojson, {
      style(feature) {
        const key = normalizeRaion(feature.properties.name);
        const count = counts[key] ?? 0;
        return {
          fillColor: colorForCount(count, min, max),
          weight: 1.5,
          opacity: 1,
          color: "#333",
          fillOpacity: 0.92,
        };
      },
      onEachFeature(feature, leafletFeature) {
        const key = normalizeRaion(feature.properties.name);
        const count = counts[key] ?? 0;
        leafletFeature.bindTooltip(
          "<strong>" + key + "</strong><br>" + count + " згадок",
          { sticky: true, className: "raion-tooltip" }
        );
        const center = leafletFeature.getBounds().getCenter();
        L.marker(center, {
          icon: L.divIcon({
            className: "raion-label",
            html:
              '<div class="raion-label-inner"><span class="raion-name">' +
              key +
              '</span><span class="raion-count">' +
              count +
              "</span></div>",
            iconSize: [120, 40],
            iconAnchor: [60, 20],
          }),
          interactive: false,
        }).addTo(map);
      },
    }).addTo(map);

    map.fitBounds(layer.getBounds(), { padding: [20, 20] });
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
    const hourLabels = [];
    for (let h = 0; h < 24; h++) hourLabels.push(String(h).padStart(2, "0"));

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
              const v = ctx.raw.v;
              return heatColor(v, maxVal);
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
      initMap(geojson, data);
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
