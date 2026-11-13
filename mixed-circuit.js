import { flattenLogic, gateCode, maxChipPins } from "./logic-circuit.js";
import { solveLogic } from "./wasm-engine.js";

const outputResistance = 25;
const unknown = -1;
const evaluations = new WeakMap();

function chipOutputs(chip, inputs) {
  let evaluator = evaluations.get(chip);
  if (!evaluator) {
    const nodes = chip.inputs.map((_, index) => ({ id: index + 2, type: "input", value: 0 }));
    const inputs = nodes.map(({ id }, pin) => ({ a: [id, 2], b: [1, pin] }));
    const netlist = flattenLogic([{ id: 1, type: "chip" }, ...nodes], inputs, new Map([["chip", chip]]));
    evaluator = {
      ...netlist, cache: new Map(),
      inputs: nodes.map(({ id }) => netlist.nodes[netlist.ports.get(id + ":2")[0] - 1]),
      outputs: chip.outputs.map((_, pin) => netlist.ports.get("1:" + (maxChipPins + pin))[0]),
    };
    evaluations.set(chip, evaluator);
  }
  const key = inputs.join(",");
  if (evaluator.cache.has(key)) return evaluator.cache.get(key);
  evaluator.inputs.forEach((node, index) => {
    const value = inputs[index];
    // An unwired buffer produces X using the same rules as the logic workbench.
    node.type = value === unknown ? "buf" : "input";
    node.value = value;
  });
  const values = solveLogic(evaluator.nodes, evaluator.links, gateCode);
  const outputs = evaluator.outputs.map((id) => values.get(id)[2]);
  if (evaluator.cache.size >= 128) evaluator.cache.clear();
  evaluator.cache.set(key, outputs);
  return outputs;
}

export function prepareMixedCircuit(parts, wires, solve, voltageBetween, keyOf) {
  const analog = parts.filter(({ type }) => type !== "logicChip");
  const chipParts = parts.filter(({ type }) => type === "logicChip");
  let partId = 0;
  let wireId = 0;
  const endpoints = new Map();
  const chips = chipParts.map(({ id, chip }) => {
    const pins = [];
    const count = 2 + chip.inputs.length + chip.outputs.length;
    for (let pin = 0; pin < count; pin++) {
      // Pair two independent terminals on each ideal open branch.
      if (pin % 2 === 0) analog.push({ id: --partId, type: "voltmeter", value: 0 });
      const end = [partId, pin % 2];
      endpoints.set(keyOf([id, pin]), end);
      pins.push(end);
    }
    const [vcc, gnd] = pins;
    const inputs = pins.slice(2, 2 + chip.inputs.length);
    const outputs = pins.slice(2 + chip.inputs.length).map((pin) => ({
      pin, driver: { id: --partId, type: "resistor", value: outputResistance },
      pinWire: --wireId, railWire: --wireId,
    }));
    return { id, chip, vcc, gnd, inputs, outputs };
  });

  const links = wires.map(({ id, a, b }) => ({ id,
    a: endpoints.get(keyOf(a)) ?? a, b: endpoints.get(keyOf(b)) ?? b }));
  const outputCount = chips.reduce((count, chip) => count + chip.outputs.length, 0);
  if (analog.length + outputCount > 256 || links.length + outputCount * 2 > 512) {
    throw new Error("칩의 핀을 포함해 계산할 수 있는 회로 크기를 초과했습니다.");
  }
  const open = Array(outputCount).fill(unknown);
  let previous = open;

  function solveWithDrivers(levels, transient) {
    const devices = [...analog];
    const connections = [...links];
    let index = 0;
    for (const { outputs, vcc, gnd } of chips) {
      for (const { pin, driver, pinWire, railWire } of outputs) {
        const level = levels[index++];
        if (level === unknown) continue;
        devices.push(driver);
        connections.push({ id: pinWire, a: [driver.id, 0], b: pin },
          { id: railWire, a: [driver.id, 1], b: level === 1 ? vcc : gnd });
      }
    }
    return solve(devices, connections, transient);
  }

  function evaluate(reading, forcedOpen) {
    const signals = new Map();
    const drive = [];
    for (const { id, chip, inputs, vcc, gnd } of chips) {
      const supply = voltageBetween(reading, vcc, gnd);
      const powered = supply >= 2 - 1e-9 && supply <= 6 + 1e-9;
      const levels = inputs.map((pin) => {
        const voltage = voltageBetween(reading, pin, gnd);
        if (!powered || voltage === undefined) return unknown;
        if (voltage <= 0.3 * supply) return 0;
        if (voltage >= 0.7 * supply) return 1;
        return unknown;
      });
      const output = (powered ? chipOutputs(chip, levels) : chip.outputs.map(() => unknown))
        .map((value, index) => forcedOpen.has(drive.length + index) ? unknown : value);
      drive.push(...output);
      signals.set(id, { supply, powered, inputs: levels, outputs: output });
    }
    return { signals, drive };
  }

  return function measureMixed(transient) {
    const forcedOpen = new Set();
    const seen = new Map();
    let levels = previous;
    let reading, signals, trial;
    for (;;) {
      const key = levels.join(",");
      seen.set(key, levels);
      trial = transient && { ...transient, storage: new Map(transient.storage) };
      reading = solveWithDrivers(levels, trial);
      if (transient && reading.elapsed < transient.step) {
        // The adaptive solver can shorten the interval for a new load.
        // Discard feedback history evaluated at a later endpoint.
        transient = { ...transient, step: reading.elapsed };
        seen.clear();
        seen.set(key, levels);
      }
      const evaluated = evaluate(reading, forcedOpen);
      signals = evaluated.signals;
      const next = evaluated.drive;
      if (next.every((value, index) => value === levels[index])) break;
      const repeated = seen.get(next.join(","));
      if (repeated || seen.size >= 32) {
        // Only outputs that have varied during the feedback cycle become high impedance.
        const visited = [...seen.values()];
        const cycle = repeated ? visited.slice(visited.indexOf(repeated)) : visited;
        next.forEach((value, index) => {
          if (cycle.some((state) => state[index] !== value)) forcedOpen.add(index);
        });
        levels = next.map((value, index) => forcedOpen.has(index) ? unknown : value);
        seen.clear();
      } else {
        levels = next;
      }
    }
    previous = levels;
    if (transient) for (const [id, state] of trial.storage) transient.storage.set(id, state);
    for (const [key, end] of endpoints) {
      const endpoint = keyOf(end);
      reading.volts.set(key, reading.volts.get(endpoint));
      reading.references.set(key, reading.references.get(endpoint));
    }
    reading.chips = signals;
    return reading;
  };
}
