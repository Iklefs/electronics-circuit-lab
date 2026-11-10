import { components, pinsFor } from "./components.js";
import { solveAnalog } from "./wasm-engine.js";

export const pinCount = (part) => pinsFor(part).length;
export const keyOf = ([id, pin]) => id + ":" + pin;

const codes = {
  ground: 0, switch: 1, spdt: 2, pot: 3, voltage: 4, current: 5, resistance: 6,
  ammeter: 7, capacitor: 8, inductor: 9, diode: 10, zener: 11, open: 12,
  sine: 13, square: 14, triangle: 15,
};

function codeFor(type) {
  const spec = components[type];
  return codes[type] ?? codes[spec.shape ?? spec.model];
}

export function measure(parts, wires, transient = null) {
  return solveAnalog(parts, wires, codeFor, pinCount, keyOf, transient);
}
