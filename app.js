const series = [
  { key: "wiimmfi", label: "Wiimmfi", color: "#61d394" },
  { key: "rwfc", label: "RWFC", color: "#f6bd4f" },
  { key: "newwfc", label: "newWFC", color: "#63b3ed" },
];

let snapshots = [];
let currentRange = "24";

const formatCount = (value) => Number.isFinite(value) ? value.toLocaleString() : "--";

const parseNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

async function loadSnapshots() {
  try {
    const response = await fetch(`data/snapshots.json?cache=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    snapshots = Array.isArray(data.snapshots) ? data.snapshots : [];
  } catch (error) {
    snapshots = [];
    document.getElementById("chart-caption").textContent = "No snapshot file found yet. The timeline will fill after the collector runs.";
  }

  render();
}

function filteredSnapshots() {
  if (currentRange === "all") return snapshots;
  const hours = Number(currentRange);
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return snapshots.filter((point) => new Date(point.timestamp).getTime() >= cutoff);
}

function latestUsableSnapshot() {
  return [...snapshots].reverse().find((point) => point && point.counts) || null;
}

function latestForSeries(key) {
  return [...snapshots].reverse().find((point) => parseNumber(point?.counts?.[key]) !== null) || null;
}

function renderCards() {
  series.forEach(({ key }) => {
    const latest = latestForSeries(key);
    const count = parseNumber(latest?.counts?.[key]);
    const state = latest?.sources?.[key]?.status || (count === null ? "no data" : "ok");
    document.getElementById(`${key}-count`).textContent = formatCount(count);
    document.getElementById(`${key}-state`).textContent = state === "ok" ? "latest valid point" : state;
  });

  const latestTime = latest ? new Date(latest.timestamp) : null;
  const counts = series.map(({ key }) => parseNumber(latest?.counts?.[key])).filter((count) => count !== null);
  const total = counts.reduce((sum, count) => sum + count, 0);

  document.getElementById("latest-time").textContent = latestTime ? latestTime.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "--";
  document.getElementById("latest-total").textContent = counts.length ? formatCount(total) : "--";
  document.getElementById("latest-points").textContent = formatCount(snapshots.length);
}

function renderChart(points) {
  const canvas = document.getElementById("timeline");
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(640, Math.floor(rect.width * ratio));
  canvas.height = Math.max(340, Math.floor(rect.height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);

  const width = rect.width;
  const height = rect.height;
  context.clearRect(0, 0, width, height);

  const pad = { top: 20, right: 22, bottom: 44, left: 54 };
  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;

  context.fillStyle = "#101820";
  context.fillRect(0, 0, width, height);

  if (points.length < 2) {
    context.fillStyle = "#9fb1bc";
    context.font = "14px system-ui, sans-serif";
    context.fillText("Waiting for at least two snapshots. The line wakes up on the next collection.", pad.left, pad.top + 30);
    return;
  }

  const timestamps = points.map((point) => new Date(point.timestamp).getTime());
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);
  const values = points.flatMap((point) => series.map(({ key }) => parseNumber(point.counts?.[key])).filter((count) => count !== null));
  const maxValue = Math.max(10, ...values);
  const yMax = Math.ceil(maxValue / 10) * 10;

  const x = (time) => pad.left + ((time - minTime) / Math.max(1, maxTime - minTime)) * plotWidth;
  const y = (value) => pad.top + plotHeight - (value / yMax) * plotHeight;

  context.strokeStyle = "rgba(255, 255, 255, 0.1)";
  context.lineWidth = 1;
  context.fillStyle = "#9fb1bc";
  context.font = "12px system-ui, sans-serif";

  for (let step = 0; step <= 4; step += 1) {
    const value = Math.round((yMax / 4) * step);
    const yPos = y(value);
    context.beginPath();
    context.moveTo(pad.left, yPos);
    context.lineTo(width - pad.right, yPos);
    context.stroke();
    context.fillText(String(value), 12, yPos + 4);
  }

  const tickCount = Math.min(5, points.length);
  for (let index = 0; index < tickCount; index += 1) {
    const point = points[Math.round((points.length - 1) * (index / Math.max(1, tickCount - 1)))];
    const time = new Date(point.timestamp);
    const label = currentRange === "all"
      ? time.toLocaleDateString([], { month: "short", day: "numeric" })
      : time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    context.fillText(label, x(time.getTime()) - 22, height - 17);
  }

  series.forEach(({ key, color }) => {
    const linePoints = points
      .map((point) => ({ time: new Date(point.timestamp).getTime(), value: parseNumber(point.counts?.[key]) }))
      .filter((point) => point.value !== null);

    if (linePoints.length < 2) return;

    context.strokeStyle = color;
    context.lineWidth = 3;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    linePoints.forEach((point, index) => {
      const xPos = x(point.time);
      const yPos = y(point.value);
      if (index === 0) context.moveTo(xPos, yPos);
      else context.lineTo(xPos, yPos);
    });
    context.stroke();

    context.fillStyle = color;
    linePoints.slice(-1).forEach((point) => {
      context.beginPath();
      context.arc(x(point.time), y(point.value), 4, 0, Math.PI * 2);
      context.fill();
    });
  });
}

function render() {
  const latest = latestUsableSnapshot();
  const points = filteredSnapshots();
  const rangeLabel = currentRange === "all" ? "all collected snapshots" : `the last ${currentRange} hours`;
  document.getElementById("chart-caption").textContent = `${points.length} points shown across ${rangeLabel}.`;
  renderCards();
  renderChart(points);
}

document.querySelectorAll(".range-button").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".range-button").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    currentRange = button.dataset.range;
    render();
  });
});

window.addEventListener("resize", render);
loadSnapshots();
