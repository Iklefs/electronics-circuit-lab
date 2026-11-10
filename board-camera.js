export function createBoardCamera(board, { width, height, controls, busy, onChange = () => {} }) {
  const minZoom = 0.5;
  const maxZoom = 3;
  const view = { zoom: 1, x: 0, y: 0 };
  const out = controls.querySelector('[data-zoom="out"]');
  const reset = controls.querySelector('[data-zoom="reset"]');
  const zoomIn = controls.querySelector('[data-zoom="in"]');

  function set(zoom, x, y) {
    const viewWidth = width / zoom;
    const viewHeight = height / zoom;
    const clamp = (position, extent) => Math.min(Math.max(0, extent), Math.max(Math.min(0, extent), position));
    Object.assign(view, { zoom, x: clamp(x, width - viewWidth), y: clamp(y, height - viewHeight) });
    board.setAttribute("viewBox", `${view.x} ${view.y} ${viewWidth} ${viewHeight}`);
    board.classList.toggle("is-zoomed", zoom > 1);
    reset.textContent = "초기화 · " + Math.round(zoom * 100) + "%";
    out.disabled = zoom <= minZoom;
    zoomIn.disabled = zoom >= maxZoom;
    onChange();
  }

  function point(event) {
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(board.getScreenCTM().inverse());
  }

  function zoomBy(factor, anchor = {
    x: view.x + width / (2 * view.zoom),
    y: view.y + height / (2 * view.zoom),
  }) {
    if (busy()) return;
    const zoom = Math.max(minZoom, Math.min(maxZoom, view.zoom * factor));
    const ratio = view.zoom / zoom;
    set(zoom, anchor.x - (anchor.x - view.x) * ratio, anchor.y - (anchor.y - view.y) * ratio);
  }

  board.addEventListener("wheel", (event) => {
    if (!event.deltaY || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    const factor = Math.exp(-Math.sign(event.deltaY) * Math.min(0.23, Math.abs(event.deltaY) * 0.008));
    zoomBy(factor, point(event));
  }, { passive: false });
  out.addEventListener("click", () => zoomBy(1 / 1.25));
  zoomIn.addEventListener("click", () => zoomBy(1.25));
  reset.addEventListener("click", () => {
    if (busy()) return;
    board.parentElement.scrollTo(0, 0);
    set(1, 0, 0);
  });
  return { view, set, point };
}
