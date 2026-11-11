const nodeWidth = 138;
const nodeHeight = 48;
const columnGap = 94;
const rowGap = 76;
const margin = 24;
const trackGap = 9;

const escape = (value) => value.replace(/[&<>"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
})[char]);

function layoutColumns(chip) {
  const gates = new Map(chip.gates.map((gate) => [gate.id, gate]));
  const ranks = new Map();
  const visiting = new Set();

  function stage(id) {
    const gate = gates.get(id);
    if (!gate || visiting.has(id)) return 0;
    if (ranks.has(id)) return ranks.get(id);
    visiting.add(id);
    // Break feedback while assigning columns. The feedback wire is drawn below the gates.
    const rank = 1 + Math.max(0, ...gate.inputs.map(stage));
    visiting.delete(id);
    ranks.set(id, rank);
    return rank;
  }

  const columns = [chip.inputs.map((id) => ({ id, name: id, kind: "input", inputs: [] }))];
  for (const gate of chip.gates) {
    const rank = stage(gate.id);
    (columns[rank] ??= []).push({
      ...gate, kind: "gate",
      name: gate.type === "low" ? "상수 0" : gate.type === "high" ? "상수 1" : gate.type.toUpperCase(),
    });
  }
  columns.push(chip.outputs.map(({ name, from }) => ({ name, kind: "output", inputs: [from] })));
  return columns;
}

function getTracks(links, key) {
  const groups = new Map();
  for (const link of links) {
    const index = key(link);
    if (!groups.has(index)) groups.set(index, new Map());
    const group = groups.get(index);
    if (!group.has(link.source)) group.set(link.source, group.size);
  }
  return (link) => {
    const group = groups.get(key(link));
    return (group.get(link.source) + 1) / (group.size + 1);
  };
}

function routeLink(link, offset, before, after) {
  const { source, target, y, lane } = link;
  if (!source) return `M${target.x - 12} ${y}H${target.x}`;
  const x = source.x + nodeWidth;
  const route = lane === undefined
    ? `H${x + 22 + offset(link) * (columnGap - 44)}V${y}`
    : `H${x + 6 + before(link) * 14}V${lane}H${target.x - 6 - after(link) * 14}V${y}`;
  return `M${x} ${source.y + nodeHeight / 2}${route}H${target.x}`;
}

function drawNode(node) {
  const { x, y, name, kind, id, inputs } = node;
  const label = escape(name);
  const shrink = name.length > 13 ? ' textLength="118" lengthAdjust="spacingAndGlyphs"' : "";
  const isGate = kind === "gate";
  const pins = inputs.map((_, index) =>
    `<circle cx="0" cy="${inputY(inputs.length, index)}" r="3.5"/>`).join("");
  return `<g class="chip-diagram-node ${kind}" transform="translate(${x} ${y})">
    <title>${label}${isGate ? " · " + escape(id) : ""}</title>
    <rect width="${nodeWidth}" height="${nodeHeight}" rx="8"/>
    <text x="${nodeWidth / 2}" y="${isGate ? 20 : 29}"${shrink}>${label}</text>
    ${isGate ? `<text class="chip-diagram-id" x="${nodeWidth / 2}" y="37"${id.length > 20 ? shrink || ' textLength="118" lengthAdjust="spacingAndGlyphs"' : ""}>${escape(id)}</text>` : ""}
    ${pins}${kind !== "output" ? `<circle cx="${nodeWidth}" cy="${nodeHeight / 2}" r="3.5"/>` : ""}
  </g>`;
}

function inputY(count, index) {
  return nodeHeight * (index + 1) / (count + 1);
}

export function fullChipDiagram(chip) {
  const columns = layoutColumns(chip);
  const rowCount = Math.max(1, ...columns.map((column) => column.length));
  const nodes = columns.flatMap((column, stage) => column.map((node, row) => ({
    ...node, stage,
    x: margin + stage * (nodeWidth + columnGap),
    y: rowGap * (row + (rowCount - column.length) / 2),
  })));
  const sources = new Map(nodes.filter(({ kind }) => kind !== "output").map((node) => [node.id, node]));
  const links = nodes.flatMap((target) => target.inputs.map((id, index) => ({
    source: sources.get(id), target, index,
  })));
  const forwardBypass = links.filter(({ source, target }) => source && target.stage - source.stage > 1);
  const feedback = links.filter(({ source, target }) => source && target.stage <= source.stage);
  const yStart = margin + 26 + forwardBypass.length * trackGap;
  const yEnd = yStart + (rowCount - 1) * rowGap + nodeHeight;
  for (const node of nodes) node.y += yStart;
  for (const link of links) link.y = link.target.y + inputY(link.target.inputs.length, link.index);
  forwardBypass.forEach((link, index) => { link.lane = yStart - (index + 1) * trackGap; });
  feedback.forEach((link, index) => { link.lane = yEnd + (index + 1) * trackGap; });

  const routed = links.filter(({ lane }) => lane !== undefined);
  const offset = getTracks(links.filter(({ source, lane }) => source && lane === undefined), (link) => link.source.stage);
  const before = getTracks(routed, (link) => link.source.stage);
  const after = getTracks(routed, (link) => link.target.stage);
  const width = 2 * margin + columns.length * nodeWidth + (columns.length - 1) * columnGap;
  const height = yEnd + feedback.length * trackGap + margin;
  const edges = links.map((link) =>
    `<path class="${link.source ? "chip-diagram-wire" : "chip-diagram-wire open-pin"}" d="${routeLink(link, offset, before, after)}"/>`).join("");
  const labels = [
    chip.inputs.length ? `<text class="chip-diagram-column" x="${margin}" y="24">입력</text>` : "",
    `<text class="chip-diagram-column" x="${width - margin - nodeWidth}" y="24">출력</text>`,
  ].join("");
  return { width, height, content: labels + edges + nodes.map(drawNode).join("") };
}
