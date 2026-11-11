const previewCache = new WeakMap();
const maxGates = 6;
const maxStages = 3;
const gateWidth = 24;
const gateHeight = 14;

export function chipPinY(index, count) {
  return 10 + (index - (count - 1) / 2) * 28;
}

function stagesOf(chip) {
  const gates = new Map(chip.gates.map((gate) => [gate.id, gate]));
  const ranks = new Map();
  const visiting = new Set();

  function rank(id) {
    const gate = gates.get(id);
    if (!gate || !gate.inputs.length) return 0;
    if (visiting.has(id)) return Infinity;
    if (ranks.has(id)) return ranks.get(id);
    visiting.add(id);
    const stage = 1 + Math.max(...gate.inputs.map(rank));
    visiting.delete(id);
    ranks.set(id, stage);
    return stage;
  }

  for (const gate of chip.gates) rank(gate.id);
  const count = Math.max(0, ...ranks.values());
  if (count > maxStages) return null;
  return Array.from({ length: count }, (_, index) =>
    chip.gates.filter(({ id }) => ranks.get(id) === index + 1));
}

function previewPaths(links, top, bottom) {
  const tracks = new Map();
  const gap = ({ source, target }) => source.x + ":" + target.x;
  const adjacent = ({ source, target }) => target.stage - source.stage <= 1;
  for (const link of links) {
    if (!link.source || !adjacent(link)) continue;
    const key = gap(link);
    if (!tracks.has(key)) tracks.set(key, new Set());
    tracks.get(key).add(link.source);
  }
  const lanes = new Map([[top, []], [bottom, []]]);
  const paths = [];
  for (const link of links) {
    const { source, target } = link;
    if (!source) {
      paths.push(`<path class="open-pin" d="M${target.x - 5} ${target.y}H${target.x}"/>`);
      continue;
    }
    let route;
    if (adjacent(link)) {
      const signals = [...tracks.get(gap(link))].sort((a, b) => a.y - b.y);
      const ratio = (signals.indexOf(source) + 1) / (signals.length + 1);
      const bend = source.x + (target.x - source.x) * ratio;
      route = `H${bend}V${target.y}`;
    } else {
      // Signals that bypass a gate column run above or below the gates.
      const order = source.y + target.y < top + bottom ? [top, bottom] : [bottom, top];
      const lane = order.find((y) => lanes.get(y).every((other) => other.source === source ||
        other.target.x <= source.x || other.source.x >= target.x));
      if (lane === undefined) return "";
      lanes.get(lane).push(link);
      route = `h4V${lane}H${target.x - 4}V${target.y}`;
    }
    paths.push(`<path d="M${source.x} ${source.y}${route}H${target.x}"/>`);
  }
  return paths.join("");
}

function makePreview(chip, width, height) {
  if (chip.gates.length > maxGates || Math.max(chip.inputs.length, chip.outputs.length) > 3) return "";
  const stages = stagesOf(chip);
  if (!stages) return "";

  const edge = width / 2;
  const top = -height / 2 + 25;
  const bottom = height / 2 - 7;
  const firstRow = top + 9;
  const lastRow = bottom - 9;
  const rowCount = Math.max(1, ...stages.map((stage) => stage.length));
  if (rowCount > 1 && (lastRow - firstRow) / (rowCount - 1) < gateHeight + 3) return "";
  const columns = {
    0: [],
    1: [0],
    2: [-23, 23],
    3: [-41, 0, 41],
  }[stages.length];

  const sources = new Map(chip.inputs.map((id, index) =>
    [id, { x: -edge, y: chipPinY(index, chip.inputs.length), stage: 0 }]));
  const constants = chip.gates.filter(({ inputs }) => !inputs.length);
  if (constants.length > 2) return "";
  const nodes = constants.map((gate, index) => ({
    gate, x: -edge + 21, y: bottom - 1 - 12 * index, stage: 0,
  }));

  stages.forEach((stage, index) => stage.forEach((gate, row) => {
    const y = stage.length === 1 ? (firstRow + lastRow) / 2 :
      firstRow + row * (lastRow - firstRow) / (stage.length - 1);
    nodes.push({ gate, x: columns[index], y, stage: index + 1 });
  }));
  for (const { gate, x, y, stage } of nodes) {
    sources.set(gate.id, { x: x + (stage ? gateWidth / 2 : 4), y, stage });
  }

  const links = [];
  for (const { gate, x, y, stage } of nodes) {
    gate.inputs.forEach((id, index) => {
      const target = { x: x - gateWidth / 2, y: y + (gate.inputs.length === 1 ? 0 : index ? 4 : -4), stage };
      links.push({ source: sources.get(id), target });
    });
  }
  chip.outputs.forEach(({ from }, index) => {
    const target = { x: edge, y: chipPinY(index, chip.outputs.length), stage: stages.length + 1 };
    links.push({ source: sources.get(from), target });
  });
  const paths = previewPaths(links, top, bottom);
  if (!paths) return "";

  const boxes = nodes.map(({ gate, x, y, stage }) => {
    const w = stage ? gateWidth : 8;
    const h = stage ? gateHeight : 10;
    const text = stage ? gate.type.toUpperCase() : gate.type === "high" ? "1" : "0";
    return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="2"/>
      <text x="${x}" y="${y + 2.5}">${text}</text>`;
  }).join("");
  return `<g class="logic-chip-preview" aria-hidden="true">${paths}${boxes}</g>`;
}

export function chipPreview(chip, width, height) {
  if (!previewCache.has(chip)) previewCache.set(chip, makePreview(chip, width, height));
  return previewCache.get(chip);
}
