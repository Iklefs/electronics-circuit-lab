export function selectedIds(selection, kind) {
  if (selection?.kind === "group") return kind === "part" ? selection.parts : selection.wires;
  return selection?.kind === kind ? [selection.id] : [];
}

export function isSelected(selection, kind, id) {
  return selectedIds(selection, kind).includes(id);
}

function selectionFrom(parts, wires) {
  if (!parts.length && !wires.length) return null;
  if (parts.length + wires.length > 1) return { kind: "group", parts, wires };
  return parts.length ? { kind: "part", id: parts[0] } : { kind: "wire", id: wires[0] };
}

export function toggleSelection(selection, kind, id) {
  const parts = new Set(selectedIds(selection, "part"));
  const wires = new Set(selectedIds(selection, "wire"));
  const ids = kind === "part" ? parts : wires;
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return selectionFrom([...parts], [...wires]);
}

export function selectionMessage(selection, fallback) {
  if (selection?.kind !== "group") return fallback;
  const { parts, wires } = selection;
  const counts = [parts.length && `부품 ${parts.length}개`, wires.length && `배선 ${wires.length}개`];
  return counts.filter(Boolean).join(" · ") + " 선택됨";
}

function rectangle(x1, y1, x2, y2) {
  return { left: Math.min(x1, x2), top: Math.min(y1, y2),
    right: Math.max(x1, x2), bottom: Math.max(y1, y2) };
}

export function createBoxSelection(rect, point, partLayer, wireLayer) {
  return {
    draw(start, event) {
      const end = point(event);
      const bounds = rectangle(start.x, start.y, end.x, end.y);
      rect.setAttribute("x", bounds.left);
      rect.setAttribute("y", bounds.top);
      rect.setAttribute("width", bounds.right - bounds.left);
      rect.setAttribute("height", bounds.bottom - bounds.top);
      rect.removeAttribute("hidden");
    },
    finish(start, event, existing) {
      const box = rectangle(start.clientX, start.clientY, event.clientX, event.clientY);
      const parts = new Set(selectedIds(existing, "part"));
      const wires = new Set(selectedIds(existing, "wire"));
      for (const part of partLayer.children) {
        const body = part.querySelector(".part-box, .logic-body > rect");
        const bounds = body.getBoundingClientRect();
        if (bounds.left <= box.right && box.left <= bounds.right &&
            bounds.top <= box.bottom && box.top <= bounds.bottom) {
          parts.add(Number(part.dataset.part ?? part.dataset.logicPart));
        }
      }
      for (const wire of wireLayer.children) {
        const line = wire.querySelector(".wire-line, .logic-signal");
        const bounds = line.getBoundingClientRect();
        if (bounds.left >= box.left && bounds.right <= box.right &&
            bounds.top >= box.top && bounds.bottom <= box.bottom) {
          wires.add(Number(wire.dataset.wire ?? wire.dataset.logicWire));
        }
      }
      return selectionFrom([...parts], [...wires]);
    },
    hide() { rect.setAttribute("hidden", ""); },
  };
}

export function moveTogether(parts, boundsFor) {
  const originals = parts.map((part) => ({ part, x: part.x, y: part.y, ...boundsFor(part) }));
  const minX = Math.min(0, Math.ceil(Math.max(...originals.map(({ left, x }) => left - x))));
  const maxX = Math.max(0, Math.floor(Math.min(...originals.map(({ right, x }) => right - x))));
  const minY = Math.min(0, Math.ceil(Math.max(...originals.map(({ top, y }) => top - y))));
  const maxY = Math.max(0, Math.floor(Math.min(...originals.map(({ bottom, y }) => bottom - y))));
  return (dx, dy) => {
    const xOffset = Math.max(minX, Math.min(maxX, Math.round(dx / 10) * 10));
    const yOffset = Math.max(minY, Math.min(maxY, Math.round(dy / 10) * 10));
    for (const { part, x, y } of originals) {
      part.x = x + xOffset;
      part.y = y + yOffset;
    }
    return [xOffset, yOffset];
  };
}

export function bindPanMode(board, button) {
  button.addEventListener("click", () => {
    const active = board.classList.toggle("pan-mode");
    button.setAttribute("aria-pressed", String(active));
  });
  return (event) => event.button === 1 || board.classList.contains("pan-mode");
}
