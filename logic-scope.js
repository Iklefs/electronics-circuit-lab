import { logicPins, logicTypes } from "./logic-circuit.js";
import { scopeColors } from "./oscilloscope.js";

export function createLogicScope(onActivity) {
  const byId = (id) => document.getElementById(id);
  const panel = byId("logic-scope-panel");
  const toggle = byId("logic-scope-toggle");
  const run = byId("logic-scope-run");
  const timeWindow = byId("logic-scope-window");
  const status = byId("logic-scope-status");
  const plot = byId("logic-scope-plot");
  const selectors = [...panel.querySelectorAll("[data-channel]")];

  let ports = new Map();
  let portSignature = "";
  let initialized = false;
  let samples = [];
  let epoch = null;
  let elapsed = 0;
  let lastDraw = -Infinity;
  let recording = true;

  function draw() {
    const span = Number(timeWindow.value);
    const start = Math.max(0, elapsed - span);
    const active = selectors.flatMap((select, index) => select.value ? [index] : []);
    const left = 70, right = 800, top = 17, rowHeight = 53;
    const bottom = top + Math.max(1, active.length) * rowHeight;
    const x = (time) => left + (right - left) * (time - start) / span;
    const axis = Array.from({ length: 6 }, (_, i) => {
      const time = start + span * i / 5;
      return `<path d="M${x(time)} ${top}V${bottom}" stroke="#3b516c"/>
        <text x="${x(time)}" y="${bottom + 18}" text-anchor="middle">${Number(time.toFixed(2))}</text>`;
    }).join("");
    const lanes = active.map((index, row) => {
      const base = top + row * rowHeight;
      const high = base + 10;
      const low = base + 40;
      const y = (level) => level === 1 ? high : level === 0 ? low : (high + low) / 2;
      const known = [], unknown = [];
      for (let i = 0; i < samples.length; i++) {
        const current = samples[i];
        const next = samples[i + 1];
        if (!current.levels) continue;
        const end = next?.time ?? elapsed;
        if (end < start) continue;
        const from = Math.max(start, current.time);
        const level = current.levels[index];
        const step = next?.levels && level !== next.levels[index] ? `V${y(next.levels[index])}` : "";
        (level === -1 ? unknown : known).push(`M${x(from).toFixed(2)} ${y(level)}H${x(end).toFixed(2)}${step}`);
      }
      return `<path d="M${left} ${high}H${right}M${left} ${low}H${right}" stroke="#2d425b"/>
        <text x="12" y="${base + 29}" fill="${scopeColors[index]}">CH${index + 1}</text>
        <text x="58" y="${high + 4}" text-anchor="end">1</text>
        <text x="58" y="${low + 4}" text-anchor="end">0</text>
        <g fill="none" stroke="${scopeColors[index]}" stroke-width="2">
          <path data-channel-trace="${index + 1}" d="${known.join("")}"/>
          <path d="${unknown.join("")}" stroke-dasharray="4 3"/>
        </g>`;
    }).join("");
    plot.setAttribute("viewBox", `0 0 820 ${bottom + 38}`);
    plot.innerHTML = `<g fill="#c4d6ed" font-size="12">${axis}${lanes}
      <text x="435" y="${bottom + 34}" text-anchor="middle">시간 (s)</text></g>`;
    status.textContent = active.length
      ? (recording ? "0과 1을 기록합니다. 점선은 미정(X)입니다." : "기록을 일시정지했습니다.")
      : "기록할 단자를 채널에서 선택하세요.";
  }

  function clear() {
    samples = [];
    epoch = null;
    elapsed = 0;
    lastDraw = -Infinity;
    draw();
  }

  function chooseDefaults() {
    if (panel.hidden || initialized || !ports.size) return;
    const ordered = [...ports.values()].sort((a, b) => a.priority - b.priority);
    selectors[0].value = ordered[0].key;
    if (ordered[1]) selectors[1].value = ordered[1].key;
    initialized = true;
  }

  function sync(parts, chips) {
    const next = parts.flatMap((part) => {
      const chip = chips.get(part.type);
      const { inputs, outputs } = logicPins(part.type, chips);
      const name = part.label ?? chip?.name ?? logicTypes[part.type].name;
      const prefix = name + " " + part.id + " · ";
      const priority = part.type === "pulse" ? 0 : part.type === "input" ? 2 : 1;
      return [...outputs.map((port) => ({ ...port, priority })), ...inputs.map((port) => ({ ...port, priority: 3 }))]
        .map(({ pin, name, priority }) => ({ key: part.id + ":" + pin, id: part.id, pin, label: prefix + name, priority }));
    });
    const signature = JSON.stringify(next);
    if (signature === portSignature) return;
    portSignature = signature;
    ports = new Map(next.map((port) => [port.key, port]));
    let removed = false;
    for (const select of selectors) {
      const key = select.value;
      select.replaceChildren(new Option("미사용", ""), ...next.map((port) => new Option(port.label, port.key)));
      if (ports.has(key)) select.value = key;
      else if (key) removed = true;
    }
    chooseDefaults();
    if (removed || !ports.size) clear();
  }

  function sample(now, signals) {
    if (!isRecording()) return;
    epoch ??= now;
    elapsed = Math.max(elapsed, (now - epoch) / 1000);
    const levels = selectors.map(({ value }) => {
      const port = ports.get(value);
      const reading = port && signals?.get(port.id)?.[port.pin];
      return reading === 0 || reading === 1 ? reading : -1;
    });
    if (!samples.at(-1)?.levels || levels.some((value, index) => value !== samples.at(-1).levels[index])) {
      samples.push({ time: elapsed, levels });
    }
    while (samples.length > 1 && samples[1].time <= elapsed - 10) samples.shift();
    if (now - lastDraw >= 65) {
      lastDraw = now;
      draw();
    }
  }

  function isRecording() {
    return !panel.hidden && recording && selectors.some(({ value }) => value);
  }

  function breakRecording() {
    if (samples.at(-1)?.levels) samples.push({ time: elapsed, levels: null });
  }

  toggle.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (panel.hidden) breakRecording();
    else {
      chooseDefaults();
      draw();
      panel.scrollIntoView({ block: "nearest" });
    }
    onActivity();
  });
  run.addEventListener("click", () => {
    recording = !recording;
    if (recording) breakRecording();
    run.textContent = recording ? "Ⅱ 기록 일시정지" : "▶ 기록 재개";
    draw();
    onActivity();
  });
  for (const select of selectors) {
    select.addEventListener("change", () => {
      initialized = true;
      clear();
      onActivity();
    });
  }
  timeWindow.addEventListener("change", draw);
  byId("logic-scope-reset").addEventListener("click", clear);

  return {
    sync, sample, isRecording, breakRecording,
    reset() {
      initialized = false;
      portSignature = "";
      selectors.forEach((select) => { select.value = ""; });
      clear();
    },
  };
}
