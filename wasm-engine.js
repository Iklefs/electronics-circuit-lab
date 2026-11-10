import wasmUrl from "./engine/engine.wasm?url";

const wasm = await (async () => {
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error("WebAssembly download failed");
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  return instance.exports;
})().catch((error) => {
  console.error("Circuit engine could not start", error);
  return null;
});

// Shared ABI with engine/src/lib.rs. Each part has three pin slots and four input fields.
const pinStride = 3;
const partStride = 4;
const maxParts = 64;
const maxWires = 128;
const wireInput = maxParts * partStride;
const voltOutput = wireInput + maxWires * 2;
const currentOutput = voltOutput + maxParts * pinStride;
const historyOutput = currentOutput + maxParts;
const wireOutput = historyOutput + maxParts;
const bufferSize = wireOutput + maxWires;
let memory;

const unavailable = "회로 계산 엔진을 불러올 수 없습니다. 페이지를 새로고침하세요.";
function buffer() {
  if (!wasm) throw new Error(unavailable);
  if (memory?.buffer !== wasm.memory.buffer) {
    memory = new Float64Array(wasm.memory.buffer, wasm.engine_buffer(), bufferSize);
  }
  return memory;
}

export function rcTimeConstant(resistance, capacitance) {
  if (!wasm) throw new Error(unavailable);
  return wasm.rc_time_constant(resistance, capacitance);
}

export function rcVoltage(voltage, time, tau, charging) {
  return wasm.rc_voltage(voltage, time, tau, Number(charging));
}

function sendWires(data, parts, wires) {
  const indices = new Map(parts.map(({ id }, index) => [id, index]));
  const pin = ([id, number]) => indices.get(id) * pinStride + number;
  wires.forEach(({ a, b }, index) => {
    data[wireInput + index * 2] = pin(a);
    data[wireInput + index * 2 + 1] = pin(b);
  });
}

const errors = [
  "",
  "접지 부품을 추가하고 회로의 기준점에 연결하세요.",
  "전류원의 두 단자에 DC 전류가 흐를 경로를 연결하세요.",
  "전원의 양단이 바로 연결됐거나 이상적인 전원이 서로 충돌합니다. 배선을 확인하세요.",
  "다이오드 회로를 계산하지 못했습니다. 전원과 직렬 저항을 확인하세요.",
  "부품과 배선 데이터를 확인하세요.",
];

function check(status) {
  if (status !== 0) throw new Error(errors[status] ?? "회로를 계산하지 못했습니다.");
}

const measured = (value) => Number.isFinite(value) ? value : undefined;

export function solveAnalog(parts, wires, codeFor, pinCount, keyOf, transient) {
  let data = buffer();
  parts.forEach((part, index) => {
    data.set([codeFor(part.type), part.value, part.frequency ?? 0, transient?.storage.get(part.id) ?? 0], index * partStride);
  });
  sendWires(data, parts, wires);
  check(wasm.measure_analog(parts.length, wires.length, transient?.time ?? 0, transient?.step ?? 0));
  data = buffer();
  const volts = new Map([["gnd", 0]]);
  const currents = new Map();
  let floating = false;
  parts.forEach((part, index) => {
    for (let pin = 0; pin < pinCount(part); pin++) {
      const value = measured(data[voltOutput + index * pinStride + pin]);
      volts.set(keyOf([part.id, pin]), value);
      floating ||= value === undefined;
    }
    const current = measured(data[currentOutput + index]);
    if (current !== undefined) currents.set(part.id, current);
    const history = measured(data[historyOutput + index]);
    if (history !== undefined) transient?.storage.set(part.id, history);
  });
  const wireCurrents = new Map(wires.map(({ id }, index) => [id, measured(data[wireOutput + index])]));
  return { volts, currents, wireCurrents, floating };
}

export function solveLogic(parts, wires, codeFor) {
  let data = buffer();
  parts.forEach((part, index) => {
    data.set([codeFor(part.type), part.value ?? 0], index * partStride);
  });
  sendWires(data, parts, wires);
  check(wasm.measure_logic(parts.length, wires.length));
  data = buffer();
  return new Map(parts.map(({ id }, index) => {
    const start = voltOutput + index * pinStride;
    return [id, Array.from(data.subarray(start, start + pinStride))];
  }));
}
