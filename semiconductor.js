import { voltageBetween } from "./circuit.js";

export const ambientTemperature = 25;
export const thermalModels = {
  led: { resistance: 350, timeConstant: 4, limit: 100, heatFraction: 0.85 },
  diode: { resistance: 350, timeConstant: 5, limit: 175, heatFraction: 1 },
  schottky: { resistance: 300, timeConstant: 5, limit: 125, heatFraction: 1 },
  zener: { resistance: 300, timeConstant: 5, limit: 150, heatFraction: 1 },
};

function dissipation(part, reading) {
  const voltage = voltageBetween(reading, [part.id, 0], [part.id, 1]);
  const current = reading?.currents.get(part.id);
  return voltage === undefined || current === undefined ? undefined : Math.max(0, voltage * current);
}

export function advanceTemperature(part, reading, temperature, elapsed) {
  const model = thermalModels[part.type];
  const heatingPower = (dissipation(part, reading) ?? 0) * model.heatFraction;
  const target = ambientTemperature + model.resistance * heatingPower;
  return temperature + (target - temperature) * -Math.expm1(-elapsed / model.timeConstant);
}

export function semiconductorReading(part, reading, temperature) {
  const model = thermalModels[part.type];
  const rise = Math.max(0, temperature - ambientTemperature);
  const forwardCurrent = Math.max(0, reading?.currents.get(part.id) ?? 0);
  const brightness = part.type === "led"
    ? Math.min(1, forwardCurrent / 0.02) * Math.max(0.4, 1 - rise * 0.003)
    : 0;
  return {
    temperature,
    power: dissipation(part, reading),
    brightness,
    heat: Math.min(1, rise / (model.limit - ambientTemperature)),
    overheated: temperature >= model.limit,
  };
}
