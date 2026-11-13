import { voltageBetween } from "./circuit.js";

export const scopeColors = ["#72efd6", "#ffd18c", "#b6baff", "#fc9db6"];
const byId = (id) => document.getElementById(id);
const format = (value) => Number(value.toPrecision(4)).toString();
const cursorTime = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 7, useGrouping: false });
const minVoltageRange = 0.01;
const voltageForDisplay = (voltage) => Math.abs(voltage) < 1e-6 ? 0 : voltage;
const formatVoltage = (voltage) => Number.isFinite(voltage) ? format(voltageForDisplay(voltage)) + " V" : "미측정";
const bounds = { left: 66, right: 800, top: 20, bottom: 233 };

function nearestSample(samples, time) {
  if (!samples.length || time < samples[0].time || time > samples.at(-1).time) return null;
  let low = 0;
  let high = samples.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].time < time) low = mid + 1;
    else high = mid;
  }
  const right = samples[low];
  const left = samples[low - 1];
  if (right.time === time) return right.gap ? null : right;
  if (left?.gap || right.gap) return null;
  return left && time - left.time < right.time - time ? left : right;
}

export function createScope() {
  const panel = byId("scope-panel");
  const run = byId("scope-run");
  const windowInput = byId("scope-window");
  const status = byId("scope-status");
  const plot = byId("scope-plot");
  const readings = byId("scope-readings");
  const waveforms = byId("scope-waveforms");
  const cursor = byId("scope-cursor");
  const tooltip = byId("scope-tooltip");
  const chart = plot.parentElement;
  let pointer = null;
  let viewport = null;

  function hideCursor() {
    cursor.setAttribute("hidden", "");
    tooltip.hidden = true;
  }

  function drawCursor() {
    if (!pointer || !viewport) return hideCursor();
    const matrix = plot.getScreenCTM();
    if (!matrix) return hideCursor();
    const { left, right, top, bottom } = bounds;
    const position = pointer.matrixTransform(matrix.inverse());
    if (position.x < left || position.x > right || position.y < top || position.y > bottom) return hideCursor();

    const { shown, start, span, x, y } = viewport;
    const sample = nearestSample(shown, start + span * (position.x - left) / (right - left));
    if (!sample || !channels.some(({ id }) => Number.isFinite(sample.values[id]))) return hideCursor();
    const cursorX = x(sample.time);
    const markers = channels.map(({ id }, index) => {
      const voltage = sample.values[id];
      return Number.isFinite(voltage)
        ? `<circle cx="${cursorX}" cy="${y(voltage)}" r="4" fill="${scopeColors[index]}"/>` : "";
    }).join("");
    cursor.innerHTML = `<line x1="${cursorX}" x2="${cursorX}" y1="${top}" y2="${bottom}"/>${markers}`;
    cursor.removeAttribute("hidden");

    const values = channels.map(({ id }, index) => {
      const voltage = sample.values[id];
      return `<div><span><i class="dot" style="--channel:${scopeColors[index]}"></i>CH${index + 1}</span><b>${formatVoltage(voltage)}</b></div>`;
    }).join("");
    tooltip.innerHTML = `<strong>${cursorTime.format(sample.time)} s</strong>${values}`;
    tooltip.hidden = false;
    const anchor = new DOMPoint(cursorX, top).matrixTransform(matrix);
    const chartBounds = chart.getBoundingClientRect();
    const offset = anchor.x - chartBounds.left;
    const tipWidth = tooltip.offsetWidth;
    const tipX = offset + tipWidth + 20 <= chartBounds.width ? offset + 12 : offset - tipWidth - 12;
    tooltip.style.left = Math.max(4, tipX) + "px";
    tooltip.style.top = Math.max(4, anchor.y - chartBounds.top + 8) + "px";
  }

  function moveCursor(event) {
    pointer = new DOMPoint(event.clientX, event.clientY);
    drawCursor();
  }

  plot.addEventListener("pointermove", moveCursor);
  plot.addEventListener("click", moveCursor);
  function clearCursor() {
    pointer = null;
    hideCursor();
  }
  plot.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch") clearCursor();
  });
  plot.addEventListener("pointercancel", clearCursor);
  let channels = [];
  let samples = [];
  let time = 0;
  let recording = true;
  let bucket = null;

  function draw() {
    const span = Number(windowInput.value);
    const start = Math.max(0, time - span);
    const shown = [...samples, ...bucketSamples()].filter((sample) => sample.time >= start);
    const voltages = shown.flatMap(({ values }) => channels.map(({ id }) => values[id]).filter(Number.isFinite));
    const peak = voltages.reduce((peak, value) => Math.max(peak, Math.abs(value)), minVoltageRange);
    const step = 10 ** Math.floor(Math.log10(peak));
    const limit = Math.ceil(peak / step) * step;
    const low = voltages.some((value) => voltageForDisplay(value) < 0) ? -limit : 0;
    const { left, right, top, bottom } = bounds;
    const x = (t) => left + (right - left) * (t - start) / span;
    const y = (v) => bottom - (bottom - top) * (voltageForDisplay(v) - low) / (limit - low);
    viewport = { shown, start, span, x, y };
    const grid = [];
    for (let index = 0; index <= 5; index += 1) {
      const t = start + index * span / 5;
      const v = low + index * (limit - low) / 5;
      grid.push(`<path d="M${x(t)} ${top}V${bottom}M${left} ${y(v)}H${right}" stroke="#3b516c"/>
        <text x="${x(t)}" y="254" text-anchor="middle">${cursorTime.format(t)}</text>
        <text x="56" y="${y(v) + 4}" text-anchor="end">${format(v)}</text>`);
    }
    const traces = channels.map(({ id }, index) => {
      let penDown = false;
      const path = shown.map(({ time: t, values }) => {
        const voltage = values[id];
        if (!Number.isFinite(voltage)) {
          penDown = false;
          return "";
        }
        const command = penDown ? "L" : "M";
        penDown = true;
        return `${command}${x(t).toFixed(2)} ${y(voltage).toFixed(2)}`;
      }).join("");
      return `<path class="scope-trace" data-channel="${id}" d="${path}" fill="none" stroke="${scopeColors[index]}" stroke-width="2"/>`;
    });
    waveforms.innerHTML = `<g fill="#c4d6ed" font-size="12">${grid.join("")}
      <text x="8" y="14">전압 (V)</text><text x="433" y="273" text-anchor="middle">시간 (s)</text></g>${traces.join("")}`;
    readings.innerHTML = channels.map(({ id }, index) => {
      const latest = shown.at(-1)?.values[id];
      return `<span><i class="dot" style="--channel:${scopeColors[index]}"></i>CH${index + 1} · 오실로스코프 ${id} · ${formatVoltage(latest)}</span>`;
    }).join("");
    drawCursor();
  }

  function updateControls() {
    run.textContent = recording ? "Ⅱ 기록 일시정지" : "▶ 기록 재개";
    status.textContent = recording ? "회로의 전압을 자동으로 기록합니다." :
      "기록을 멈췄습니다. 회로는 계속 작동합니다.";
  }

  function clear() {
    samples = [];
    bucket = null;
    time = 0;
    draw();
  }

  function sync(parts) {
    const wasEmpty = channels.length === 0;
    channels = parts.filter(({ type }) => type === "scope");
    if (bucket) flushBucket();
    panel.hidden = channels.length === 0;
    if (wasEmpty && channels.length) {
      recording = true;
      updateControls();
    }
    if (panel.hidden) clear();
    else draw();
  }

  function sample(reading, timestamp) {
    if (!recording || !channels.length) return;
    const values = Object.fromEntries(channels.map(({ id }) =>
      [id, voltageBetween(reading, [id, 0], [id, 1])]));
    time = timestamp;
    const entry = { time, values };
    const bin = Math.floor(time / (Number(windowInput.value) / 960));
    if (bucket?.bin !== bin) {
      flushBucket();
      bucket = { bin, first: entry, last: entry, extrema: new Map() };
    }
    bucket.last = entry;
    for (const { id } of channels) {
      if (!Number.isFinite(values[id])) continue;
      const range = bucket.extrema.get(id) ?? [entry, entry];
      if (values[id] < range[0].values[id]) range[0] = entry;
      if (values[id] > range[1].values[id]) range[1] = entry;
      bucket.extrema.set(id, range);
    }
  }

  function bucketSamples() {
    if (!bucket) return [];
    const entries = new Set([bucket.first, bucket.last]);
    for (const range of bucket.extrema.values()) for (const entry of range) entries.add(entry);
    return [...entries].sort((a, b) => a.time - b.time);
  }

  function flushBucket() {
    samples.push(...bucketSamples());
    bucket = null;
  }

  function render() {
    if (!recording || panel.hidden) return;
    const oldest = Math.max(0, time - Number(windowInput.value));
    samples = samples.filter((entry) => entry.time >= oldest);
    draw();
  }

  run.addEventListener("click", () => {
    recording = !recording;
    flushBucket();
    if (recording) {
      // Show a break in the trace across the interval that was not recorded.
      if (samples.length) samples.push({ time, values: {}, gap: true });
    }
    updateControls();
  });
  byId("scope-reset").addEventListener("click", clear);
  windowInput.addEventListener("change", () => {
    flushBucket();
    draw();
  });
  updateControls();
  return { sync, clear, sample, render };
}
