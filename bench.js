import { components, frequencyRange, groups, pinsFor } from "./components.js";
import { pinCount, keyOf, measure } from "./circuit.js";
import { createScope, scopeColors } from "./oscilloscope.js";
import { createSimulation, isTimeDependent } from "./simulation.js";
import { wireCurrents } from "./wire-currents.js";

const byId = (id) => document.getElementById(id);
const board = byId("board");
const partLayer = byId("part-layer");
const wireLayer = byId("wire-layer");
const wirePreview = byId("wire-preview");
const draftPoints = byId("draft-points");
const editor = byId("part-editor");
const editorInput = byId("part-value");
const frequencyInput = byId("part-frequency");
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
let parts = [];
let wires = [];
let nextId = 1;
let placing = null;
let paletteDrag = null;
let suppressPaletteClick = false;
let fallbackFullscreen = false;
let selection = null;
let pending = null;
let bends = [];
let editing = null;
let drag = null;
let live = false;
let result = null;
let flowMode = null;
let dcReading = null;
let dcError = "";
let transientReading = null;
const scope = createScope();
const simulation = createSimulation(scope.sample, (reading) => {
  transientReading = reading;
  if (flowMode) refreshFlow();
  for (const part of parts) {
    if (!components[part.type].light) continue;
    partLayer.querySelector(`.part[data-part="${part.id}"]`)?.classList.toggle("lit", lightOn(part, reading));
  }
  scope.render();
}, (error) => {
  transientReading = null;
  simulationError.textContent = error.message;
  simulationError.hidden = false;
  draw();
});

paletteGroups.innerHTML = groups.map((group, index) =>
  `<button type="button" data-group="${index}" aria-pressed="${index === 0}">${group}</button>`
).join("");
palette.innerHTML = groups.map((group, index) => {
  const buttons = Object.entries(components).filter(([, part]) => part.group === index).map(([type, part]) =>
    `<button type="button" data-type="${type}" aria-pressed="false"><span class="part-icon" aria-hidden="true">${part.icon}</span>${part.name}</button>`
  ).join("");
  return `<div class="palette-group" data-group="${index}" role="group" aria-label="${group}"${index ? " hidden" : ""}>${buttons}</div>`;
}).join("");

paletteGroups.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const group = button.dataset.group;
  for (const item of paletteGroups.children) {
    item.setAttribute("aria-pressed", String(item === button));
  }
  for (const items of palette.children) items.hidden = items.dataset.group !== group;
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

function lightOn(part, reading) {
  if (!components[part.type].light) return false;
  const current = reading?.currents.get(part.id) ?? 0;
  return part.type === "led" ? current > 0.0001 : current ** 2 * part.value > 1e-6;
}

function partMarkup(part) {
  const spec = components[part.type];
  const selected = selection?.kind === "part" && selection.id === part.id;
  const current = result?.currents.get(part.id);
  const isLit = lightOn(part, transientReading ?? dcReading);
  let caption = spec.unit ? spec.name + " · " + part.value + " " + spec.unit : spec.name;
  if (part.type === "ground") caption = "GND";
  const channel = part.type === "scope" ? parts.filter(({ type }) => type === "scope").indexOf(part) : -1;
  if (channel >= 0) caption = `CH${channel + 1} · 오실로스코프`;
  if (spec.shape) caption = `${spec.icon} ${part.value} V · ${part.frequency} Hz`;
  if (part.type === "ammeter" && result) caption = "전류계 · " + number(current === undefined ? undefined : current * 1000, "mA");
  if (part.type === "voltmeter" && result) {
    const a = result.volts.get(keyOf([part.id, 0]));
    const b = result.volts.get(keyOf([part.id, 1]));
    caption = "전압계 · " + number(a === undefined || b === undefined ? undefined : a - b, "V");
  }
  const terminals = Array.from({ length: pinCount(part) }, (_, pin) => {
    const [x, y] = pinPosition([part.id, pin]);
    const key = keyOf([part.id, pin]);
    const active = pending && keyOf(pending) === key;
    const label = spec.labels?.[pin] ?? (pin ? "오른쪽" : "왼쪽");
    const value = result?.volts.get(key);
    return `<circle class="terminal${active ? " pending" : ""}" data-terminal="${pin}" data-part="${part.id}" cx="${x - part.x}" cy="${y - part.y}" r="7" role="button" tabindex="0" aria-label="${spec.name} ${part.id} ${label} 단자"><title>클릭해 배선 연결 · 끌어서 회전</title></circle>
      ${result ? `<text class="voltage-label" x="${x - part.x}" y="${y - part.y - 12}">${value === undefined ? "—" : number(value, "V")}</text>` : ""}`;
  }).join("");
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
    <g data-body="${part.id}" role="button" tabindex="0" aria-label="${caption} 선택">
      <rect class="part-box" x="-42" y="-29" width="84" height="58" rx="10"/>
      <path class="part-symbol" transform="rotate(${part.angle})" d="${spec.toggle && part.value ? spec.closed : spec.symbol}"/>
      ${switchControl ? "" : `<text class="part-caption" y="${captionY}"${channel >= 0 ? ` style="fill:${scopeColors[channel]}"` : ""}>${caption}</text>`}
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
  const reading = running ? transientReading : dcReading;
  const currents = reading ? wireCurrents(parts, wires, reading) : null;
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
  const current = result?.currents.get(part.id);
  const spec = components[part.type];
  inspector.innerHTML = `<strong>${spec.name} · ${part.id}</strong>
    <span class="part-angle">회전 각도 ${part.angle}°</span>
    ${current !== undefined ? `<span>전류 ${number(current * 1000, "mA")} · 회전 전 왼쪽 → 오른쪽 기준</span>` : ""}
    ${spec.note || spec.model === "diode" ? `<p class="bench-help">${spec.note ?? "문턱 전압과 도통 저항으로 근사한 DC 모델입니다."}</p>` : ""}`;
}

function positionEditor() {
  const matrix = board.getScreenCTM();
  if (editor.hidden || !editing || !matrix) return;
  const anchor = new DOMPoint(editing.x, editing.y).matrixTransform(matrix);
  const bounds = boardScroll.getBoundingClientRect();
  const x = anchor.x - bounds.left;
  const y = anchor.y - bounds.top;
  const maxX = Math.max(8, boardScroll.clientWidth - editor.offsetWidth - 8);
  const maxY = Math.max(8, boardScroll.clientHeight - editor.offsetHeight - 8);
  const nextX = x + 55 <= maxX ? x + 55 : x - editor.offsetWidth - 55;
  editor.style.left = boardScroll.scrollLeft + Math.max(8, Math.min(maxX, nextX)) + "px";
  editor.style.top = boardScroll.scrollTop + Math.max(8, Math.min(maxY, y - 24)) + "px";
}

function openEditor(part) {
  const spec = components[part.type];
  editing = part;
  byId("editor-title").textContent = spec.name;
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
  byId("scope-jump").hidden = part.type !== "scope";
  editor.hidden = false;
  positionEditor();
}

function closeEditor(restoreFocus = false) {
  const part = editing;
  editing = null;
  editor.hidden = true;
  if (restoreFocus && part) board.querySelector(`[data-body="${part.id}"]`)?.focus({ preventScroll: true });
}

editor.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!editing || !Number.isFinite(editorInput.valueAsNumber)) return;
  if (!frequencyInput.disabled) {
    if (!Number.isFinite(frequencyInput.valueAsNumber)) return;
    editing.frequency = frequencyInput.valueAsNumber;
  }
  editing.value = editorInput.valueAsNumber;
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
  editing.angle = (editing.angle + 90) % 360;
  update();
});
boardScroll.addEventListener("scroll", positionEditor);
new ResizeObserver(positionEditor).observe(boardScroll);

function toggleSwitch(id) {
  const part = parts.find((item) => item.id === id);
  part.value = part.value ? 0 : 1;
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
  for (const button of palette.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(placing === button.dataset.type));
  }
  byId("bench-count").textContent = `부품 ${parts.length}개 · 배선 ${wires.length}개`;
  byId("empty-board").hidden = parts.length > 0 || Boolean(placing) || Boolean(paletteDrag?.moved);
  byId("delete").disabled = !selection;
  byId("clear-board").disabled = !parts.length;
  byId("example").disabled = parts.length > 0;
  drawInspector();
  positionEditor();
}

function syncSimulation() {
  const dynamic = parts.some(isTimeDependent);
  const hasScope = parts.some(({ type }) => type === "scope");
  byId("simulation-reset").hidden = !dynamic;
  const connected = wires.length > 0 && parts.some(({ type }) => type === "ground");
  simulation.configure(parts, wires, !byId("bench").hidden && connected && (dynamic || hasScope));
}

function update() {
  dcReading = null;
  dcError = "";
  transientReading = null;
  if (live || flowMode || parts.some(({ type }) => components[type].light)) {
    try {
      dcReading = measure(parts, wires);
    } catch (error) {
      dcError = error.message;
    }
  }
  result = live ? dcReading : null;
  byId("simulate").setAttribute("aria-pressed", String(live));
  solveStatus.hidden = !live;
  solveStatus.textContent = !live ? "" : dcError || (result.floating ?
    "— 표시는 접지 기준 전압을 계산할 수 없는 단자입니다." : "단자에 접지 기준 전압을 표시했습니다.");
  byId("bench-share-box").hidden = true;
  simulationError.hidden = true;
  syncSimulation();
  draw();
  scope.sync(parts);
}

function point(event) {
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(board.getScreenCTM().inverse());
}

function move(part, x, y) {
  part.x = Math.max(60, Math.min(width - 60, Math.round(x / 10) * 10));
  part.y = Math.max(60, Math.min(height - 80, Math.round(y / 10) * 10));
}

function addPart(type, x, y) {
  const part = { id: nextId++, type, x, y, angle: 0, value: components[type].value };
  if (components[type].shape) part.frequency = frequencyRange.initial;
  move(part, x, y);
  parts.push(part);
  return part;
}

function place(x, y) {
  if (parts.length >= maxParts) {
    status.textContent = `부품은 최대 ${maxParts}개까지 배치할 수 있습니다.`;
    return;
  }
  if (placing === "scope" && parts.filter(({ type }) => type === "scope").length >= 4) {
    status.textContent = "오실로스코프는 최대 4개까지 연결할 수 있습니다.";
    return;
  }
  const part = addPart(placing, x, y);
  selection = { kind: "part", id: part.id };
  placing = null;
  update();
  status.textContent = `${components[part.type].name} 배치 완료. 단자를 눌러 연결하세요.`;
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

function connect(id, pin) {
  closeEditor();
  const end = [id, pin];
  if (!pending) {
    pending = end;
    bends = [];
    selection = null;
    status.textContent = "빈 곳을 눌러 경유점을 추가하고 두 번째 단자를 눌러 연결하세요. Esc로 취소합니다.";
    draw();
    return;
  }
  if (keyOf(end) === keyOf(pending)) {
    status.textContent = "배선 연결을 취소했습니다.";
  } else if (wires.some((wire) => sameWire(wire, pending, end))) {
    status.textContent = "이미 연결된 단자입니다.";
  } else if (wires.length === maxWires) {
    status.textContent = `배선은 최대 ${maxWires}개까지 연결할 수 있습니다.`;
  } else {
    const wire = { id: nextId++, a: pending, b: end, points: bends };
    wires.push(wire);
    selection = { kind: "wire", id: wire.id };
    status.textContent = "배선을 연결했습니다.";
  }
  pending = null;
  bends = [];
  update();
}

function activate(target) {
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
}

function dropPoint(event) {
  if (!document.elementFromPoint(event.clientX, event.clientY)?.closest("#board")) return null;
  const position = point(event);
  return position.x >= 0 && position.x <= width && position.y >= 0 && position.y <= height ? position : null;
}

palette.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-type]");
  if (!button || event.button !== 0 || paletteDrag) return;
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
    const spec = components[paletteDrag.type];
    placementPreview.innerHTML = `<rect x="-42" y="-29" width="84" height="58" rx="10"/>
      <path d="${spec.symbol}"/><text y="49">${spec.name}</text>`;
    workbench.classList.add("placing-by-drag");
    status.textContent = "회로도 안에서 놓으면 부품이 추가됩니다.";
    draw();
  }
  const position = dropPoint(event);
  placementPreview.toggleAttribute("hidden", !position);
  if (position) {
    const preview = {};
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
  status.textContent = placing ? "작업대에서 원하는 위치를 클릭하거나 Enter를 눌러 배치하세요." : defaultStatus;
  draw();
});
function bearing(part, x, y) {
  return Math.atan2(y - part.y, x - part.x) * 180 / Math.PI;
}

board.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || placing || drag || event.target.closest("[data-switch]")) return;
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
  if (!terminal && !body) return;
  const id = Number(terminal ? terminal.dataset.part : body.dataset.body);
  const part = parts.find((item) => item.id === id);
  const { x, y } = point(event);
  drag = {
    part, x, y, startX: part.x, startY: part.y, startAngle: part.angle,
    bearing: bearing(part, x, y), pin: terminal ? Number(terminal.dataset.terminal) : null,
    pointer: event.pointerId, moved: false,
  };
  board.setPointerCapture(event.pointerId);
});
board.addEventListener("pointermove", (event) => {
  if (!drag && !pending) return;
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
  if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 5) return;
  const { part, pin } = drag;
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
    if (Math.hypot(x - part.x, y - part.y) > 8) {
      const delta = bearing(part, x, y) - drag.bearing;
      part.angle = (Math.round(drag.startAngle + delta) + 720) % 360;
    }
    item.outerHTML = partMarkup(part);
    status.textContent = `회전 중 · ${part.angle}°`;
  }
  drawWires();
});
board.addEventListener("pointerleave", () => drawDraft());

function finishDrag(event, cancelled = false) {
  if (drag?.pointer !== event.pointerId) return;
  if (drag.wire) {
    if (cancelled) drag.wire.points[drag.index] = drag.start;
    drag = null;
    draw();
    return;
  }
  const { part, pin, moved, startX, startY, startAngle } = drag;
  drag = null;
  board.classList.remove("moving-part", "rotating-part");
  if (cancelled) {
    Object.assign(part, { x: startX, y: startY, angle: startAngle });
    status.textContent = defaultStatus;
    draw();
    return;
  }
  if (!moved && pin !== null) {
    connect(part.id, pin);
    return;
  }
  selection = { kind: "part", id: part.id };
  pending = null;
  status.textContent = !moved ? defaultStatus : pin === null ? "부품 위치를 바꿨습니다." :
    `부품을 ${part.angle}°로 회전했습니다.`;
  draw();
  if (!moved) openEditor(part);
}
board.addEventListener("pointerup", (event) => finishDrag(event));
board.addEventListener("pointercancel", (event) => finishDrag(event, true));
board.addEventListener("lostpointercapture", (event) => finishDrag(event, true));
board.addEventListener("click", (event) => {
  if (placing) {
    const position = dropPoint(event);
    if (position) place(position.x, position.y);
  } else if (pending && event.target === byId("board-surface")) {
    if (bends.length === maxPoints) {
      status.textContent = `배선 하나에 경유점을 최대 ${maxPoints}개까지 추가할 수 있습니다.`;
      return;
    }
    const { x, y } = point(event);
    bends.push(bendAt(x, y));
    drawDraft();
    status.textContent = `경유점 ${bends.length}개 · 두 번째 단자를 눌러 연결하세요. Backspace로 마지막 점을 지울 수 있습니다.`;
  } else if (event.target !== board) {
    activate(event.target);
  }
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
  if (event.target.matches("input, textarea")) return;
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
    byId("delete").click();
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
    if (!editor.hidden && !editorInput.disabled) editorInput.focus({ preventScroll: true });
    else board.querySelector(selector)?.focus();
  }
});
byId("delete").addEventListener("click", () => {
  if (!selection) return;
  closeEditor();
  const { kind, id } = selection;
  if (kind === "part") {
    parts = parts.filter((part) => part.id !== id);
    wires = wires.filter(({ a, b }) => a[0] !== id && b[0] !== id);
  } else {
    wires = wires.filter((wire) => wire.id !== id);
  }
  selection = pending = null;
  update();
  status.textContent = kind === "part" ? "부품과 연결된 배선을 지웠습니다." : "배선을 지웠습니다.";
});
byId("clear-board").addEventListener("click", () => {
  closeEditor();
  parts = [];
  wires = [];
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
  status.textContent = "회로의 시간과 커패시터 전압, 인덕터 전류를 초기화했습니다.";
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
  selection = pending = placing = null;
  live = false;
  simulation.reset();
  scope.clear();
  update();
}

byId("example").addEventListener("click", () => {
  if (parts.length) return;
  const kind = byId("example-type").value;
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
  selection = { kind: "part", id: toggle.id };
  pending = placing = null;
  live = true;
  update();
  status.textContent = "회로도에서 스위치의 OFF 버튼을 눌러 램프를 켜 보세요.";
});

byId("bench-share").addEventListener("click", () => {
  const url = new URL(location.href);
  url.hash = "bench=" + encodeURIComponent(JSON.stringify({ v: 1, parts, wires }));
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
  if (rc) {
    closeEditor();
    if (fallbackFullscreen) {
      fallbackFullscreen = false;
      syncFullscreen();
    }
    if (document.fullscreenElement === workbench) document.exitFullscreen().catch(syncFullscreen);
  }
  byId("bench").hidden = rc;
  byId("rc-lab").hidden = !rc;
  byId("share").hidden = !rc;
  byId("open-bench").setAttribute("aria-current", rc ? "false" : "page");
  if (rc || !hash.startsWith("#bench=") || hash === loadedHash) {
    syncSimulation();
    return;
  }
  loadedHash = hash;
  try {
    if (hash.length > 48000) throw new Error();
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
      if (spec.shape) {
        if (!Number.isFinite(part.frequency) || part.frequency < frequencyRange.min ||
            part.frequency > frequencyRange.max) throw new Error();
        clean.frequency = part.frequency;
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
