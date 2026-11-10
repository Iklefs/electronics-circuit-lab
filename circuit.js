import { components, pinsFor, sourceWave } from "./components.js";

export const pinCount = (part) => pinsFor(part).length;
export const keyOf = ([id, pin]) => id + ":" + pin;

export function idealConnections(parts) {
  const links = [];
  for (const part of parts) {
    const pin = (index) => keyOf([part.id, index]);
    if (part.type === "ground") links.push([pin(0), "gnd"]);
    if (part.type === "switch" && part.value) links.push([pin(0), pin(1)]);
    if (part.type === "spdt") links.push([pin(0), pin(part.value ? 2 : 1)]);
    if (part.type === "pot" && part.value === 0) links.push([pin(0), pin(2)]);
    if (part.type === "pot" && part.value === 100) links.push([pin(1), pin(2)]);
  }
  return links;
}

function solveLinear(matrix) {
  for (let col = 0; col < matrix.length; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < matrix.length; row += 1) {
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    }
    if (Math.abs(matrix[pivot][col]) < 1e-12) {
      throw new Error("전원의 양단이 바로 연결됐거나 이상적인 전원이 서로 충돌합니다. 배선을 확인하세요.");
    }
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const scale = matrix[col][col];
    for (let i = col; i <= matrix.length; i += 1) matrix[col][i] /= scale;
    for (let row = 0; row < matrix.length; row += 1) {
      if (row === col) continue;
      const factor = matrix[row][col];
      for (let i = col; i <= matrix.length; i += 1) matrix[row][i] -= factor * matrix[col][i];
    }
  }
  return matrix.map((row) => row.at(-1));
}

export function measure(parts, wires, transient = null) {
  const nodes = new Map(parts.flatMap((part) => Array.from({ length: pinCount(part) }, (_, pin) => {
    const key = keyOf([part.id, pin]);
    return [key, key];
  })));
  nodes.set("gnd", "gnd");
  function root(key) {
    while (nodes.get(key) !== key) key = nodes.get(key);
    return key;
  }
  function join(a, b) {
    const first = root(a);
    const second = root(b);
    if (first === second) return;
    if (first === "gnd") nodes.set(second, first);
    else nodes.set(first, second);
  }
  for (const { a, b } of wires) join(keyOf(a), keyOf(b));
  if (!parts.some(({ type }) => type === "ground")) {
    throw new Error("접지 부품을 추가하고 회로의 기준점에 연결하세요.");
  }
  for (const [a, b] of idealConnections(parts)) join(a, b);

  const devices = parts.flatMap((part) => {
    const { model, shape } = components[part.type];
    const pin = (index) => keyOf([part.id, index]);
    const branch = (kind, a, b, value) => ({
      id: part.id, type: part.type, kind, from: pin(a), to: pin(b), a: root(pin(a)), b: root(pin(b)), value,
    });
    if (model === "pot") {
      const left = part.value * 100;
      return [
        branch("resistance", 0, 2, left),
        branch("resistance", 2, 1, 10000 - left),
      ].filter(({ value }) => value > 0);
    }
    if (shape) {
      const voltage = transient ? part.value * sourceWave(shape, part.frequency * transient.time) : 0;
      return [branch("voltage", 0, 1, voltage)];
    }
    if (model === "capacitor" || model === "inductor") {
      if (!transient) return [model === "capacitor" ? branch("open", 0, 1, 0) : branch("resistance", 0, 1, 0.1)];
      // Backward Euler replaces the storage element with conductance and a history current.
      const previous = transient.storage.get(part.id) ?? 0;
      const isCap = model === "capacitor";
      const conductance = isCap ? part.value * 1e-6 / transient.step : 1 / (0.1 + part.value * 1e-3 / transient.step);
      const offset = isCap ? -conductance * previous : previous * (1 - 0.1 * conductance);
      return [{ ...branch("history", 0, 1, 0), conductance, offset, storage: model }];
    }
    if (model === "ammeter") return [branch("resistance", 0, 1, 0.01)];
    return model ? [branch(model, 0, 1, part.value)] : [];
  });
  const voltagePaths = devices.filter(({ kind }) => kind !== "open" && kind !== "current");
  const grounded = new Set(["gnd"]);
  let size;
  do {
    size = grounded.size;
    for (const { a, b } of voltagePaths) {
      if (grounded.has(a) || grounded.has(b)) grounded.add(a).add(b);
    }
  } while (size !== grounded.size);

  if (devices.some(({ kind, a, b, value }) =>
    kind === "current" && value > 0 && grounded.has(a) !== grounded.has(b))) {
    throw new Error("전류원의 두 단자에 DC 전류가 흐를 경로를 연결하세요.");
  }
  const active = devices.filter(({ a, b }) => grounded.has(a) && grounded.has(b));
  const sources = active.filter(({ kind }) => kind === "voltage");
  const namedNodes = [...grounded].filter((key) => key !== "gnd");
  const indices = new Map(namedNodes.map((key, index) => [key, index]));
  const count = namedNodes.length + sources.length;
  const voltage = (key, values) => key === "gnd" ? 0 : values[indices.get(key)];
  const drop = ({ a, b }, values) => voltage(a, values) - voltage(b, values);

  function linearize(values) {
    const matrix = Array.from({ length: count }, () => Array(count + 1).fill(0));
    const add = (row, col, value) => {
      if (row !== undefined && col !== undefined) matrix[row][col] += value;
    };
    for (const [index, part] of sources.entries()) {
      const a = indices.get(part.a);
      const b = indices.get(part.b);
      const row = namedNodes.length + index;
      add(a, row, 1); add(b, row, -1);
      add(row, a, 1); add(row, b, -1);
      matrix[row][count] = part.value;
    }
    for (const part of active) {
      if (part.kind === "voltage" || part.kind === "open") continue;
      const a = indices.get(part.a);
      const b = indices.get(part.b);
      const v = drop(part, values);
      const [current, conductance] = response(part, v);
      const offset = current - conductance * v;
      add(a, a, conductance); add(b, b, conductance);
      add(a, b, -conductance); add(b, a, -conductance);
      add(a, count, -offset); add(b, count, offset);
    }
    return matrix;
  }

  let solution = solveLinear(linearize(Array(count).fill(0)));
  if (active.some(({ kind }) => kind === "diode")) {
    solution = solveNonlinear(solution, linearize);
  }
  const volts = new Map([...nodes.keys()].map((key) => [key, voltage(root(key), solution)]));
  const currents = new Map();
  const terminalCurrents = new Map();
  for (const part of active) {
    const current = part.kind === "voltage" ? solution[namedNodes.length + sources.indexOf(part)] :
      response(part, drop(part, solution))[0];
    if (part.type !== "pot") currents.set(part.id, current);
    terminalCurrents.set(part.from, (terminalCurrents.get(part.from) ?? 0) + current);
    terminalCurrents.set(part.to, (terminalCurrents.get(part.to) ?? 0) - current);
  }
  for (const { id, type } of parts) {
    const { model } = components[type];
    if (model === "open" || (model === "capacitor" && !transient)) currents.set(id, 0);
  }
  if (transient) {
    for (const part of active) {
      if (part.storage === "capacitor") transient.storage.set(part.id, drop(part, solution));
      if (part.storage === "inductor") transient.storage.set(part.id, currents.get(part.id));
    }
  }
  const floating = [...nodes.keys()].some((key) => !grounded.has(root(key)));
  return { volts, currents, terminalCurrents, floating };
}

function response(part, voltage) {
  if (part.kind === "open") return [0, 0];
  if (part.kind === "current") return [part.value / 1000, 0];
  if (part.kind === "history") return [part.offset + voltage * part.conductance, part.conductance];
  if (part.kind === "resistance") return [voltage / part.value, 1 / part.value];

  // Smooth the knee over 10 mV to make the Newton step continuous.
  const knee = (overdrive) => {
    if (overdrive <= 0) return [0, 0];
    if (overdrive >= 0.01) return [overdrive - 0.005, 1];
    return [overdrive ** 2 / 0.02, overdrive / 0.01];
  };
  const zener = part.type === "zener";
  const [forward, forwardSlope] = knee(voltage - (zener ? 0.7 : part.value));
  const [reverse, reverseSlope] = zener ? knee(-voltage - part.value) : [0, 0];
  return [voltage * 1e-9 + (forward - reverse) / 2, 1e-9 + (forwardSlope + reverseSlope) / 2];
}

function solveNonlinear(initial, linearize) {
  const residual = (matrix, values) => Math.max(...matrix.map((row) =>
    Math.abs(values.reduce((sum, value, index) => sum + row[index] * value, -row.at(-1)))
  ));
  let values = initial;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const matrix = linearize(values);
    const error = residual(matrix, values);
    if (error < 1e-8) return values;
    const next = solveLinear(matrix);
    let accepted = false;
    for (let step = 1; step >= 1 / 4096; step /= 2) {
      const candidate = values.map((value, index) => value + step * (next[index] - value));
      if (residual(linearize(candidate), candidate) < error) {
        values = candidate;
        accepted = true;
        break;
      }
    }
    if (!accepted) break;
  }
  throw new Error("다이오드 회로의 DC 해를 계산하지 못했습니다. 전원과 직렬 저항을 확인하세요.");
}
