import { components } from "./components.js";
import { measure } from "./circuit.js";

export function isTimeDependent(part) {
  const spec = components[part.type];
  return Boolean(spec.shape) || spec.model === "capacitor" || spec.model === "inductor";
}

export function createSimulation(onSample, onFrame, onError) {
  const storage = new Map();
  let parts = [];
  let wires = [];
  let step = 1 / 1200;
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
    time = 0;
  }

  function advance(now) {
    budget += Math.min(0.05, (now - (lastFrame ?? now)) / 1000);
    lastFrame = now;
    let reading;
    let count = 0;
    const deadline = performance.now() + 8;
    try {
      while (budget >= step && count < 32 && (count === 0 || performance.now() < deadline)) {
        reading = measure(parts, wires, { time: time + step, step, storage });
        time += step;
        budget -= step;
        count += 1;
        onSample(reading, time);
      }
    } catch (error) {
      stop();
      onError(error);
      return;
    }
    // Avoid accumulating work after a busy frame or while the tab is hidden.
    if (count) budget = Math.min(budget, step);
    frameId = requestAnimationFrame(advance);
    if (reading) onFrame(reading);
  }

  function configure(nextParts, nextWires, active) {
    parts = nextParts;
    wires = nextWires;
    const storedIds = new Set(parts.filter(isTimeDependent).map(({ id }) => id));
    for (const id of storage.keys()) {
      if (!storedIds.has(id)) storage.delete(id);
    }
    if (!active) {
      stop();
      return;
    }
    const frequency = Math.max(0, ...parts.filter(({ type }) => components[type].shape)
      .map((part) => part.frequency));
    step = Math.min(1 / 1200, frequency ? 1 / (frequency * 48) : Infinity);
    if (frameId === null) frameId = requestAnimationFrame(advance);
  }

  return { configure, reset, isRunning: () => frameId !== null };
}
