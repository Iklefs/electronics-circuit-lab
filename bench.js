import { createBoardCamera } from "./board-camera.js";
import { analogExamples, bindExamplePicker, buildExample } from "./circuit-examples.js";
import { chipPackage, components, frequencyRange, groups, logicChipGroup, motorSettings, pinsFor, validMotorSettings } from "./components.js";
import { pinCount, keyOf, measure, voltageBetween } from "./circuit.js";
import { chipLibrary } from "./chip-library.js";
import { validateChip } from "./logic-circuit.js";
import { createScope, scopeColors } from "./oscilloscope.js";
import { createSimulation, isTimeDependent } from "./simulation.js";

const byId = (id) => document.getElementById(id);
const board = byId("board");
const boardSurface = byId("board-surface");
const partLayer = byId("part-layer");
const wireLayer = byId("wire-layer");
const wirePreview = byId("wire-preview");
const rotationGuide = byId("rotation-guide");
const draftPoints = byId("draft-points");
const editor = byId("part-editor");
const editorInput = byId("part-value");
const readingTip = byId("board-reading");
const editorReading = byId("editor-reading");
const touchInput = matchMedia("(pointer: coarse)");
const frequencyInput = byId("part-frequency");
const motorEditor = byId("editor-motor");
motorEditor.insertAdjacentHTML("beforeend", Object.entries(motorSettings).map(([key, { label, min, max }]) =>
  `<label>${label}<input name="${key}" type="number" min="${min}" max="${max}" step="any" required></label>`
).join("") + "<p>양의 부하 토크는 정방향 회전에 반대로 작용합니다.</p>");
const motorInputs = [...motorEditor.querySelectorAll("input")];
const cleanMotorSettings = (settings) => Object.fromEntries(
  Object.keys(motorSettings).map((key) => [key, settings[key]]));
const boardScroll = board.parentElement;
const inspector = byId("inspector");
const palette = byId("palette");
const paletteGroups = byId("palette-groups");
const placementPreview = byId("placement-preview");
const workbench = byId("workbench");
const fullscreenButton = byId("fullscreen");
const status = byId("bench-status");
const solveStatus = byId("solve-status");
const flowStatus = byId("flow-status");
const simulationError = byId("simulation-error");
const flowControls = byId("flow-controls");
const defaultStatus = "단자에서 시작해 빈 곳을 클릭하면 배선 경유점을 추가할 수 있습니다.";
const width = 960;
const height = 520;
const maxParts = 30;
const maxWires = 60;
const maxPoints = 12;
const rotationStep = 15;
const historyLimit = 100;
const minDisplayedChargeMicrocoulombs = 0.001;
let parts = [];
let wires = [];
const undoStack = [];
const redoStack = [];
let checkpoint = JSON.stringify({ parts, wires });
let nextId = 1;
let placing = null;
let paletteDrag = null;
let suppressPaletteClick = false;
let suppressBoardClick = false;
let fallbackFullscreen = false;
let selection = null;
let pending = null;
let bends = [];
let editing = null;
let editorAnchor = null;
let hovered = null;
const clipboardPrefix = "circuit-lab:part:v1:";
const maxSharedLength = 150000;
const escape = (value) => value.replace(/[&<>"]/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const partName = (part) => part.chip?.name ?? components[part.type].name;
let drag = null;
let live = false;
let flowMode = null;
let dcReading = null;
let dcError = "";
let transientReading = null;
const scope = createScope();
const simulation = createSimulation(scope.sample, (reading) => {
  transientReading = reading;
  refreshBoardReadings(reading);
  refreshMeasurements();
  if (flowMode) refreshFlow();
  scope.render();
}, (error) => {
  transientReading = null;
  simulationError.textContent = error.message;
  simulationError.hidden = false;
  draw();
  refreshMeasurements();
});

function recordEdit() {
  const next = JSON.stringify({ parts, wires });
  if (next === checkpoint) return;
  undoStack.push(checkpoint);
  if (undoStack.length > historyLimit) undoStack.shift();
  checkpoint = next;
  redoStack.length = 0;
}

function restoreEdit(redo) {
  const from = redo ? redoStack : undoStack;
  const to = redo ? undoStack : redoStack;
  if (drag || paletteDrag || !from.length) return;
  to.push(checkpoint);
  checkpoint = from.pop();
  ({ parts, wires } = JSON.parse(checkpoint));
  closeEditor();
  selection = pending = placing = null;
  bends = [];
  update();
  board.focus({ preventScroll: true });
  status.textContent = redo ? "회로 편집을 다시 실행했습니다." : "회로 편집을 되돌렸습니다.";
}

paletteGroups.innerHTML = groups.map((group, index) =>
  `<button type="button" data-group="${index}" aria-pressed="${index === 0}">${group}</button>`
).join("");
palette.innerHTML = groups.map((group, index) => {
  const buttons = Object.entries(components).filter(([type, part]) => type !== "logicChip" && part.group === index).map(([type, part]) =>
    `<button type="button" data-type="${type}" aria-pressed="false"><span class="part-icon" aria-hidden="true">${part.icon}</span>${part.name}</button>`
  ).join("");
  return `<div class="palette-group" data-group="${index}" role="group" aria-label="${group}"${index ? " hidden" : ""}>${buttons}</div>`;
}).join("");

function renderAnalogChipList() {
  const group = palette.querySelector(`[data-group="${logicChipGroup}"]`);
  const chips = [...chipLibrary].slice(-32).reverse();
  group.innerHTML = chips.length
    ? chips.map(([id, chip]) => `<button type="button" data-type="${id}" aria-pressed="${placing === id}"><span class="part-icon" aria-hidden="true">▣</span>${escape(chip.name)}</button>`).join("")
    : '<p class="bench-help">논리 작업대의 ‘칩 / JSON’에서 회로를 칩으로 저장하세요. 예제 메뉴에서도 논리 칩을 시험할 수 있습니다.</p>';
}
window.addEventListener("logic-chips-change", renderAnalogChipList);
renderAnalogChipList();

paletteGroups.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const group = button.dataset.group;
  for (const item of paletteGroups.children) {
    item.setAttribute("aria-pressed", String(item === button));
  }
  for (const items of palette.children) items.hidden = items.dataset.group !== group;
});
byId("logic-chip-to-bench").addEventListener("click", () => {
  paletteGroups.querySelector(`[data-group="${logicChipGroup}"]`).click();
  location.hash = "bench";
});

function syncFullscreen() {
  const active = document.fullscreenElement === workbench || fallbackFullscreen;
  fullscreenButton.setAttribute("aria-pressed", String(active));
  byId("fullscreen-label").textContent = active ? "전체화면 종료" : "전체화면";
  workbench.classList.toggle("is-expanded", fallbackFullscreen);
  document.body.classList.toggle("workbench-expanded", fallbackFullscreen);
  positionEditor();
}

fullscreenButton.addEventListener("click", async () => {
  if (document.fullscreenElement === workbench) {
    await document.exitFullscreen();
  } else if (fallbackFullscreen) {
    fallbackFullscreen = false;
    syncFullscreen();
  } else {
    try {
      await workbench.requestFullscreen();
    } catch {
      fallbackFullscreen = true;
      workbench.scrollTop = 0;
      syncFullscreen();
    }
  }
});
document.addEventListener("fullscreenchange", syncFullscreen);

function pinPosition([id, pin]) {
  const part = parts.find((item) => item.id === id);
  const [dx, dy] = pinsFor(part)[pin];
  const radians = part.angle * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [part.x + dx * cos - dy * sin, part.y + dx * sin + dy * cos];
}

function number(value, unit) {
  if (value === undefined) return "미측정";
  return Number(value.toPrecision(4)) + " " + unit;
}

function readDC() {
  if (!dcReading && !dcError) {
    try {
      dcReading = measure(parts, wires);
    } catch (error) {
      dcError = error.message;
    }
  }
  return dcReading;
}

function boardReading() {
  if (!simulationError.hidden) return null;
  return simulation.isRunning() ? transientReading : dcReading;
}

function hideReadingTip() {
  hovered = null;
  readingTip.hidden = true;
}

function terminalLabel(part, pin) {
  if (part.type === "logicChip") return chipPackage(part.chip).labels[pin];
  return components[part.type].labels?.[pin] ?? (pin ? "오른쪽" : "왼쪽");
}

function capacitorCharge(part) {
  const voltage = voltageBetween(transientReading, [part.id, 0], [part.id, 1]);
  if (voltage === undefined) return "";
  const charge = part.value * voltage;
  const displayedCharge = Math.abs(charge) < minDisplayedChargeMicrocoulombs ? 0 : charge;
  return "Q " + number(displayedCharge, "µC");
}

function measurementText({ part, wire, pin = null }) {
  const running = simulation.isRunning();
  const reading = !running && simulationError.hidden ? readDC() : boardReading();
  const volts = (end) => reading?.volts.get(keyOf(end));
  const basis = (end) => reading?.references.get(keyOf(end)) > 0 ? "임시 기준" : "접지 기준";
  let label, voltage, amps, direction, motor;
  if (wire) {
    label = `배선 ${wire.id}`;
    voltage = basis(wire.a) + " 전압 " + number(volts(wire.a), "V");
    amps = reading?.wireCurrents.get(wire.id);
    if (amps) {
      const [from, to] = amps > 0 ? [wire.a, wire.b] : [wire.b, wire.a];
      const terminalName = ([id, index]) => {
        const device = parts.find((item) => item.id === id);
        return partName(device) + " " + id + " · " + terminalLabel(device, index);
      };
      direction = terminalName(from) + " → " + terminalName(to);
      amps = Math.abs(amps);
    }
  } else {
    const spec = components[part.type];
    const terminalName = (index) => terminalLabel(part, index);
    label = `${partName(part)} ${part.id}`;
    amps = reading?.currents.get(part.id);
    if (pin !== null || pinCount(part) === 1) {
      const end = [part.id, pin ?? 0];
      voltage = `${terminalName(end[1])} 전압 ${number(volts(end), "V")} · ${basis(end)}`;
    } else if (part.type === "logicChip") {
      voltage = chipReadout(part, reading);
    } else if (pinCount(part) === 2) {
      voltage = "양단 전압 " + number(voltageBetween(reading, [part.id, 0], [part.id, 1]), "V");
      const charge = spec.model === "capacitor" && capacitorCharge(part);
      if (charge) voltage += "\n" + charge;
    } else {
      voltage = pinsFor(part).map((_, index) =>
        `${terminalName(index)} ${number(volts([part.id, index]), "V")}`).join("\n");
    }
    if (amps) direction = terminalName(0) + " → " + terminalName(1) + " 기준";
    if (part.type === "motor") motor = motorReadout(part, reading);
  }
  const mode = running ? "실시간" : "DC";
  const current = number(amps === undefined ? undefined : amps * 1000, "mA");
  return [label + " · " + mode, voltage, "전류 " + current, direction, motor].filter(Boolean).join("\n");
}

function refreshMeasurements() {
  if (!editor.hidden && touchInput.matches) {
    const wire = editorAnchor && wires.find(({ id }) => id === selection?.id);
    if (editing || wire) {
      const detail = measurementText({ part: editing, wire });
      if (editorReading.textContent !== detail) editorReading.textContent = detail;
    }
  }
  if (!hovered) return;
  const detail = measurementText(hovered);
  const { clientX, clientY } = hovered;
  if (readingTip.textContent !== detail) readingTip.textContent = detail;
  readingTip.hidden = false;
  const bounds = boardScroll.getBoundingClientRect();
  const x = clientX - bounds.left;
  const y = clientY - bounds.top;
  const left = Math.min(x + 14, boardScroll.clientWidth - readingTip.offsetWidth - 8);
  const top = y + 16 + readingTip.offsetHeight <= boardScroll.clientHeight ? y + 16 : y - readingTip.offsetHeight - 12;
  readingTip.style.left = boardScroll.scrollLeft + Math.max(8, left) + "px";
  readingTip.style.top = boardScroll.scrollTop + Math.max(8, top) + "px";
}

board.addEventListener("pointermove", (event) => {
  if (event.pointerType === "touch" || drag || pending || placing || paletteDrag) return hideReadingTip();
  const wire = event.target.closest("[data-wire]");
  const part = event.target.closest(".part");
  if (!wire && !part) return hideReadingTip();
  hovered = {
    wire: wire && wires.find(({ id }) => id === Number(wire.dataset.wire)),
    part: part && parts.find(({ id }) => id === Number(part.dataset.part)),
    pin: event.target.hasAttribute("data-terminal") ? Number(event.target.dataset.terminal) : null,
    clientX: event.clientX, clientY: event.clientY,
  };
  refreshMeasurements();
});
board.addEventListener("pointerleave", hideReadingTip);
board.addEventListener("pointerdown", hideReadingTip);
boardScroll.addEventListener("scroll", hideReadingTip);

function lightOn(part, reading) {
  if (!components[part.type].light) return false;
  const current = reading?.currents.get(part.id) ?? 0;
  return part.type === "led" ? current > 0.0001 : current ** 2 * part.value > 1e-6;
}

function terminalVoltage(reading, id, pin) {
  const voltage = reading?.volts.get(keyOf([id, pin]));
  return voltage === undefined ? "—" : number(voltage, "V");
}

function meterCaption(part, reading) {
  if (!live) return components[part.type].name;
  if (part.type === "voltmeter") {
    return "전압계 · " + number(voltageBetween(reading, [part.id, 0], [part.id, 1]), "V");
  }
  const current = reading?.currents.get(part.id);
  return "전류계 · " + number(current === undefined ? undefined : current * 1000, "mA");
}

function motorReadout(part, reading) {
  const state = reading?.motors.get(part.id);
  if (!state) return "";
  const { rpm, backEmf } = state;
  return number(Math.abs(rpm) < 0.01 ? 0 : rpm, "rpm") +
    " · 역기전력 " + number(Math.abs(backEmf) < 1e-6 ? 0 : backEmf, "V");
}

function chipReadout(part, reading) {
  const chip = reading?.chips?.get(part.id);
  if (!chip) return "계산 대기";
  if (!chip.powered) return "전원 필요";
  const level = (value) => value === -1 ? "X" : String(value);
  const inputs = chip.inputs.map(level).join(" · ");
  const outputs = chip.outputs.map(level).join(" · ");
  return inputs ? inputs + " → " + outputs : outputs;
}

function setReadingText(element, text) {
  if (element && element.textContent !== text) element.textContent = text;
}

function refreshSolveStatus(reading) {
  solveStatus.hidden = !live;
  if (!live) return;
  const running = simulation.isRunning();
  const mode = running ? "실시간 측정" : "DC 정상상태";
  const detail = !reading
    ? (running ? "회로를 계산 중입니다." : dcError || "표시할 측정값이 없습니다.")
    : [...reading.references.values()].some((group) => group > 0)
      ? "접지에 연결되지 않은 회로는 각 회로의 임시 기준 전압을 표시합니다."
      : reading.floating ? "— 표시는 전압을 계산할 수 없는 단자입니다." : "단자에 접지 기준 전압을 표시합니다.";
  setReadingText(solveStatus, `${mode} · ${detail}`);
}

function refreshBoardReadings(reading) {
  for (const [index, part] of parts.entries()) {
    const item = partLayer.children[index];
    if (!item) continue;
    const spec = components[part.type];
    if (spec.light) item.classList.toggle("lit", lightOn(part, reading));
    if (spec.model === "capacitor") setReadingText(item.querySelector("[data-charge]"), capacitorCharge(part));
    if (spec.model === "motor") setReadingText(item.querySelector("[data-motor-reading]"), motorReadout(part, reading));
    if (part.type === "logicChip") setReadingText(item.querySelector("[data-chip-reading]"), chipReadout(part, reading));
    if (!live) continue;
    for (const label of item.querySelectorAll("[data-voltage-pin]")) {
      setReadingText(label, terminalVoltage(reading, part.id, Number(label.dataset.voltagePin)));
    }
    if (part.type === "ammeter" || part.type === "voltmeter") {
      setReadingText(item.querySelector(".part-caption"), meterCaption(part, reading));
    }
  }
  if (live) {
    refreshSolveStatus(reading);
    refreshInspectorCurrent(reading);
  }
}

function partMarkup(part) {
  const spec = components[part.type];
  const chip = part.chip && chipPackage(part.chip);
  const selected = selection?.kind === "part" && selection.id === part.id;
  const reading = boardReading();
  const isLit = lightOn(part, reading);
  let caption = chip ? partName(part) : spec.unit ? spec.name + " · " + part.value + " " + spec.unit : spec.name;
  if (part.type === "ground") caption = "GND";
  const channel = part.type === "scope" ? parts.filter(({ type }) => type === "scope").indexOf(part) : -1;
  if (channel >= 0) caption = `CH${channel + 1} · 오실로스코프`;
  if (spec.shape) caption = `${spec.icon} ${part.value} V · ${part.frequency} Hz`;
  const isMeter = part.type === "ammeter" || part.type === "voltmeter";
  if (isMeter) caption = meterCaption(part, reading);
  const terminals = Array.from({ length: pinCount(part) }, (_, pin) => {
    const [x, y] = pinPosition([part.id, pin]);
    const key = keyOf([part.id, pin]);
    const active = pending && keyOf(pending) === key;
    const label = terminalLabel(part, pin);
    return `<circle class="terminal${active ? " pending" : ""}" data-terminal="${pin}" data-part="${part.id}" cx="${x - part.x}" cy="${y - part.y}" r="7" role="button" tabindex="0" aria-label="${escape(partName(part))} ${part.id} ${escape(label)} 단자"><title>${escape(label)} · 점선 안에서 끌어 ${rotationStep}° 회전 · 밖으로 끌거나 눌러 배선 연결</title></circle>
      ${live ? `<text class="voltage-label" data-voltage-pin="${pin}" x="${x - part.x}" y="${y - part.y - 12}">${terminalVoltage(reading, part.id, pin)}</text>` : ""}`;
  }).join("");
  if (chip) {
    const verticalExtent = Math.max(...pinsFor(part).map(([x, y]) =>
      Math.abs(x * Math.sin(part.angle * Math.PI / 180) + y * Math.cos(part.angle * Math.PI / 180))));
    const short = (value, length) => escape(value.length > length ? value.slice(0, length - 1) + "…" : value);
    const labels = chip.pins.map(([x, y], index) => {
      const left = x < 0;
      const lx = x === 0 ? 0 : left ? -66 : 66;
      return `<text class="analog-chip-pin" x="${lx}" y="${y + (index === 0 ? 28 : index === 1 ? -20 : 4)}" text-anchor="${x === 0 ? "middle" : left ? "start" : "end"}">${short(chip.labels[index], 8)}</text>`;
    }).join("");
    const readout = chipReadout(part, reading);
    return `<g class="part${selected ? " selected" : ""}" data-part="${part.id}" transform="translate(${part.x} ${part.y})">
      <g data-body="${part.id}" role="button" tabindex="0" aria-label="${escape(caption)} 선택">
        <g transform="rotate(${part.angle})"><rect class="part-box" x="-72" y="${-chip.height / 2}" width="144" height="${chip.height}" rx="9"/>${labels}</g>
        <text class="part-caption" y="${verticalExtent + 20}">${short(caption, 26)}</text>
        <text class="part-caption capacitor-charge" y="${verticalExtent + 36}" data-chip-reading>${escape(readout)}</text>
      </g>${terminals}</g>`;
  }
  const captionY = Math.abs(Math.sin(part.angle * Math.PI / 180)) > 0.35 && part.type !== "ground" ? 73 : 48;
  const toggleLabel = part.type === "spdt" ? (part.value ? "B 연결" : "A 연결") :
    part.value ? "닫힘 · ON" : "열림 · OFF";
  const toggleAction = part.type === "spdt" ? (part.value ? "A로 전환" : "B로 전환") :
    part.value ? "열기" : "닫기";
  const switchControl = spec.toggle ?
    `<g class="switch-control${part.value ? " on" : ""}" data-switch="${part.id}" role="button" tabindex="0" aria-pressed="${Boolean(part.value)}" aria-label="${spec.name} ${part.id} ${toggleAction}">
      <rect x="-39" y="${captionY - 15}" width="78" height="22" rx="6"/>
      <text y="${captionY}">${toggleLabel}</text>
    </g>` : "";
  return `<g class="part${selected ? " selected" : ""}${isLit ? " lit" : ""}" data-part="${part.id}" transform="translate(${part.x} ${part.y})">
    <g data-body="${part.id}" role="button" tabindex="0" aria-label="${isMeter ? spec.name : caption} 선택">
      <rect class="part-box" x="-42" y="-29" width="84" height="58" rx="10"/>
      <path class="part-symbol" transform="rotate(${part.angle})" d="${spec.toggle && part.value ? spec.closed : spec.symbol}"/>
      ${switchControl ? "" : `<text class="part-caption" y="${captionY}"${channel >= 0 ? ` style="fill:${scopeColors[channel]}"` : ""}>${caption}</text>`}
      ${spec.model === "capacitor" ? `<text class="part-caption capacitor-charge" data-charge="${part.id}" y="${captionY + 16}">${capacitorCharge(part)}</text>` : ""}
      ${spec.model === "motor" ? `<text class="part-caption capacitor-charge" data-motor-reading y="${captionY + 16}">${motorReadout(part, reading)}</text>` : ""}
    </g>${terminals}${switchControl}</g>`;
}

function wirePath([x1, y1], [x2, y2]) {
  const middle = (x1 + x2) / 2;
  return `M${x1} ${y1}H${middle}V${y2}H${x2}`;
}

function routedPath(a, points, b) {
  return [a, ...points, b].map((position, index) => (index ? "L" : "M") + position.join(" ")).join("");
}

function drawWires() {
  wireLayer.innerHTML = wires.map(({ id, a, b, points }) => {
    const start = pinPosition(a);
    const end = pinPosition(b);
    const path = points ? routedPath(start, points, end) : wirePath(start, end);
    const selected = selection?.kind === "wire" && selection.id === id;
    const handles = selected ? (points ?? []).map(([x, y], index) =>
      `<circle class="waypoint" data-bend="${index}" cx="${x}" cy="${y}" r="6"><title>끌어서 경유점 이동</title></circle>`
    ).join("") : "";
    return `<g class="wire${selected ? " selected" : ""}" data-wire="${id}" role="button" tabindex="0" aria-label="배선 ${id} 선택"><path class="wire-line" d="${path}"/>
      <path class="flow-stream" d="${path}" aria-hidden="true"/>
      <path class="flow-arrow" d="M-6-4L4 0l-10 4" aria-hidden="true"/>
      <path class="wire-hit" d="${path}"/>${handles}</g>`;
  }).join("");
  if (flowMode) refreshFlow();
}

function refreshFlow() {
  if (!flowMode) return;
  const running = simulation.isRunning();
  const reading = boardReading();
  const currents = reading?.wireCurrents;
  let moving = 0;
  let unknown = 0;
  for (const wire of wireLayer.children) {
    const current = currents?.get(Number(wire.dataset.wire));
    const unresolved = Boolean(currents) && current === undefined;
    if (unresolved) unknown += 1;
    wire.classList.toggle("flow-unknown", unresolved);
    const direction = Math.abs(current ?? 0) >= 1e-7 ? Math.sign(current) * (flowMode === "electrons" ? -1 : 1) : 0;
    if (direction) moving += 1;
    if (wire.dataset.direction === String(direction)) continue;
    wire.dataset.direction = String(direction);
    if (!direction) continue;
    const line = wire.querySelector(".wire-line");
    const half = line.getTotalLength() / 2;
    const center = line.getPointAtLength(half);
    const before = line.getPointAtLength(Math.max(0, half - 1));
    const after = line.getPointAtLength(half + 1);
    const angle = Math.atan2(after.y - before.y, after.x - before.x) * 180 / Math.PI;
    wire.querySelector(".flow-arrow").setAttribute("transform",
      `translate(${center.x} ${center.y}) rotate(${angle + (direction < 0 ? 180 : 0)})`);
  }
  const legend = flowMode === "electrons" ? "전자 이동 · 금속 도선에서 전류 방향과 반대" : "전류 방향 · 양전하가 이동하는 방향";
  let detail = running ? "실시간 회로 시뮬레이션" : "DC 정상상태";
  if (!wires.length) detail = "단자를 배선으로 연결하세요.";
  else if (!reading) detail = running ? "회로를 계산 중입니다." : dcError;
  else if (!moving) detail += " · 표시할 흐름이 없습니다.";
  if (unknown) detail += " · 회색 점선은 방향을 정할 수 없는 배선입니다.";
  const message = legend + " | " + detail;
  if (flowStatus.textContent !== message) flowStatus.textContent = message;
}

flowControls.addEventListener("click", (event) => {
  const button = event.target.closest("[data-flow]");
  if (!button) return;
  flowMode = flowMode === button.dataset.flow ? null : button.dataset.flow;
  board.dataset.flowMode = flowMode ?? "";
  for (const item of flowControls.querySelectorAll("button")) {
    item.setAttribute("aria-pressed", String(item.dataset.flow === flowMode));
  }
  flowStatus.hidden = !flowMode;
  update();
});

function drawInspector() {
  const part = selection?.kind === "part" && parts.find(({ id }) => id === selection.id);
  inspector.hidden = !part;
  if (!part) return;
  const spec = components[part.type];
  inspector.innerHTML = `<strong>${escape(partName(part))} · ${part.id}</strong>
    <span class="part-angle">회전 각도 ${part.angle}°</span>
    ${live ? '<span id="inspector-current" hidden></span>' : ""}
    ${spec.note || spec.model === "diode" ? `<p class="bench-help">${spec.note ?? "문턱 전압과 도통 저항으로 근사한 DC 모델입니다."}</p>` : ""}`;
  refreshInspectorCurrent(boardReading());
}

function refreshInspectorCurrent(reading) {
  const label = byId("inspector-current");
  if (!label || inspector.hidden) return;
  const current = reading?.currents.get(selection.id);
  label.hidden = current === undefined;
  if (current !== undefined) {
    setReadingText(label, `전류 ${number(current * 1000, "mA")} · 회전 전 왼쪽 → 오른쪽 기준`);
  }
}

function positionEditor() {
  if (editor.hidden || getComputedStyle(editor).position === "static") return;
  const matrix = board.getScreenCTM();
  if (!matrix) return;
  const { x: anchorX, y: anchorY } = editing ?? editorAnchor;
  const anchor = new DOMPoint(anchorX, anchorY).matrixTransform(matrix);
  const bounds = boardScroll.getBoundingClientRect();
  const x = anchor.x - bounds.left;
  const y = anchor.y - bounds.top;
  const maxX = Math.max(8, boardScroll.clientWidth - editor.offsetWidth - 8);
  const maxY = Math.max(8, boardScroll.clientHeight - editor.offsetHeight - 8);
  const nextX = x + 55 <= maxX ? x + 55 : x - editor.offsetWidth - 55;
  editor.style.left = boardScroll.scrollLeft + Math.max(8, Math.min(maxX, nextX)) + "px";
  editor.style.top = boardScroll.scrollTop + Math.max(8, Math.min(maxY, y - 24)) + "px";
}

function showEditor() {
  editor.hidden = false;
  refreshMeasurements();
  if (getComputedStyle(editor).position === "static") editor.scrollIntoView({ block: "nearest" });
  else positionEditor();
}

function openEditor(part) {
  const spec = components[part.type];
  editing = part;
  byId("editor-title").textContent = partName(part);
  byId("editor-value").hidden = !spec.unit;
  editorInput.disabled = !spec.unit;
  if (spec.unit) {
    byId("editor-label").textContent = `${spec.label} (${spec.unit})`;
    editorInput.min = spec.min;
    editorInput.max = spec.max;
    editorInput.value = part.value;
  }
  byId("editor-frequency").hidden = !spec.shape;
  frequencyInput.disabled = !spec.shape;
  if (spec.shape) {
    frequencyInput.min = frequencyRange.min;
    frequencyInput.max = frequencyRange.max;
    frequencyInput.value = part.frequency;
  }
  motorEditor.hidden = motorEditor.disabled = part.type !== "motor";
  if (!motorEditor.hidden) {
    for (const input of motorInputs) input.value = part.motor?.[input.name] ?? motorSettings[input.name].initial;
  }
  byId("scope-jump").hidden = part.type !== "scope";
  byId("rotate-part").hidden = false;
  byId("editor-delete").textContent = "부품 삭제";
  showEditor();
}

function openWireEditor(wire, anchor) {
  if (!anchor) {
    const path = wireLayer.querySelector(`[data-wire="${wire.id}"] .wire-line`);
    anchor = path.getPointAtLength(path.getTotalLength() / 2);
  }
  editorAnchor = anchor;
  byId("editor-title").textContent = `배선 ${wire.id}`;
  byId("editor-value").hidden = byId("editor-frequency").hidden = true;
  editorInput.disabled = frequencyInput.disabled = true;
  motorEditor.hidden = motorEditor.disabled = true;
  byId("scope-jump").hidden = byId("rotate-part").hidden = true;
  byId("editor-delete").textContent = "배선 삭제";
  showEditor();
}

function closeEditor(restoreFocus = false) {
  const selector = editing ? `[data-body="${editing.id}"]` :
    editorAnchor && `[data-wire="${selection?.id}"]`;
  editing = editorAnchor = null;
  editor.hidden = true;
  if (restoreFocus && selector) board.querySelector(selector)?.focus({ preventScroll: true });
}

editor.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editing || !Number.isFinite(editorInput.valueAsNumber)) return;
  if (!frequencyInput.disabled) {
    if (!Number.isFinite(frequencyInput.valueAsNumber)) return;
    editing.frequency = frequencyInput.valueAsNumber;
  }
  if (!motorEditor.disabled) {
    const motor = Object.fromEntries(motorInputs.map((input) => [input.name, input.valueAsNumber]));
    if (!validMotorSettings(motor)) return;
    editing.motor = motor;
  }
  editing.value = editorInput.valueAsNumber;
  recordEdit();
  const id = editing.id;
  closeEditor();
  update();
  board.querySelector(`[data-body="${id}"]`)?.focus({ preventScroll: true });
  status.textContent = "부품 값을 바꿨습니다.";
});
byId("scope-jump").addEventListener("click", () => {
  closeEditor();
  byId("scope-panel").scrollIntoView({ block: "nearest" });
  byId("scope-run").focus({ preventScroll: true });
});
byId("editor-close").addEventListener("click", () => closeEditor(true));
byId("rotate-part").addEventListener("click", () => {
  if (!editing) return;
  editing.angle = ((Math.floor(editing.angle / rotationStep) + 1) * rotationStep) % 360;
  recordEdit();
  update();
});
boardScroll.addEventListener("scroll", positionEditor);
new ResizeObserver(positionEditor).observe(boardScroll);

function toggleSwitch(id) {
  const part = parts.find((item) => item.id === id);
  part.value = part.value ? 0 : 1;
  recordEdit();
  closeEditor();
  selection = { kind: "part", id };
  update();
  board.querySelector(`[data-switch="${id}"]`)?.focus({ preventScroll: true });
  status.textContent = part.type === "spdt" ? `${part.value ? "B" : "A"} 단자로 전환했습니다.` :
    part.value ? "스위치를 닫았습니다." : "스위치를 열었습니다.";
}

function drawDraft(end) {
  if (!pending) {
    wirePreview.setAttribute("hidden", "");
    draftPoints.innerHTML = "";
    return;
  }
  const last = bends.at(-1) ?? pinPosition(pending);
  wirePreview.setAttribute("d", routedPath(pinPosition(pending), bends, end ?? last));
  wirePreview.removeAttribute("hidden");
  draftPoints.innerHTML = bends.map(([x, y]) =>
    `<circle class="draft-point" cx="${x}" cy="${y}" r="4"/>`
  ).join("");
}

function draw() {
  drawWires();
  drawDraft();
  partLayer.innerHTML = parts.map(partMarkup).join("");
  board.classList.toggle("placing", Boolean(placing));
  byId("bench-cancel").hidden = !placing && (!pending || drag?.wiring);
  for (const button of palette.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(placing === button.dataset.type));
  }
  byId("bench-count").textContent = `부품 ${parts.length}개 · 배선 ${wires.length}개`;
  byId("empty-board").hidden = parts.length > 0 || Boolean(placing) || Boolean(paletteDrag?.moved);
  byId("clear-board").disabled = !parts.length;
  byId("example").disabled = parts.length > 0;
  refreshSolveStatus(boardReading());
  drawInspector();
  positionEditor();
}

function syncSimulation() {
  const dynamic = parts.some(isTimeDependent);
  const hasScope = parts.some(({ type }) => type === "scope");
  byId("simulation-reset").hidden = !dynamic;
  simulation.configure(parts, wires, !byId("bench").hidden && (dynamic || (hasScope && wires.length > 0)));
}

function update() {
  dcReading = null;
  dcError = "";
  transientReading = null;
  hideReadingTip();
  byId("simulate").setAttribute("aria-pressed", String(live));
  byId("bench-share-box").hidden = true;
  simulationError.hidden = true;
  syncSimulation();
  if (!simulation.isRunning() && (live || flowMode ||
      parts.some(({ type }) => type === "logicChip" || components[type].light))) readDC();
  draw();
  scope.sync(parts);
  refreshMeasurements();
}

const { view: camera, set: setCamera, point } = createBoardCamera(board, {
  width, height,
  controls: byId("zoom-reset").parentElement,
  busy: () => Boolean(drag || paletteDrag),
  onChange: () => {
    hideReadingTip();
    positionEditor();
  },
});
byId("simulation-speed").addEventListener("change", (event) => {
  const speed = Number(event.target.value);
  simulation.setSpeed(speed);
  board.style.setProperty("--flow-period", `${0.7 / speed}s`);
});

function move(part, x, y) {
  const chipPins = part.chip ? pinsFor(part) : [];
  const angle = (part.angle ?? 0) * Math.PI / 180;
  const side = Math.max(60, ...chipPins.map(([x, y]) => Math.abs(x * Math.cos(angle) - y * Math.sin(angle)) + 10));
  const top = Math.max(60, ...chipPins.map(([x, y]) => Math.abs(x * Math.sin(angle) + y * Math.cos(angle)) + 22));
  part.x = Math.max(side, Math.min(width - side, Math.round(x / 10) * 10));
  const bottom = Math.max(80, part.chip ? top + 28 : 80);
  part.y = Math.max(top, Math.min(height - bottom, Math.round(y / 10) * 10));
}

function addPart(type, x, y, chip = chipLibrary.get(type)) {
  if (chip) type = "logicChip";
  const part = { id: nextId++, type, x, y, angle: 0, value: components[type].value };
  if (chip) part.chip = chip;
  if (components[type].shape) part.frequency = frequencyRange.initial;
  move(part, x, y);
  parts.push(part);
  return part;
}

function canPlace(type) {
  if (parts.length >= maxParts) {
    status.textContent = `부품은 최대 ${maxParts}개까지 배치할 수 있습니다.`;
    return;
  }
  if (type === "scope" && parts.filter(({ type }) => type === "scope").length >= 4) {
    status.textContent = "오실로스코프는 최대 4개까지 연결할 수 있습니다.";
    return;
  }
  return true;
}

function place(x, y) {
  if (!canPlace(placing)) return;
  const part = addPart(placing, x, y);
  recordEdit();
  selection = { kind: "part", id: part.id };
  placing = null;
  update();
  status.textContent = part.chip ? "VCC와 GND에 전원을 연결하고 입력·출력 핀을 배선하세요." :
    `${partName(part)} 배치 완료. 단자를 눌러 연결하세요.`;
}

function sameWire(wire, a, b) {
  const [first, second] = [keyOf(a), keyOf(b)];
  return (keyOf(wire.a) === first && keyOf(wire.b) === second) ||
    (keyOf(wire.a) === second && keyOf(wire.b) === first);
}

function bendAt(x, y) {
  return [
    Math.max(0, Math.min(width, Math.round(x))),
    Math.max(0, Math.min(height, Math.round(y))),
  ];
}

function startWire(end) {
  closeEditor();
  pending = end;
  bends = [];
  selection = null;
  status.textContent = "다른 단자에 연결하세요. 빈 곳을 누르면 경유점을 추가할 수 있습니다.";
  draw();
}

function connect(id, pin) {
  const end = [id, pin];
  if (!pending) {
    startWire(end);
    return;
  }
  closeEditor();
  if (keyOf(end) === keyOf(pending)) {
    status.textContent = "배선 연결을 취소했습니다.";
  } else if (wires.some((wire) => sameWire(wire, pending, end))) {
    status.textContent = "이미 연결된 단자입니다.";
  } else if (wires.length === maxWires) {
    status.textContent = `배선은 최대 ${maxWires}개까지 연결할 수 있습니다.`;
  } else {
    const wire = { id: nextId++, a: pending, b: end, points: bends };
    wires.push(wire);
    recordEdit();
    selection = { kind: "wire", id: wire.id };
    status.textContent = "배선을 연결했습니다.";
  }
  pending = null;
  bends = [];
  update();
}

function activate(target, anchor) {
  const terminal = target.closest("[data-terminal]");
  const body = target.closest("[data-body]");
  const wire = target.closest("[data-wire]");
  const toggle = target.closest("[data-switch]");
  if (toggle) {
    toggleSwitch(Number(toggle.dataset.switch));
    return;
  }
  closeEditor();
  if (terminal) {
    connect(Number(terminal.dataset.part), Number(terminal.dataset.terminal));
    return;
  }
  pending = null;
  selection = body ? { kind: "part", id: Number(body.dataset.body) } :
    wire ? { kind: "wire", id: Number(wire.dataset.wire) } : null;
  status.textContent = defaultStatus;
  draw();
  if (body) openEditor(parts.find((part) => part.id === selection.id));
  else if (wire) openWireEditor(wires.find(({ id }) => id === selection.id), anchor);
}

function dropPoint(event) {
  if (!document.elementFromPoint(event.clientX, event.clientY)?.closest("#board")) return null;
  const position = point(event);
  return position.x >= 0 && position.x <= width && position.y >= 0 && position.y <= height ? position : null;
}

palette.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-type]");
  if (!event.isPrimary || !button || event.button !== 0 || paletteDrag) return;
  suppressPaletteClick = false;
  paletteDrag = { type: button.dataset.type, pointer: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  button.setPointerCapture(event.pointerId);
});
palette.addEventListener("pointermove", (event) => {
  if (paletteDrag?.pointer !== event.pointerId) return;
  if (!paletteDrag.moved) {
    if (Math.hypot(event.clientX - paletteDrag.x, event.clientY - paletteDrag.y) < 7) return;
    paletteDrag.moved = true;
    suppressPaletteClick = true;
    closeEditor();
    placing = pending = null;
    const chip = chipLibrary.get(paletteDrag.type);
    const spec = chip ? components.logicChip : components[paletteDrag.type];
    placementPreview.innerHTML = `<rect x="-42" y="-29" width="84" height="58" rx="10"/>
      <path d="${spec.symbol ?? ""}"/><text y="49">${escape(chip?.name ?? spec.name)}</text>`;
    workbench.classList.add("placing-by-drag");
    status.textContent = "회로도 안에서 놓으면 부품이 추가됩니다.";
    draw();
  }
  const position = dropPoint(event);
  placementPreview.toggleAttribute("hidden", !position);
  if (position) {
    const preview = { type: "logicChip", chip: chipLibrary.get(paletteDrag.type) };
    move(preview, position.x, position.y);
    placementPreview.setAttribute("transform", `translate(${preview.x} ${preview.y})`);
  }
});

function finishPaletteDrag(event, cancelled = false) {
  if (paletteDrag?.pointer !== event.pointerId) return;
  const { type, moved } = paletteDrag;
  paletteDrag = null;
  if (!moved) return;
  workbench.classList.remove("placing-by-drag");
  placementPreview.setAttribute("hidden", "");
  const position = cancelled ? null : dropPoint(event);
  if (position) {
    placing = type;
    place(position.x, position.y);
  } else {
    status.textContent = defaultStatus;
    draw();
  }
}
palette.addEventListener("pointerup", (event) => finishPaletteDrag(event));
palette.addEventListener("pointercancel", (event) => finishPaletteDrag(event, true));
palette.addEventListener("lostpointercapture", (event) => finishPaletteDrag(event, true));

palette.addEventListener("click", (event) => {
  if (suppressPaletteClick && event.detail) {
    suppressPaletteClick = false;
    return;
  }
  const button = event.target.closest("[data-type]");
  if (!button) return;
  closeEditor();
  placing = placing === button.dataset.type ? null : button.dataset.type;
  pending = null;
  status.textContent = placing ? "작업대에서 원하는 위치를 누르거나 Enter로 배치하세요." : defaultStatus;
  draw();
});
function bearing(part, x, y) {
  return Math.atan2(y - part.y, x - part.x) * 180 / Math.PI;
}

function terminalAt(event) {
  return document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-terminal]");
}

function draftEnd(event, x, y) {
  const terminal = terminalAt(event);
  return terminal ? pinPosition([Number(terminal.dataset.part), Number(terminal.dataset.terminal)]) : [x, y];
}

board.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || drag || placing || paletteDrag) return;
  const panOnEmpty = event.button === 0 && event.target === boardSurface && !pending;
  if (camera.zoom > 1 && (event.button === 1 || panOnEmpty)) {
    const matrix = board.getScreenCTM();
    drag = { camera: { ...camera }, clientX: event.clientX, clientY: event.clientY,
      scale: matrix.a, pointer: event.pointerId, moved: false, panOnEmpty };
    if (event.button === 1) event.preventDefault();
    board.setPointerCapture(event.pointerId);
    return;
  }
  if (event.button !== 0 || event.target.closest("[data-switch]")) return;
  const handle = event.target.closest("[data-bend]");
  if (handle) {
    const wire = wires.find(({ id }) => id === Number(handle.closest("[data-wire]").dataset.wire));
    const index = Number(handle.dataset.bend);
    drag = { wire, index, start: wire.points[index], pointer: event.pointerId };
    board.setPointerCapture(event.pointerId);
    return;
  }
  const terminal = event.target.closest("[data-terminal]");
  const body = event.target.closest("[data-body]");
  if ((!terminal && !body) || (terminal && pending)) return;
  const id = Number(terminal ? terminal.dataset.part : body.dataset.body);
  const part = parts.find((item) => item.id === id);
  const { x, y } = point(event);
  drag = {
    part, x, y, startX: part.x, startY: part.y, startAngle: part.angle,
    bearing: bearing(part, x, y), pin: terminal ? Number(terminal.dataset.terminal) : null,
    pointer: event.pointerId, moved: false,
  };
  if (terminal) {
    drag.rotationRadius = Math.max(42, ...pinsFor(part).map(([dx, dy]) => Math.hypot(dx, dy))) + 34;
    rotationGuide.setAttribute("cx", part.x);
    rotationGuide.setAttribute("cy", part.y);
    rotationGuide.setAttribute("r", drag.rotationRadius);
    rotationGuide.removeAttribute("hidden");
    status.textContent = `점선 안에서 ${rotationStep}°씩 회전합니다. 점선 밖으로 끌면 배선을 시작합니다.`;
  }
  board.setPointerCapture(event.pointerId);
});
board.addEventListener("pointermove", (event) => {
  if (!drag && !pending) return;
  if (drag?.camera) {
    if (drag.pointer !== event.pointerId) return;
    const dx = event.clientX - drag.clientX;
    const dy = event.clientY - drag.clientY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    board.classList.add("panning");
    setCamera(drag.camera.zoom, drag.camera.x - dx / drag.scale, drag.camera.y - dy / drag.scale);
    return;
  }
  const { x, y } = point(event);
  if (!drag) {
    if (pending) {
      const terminal = event.target.closest("[data-terminal]");
      const end = terminal ? pinPosition([Number(terminal.dataset.part), Number(terminal.dataset.terminal)]) : [x, y];
      drawDraft(end);
    }
    return;
  }
  if (drag.pointer !== event.pointerId) return;
  if (drag.wire) {
    drag.wire.points[drag.index] = bendAt(x, y);
    byId("bench-share-box").hidden = true;
    drawWires();
    return;
  }
  if (drag.wiring) {
    drawDraft(draftEnd(event, x, y));
    return;
  }
  if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 5) return;
  const { part, pin } = drag;
  const radius = Math.hypot(x - part.x, y - part.y);
  if (pin !== null && radius > drag.rotationRadius) {
    drag.wiring = true;
    part.angle = drag.startAngle;
    rotationGuide.setAttribute("hidden", "");
    board.classList.remove("rotating-part");
    byId("bench-share-box").hidden = true;
    startWire([part.id, pin]);
    drawDraft(draftEnd(event, x, y));
    return;
  }
  if (!drag.moved) {
    drag.moved = true;
    closeEditor();
    pending = null;
    selection = { kind: "part", id: part.id };
    board.classList.add(pin === null ? "moving-part" : "rotating-part");
    drawDraft();
    byId("bench-share-box").hidden = true;
  }
  const item = partLayer.querySelector(`.part[data-part="${part.id}"]`);
  if (pin === null) {
    move(part, drag.startX + x - drag.x, drag.startY + y - drag.y);
    item.setAttribute("transform", `translate(${part.x} ${part.y})`);
  } else {
    if (radius > 8) {
      const delta = bearing(part, x, y) - drag.bearing;
      const snapped = Math.round((drag.startAngle + delta) / rotationStep) * rotationStep;
      part.angle = (snapped + 720) % 360;
    }
    item.outerHTML = partMarkup(part);
    status.textContent = `회전 중 · ${part.angle}°`;
  }
  drawWires();
});
board.addEventListener("pointerleave", () => drawDraft());

function finishDrag(event, cancelled = false) {
  if (drag?.pointer !== event.pointerId) return;
  // Touch can send a click to the newly drawn surface after pointerup.
  suppressBoardClick = !cancelled;
  if (drag.camera) {
    const previous = drag;
    drag = null;
    board.classList.remove("panning");
    if (cancelled) setCamera(previous.camera.zoom, previous.camera.x, previous.camera.y);
    else if (!previous.moved && previous.panOnEmpty) activate(boardSurface);
    return;
  }
  if (drag.wire) {
    if (cancelled) drag.wire.points[drag.index] = drag.start;
    else recordEdit();
    drag = null;
    draw();
    return;
  }
  const { part, pin, moved, wiring, startX, startY, startAngle } = drag;
  drag = null;
  rotationGuide.setAttribute("hidden", "");
  board.classList.remove("moving-part", "rotating-part");
  if (cancelled) {
    if (wiring) pending = null;
    Object.assign(part, { x: startX, y: startY, angle: startAngle });
    status.textContent = defaultStatus;
    draw();
    return;
  }
  if (wiring) {
    const terminal = terminalAt(event);
    if (terminal) connect(Number(terminal.dataset.part), Number(terminal.dataset.terminal));
    else {
      const position = dropPoint(event);
      draw();
      if (position) drawDraft([position.x, position.y]);
    }
    return;
  }
  if (!moved && pin !== null) {
    connect(part.id, pin);
    return;
  }
  selection = { kind: "part", id: part.id };
  pending = null;
  if (moved) recordEdit();
  status.textContent = !moved ? defaultStatus : pin === null ? "부품 위치를 바꿨습니다." :
    `부품을 ${part.angle}°로 회전했습니다.`;
  draw();
  if (!moved) openEditor(part);
}
board.addEventListener("pointerup", (event) => finishDrag(event));
board.addEventListener("pointercancel", (event) => finishDrag(event, true));
board.addEventListener("lostpointercapture", (event) => finishDrag(event, true));
board.addEventListener("pointerdown", () => { suppressBoardClick = false; }, true);
board.addEventListener("click", (event) => {
  if (suppressBoardClick && event.detail) return;
  if (placing) {
    const position = dropPoint(event);
    if (position) place(position.x, position.y);
  } else if (pending && event.target === boardSurface) {
    if (bends.length === maxPoints) {
      status.textContent = `배선 하나에 경유점을 최대 ${maxPoints}개까지 추가할 수 있습니다.`;
      return;
    }
    const { x, y } = point(event);
    bends.push(bendAt(x, y));
    drawDraft();
    status.textContent = `경유점 ${bends.length}개 · 두 번째 단자를 눌러 연결하세요. Backspace로 마지막 점을 지울 수 있습니다.`;
  } else if (event.target !== board) {
    activate(event.target, point(event));
  }
});
byId("bench-cancel").addEventListener("click", () => {
  pending = placing = null;
  bends = [];
  status.textContent = defaultStatus;
  draw();
});
document.addEventListener("keydown", (event) => {
  if (byId("bench").hidden) return;
  if (event.key === "Escape" && paletteDrag) {
    finishPaletteDrag({ pointerId: paletteDrag.pointer }, true);
    return;
  }
  if (event.key === "Escape" && !editor.hidden) {
    event.preventDefault();
    closeEditor(true);
    return;
  }
  if (isTextEditing(event.target) || event.isComposing || event.altKey) return;
  if (event.ctrlKey || event.metaKey) {
    if (event.key.toLowerCase() === "z" || event.code === "KeyZ") {
      event.preventDefault();
      restoreEdit(event.shiftKey);
    }
    return;
  }
  if (event.key === "Backspace" && pending && bends.length) {
    event.preventDefault();
    bends.pop();
    drawDraft();
    status.textContent = "마지막 경유점을 지웠습니다.";
  } else if (event.key === "Escape") {
    if (fallbackFullscreen && !drag && !pending && !placing) {
      fallbackFullscreen = false;
      syncFullscreen();
      fullscreenButton.focus();
      return;
    }
    if (drag) finishDrag({ pointerId: drag.pointer }, true);
    pending = null;
    placing = null;
    status.textContent = defaultStatus;
    draw();
  } else if (event.key === "Delete" && selection) {
    event.preventDefault();
    deleteSelection();
  } else if (event.key === "Enter" && placing && event.target.closest("#palette")) {
    event.preventDefault();
    place(120 + (parts.length % 7) * 115, 100 + Math.floor(parts.length / 7) * 85);
  } else if (event.target.closest("#board") && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    const target = event.target;
    const selector = target.hasAttribute("data-switch") ? `[data-switch="${target.dataset.switch}"]` :
      target.hasAttribute("data-terminal") ?
      `[data-part="${target.dataset.part}"][data-terminal="${target.dataset.terminal}"]` :
      target.hasAttribute("data-body") ? `[data-body="${target.dataset.body}"]` :
      `[data-wire="${target.dataset.wire}"]`;
    activate(target);
    if (!editor.hidden) {
      (editorInput.disabled ? byId("editor-delete") : editorInput).focus({ preventScroll: true });
    } else board.querySelector(selector)?.focus();
  }
});
function isTextEditing(target) {
  return target.closest?.("input, textarea, select") || target.isContentEditable;
}

function canUseClipboard(event) {
  return !byId("bench").hidden && !isTextEditing(event.target) && !drag && !paletteDrag && event.clipboardData;
}

for (const action of ["copy", "cut"]) {
  document.addEventListener(action, (event) => {
    if (!canUseClipboard(event) || selection?.kind !== "part" || !getSelection().isCollapsed) return;
    const part = parts.find(({ id }) => id === selection.id);
    event.clipboardData.setData("text/plain", clipboardPrefix + JSON.stringify(part));
    event.preventDefault();
    if (action === "cut") deleteSelection();
    status.textContent = `${partName(part)} ${action === "cut" ? "잘라내기" : "복사"} 완료.`;
  });
}

document.addEventListener("paste", (event) => {
  if (!canUseClipboard(event)) return;
  const text = event.clipboardData.getData("text/plain");
  if (!text.startsWith(clipboardPrefix) || text.length > maxSharedLength) return;
  let saved;
  try {
    saved = JSON.parse(text.slice(clipboardPrefix.length));
  } catch {
    return;
  }
  if (!saved || !Object.hasOwn(components, saved.type)) return;
  const { type, value, frequency, angle, x, y, motor } = saved;
  let chip;
  if (type === "logicChip") {
    try { chip = validateChip(saved.chip); } catch { return; }
  }
  const spec = components[type];
  if (![x, y, value].every(Number.isFinite) || !Number.isInteger(angle) || angle < 0 || angle >= 360 ||
      value < (spec.min ?? 0) || value > (spec.max ?? (spec.toggle ? 1 : 0)) ||
      (spec.toggle && ![0, 1].includes(value)) ||
      (spec.shape && (!Number.isFinite(frequency) || frequency < frequencyRange.min || frequency > frequencyRange.max)) ||
      (type === "motor" && !validMotorSettings(motor))) return;
  event.preventDefault();
  if (!canPlace(type)) return;
  const right = camera.x + width / camera.zoom;
  const bottom = camera.y + height / camera.zoom;
  const candidates = [[x + 100, y], [x - 100, y], [x, y + 90], [x, y - 90]];
  const [left, top] = candidates.find(([a, b]) => a > camera.x + 40 && a < right - 40 &&
    b > camera.y + 30 && b < bottom - 30 && a >= 60 && a <= width - 60 && b >= 60 && b <= height - 80 &&
    !parts.some((part) => Math.abs(part.x - a) < 85 && Math.abs(part.y - b) < 65)) ?? [(camera.x + right) / 2, (camera.y + bottom) / 2];
  const part = addPart(type, left, top, chip);
  Object.assign(part, { value, angle, ...(spec.shape ? { frequency } : {}) });
  if (chip) move(part, left, top);
  if (type === "motor" && motor) part.motor = cleanMotorSettings(motor);
  recordEdit();
  closeEditor();
  selection = { kind: "part", id: part.id };
  placing = pending = null;
  bends = [];
  update();
  openEditor(part);
  board.querySelector(`[data-body="${part.id}"]`)?.focus({ preventScroll: true });
  status.textContent = `${partName(part)} 붙여넣기 완료.`;
});

function deleteSelection() {
  if (!selection || drag || paletteDrag) return;
  closeEditor();
  const { kind, id } = selection;
  if (kind === "part") {
    parts = parts.filter((part) => part.id !== id);
    wires = wires.filter(({ a, b }) => a[0] !== id && b[0] !== id);
  } else {
    wires = wires.filter((wire) => wire.id !== id);
  }
  recordEdit();
  selection = pending = null;
  bends = [];
  update();
  board.focus({ preventScroll: true });
  status.textContent = kind === "part" ? "부품과 연결된 배선을 지웠습니다." : "배선을 지웠습니다.";
}
byId("editor-delete").addEventListener("click", deleteSelection);
byId("clear-board").addEventListener("click", () => {
  if (drag || paletteDrag) return;
  closeEditor();
  parts = [];
  wires = [];
  recordEdit();
  simulation.reset();
  scope.clear();
  selection = pending = placing = null;
  live = false;
  update();
  status.textContent = "작업대를 비웠습니다.";
});
byId("simulation-reset").addEventListener("click", () => {
  simulation.reset();
  scope.clear();
  update();
  status.textContent = "시뮬레이션 시간과 부품에 저장된 에너지를 초기화했습니다.";
});
byId("simulate").addEventListener("click", () => {
  live = !live;
  update();
});
function addWaveExample(kind) {
  const ac = kind === "ac";
  const source = addPart(ac ? "sine" : "source", 160, 315);
  source.angle = 90;
  const resistor = addPart("resistor", 510, 130);
  resistor.value = ac ? 1000 : 10000;
  const cap = addPart("capacitor", 640, 265);
  cap.angle = 90;
  const inputProbe = ac ? addPart("scope", 315, 265) : null;
  const probe = addPart("scope", 775, 265);
  probe.angle = 90;
  const ground = addPart("ground", 500, 420);
  const negative = [ground.id, 0];
  function wire(a, b, points) {
    wires.push({ id: nextId++, a, b, ...(points ? { points } : {}) });
  }
  wire([source.id, 1], negative, [[160, 394], [500, 394]]);
  wire([resistor.id, 1], [cap.id, 0], [[640, 130]]);
  wire([cap.id, 1], negative, [[640, 394]]);
  wire([cap.id, 0], [probe.id, 0]);
  wire([cap.id, 1], [probe.id, 1]);
  if (ac) {
    source.frequency = 10;
    wire([source.id, 0], [resistor.id, 0], [[160, 130]]);
    inputProbe.angle = 90;
    wire([source.id, 0], [inputProbe.id, 0], [[250, 265], [250, 215]]);
    wire([inputProbe.id, 1], negative, [[315, 394]]);
    status.textContent = "오실로스코프에서 RC 필터의 입력과 출력을 비교해 보세요.";
  } else {
    const toggle = addPart("spdt", 345, 130);
    toggle.angle = 180;
    toggle.value = 1;
    wire([source.id, 0], [toggle.id, 1], [[160, 148]]);
    wire([toggle.id, 2], negative, [[255, 112], [255, 394], [500, 394]]);
    wire([toggle.id, 0], [resistor.id, 0]);
    status.textContent = "스위치를 A로 바꾸면 충전, B로 바꾸면 방전됩니다.";
  }
  byId("scope-window").value = ac ? "0.2" : "5";
  recordEdit();
  selection = pending = placing = null;
  live = false;
  simulation.reset();
  scope.clear();
  update();
}

const examplePicker = byId("example-type");
bindExamplePicker(examplePicker, byId("example-guide"), analogExamples);
byId("example").addEventListener("click", () => {
  if (parts.length) return;
  const kind = examplePicker.value;
  const example = analogExamples[kind];
  if (example.parts) {
    buildExample(example, (type, x, y, options) => Object.assign(addPart(type, x, y, options?.chip), options),
      (a, b, points) => wires.push({ id: nextId++, a, b, ...(points ? { points } : {}) }));
    recordEdit();
    selection = pending = placing = null;
    live = !example.scopeWindow;
    if (example.scopeWindow) byId("scope-window").value = example.scopeWindow;
    simulation.reset();
    scope.clear();
    update();
    status.textContent = example.try;
    return;
  }
  if (kind !== "lamp") {
    addWaveExample(kind);
    return;
  }
  const source = addPart("source", 190, 350);
  source.angle = 90;
  const resistor = addPart("resistor", 350, 160);
  const lamp = addPart("lamp", 570, 160);
  const toggle = addPart("switch", 740, 300);
  toggle.angle = 90;
  const ground = addPart("ground", 460, 460);
  for (const [a, b] of [
    [[source.id, 0], [resistor.id, 0]], [[resistor.id, 1], [lamp.id, 0]],
    [[lamp.id, 1], [toggle.id, 0]], [[toggle.id, 1], [source.id, 1]],
    [[source.id, 1], [ground.id, 0]],
  ]) wires.push({ id: nextId++, a, b });
  recordEdit();
  selection = { kind: "part", id: toggle.id };
  pending = placing = null;
  live = true;
  update();
  status.textContent = "회로도에서 스위치의 OFF 버튼을 눌러 램프를 켜 보세요.";
});

byId("bench-share").addEventListener("click", () => {
  const url = new URL(location.href);
  url.hash = "bench=" + encodeURIComponent(JSON.stringify({ v: 1, parts, wires }));
  if (url.hash.length > maxSharedLength) {
    status.textContent = "공유 링크가 너무 깁니다. 부품이나 칩 수를 줄여 주세요.";
    return;
  }
  const field = byId("bench-link");
  field.value = url.href;
  byId("bench-share-box").hidden = false;
  field.select();
  field.focus();
});
byId("bench-copy").addEventListener("click", async () => {
  const field = byId("bench-link");
  try {
    await navigator.clipboard.writeText(field.value);
    status.textContent = "회로 공유 링크를 복사했습니다.";
  } catch {
    field.focus();
    field.select();
    status.textContent = "선택된 링크를 복사해 주세요.";
  }
});

let loadedHash;
function route() {
  const hash = location.hash;
  const rc = hash === "#rc" || hash.startsWith("#lab=");
  const logic = hash === "#logic" || hash.startsWith("#logic=");
  if (rc || logic) {
    closeEditor();
    hideReadingTip();
    if (fallbackFullscreen) {
      fallbackFullscreen = false;
      syncFullscreen();
    }
    if (document.fullscreenElement === workbench) document.exitFullscreen().catch(syncFullscreen);
  }
  byId("logic-workbench").hidden = !logic;
  byId("open-logic").setAttribute("aria-current", logic ? "page" : "false");
  byId("bench").hidden = rc || logic;
  byId("rc-lab").hidden = !rc;
  byId("share").hidden = !rc;
  byId("open-bench").setAttribute("aria-current", (rc || logic) ? "false" : "page");
  if (rc || !hash.startsWith("#bench=") || hash === loadedHash) {
    syncSimulation();
    return;
  }
  loadedHash = hash;
  try {
    if (hash.length > maxSharedLength) throw new Error();
    const saved = JSON.parse(decodeURIComponent(hash.slice(7)));
    if (saved.v !== 1 || !Array.isArray(saved.parts) || !Array.isArray(saved.wires) ||
        saved.parts.length > maxParts || saved.wires.length > maxWires) throw new Error();
    const ids = new Set();
    function validId(id) {
      if (!Number.isInteger(id) || id <= 0 || id > 1000000000 || ids.has(id)) return false;
      ids.add(id);
      return true;
    }
    const loadedParts = new Map();
    for (const part of saved.parts) {
      if (!part || !Object.hasOwn(components, part.type) || !validId(part.id)) throw new Error();
      const spec = components[part.type];
      if (!Number.isFinite(part.value) || part.value < (spec.min ?? 0) ||
          part.value > (spec.max ?? (spec.toggle ? 1 : 0)) ||
          (spec.toggle && ![0, 1].includes(part.value)) ||
          (!Number.isInteger(part.angle) || part.angle < 0 || part.angle >= 360) ||
          !Number.isFinite(part.x) || !Number.isFinite(part.y)) throw new Error();
      const clean = { id: part.id, type: part.type, value: part.value, angle: part.angle };
      if (part.type === "logicChip") clean.chip = validateChip(part.chip);
      if (spec.shape) {
        if (!Number.isFinite(part.frequency) || part.frequency < frequencyRange.min ||
            part.frequency > frequencyRange.max) throw new Error();
        clean.frequency = part.frequency;
      }
      if (part.type === "motor" && part.motor !== undefined) {
        if (!validMotorSettings(part.motor)) throw new Error();
        clean.motor = cleanMotorSettings(part.motor);
      }
      move(clean, part.x, part.y);
      loadedParts.set(clean.id, clean);
    }
    if ([...loadedParts.values()].filter(({ type }) => type === "scope").length > 4) throw new Error();
    const validEnd = (end) => Array.isArray(end) && end.length === 2 && loadedParts.has(end[0]) &&
      Number.isInteger(end[1]) && end[1] >= 0 && end[1] < pinCount(loadedParts.get(end[0]));
    const loadedWires = [];
    for (const wire of saved.wires) {
      if (!wire || !validId(wire.id) || !validEnd(wire.a) || !validEnd(wire.b) ||
          keyOf(wire.a) === keyOf(wire.b) || loadedWires.some((item) => sameWire(item, wire.a, wire.b))) throw new Error();
      const cleanWire = { id: wire.id, a: wire.a, b: wire.b };
      if (wire.points !== undefined) {
        if (!Array.isArray(wire.points) || wire.points.length > maxPoints ||
            !wire.points.every((point) => Array.isArray(point) && point.length === 2 &&
              point.every(Number.isInteger) && point[0] >= 0 && point[0] <= width &&
              point[1] >= 0 && point[1] <= height)) throw new Error();
        cleanWire.points = wire.points;
      }
      loadedWires.push(cleanWire);
    }
    closeEditor();
    simulation.reset();
    scope.clear();
    parts = [...loadedParts.values()];
    wires = loadedWires;
    undoStack.length = redoStack.length = 0;
    checkpoint = JSON.stringify({ parts, wires });
    nextId = Math.max(0, ...ids) + 1;
    selection = pending = placing = null;
    live = true;
    update();
    status.textContent = "공유 링크의 회로를 불러왔습니다.";
  } catch {
    status.textContent = "공유 링크에서 회로를 읽을 수 없습니다.";
  }
}

window.addEventListener("hashchange", route);
update();
route();
