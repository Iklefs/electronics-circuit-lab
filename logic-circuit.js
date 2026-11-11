export const maxLogicParts = 48;
export const maxLogicWires = 96;
export const maxChipPins = 8;
const maxChipGates = 120;
const maxExpandedParts = 256;
const maxExpandedWires = 512;

// The positions in this list match Gate::from_code in the Rust engine.
export const logicTypes = {
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
const buffer = { code: 11, inputs: 1 };
const gateSpec = (type) => type === "buf" ? buffer : Object.hasOwn(logicTypes, type) && logicTypes[type];
export const gateCode = (type) => gateSpec(type).code;
const pinKey = ([id, pin]) => id + ":" + pin;

function validLabel(value, max = 24) {
  return typeof value === "string" && value.length > 0 && value.length <= max &&
    value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value);
}

export function validateChip(chip) {
  if (chip?.v !== 1 || !validLabel(chip.name, 36) ||
      !Array.isArray(chip.inputs) || chip.inputs.length > maxChipPins ||
      !Array.isArray(chip.outputs) || !chip.outputs.length || chip.outputs.length > maxChipPins ||
      !Array.isArray(chip.gates) || chip.gates.length > maxChipGates) {
    throw new Error("칩 이름, 버전(v: 1), 입력·출력(각각 최대 8개), 게이트(최대 120개)를 확인하세요.");
  }
  const inputs = [...chip.inputs];
  const nets = new Set();
  for (const name of inputs) {
    if (!validLabel(name) || nets.has(name)) throw new Error("입력 이름은 비어 있거나 중복될 수 없습니다.");
    nets.add(name);
  }
  const gates = chip.gates.map((gate) => {
    const spec = typeof gate?.type === "string" && gateSpec(gate.type);
    if (!spec || ["input", "output"].includes(gate.type) ||
        typeof gate.id !== "string" || !/^[a-zA-Z0-9_-]{1,24}$/.test(gate.id) || nets.has(gate.id) ||
        !Array.isArray(gate.inputs) || gate.inputs.length !== spec.inputs) {
      throw new Error("게이트의 ID, 종류, 입력 개수를 확인하세요.");
    }
    nets.add(gate.id);
    return { id: gate.id, type: gate.type, inputs: [...gate.inputs] };
  });
  const validRef = (value) => value === null || (typeof value === "string" && nets.has(value));
  if (gates.some((gate) => !gate.inputs.every(validRef))) {
    throw new Error("게이트 입력에 정의된 입력 이름이나 게이트 ID를 사용하세요.");
  }
  const outputNames = new Set();
  const outputs = chip.outputs.map((output) => {
    if (!validLabel(output?.name) || outputNames.has(output.name) || !validRef(output.from)) {
      throw new Error("출력 이름과 연결할 입력 이름 또는 게이트 ID를 확인하세요.");
    }
    outputNames.add(output.name);
    return { name: output.name, from: output.from };
  });
  return { v: 1, name: chip.name, inputs, outputs, gates };
}

export function logicPins(type, chips) {
  const chip = chips.get(type);
  if (chip) {
    return {
      inputs: chip.inputs.map((name, pin) => ({ pin, name })),
      outputs: chip.outputs.map(({ name }, index) => ({ pin: maxChipPins + index, name })),
    };
  }
  const spec = logicTypes[type];
  return {
    inputs: Array.from({ length: spec.inputs }, (_, pin) => ({ pin, name: "입력 " + (pin === 0 ? "A" : "B") })),
    outputs: spec.output ? [{ pin: 2, name: "출력" }] : [],
  };
}

export function flattenLogic(parts, wires, chips) {
  const nodes = [];
  const links = [];
  const ports = new Map();
  const add = (type, value = 0) => {
    const id = nodes.length + 1;
    nodes.push({ id, type, value });
    return id;
  };
  const connect = (source, target) => links.push({ a: source, b: target });

  for (const part of parts) {
    const chip = chips.get(part.type);
    if (!chip) {
      const node = add(part.type, part.value);
      const { inputs, outputs } = logicPins(part.type, chips);
      for (const { pin } of [...inputs, ...outputs]) ports.set(pinKey([part.id, pin]), [node, pin]);
      continue;
    }
    const nets = new Map();
    chip.inputs.forEach((name, pin) => {
      const node = add("buf");
      nets.set(name, node);
      ports.set(pinKey([part.id, pin]), [node, 0]);
    });
    for (const gate of chip.gates) nets.set(gate.id, add(gate.type));
    for (const gate of chip.gates) {
      gate.inputs.forEach((source, pin) => {
        if (source !== null) connect([nets.get(source), 2], [nets.get(gate.id), pin]);
      });
    }
    chip.outputs.forEach(({ from }, index) => {
      const node = add("buf");
      if (from !== null) connect([nets.get(from), 2], [node, 0]);
      ports.set(pinKey([part.id, maxChipPins + index]), [node, 2]);
    });
    if (nodes.length > maxExpandedParts || links.length > maxExpandedWires) {
      throw new Error("칩 내부를 포함해 부품 256개, 배선 512개까지 계산할 수 있습니다.");
    }
  }
  for (const { a, b } of wires) connect(ports.get(pinKey(a)), ports.get(pinKey(b)));
  if (nodes.length > maxExpandedParts || links.length > maxExpandedWires) {
    throw new Error("칩 내부를 포함해 부품 256개, 배선 512개까지 계산할 수 있습니다.");
  }
  return { nodes, links, ports };
}

export function boardSignals(parts, wires, chips, solve) {
  const { nodes, links, ports } = flattenLogic(parts, wires, chips);
  const values = solve(nodes, links, gateCode);
  return new Map(parts.map(({ id, type }) => {
    const { inputs, outputs } = logicPins(type, chips);
    const pins = [];
    for (const { pin } of [...inputs, ...outputs]) {
      const [node, terminal] = ports.get(pinKey([id, pin]));
      pins[pin] = values.get(node)[terminal];
    }
    return [id, pins];
  }));
}

export function chipFromBoard(name, parts, wires, chips) {
  const inputParts = parts.filter(({ type }) => type === "input");
  const outputParts = parts.filter(({ type }) => type === "output");
  if (!outputParts.length) throw new Error("칩의 출력으로 사용할 출력 표시등을 추가하세요.");
  const { nodes, links, ports } = flattenLogic(parts, wires, chips);
  const incoming = new Map(links.map(({ a, b }) => [pinKey(b), a[0]]));
  const names = new Map(nodes.map(({ id }) => [id, "g" + id]));
  const inputNames = inputParts.map((part, index) => {
    const name = part.label ?? "I" + (index + 1);
    names.set(ports.get(pinKey([part.id, 2]))[0], name);
    return name;
  });
  const ref = (id, pin) => names.get(incoming.get(pinKey([id, pin]))) ?? null;
  const gates = nodes.filter(({ type }) => type !== "input" && type !== "output").map(({ id, type }) => ({
    id: names.get(id), type, inputs: Array.from({ length: gateSpec(type).inputs }, (_, pin) => ref(id, pin)),
  }));
  const outputs = outputParts.map((part, index) => ({
    name: part.label ?? "O" + (index + 1),
    from: ref(ports.get(pinKey([part.id, 0]))[0], 0),
  }));
  return validateChip({ v: 1, name, inputs: inputNames, outputs, gates });
}
