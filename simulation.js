import { components } from "./components.js";
import { prepareCircuit } from "./circuit.js";
import { advanceTemperature, ambientTemperature, thermalModels } from "./semiconductor.js";

function hasElectricalDynamics(part) {
  const spec = components[part.type];
  return Boolean(spec.shape) || ["capacitor", "inductor", "motor"].includes(spec.model);
}

export function isTimeDependent(part) {
  return hasElectricalDynamics(part) || Object.hasOwn(thermalModels, part.type);
}

export function createSimulation(onSample, onFrame, onError) {
  const storage = new Map();
  const temperatures = new Map();
  let semiconductors = [];
  const temperatureOf = (id) => temperatures.get(id) ?? ambientTemperature;
  let measure;
  let maxStep = 1 / 1200;
  let nextStep = maxStep;
  let speed = 1;
  let time = 0;
  let budget = 0;
  let lastFrame = null;
  let frameId = null;

  function stop() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = lastFrame = null;
    budget = 0;
  }

  function reset() {
    stop();
    storage.clear();
    temperatures.clear();
    time = 0;
    nextStep = maxStep;
  }

  function advance(now) {
    budget = Math.min(0.25, budget + Math.min(0.05, (now - (lastFrame ?? now)) / 1000) * speed);
    lastFrame = now;
    let reading;
    let count = 0;
    const deadline = performance.now() + 8;
    try {
      while (budget >= Math.min(nextStep, maxStep) && count < 1024 &&
             (count === 0 || performance.now() < deadline)) {
        const step = Math.min(nextStep, maxStep);
        reading = measure({ time, step, storage });
        time += reading.elapsed;
        budget -= reading.elapsed;
        nextStep = reading.nextStep;
        count += 1;
        for (const part of semiconductors) {
          temperatures.set(part.id, advanceTemperature(part, reading, temperatureOf(part.id), reading.elapsed));
        }
        onSample(reading, time);
      }
    } catch (error) {
      stop();
      onError(error);
      return;
    }
    frameId = requestAnimationFrame(advance);
    if (reading) onFrame(reading);
  }

  function configure(parts, wires, active) {
    const dynamic = parts.filter(hasElectricalDynamics);
    const storedIds = new Set(dynamic.map(({ id }) => id));
    for (const id of storage.keys()) {
      if (!storedIds.has(id)) storage.delete(id);
    }
    semiconductors = parts.filter(({ type }) => Object.hasOwn(thermalModels, type));
    const semiconductorIds = new Set(semiconductors.map(({ id }) => id));
    for (const id of temperatures.keys()) {
      if (!semiconductorIds.has(id)) temperatures.delete(id);
    }
    if (!active) {
      stop();
      return;
    }
    // Prepare lazily so an oversized circuit reports through the normal error path.
    let prepared, steadyReading;
    measure = (transient) => {
      prepared ??= prepareCircuit(parts, wires);
      if (dynamic.length || !semiconductors.length) return prepared(transient);
      steadyReading ??= prepared();
      return { ...steadyReading, elapsed: transient.step, nextStep: transient.step };
    };
    const frequency = Math.max(0, ...parts.filter(({ type }) => components[type].shape)
      .map((part) => part.frequency));
    maxStep = Math.min(1 / 1200, frequency ? 1 / (frequency * 64) : Infinity);
    nextStep = maxStep;
    if (frameId === null) frameId = requestAnimationFrame(advance);
  }

  function setSpeed(multiplier) {
    speed = multiplier;
    budget = 0;
    lastFrame = null;
  }

  return { configure, reset, setSpeed, temperatureOf, isRunning: () => frameId !== null };
}
