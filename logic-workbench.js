import { solveLogic } from "./wasm-engine.js";
import { createBoardCamera } from "./board-camera.js";
import { chipPinY, chipPreview } from "./logic-chip-preview.js";
import { fullChipDiagram } from "./logic-chip-diagram.js";
import { bindExamplePicker, buildExample, logicExamples } from "./circuit-examples.js";

import { boardSignals, chipFromBoard, flattenLogic, logicPins, logicTypes as types,
  maxLogicParts as maxParts, maxLogicWires as maxWires, validateChip } from "./logic-circuit.js";

const byId = (id) => document.getElementById(id);
const workspace = byId("logic-workbench");
const board = byId("logic-board");
const surface = byId("logic-surface");
const palette = byId("logic-palette");
const partLayer = byId("logic-parts");
const wireLayer = byId("logic-wires");
const draft = byId("logic-draft");
const status = byId("logic-status");
const share = byId("logic-share-panel");
const link = byId("logic-link");
const width = 960, height = 480;
const chips = new Map();
const chipList = byId("logic-chip-list");
const chipJson = byId("logic-chip-json");
const chipName = byId("logic-chip-name");
const chipStatus = byId("logic-chip-status");
const viewChipJson = byId("logic-chip-view");
const inspectChip = byId("logic-chip-inspect");
const chipDialog = byId("logic-chip-dialog");
const diagram = byId("chip-diagram");
const diagramScroll = byId("chip-diagram-scroll");
const zoomDiagramOut = byId("chip-diagram-out");
const zoomDiagramIn = byId("chip-diagram-in");
const chipStorageKey = "circuit-lab.logic-chips.v1";
const chipId = /^chip-[a-z0-9-]{1,50}$/;
const maxJsonLength = 60000;
const maxSharedLength = 150000;
const instructions = "출력과 입력 단자를 차례로 누르면 연결됩니다. 스위치의 0 또는 1을 눌러 신호를 바꾸세요.";
let parts = [];
let wires = [];
let nextId = 1;
let pending = null;
let placing = null;
let selection = null;
let gesture = null;
let loadedHash;
let diagramLayout;
let diagramScale = 1;
let dialogTrigger;
const { view: camera, set: setCamera, point } = createBoardCamera(board, {
  width, height, controls: byId("logic-zoom"), busy: () => Boolean(gesture),
});

const textValue = (value) => value === 0 || value === 1 ? String(value) : "X";
const signal = (value) => value === 0 || value === 1 ? value : -1;
const samePin = ([part, pin], [otherPart, otherPin]) => part === otherPart && pin === otherPin;

palette.firstElementChild.innerHTML = Object.entries(types).map(([type, spec]) =>
  `<button type="button" data-logic-type="${type}" aria-pressed="false"><span class="part-icon" aria-hidden="true">${spec.icon}</span>${spec.name}</button>`
).join("");

const escape = (text) => String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
const nameOf = (type) => chips.get(type)?.name ?? types[type].name;
const isOutput = ([id, pin]) => logicPins(parts.find((part) => part.id === id).type, chips).outputs.some((port) => port.pin === pin);
const chipHeight = ({ inputs, outputs }) => Math.max(58, 30 + Math.max(inputs.length, outputs.length) * 28);
const selectedChip = () => selection?.kind === "part" && chips.get(parts.find(({ id }) => id === selection.id)?.type);

function pinOffset(part, pin, output) {
  if (chips.has(part.type)) {
    const sides = logicPins(part.type, chips);
    const side = output ? sides.outputs : sides.inputs;
    return [output ? 97 : -97, chipPinY(side.findIndex((item) => item.pin === pin), side.length)];
  }
  if (pin === 2) return [58, 0];
  if (types[part.type].inputs === 1) return [-58, 0];
  return [-58, pin === 0 ? -14 : 14];
}

function pinPosition([id, pin]) {
  const part = parts.find((item) => item.id === id);
  const [x, y] = pinOffset(part, pin, isOutput([id, pin]));
  return [part.x + x, part.y + y];
}

function path(a, b, shift = 0) {
  const bend = (a[0] + b[0]) / 2 + shift;
  return `M${a[0]} ${a[1]}H${bend}V${b[1]}H${b[0]}`;
}

function partMarkup(part, values) {
  const chip = chips.get(part.type);
  const current = values?.get(part.id);
  const selected = selection?.kind === "part" && selection.id === part.id;
  const input = part.type === "input";
  const output = part.type === "output";
  const label = escape(part.label ?? nameOf(part.type));
  const caption = chip && chip.name.length > 19 ? escape(chip.name.slice(0, 18) + "…") : label;
  const { inputs, outputs } = logicPins(part.type, chips);
  const bodyWidth = chip ? 168 : 90;
  const bodyHeight = chip ? chipHeight(chip) : 56;
  const preview = chip ? chipPreview(chip, bodyWidth, bodyHeight) : "";
  const value = signal(current?.[output ? 0 : 2]);
  return `<g class="logic-part${selected ? " selected" : ""}" data-logic-part="${part.id}" transform="translate(${part.x} ${part.y})">
    <g class="logic-body" data-logic-body="${part.id}" role="button" tabindex="0" aria-label="${label} 선택">
      <rect x="${-bodyWidth / 2}" y="${-bodyHeight / 2}" width="${bodyWidth}" height="${bodyHeight}" rx="11"/>
      <text class="logic-name" y="${chip ? 17 - bodyHeight / 2 : input || output ? -7 : 5}">${caption}</text>
      ${preview}
      ${chip ? `<text class="logic-chip-summary${preview ? " logic-chip-zoom-hint" : ""}" y="14">${preview ? "내부 회로 보기" : "내부 회로 생략"}</text>` : ""}
      ${output ? `<text class="logic-value" data-signal="${value}" y="16">${textValue(value)}</text>` : ""}
    </g>
    ${input ? `<g class="logic-toggle" data-logic-toggle="${part.id}" data-signal="${part.value}" role="button" tabindex="0" aria-label="${label} 입력 전환" aria-pressed="${Boolean(part.value)}"><rect x="-18" y="2" width="36" height="20" rx="6"/><text y="17">${part.value}</text></g>` : ""}
    ${[...inputs, ...outputs].map(({ pin, name }) => {
      const isOut = outputs.some((port) => port.pin === pin);
      const [x, y] = pinOffset(part, pin, isOut);
      const active = pending && samePin(pending, [part.id, pin]);
      const pinValue = signal(current?.[pin]);
      const labelLimit = preview ? 5 : 9;
      const chipLabel = name.length > labelLimit ? name.slice(0, labelLimit - 1) + "…" : name;
      return `<path class="logic-stub" d="M${x} ${y}H${isOut ? bodyWidth / 2 : -bodyWidth / 2}"/>
        ${chip ? `<text class="logic-chip-pin${preview ? " logic-chip-pin-preview" : ""}" x="${isOut ? 80 : -80}" y="${y + (preview ? -3 : 4)}" text-anchor="${isOut ? "end" : "start"}">${escape(chipLabel)}</text>` : ""}
        <circle cx="${x}" cy="${y}" r="6.5" class="logic-pin${active ? " pending" : ""}" data-logic-pin="${pin}" data-node="${part.id}" data-signal="${pinValue}" role="button" tabindex="0" aria-label="${label} ${escape(name)}, ${textValue(pinValue)}"/>`;
    }).join("")}
  </g>`;
}

function draw(values) {
  partLayer.innerHTML = parts.map((part) => partMarkup(part, values)).join("");
  wireLayer.innerHTML = wires.map(({ id, a, b, shift }) => {
    const d = path(pinPosition(a), pinPosition(b), shift);
    const selected = selection?.kind === "wire" && selection.id === id;
    return `<g class="wire logic-wire${selected ? " selected" : ""}" data-logic-wire="${id}" role="button" tabindex="0" aria-label="배선 ${id} 선택">
      <path class="logic-signal" data-signal="${signal(values?.get(a[0])?.[a[1]])}" d="${d}"/><path class="wire-hit" d="${d}"/></g>`;
  }).join("");
  draft.setAttribute("hidden", "");
  byId("logic-count").textContent = `부품 ${parts.length}개 · 배선 ${wires.length}개`;
  byId("logic-empty").hidden = Boolean(parts.length || placing || gesture?.type);
  byId("logic-clear").disabled = parts.length === 0;
  byId("logic-example").disabled = parts.length > 0;
  byId("logic-delete").disabled = !selection;
  viewChipJson.disabled = !selectedChip();
  inspectChip.disabled = !selectedChip();
  byId("logic-cancel").hidden = !placing && !pending;
  board.classList.toggle("placing", Boolean(placing || gesture?.type));
  for (const button of palette.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(placing === button.dataset.logicType));
  }
}

function update(message = instructions, changed = true) {
  if (changed) share.hidden = true;
  try {
    draw(boardSignals(parts, wires, chips, solveLogic));
    status.textContent = message;
  } catch (error) {
    draw(null);
    status.textContent = error.message;
  }
}

function move(part, x, y) {
  const chip = chips.get(part.type);
  const horizontal = chip ? 110 : 65;
  const vertical = chip ? chipHeight(chip) / 2 + 10 : 42;
  part.x = Math.max(horizontal, Math.min(width - horizontal, Math.round(x / 10) * 10));
  part.y = Math.max(vertical, Math.min(height - vertical, Math.round(y / 10) * 10));
}

function add(type, x, y, label) {
  const part = { id: nextId++, type, value: 0, label };
  move(part, x, y);
  parts.push(part);
  return part;
}

function place(type, x, y) {
  if (parts.length >= maxParts) {
    update(`부품은 최대 ${maxParts}개까지 배치할 수 있습니다.`, false);
    return;
  }
  try {
    flattenLogic([...parts, { id: nextId, type, value: 0 }], wires, chips);
  } catch (error) {
    return update(error.message, false);
  }
  selection = { kind: "part", id: add(type, x, y).id };
  pending = placing = null;
  update(`${nameOf(type)} 배치 완료. 단자를 눌러 연결하세요.`);
}

function connect(end) {
  placing = null;
  if (!pending) {
    pending = end;
    update("연결할 반대쪽 단자를 누르세요. Esc로 취소할 수 있습니다.", false);
    return;
  }
  const first = pending;
  pending = null;
  if (samePin(first, end)) return update("배선 연결을 취소했습니다.", false);
  const firstOut = isOutput(first);
  if (firstOut === isOutput(end)) return update("출력과 입력 단자를 연결하세요.", false);
  const [a, b] = firstOut ? [first, end] : [end, first];
  if (wires.some((wire) => samePin(wire.b, b))) return update("이 입력에는 이미 배선이 있습니다. 기존 배선을 지운 뒤 연결하세요.", false);
  if (wires.length >= maxWires) return update(`배선은 최대 ${maxWires}개까지 추가할 수 있습니다.`, false);
  const wire = { id: nextId, a, b };
  try {
    flattenLogic(parts, [...wires, wire], chips);
  } catch (error) {
    return update(error.message, false);
  }
  nextId++;
  wires.push(wire);
  selection = { kind: "wire", id: wire.id };
  update("배선을 연결했습니다.");
}

function activate(target) {
  const pin = target.closest("[data-logic-pin]");
  if (pin) return connect([Number(pin.dataset.node), Number(pin.dataset.logicPin)]);
  pending = null;
  const toggle = target.closest("[data-logic-toggle]");
  const part = target.closest("[data-logic-body]");
  const wire = target.closest("[data-logic-wire]");
  if (toggle) {
    const input = parts.find(({ id }) => id === Number(toggle.dataset.logicToggle));
    input.value = 1 - input.value;
    selection = { kind: "part", id: input.id };
    update(`${input.label ?? "입력 스위치"}를 ${input.value}로 바꿨습니다.`);
    return;
  }
  selection = part ? { kind: "part", id: Number(part.dataset.logicBody) } :
    wire ? { kind: "wire", id: Number(wire.dataset.logicWire) } : null;
  update(instructions, false);
}

palette.addEventListener("click", (event) => {
  const type = event.target.closest("[data-logic-type]")?.dataset.logicType;
  if (!type) return;
  placing = placing === type ? null : type;
  pending = null;
  update(placing ? "작업대에서 놓을 곳을 누르세요. Enter로도 배치할 수 있습니다." : instructions, false);
});
palette.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-logic-type]");
  if (!event.isPrimary || !button || event.button !== 0 || gesture) return;
  gesture = { type: button.dataset.logicType, pointer: event.pointerId, x: event.clientX, y: event.clientY };
  button.setPointerCapture(event.pointerId);
});
board.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || placing || event.button !== 0 || gesture) return;
  const start = { pointer: event.pointerId, x: event.clientX, y: event.clientY };
  if (camera.zoom > 1 && event.target === surface) {
    gesture = { ...start, camera: { ...camera }, scale: board.getScreenCTM().a };
    board.setPointerCapture(event.pointerId);
    return;
  }
  const body = event.target.closest("[data-logic-body]");
  if (!body) return;
  const part = parts.find(({ id }) => id === Number(body.dataset.logicBody));
  gesture = { ...start, part, anchor: point(event), original: [part.x, part.y] };
  body.setPointerCapture(event.pointerId);
});

function moveGesture(event) {
  if (gesture?.pointer !== event.pointerId) return;
  const dx = event.clientX - gesture.x;
  const dy = event.clientY - gesture.y;
  if (!gesture.moved && Math.hypot(dx, dy) < 6) return;
  gesture.moved = true;
  if (gesture.camera) {
    const { camera: start, scale } = gesture;
    board.classList.add("panning");
    setCamera(start.zoom, start.x - dx / scale, start.y - dy / scale);
    return;
  }
  if (gesture.type) {
    status.textContent = "작업대 안에서 놓으면 부품이 추가됩니다.";
    board.classList.add("placing");
    return;
  }
  const { part, anchor, original } = gesture;
  const position = point(event);
  move(part, original[0] + position.x - anchor.x, original[1] + position.y - anchor.y);
  const item = partLayer.querySelector(`[data-logic-part="${part.id}"]`);
  item.setAttribute("transform", `translate(${part.x} ${part.y})`);
  for (const wire of wires.filter(({ a, b }) => a[0] === part.id || b[0] === part.id)) {
    const group = wireLayer.querySelector(`[data-logic-wire="${wire.id}"]`);
    const d = path(pinPosition(wire.a), pinPosition(wire.b), wire.shift);
    for (const line of group.children) line.setAttribute("d", d);
  }
}

let suppressClick = false;
function finish(event, cancelled = false) {
  if (gesture?.pointer !== event.pointerId) return;
  const { part, type, moved, original, camera: start } = gesture;
  gesture = null;
  if (type && !moved) return;
  suppressClick = !cancelled;
  if (start) {
    board.classList.remove("panning");
    if (cancelled) setCamera(start.zoom, start.x, start.y);
    else if (!moved) activate(surface);
    return;
  }
  if (cancelled) {
    if (part) [part.x, part.y] = original;
    update(instructions, false);
    return;
  }
  if (type) {
    if (document.elementFromPoint(event.clientX, event.clientY)?.closest("#logic-board")) {
      const { x, y } = point(event);
      if (x >= 0 && x <= width && y >= 0 && y <= height) return place(type, x, y);
    }
    update(instructions, false);
    return;
  }
  selection = { kind: "part", id: part.id };
  pending = null;
  if (moved) {
    update(instructions);
    return;
  }
  // Keep the clicked SVG element in place so the browser can target a double click.
  for (const node of partLayer.children) node.classList.toggle("selected", Number(node.dataset.logicPart) === part.id);
  wireLayer.querySelector(".selected")?.classList.remove("selected");
  partLayer.querySelector(".logic-pin.pending")?.classList.remove("pending");
  draft.setAttribute("hidden", "");
  byId("logic-cancel").hidden = true;
  byId("logic-delete").disabled = false;
  viewChipJson.disabled = inspectChip.disabled = !selectedChip();
  status.textContent = instructions;
}
for (const target of [board, palette]) {
  target.addEventListener("pointerdown", () => { suppressClick = false; });
  target.addEventListener("pointermove", moveGesture);
  target.addEventListener("pointerup", (event) => finish(event));
  target.addEventListener("pointercancel", (event) => finish(event, true));
  target.addEventListener("lostpointercapture", (event) => finish(event, true));
  target.addEventListener("click", (event) => {
    if (suppressClick && event.detail) event.stopImmediatePropagation();
  }, true);
}

board.addEventListener("pointermove", (event) => {
  if (!pending || gesture) return;
  const { x, y } = point(event);
  const start = pinPosition(pending);
  draft.setAttribute("d", isOutput(pending) ? path(start, [x, y]) : path([x, y], start));
  draft.removeAttribute("hidden");
});
board.addEventListener("pointerleave", () => draft.setAttribute("hidden", ""));
board.addEventListener("click", (event) => {
  if (placing) {
    const { x, y } = point(event);
    if (x >= 0 && x <= width && y >= 0 && y <= height) place(placing, x, y);
  } else if (event.target !== board) {
    activate(event.target);
  }
});

board.addEventListener("dblclick", (event) => {
  if (placing || gesture) return;
  const body = event.target.closest("[data-logic-body]");
  const part = body && parts.find(({ id }) => id === Number(body.dataset.logicBody));
  const chip = part && chips.get(part.type);
  if (chip) openChipDialog(chip, body);
});

function diagramFit() {
  return Math.min(1, diagramScroll.clientWidth / diagramLayout.width,
    diagramScroll.clientHeight / diagramLayout.height);
}

function setDiagramScale(scale) {
  diagramScale = scale;
  diagram.setAttribute("width", Math.floor(diagramLayout.width * scale));
  diagram.setAttribute("height", Math.floor(diagramLayout.height * scale));
  zoomDiagramOut.disabled = scale <= diagramFit();
  zoomDiagramIn.disabled = scale >= 2.5;
}

function fitDiagram() {
  setDiagramScale(diagramFit());
  diagramScroll.scrollTo(0, 0);
}

function zoomDiagram(factor) {
  const centerX = diagramScroll.clientWidth / 2;
  const centerY = diagramScroll.clientHeight / 2;
  const x = diagramScroll.scrollLeft + centerX;
  const y = diagramScroll.scrollTop + centerY;
  const oldScale = diagramScale;
  const next = factor > 1 ? Math.max(0.25, oldScale * factor) : oldScale * factor;
  setDiagramScale(Math.max(diagramFit(), Math.min(2.5, next)));
  const ratio = diagramScale / oldScale;
  diagramScroll.scrollTo(x * ratio - centerX, y * ratio - centerY);
}

function openChipDialog(chip, trigger) {
  if (chipDialog.open) return;
  diagramLayout = fullChipDiagram(chip);
  dialogTrigger = trigger;
  byId("chip-diagram-title").textContent = chip.name + " 내부 회로";
  byId("chip-diagram-count").textContent = `입력 ${chip.inputs.length}개 · 게이트 ${chip.gates.length}개 · 출력 ${chip.outputs.length}개`;
  diagram.setAttribute("viewBox", `0 0 ${diagramLayout.width} ${diagramLayout.height}`);
  diagram.innerHTML = diagramLayout.content;
  chipDialog.showModal();
  fitDiagram();
}

inspectChip.addEventListener("click", () => {
  const chip = selectedChip();
  if (chip) openChipDialog(chip, inspectChip);
});
byId("chip-diagram-fit").addEventListener("click", fitDiagram);
zoomDiagramOut.addEventListener("click", () => zoomDiagram(1 / 1.4));
zoomDiagramIn.addEventListener("click", () => zoomDiagram(1.4));
chipDialog.addEventListener("close", () => {
  dialogTrigger?.focus({ preventScroll: true });
  dialogTrigger = null;
});

byId("logic-cancel").addEventListener("click", () => {
  pending = placing = null;
  update(instructions, false);
});

byId("logic-delete").addEventListener("click", () => {
  if (!selection) return;
  if (selection.kind === "part") {
    parts = parts.filter(({ id }) => id !== selection.id);
    wires = wires.filter(({ a, b }) => a[0] !== selection.id && b[0] !== selection.id);
  } else wires = wires.filter(({ id }) => id !== selection.id);
  selection = pending = null;
  update("선택한 항목을 삭제했습니다.");
});
byId("logic-clear").addEventListener("click", () => {
  parts = [];
  wires = [];
  selection = pending = placing = null;
  update("작업대를 비웠습니다.");
});
document.addEventListener("keydown", (event) => {
  if (workspace.hidden || chipDialog.open || event.target.matches("input, textarea, select")) return;
  if (event.key === "Escape") {
    if (gesture) finish({ pointerId: gesture.pointer }, true);
    pending = placing = null;
    update(instructions, false);
  } else if (event.key === "Delete") {
    byId("logic-delete").click();
  } else if (event.key === "Enter" && placing && palette.contains(event.target)) {
    event.preventDefault();
    place(placing, 110 + parts.length % 6 * 140, 70 + Math.floor(parts.length / 6) * 48);
  } else if (["Enter", " "].includes(event.key) && board.contains(event.target) && event.target.hasAttribute("tabindex")) {
    event.preventDefault();
    const { logicPin, node, logicToggle, logicBody, logicWire } = event.target.dataset;
    const selector = logicPin !== undefined ? `[data-logic-pin="${logicPin}"][data-node="${node}"]` :
      logicToggle ? `[data-logic-toggle="${logicToggle}"]` : logicBody ? `[data-logic-body="${logicBody}"]` : `[data-logic-wire="${logicWire}"]`;
    activate(event.target);
    board.querySelector(selector)?.focus({ preventScroll: true });
  }
});

const examplePicker = byId("logic-example-type");
bindExamplePicker(examplePicker, byId("logic-example-guide"), logicExamples);
byId("logic-example").addEventListener("click", () => {
  if (parts.length) return;
  const example = logicExamples[examplePicker.value];
  buildExample(example, (type, x, y, options) => Object.assign(add(type, x, y), options),
    (a, b, shift) => wires.push({ id: nextId++, a, b, shift }));
  selection = pending = placing = null;
  update(example.try);
});

const exampleChip = {
  v: 1,
  name: "반가산기",
  inputs: ["A", "B"],
  outputs: [{ name: "합", from: "sum" }, { name: "올림", from: "carry" }],
  gates: [
    { id: "sum", type: "xor", inputs: ["A", "B"] },
    { id: "carry", type: "and", inputs: ["A", "B"] },
  ],
};

function renderChipList() {
  chipList.replaceChildren(...[...chips].slice(-32).reverse().map(([id, chip]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.logicType = id;
    button.setAttribute("aria-pressed", String(placing === id));
    button.textContent = chip.name;
    button.title = `칩 · 입력 ${chip.inputs.length}개 · 출력 ${chip.outputs.length}개`;
    return button;
  }));
  chipList.hidden = !chipList.childElementCount;
}

function saveChipLibrary() {
  try {
    localStorage.setItem(chipStorageKey, JSON.stringify([...chips].slice(-32)));
  } catch {
    // Imported definitions still remain available in this tab and in shared links.
  }
}

function loadChipLibrary() {
  try {
    const saved = JSON.parse(localStorage.getItem(chipStorageKey));
    if (!Array.isArray(saved)) return;
    for (const [id, chip] of saved.slice(-32)) {
      if (typeof id === "string" && chipId.test(id)) chips.set(id, validateChip(chip));
    }
  } catch {
    // Storage may be disabled or an older saved entry may be invalid.
  }
}

function registerChip(chip, preferredId) {
  const definition = JSON.stringify(chip);
  const existing = [...chips].find(([, saved]) => JSON.stringify(saved) === definition);
  const id = existing?.[0] ?? (preferredId && !chips.has(preferredId) ? preferredId : "chip-" + crypto.randomUUID());
  chips.delete(id);
  chips.set(id, chip);
  return id;
}

function showChip(chip) {
  registerChip(chip);
  saveChipLibrary();
  renderChipList();
  chipJson.value = JSON.stringify(chip, null, 2);
  chipStatus.textContent = `${chip.name} 칩을 저장했습니다. 부품 목록에서 선택해 배치하세요.`;
}

const chipPanel = byId("logic-chip-panel");
const chipToggle = byId("logic-chip-toggle");
chipToggle.addEventListener("click", () => {
  chipPanel.hidden = !chipPanel.hidden;
  chipToggle.setAttribute("aria-expanded", String(!chipPanel.hidden));
  if (!chipPanel.hidden) chipName.focus();
});
byId("logic-chip-create").addEventListener("click", () => {
  try {
    showChip(chipFromBoard(chipName.value.trim(), parts, wires, chips));
  } catch (error) {
    chipStatus.textContent = error.message;
  }
});
byId("logic-chip-import").addEventListener("click", () => {
  if (chipJson.value.length > maxJsonLength) {
    chipStatus.textContent = "칩 JSON이 너무 깁니다.";
    return;
  }
  let data;
  try {
    data = JSON.parse(chipJson.value);
  } catch {
    chipStatus.textContent = "JSON 형식을 확인하세요.";
    return;
  }
  try {
    showChip(validateChip(data));
  } catch (error) {
    chipStatus.textContent = error.message;
  }
});
byId("logic-chip-example").addEventListener("click", () => {
  chipJson.value = JSON.stringify(exampleChip, null, 2);
  chipStatus.textContent = "";
});
viewChipJson.addEventListener("click", () => {
  const chip = selectedChip();
  if (!chip) return;
  chipJson.value = JSON.stringify(chip, null, 2);
  chipStatus.textContent = `${chip.name} 칩의 JSON을 불러왔습니다.`;
});
byId("logic-chip-copy").addEventListener("click", async () => {
  if (!chipJson.value.trim()) return;
  try {
    await navigator.clipboard.writeText(chipJson.value);
    chipStatus.textContent = "칩 JSON을 복사했습니다.";
  } catch {
    chipJson.focus();
    chipJson.select();
    chipStatus.textContent = "선택된 JSON을 복사하세요.";
  }
});

byId("logic-share").addEventListener("click", () => {
  const url = new URL(location.href);
  const usedChips = [...new Set(parts.map(({ type }) => type))]
    .filter((type) => chips.has(type)).map((type) => [type, chips.get(type)]);
  url.hash = "logic=" + encodeURIComponent(JSON.stringify({
    v: 1, parts, wires, ...(usedChips.length ? { chips: usedChips } : {}),
  }));
  if (url.hash.length > maxSharedLength) {
    status.textContent = "공유 링크가 너무 깁니다. 사용한 칩이나 부품을 줄여 주세요.";
    return;
  }
  link.value = url.href;
  share.hidden = false;
  link.focus();
  link.select();
});
byId("logic-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(link.value);
    status.textContent = "공유 링크를 복사했습니다.";
  } catch {
    link.focus();
    link.select();
    status.textContent = "선택된 링크를 복사하세요.";
  }
});

function restore() {
  const hash = location.hash;
  if (!hash.startsWith("#logic=") || hash === loadedHash) return;
  loadedHash = hash;
  try {
    if (hash.length > maxSharedLength) throw new Error();
    const saved = JSON.parse(decodeURIComponent(hash.slice(7)));
    if (saved.v !== 1 || !Array.isArray(saved.parts) || !Array.isArray(saved.wires) ||
      saved.parts.length > maxParts || saved.wires.length > maxWires) throw new Error();
    const sharedChips = new Map();
    if (saved.chips !== undefined) {
      if (!Array.isArray(saved.chips) || saved.chips.length > maxParts) throw new Error();
      for (const [id, chip] of saved.chips) {
        if (typeof id !== "string" || !chipId.test(id) || sharedChips.has(id)) throw new Error();
        sharedChips.set(id, validateChip(chip));
      }
    }
    const ids = new Set();
    const validId = (id) => {
      if (!Number.isInteger(id) || id < 1 || id > 1e9 || ids.has(id)) return false;
      ids.add(id);
      return true;
    };
    const nextParts = new Map();
    for (const part of saved.parts) {
      if (typeof part?.type !== "string" || (!Object.hasOwn(types, part.type) && !sharedChips.has(part.type)) || !validId(part.id) ||
          ![0, 1].includes(part.value) || !Number.isFinite(part.x) || !Number.isFinite(part.y)) throw new Error();
      const item = { id: part.id, type: part.type, value: part.value };
      if (typeof part.label === "string" && part.label.length > 0 && part.label.length <= 24 &&
          part.label.trim() === part.label && !/[\u0000-\u001f\u007f]/u.test(part.label)) item.label = part.label;
      nextParts.set(item.id, { ...item, x: part.x, y: part.y });
    }
    const used = new Set();
    const validPin = (pin, output) => {
      if (!Array.isArray(pin) || pin.length !== 2 || !nextParts.has(pin[0])) return false;
      const pins = logicPins(nextParts.get(pin[0]).type, sharedChips);
      return (output ? pins.outputs : pins.inputs).some(({ pin: index }) => index === pin[1]);
    };
    const nextWires = saved.wires.map((wire) => {
      if (!wire || !validId(wire.id) || !validPin(wire.a, true) || !validPin(wire.b, false) || used.has(wire.b.join(":"))) throw new Error();
      used.add(wire.b.join(":"));
      const shift = Number.isFinite(wire.shift) && Math.abs(wire.shift) <= 80 ? wire.shift : 0;
      return { id: wire.id, a: wire.a, b: wire.b, shift };
    });
    const next = [...nextParts.values()];
    flattenLogic(next, nextWires, sharedChips);
    const replacements = new Map();
    for (const { type } of next) {
      if (sharedChips.has(type) && !replacements.has(type)) {
        replacements.set(type, registerChip(sharedChips.get(type), type));
      }
    }
    for (const part of next) {
      part.type = replacements.get(part.type) ?? part.type;
      move(part, part.x, part.y);
    }
    parts = next;
    wires = nextWires;
    if (replacements.size) {
      renderChipList();
      saveChipLibrary();
    }
    nextId = Math.max(0, ...ids) + 1;
    selection = pending = placing = null;
    update("공유 링크의 논리회로를 불러왔습니다.");
  } catch {
    update("공유 링크에서 논리회로를 읽을 수 없습니다.", false);
  }
}

window.addEventListener("hashchange", restore);
loadChipLibrary();
renderChipList();
update();
restore();
