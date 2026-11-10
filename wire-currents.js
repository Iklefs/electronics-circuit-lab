import { idealConnections, keyOf } from "./circuit.js";

export function wireCurrents(parts, wires, reading) {
  const graph = new Map();
  const currents = new Map();
  function connect(from, to, id = null) {
    const edge = { from, to, id };
    if (!graph.has(from)) graph.set(from, []);
    if (!graph.has(to)) graph.set(to, []);
    graph.get(from).push(edge);
    graph.get(to).push(edge);
    if (id !== null) currents.set(id, undefined);
  }
  for (const { id, a, b } of wires) connect(keyOf(a), keyOf(b), id);
  for (const [a, b] of idealConnections(parts)) connect(a, b);

  // A bridge carries the sum of the branch currents on its far side.
  // A wire on an ideal loop has no unique current in this model.
  const visited = new Map();
  function walk(node, parent) {
    const order = visited.size;
    visited.set(node, order);
    let low = order;
    let sum = reading.terminalCurrents.get(node) ?? 0;
    for (const edge of graph.get(node)) {
      if (edge === parent) continue;
      const forward = edge.from === node;
      const neighbor = forward ? edge.to : edge.from;
      if (visited.has(neighbor)) {
        low = Math.min(low, visited.get(neighbor));
        continue;
      }
      const subtree = walk(neighbor, edge);
      low = Math.min(low, subtree.low);
      sum += subtree.sum;
      if (edge.id !== null && subtree.low > order && Number.isFinite(reading.volts.get(node))) {
        currents.set(edge.id, forward ? subtree.sum : -subtree.sum);
      }
    }
    return { low, sum };
  }
  for (const node of graph.keys()) {
    if (!visited.has(node)) walk(node, null);
  }
  return currents;
}
