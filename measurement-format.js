const voltageUnits = [[1, "V"], [1e-3, "mV"], [1e-6, "µV"]];
const currentUnits = [[1e-3, "mA"], [1e-6, "µA"], [1e-9, "nA"]];
const chargeUnits = [[1e-6, "µC"], [1e-9, "nC"], [1e-12, "pC"]];
const powerUnits = [[1, "W"], [1e-3, "mW"], [1e-6, "µW"]];

export const voltageResolution = voltageUnits.at(-1)[0];
export const currentResolution = currentUnits.at(-1)[0];

function format(value, units) {
  if (!Number.isFinite(value)) return "미측정";
  const magnitude = Math.abs(value);
  const [scale, unit] = units.find(([scale]) => magnitude >= scale) ?? [];
  if (!unit) return (magnitude ? "≈0 " : "0 ") + units[0][1];
  return Number((value / scale).toPrecision(4)) + " " + unit;
}

export const formatVoltage = (volts) => format(volts, voltageUnits);
export const formatCurrent = (amps) => format(amps, currentUnits);
export const formatCharge = (coulombs) => format(coulombs, chargeUnits);
export const formatPower = (watts) => format(watts, powerUnits);
