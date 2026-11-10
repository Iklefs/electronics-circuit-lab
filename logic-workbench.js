import { solveLogic } from "./wasm-engine.js";

const types = {
  input: { name: "입력 스위치", icon: "▣", code: 0, inputs: 0, output: true },
  low: { name: "상수 0", icon: "0", code: 1, inputs: 0, output: true },
  high: { name: "상수 1", icon: "1", code: 2, inputs: 0, output: true },
  output: { name: "출력 표시등", icon: "◉", code: 3, inputs: 1, output: false },
  not: { name: "NOT", icon: "¬", code: 4, inputs: 1, output: true },
  and: { name: "AND", icon: "∧", code: 5, inputs: 2, output: true },
  nand: { name: "NAND", icon: "⊼", code: 6, inputs: 2, output: true },
  or: { name: "OR", icon: "∨", code: 7, inputs: 2, output: true },
  nor: { name: "NOR", icon: "⊽", code: 8, inputs: 2, output: true },
  xor: { name: "XOR", icon: "⊕", code: 9, inputs: 2, output: true },
  xnor: { name: "XNOR", icon: "⊙", code: 10, inputs: 2, output: true },
};

const byId = (id) => document.getElementById(id);
const workspace = byId("logic-workbench");
const board = byId("logic-board");
const palette = byId("logic-palette");
const partLayer = byId("logic-parts");
const wireLayer = byId("logic-wires");
const draft = byId("logic-draft");
const status = byId("logic-status");
const share = byId("logic-share-panel");
const link = byId("logic-link");
const width = 960, height = 480;
const maxParts = 48, maxWires = 96;
const instructions = "출력과 입력 단자를 차례로 누르면 연결됩니다. 스위치의 0 또는 1을 눌러 신호를 바꾸세요.";
let parts = [];
let wires = [];
let nextId = 1;
let pending = null;
let placing = null;
let selection = null;
let gesture = null;
let loadedHash;

const textValue = (value) => value === 0 || value === 1 ? String(value) : "X";
const signal = (value) => value === 0 || value === 1 ? value : -1;
const samePin = ([part, pin], [otherPart, otherPin]) => part === otherPart && pin === otherPin;

palette.firstElementChild.innerHTML = Object.entries(types).map(([type, spec]) =>
  `<button type="button" data-logic-type="${type}" aria-pressed="false"><span class="part-icon" aria-hidden="true">${spec.icon}</span>${spec.name}</button>`
).join("");

function pinOffset(part, pin) {
  if (pin === 2) return [58, 0];
  if (types[part.type].inputs === 1) return [-58, 0];
  return [-58, pin === 0 ? -14 : 14];
}

function pinPosition([id, pin]) {
  const part = parts.find((item) => item.id === id);
  const [x, y] = pinOffset(part, pin);
  return [part.x + x, part.y + y];
}

function path(a, b, shift = 0) {
  const bend = (a[0] + b[0]) / 2 + shift;
  return `M${a[0]} ${a[1]}H${bend}V${b[1]}H${b[0]}`;
}

function partMarkup(part, values) {
  const spec = types[part.type];
  const current = values?.get(part.id);
  const selected = selection?.kind === "part" && selection.id === part.id;
  const input = part.type === "input";
  const output = part.type === "output";
  const label = part.label ?? spec.name;
  const value = signal(current?.[output ? 0 : 2]);
  const pins = [...Array.from({ length: spec.inputs }, (_, pin) => pin), ...(spec.output ? [2] : [])];
  return `<g class="logic-part${selected ? " selected" : ""}" data-logic-part="${part.id}" transform="translate(${part.x} ${part.y})">
    <g class="logic-body" data-logic-body="${part.id}" role="button" tabindex="0" aria-label="${label} 선택">
      <rect x="-45" y="-28" width="90" height="56" rx="11"/>
      <text class="logic-name" y="${input || output ? -7 : 5}">${label}</text>
      ${output ? `<text class="logic-value" data-signal="${value}" y="16">${textValue(value)}</text>` : ""}
    </g>
    ${input ? `<g class="logic-toggle" data-logic-toggle="${part.id}" data-signal="${part.value}" role="button" tabindex="0" aria-label="${label} 입력 전환" aria-pressed="${Boolean(part.value)}"><rect x="-18" y="2" width="36" height="20" rx="6"/><text y="17">${part.value}</text></g>` : ""}
    ${pins.map((pin) => {
      const [x, y] = pinOffset(part, pin);
      const active = pending && samePin(pending, [part.id, pin]);
      const name = pin === 2 ? "출력" : "입력 " + (pin === 0 ? "A" : "B");
      const pinValue = signal(current?.[pin]);
      return `<path class="logic-stub" d="M${x} ${y}H${pin === 2 ? 45 : -45}"/>
        <circle cx="${x}" cy="${y}" r="6.5" class="logic-pin${active ? " pending" : ""}" data-logic-pin="${pin}" data-node="${part.id}" data-signal="${pinValue}" role="button" tabindex="0" aria-label="${label} ${name}, ${textValue(pinValue)}"/>`;
    }).join("")}
  </g>`;
}

function draw(values) {
  partLayer.innerHTML = parts.map((part) => partMarkup(part, values)).join("");
  wireLayer.innerHTML = wires.map(({ id, a, b, shift }) => {
    const d = path(pinPosition(a), pinPosition(b), shift);
    const selected = selection?.kind === "wire" && selection.id === id;
    return `<g class="wire logic-wire${selected ? " selected" : ""}" data-logic-wire="${id}" role="button" tabindex="0" aria-label="배선 ${id} 선택">
      <path class="logic-signal" data-signal="${signal(values?.get(a[0])?.[2])}" d="${d}"/><path class="wire-hit" d="${d}"/></g>`;
  }).join("");
  draft.setAttribute("hidden", "");
  byId("logic-count").textContent = `부품 ${parts.length}개 · 배선 ${wires.length}개`;
  byId("logic-empty").hidden = Boolean(parts.length || placing || gesture?.type);
  byId("logic-clear").disabled = parts.length === 0;
  byId("logic-example").disabled = parts.length > 0;
  byId("logic-delete").disabled = !selection;
  board.classList.toggle("placing", Boolean(placing || gesture?.type));
  for (const button of palette.querySelectorAll("button")) {
    button.setAttribute("aria-pressed", String(placing === button.dataset.logicType));
  }
}

function update(message = instructions, changed = true) {
  if (changed) share.hidden = true;
  try {
    draw(solveLogic(parts, wires, (type) => types[type].code));
    status.textContent = message;
  } catch (error) {
    draw(null);
    status.textContent = error.message;
  }
}

function point(event) {
  return new DOMPoint(event.clientX, event.clientY).matrixTransform(board.getScreenCTM().inverse());
}

function move(part, x, y) {
  part.x = Math.max(65, Math.min(width - 65, Math.round(x / 10) * 10));
  part.y = Math.max(42, Math.min(height - 42, Math.round(y / 10) * 10));
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
  selection = { kind: "part", id: add(type, x, y).id };
  pending = placing = null;
  update(`${types[type].name} 배치 완료. 단자를 눌러 연결하세요.`);
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
  if ((first[1] === 2) === (end[1] === 2)) return update("출력과 입력 단자를 연결하세요.", false);
  const [a, b] = first[1] === 2 ? [first, end] : [end, first];
  if (wires.some((wire) => samePin(wire.b, b))) return update("이 입력에는 이미 배선이 있습니다. 기존 배선을 지운 뒤 연결하세요.", false);
  if (wires.length >= maxWires) return update(`배선은 최대 ${maxWires}개까지 추가할 수 있습니다.`, false);
  const wire = { id: nextId++, a, b };
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
  update(placing ? "작업대에서 놓을 곳을 클릭하세요. Enter로도 배치할 수 있습니다." : instructions, false);
});
palette.addEventListener("pointerdown", (event) => {
  const button = event.target.closest("[data-logic-type]");
  if (!button || event.button !== 0 || gesture) return;
  gesture = { type: button.dataset.logicType, pointer: event.pointerId, x: event.clientX, y: event.clientY };
  button.setPointerCapture(event.pointerId);
});
board.addEventListener("pointerdown", (event) => {
  const body = event.target.closest("[data-logic-body]");
  if (!body || placing || event.button !== 0 || gesture) return;
  const part = parts.find(({ id }) => id === Number(body.dataset.logicBody));
  gesture = { part, pointer: event.pointerId, x: event.clientX, y: event.clientY, anchor: point(event), original: [part.x, part.y] };
  board.setPointerCapture(event.pointerId);
});

function moveGesture(event) {
  if (gesture?.pointer !== event.pointerId) return;
  if (!gesture.moved && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) < 6) return;
  gesture.moved = true;
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
  const { part, type, moved, original } = gesture;
  gesture = null;
  if (type && !moved) return;
  suppressClick = Boolean(moved);
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
  update(instructions, moved);
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
  draft.setAttribute("d", pending[1] === 2 ? path(start, [x, y]) : path([x, y], start));
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
  if (workspace.hidden || event.target.matches("input")) return;
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

byId("logic-example").addEventListener("click", () => {
  if (parts.length) return;
  const a = add("input", 130, 160, "입력 A");
  const b = add("input", 130, 310, "입력 B");
  const xor = add("xor", 470, 160);
  const and = add("and", 470, 310);
  const sum = add("output", 800, 160, "합 S");
  const carry = add("output", 800, 310, "올림 C");
  for (const [from, to, pin, shift] of [
    [a, xor, 0, 10], [b, xor, 1, 50], [a, and, 0, -45], [b, and, 1, -10],
    [xor, sum, 0, 0], [and, carry, 0, 0],
  ]) wires.push({ id: nextId++, a: [from.id, 2], b: [to.id, pin], shift });
  selection = pending = placing = null;
  update("입력 A와 B를 바꿔 합 S와 올림 C를 비교해 보세요.");
});

byId("logic-share").addEventListener("click", () => {
  const url = new URL(location.href);
  url.hash = "logic=" + encodeURIComponent(JSON.stringify({ v: 1, parts, wires }));
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
    if (hash.length > 36000) throw new Error();
    const saved = JSON.parse(decodeURIComponent(hash.slice(7)));
    if (saved.v !== 1 || !Array.isArray(saved.parts) || !Array.isArray(saved.wires) ||
      saved.parts.length > maxParts || saved.wires.length > maxWires) throw new Error();
    const ids = new Set();
    const validId = (id) => {
      if (!Number.isInteger(id) || id < 1 || id > 1e9 || ids.has(id)) return false;
      ids.add(id);
      return true;
    };
    const nextParts = new Map();
    for (const part of saved.parts) {
      if (!part || !Object.hasOwn(types, part.type) || !validId(part.id) ||
          ![0, 1].includes(part.value) || !Number.isFinite(part.x) || !Number.isFinite(part.y)) throw new Error();
      const item = { id: part.id, type: part.type, value: part.value };
      if (["입력 A", "입력 B", "합 S", "올림 C"].includes(part.label)) item.label = part.label;
      move(item, part.x, part.y);
      nextParts.set(item.id, item);
    }
    const used = new Set();
    const validPin = (pin, output) => {
      if (!Array.isArray(pin) || pin.length !== 2 || !nextParts.has(pin[0])) return false;
      const spec = types[nextParts.get(pin[0]).type];
      return output ? pin[1] === 2 && spec.output : Number.isInteger(pin[1]) && pin[1] >= 0 && pin[1] < spec.inputs;
    };
    const nextWires = saved.wires.map((wire) => {
      if (!wire || !validId(wire.id) || !validPin(wire.a, true) || !validPin(wire.b, false) || used.has(wire.b.join(":"))) throw new Error();
      used.add(wire.b.join(":"));
      const shift = Number.isFinite(wire.shift) && Math.abs(wire.shift) <= 80 ? wire.shift : 0;
      return { id: wire.id, a: wire.a, b: wire.b, shift };
    });
    parts = [...nextParts.values()];
    wires = nextWires;
    nextId = Math.max(0, ...ids) + 1;
    selection = pending = placing = null;
    update("공유 링크의 논리회로를 불러왔습니다.");
  } catch {
    update("공유 링크에서 논리회로를 읽을 수 없습니다.", false);
  }
}

window.addEventListener("hashchange", restore);
update();
restore();
