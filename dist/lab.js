"use strict";

const byId = (id) => document.getElementById(id);
const parameters = ["r", "c", "v"];
const units = { r: "kΩ", c: "µF", v: "V" };
const inputs = Object.fromEntries(parameters.map((name) => [name, byId(name)]));
const modes = [...document.querySelectorAll('[name="mode"]')];
const notes = byId("notes");
const plot = byId("plot");
const sharePanel = byId("share-panel");
const linkField = byId("link");
const status = byId("status");
const defaults = { r: 10, c: 100, v: 5, mode: "charge" };
let reference = null;

const timeConstant = ({ r, c }) => r * c / 1000;
const number = (value) => Number(value.toPrecision(3)).toString();

function readControls() {
  return {
    ...Object.fromEntries(parameters.map((name) => [name, inputs[name].valueAsNumber])),
    mode: modes.find((input) => input.checked).value,
  };
}

function setControls(settings) {
  for (const name of parameters) inputs[name].value = settings[name];
  for (const input of modes) input.checked = input.value === settings.mode;
}

function validSettings(settings) {
  return settings && ["charge", "discharge"].includes(settings.mode) &&
    parameters.every((name) => {
      const value = settings[name];
      const { min, max, step } = inputs[name];
      return Number.isFinite(value) && value >= Number(min) && value <= Number(max) &&
        Number.isInteger((value - Number(min)) / Number(step || 1));
    });
}

function niceMaximum(value) {
  const scale = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((factor) => factor * scale).find((limit) => limit >= value);
}

function drawPlot(current) {
  const left = 58, top = 32, width = 559, height = 235;
  const bottom = top + height;
  const endTime = niceMaximum(5 * Math.max(timeConstant(current), reference ? timeConstant(reference) : 0));
  const endVoltage = Math.ceil(Math.max(current.v, reference?.v ?? 0));
  const x = (t) => left + width * t / endTime;
  const y = (voltage) => bottom - height * voltage / endVoltage;
  const curve = (settings) => {
    const tau = timeConstant(settings);
    const points = new Set(Array.from({ length: 161 }, (_, index) => index / 160 * endTime));
    for (let index = 1; index <= 100; index += 1) {
      const t = index / 20 * tau;
      if (t < endTime) points.add(t);
    }
    return [...points].sort((a, b) => a - b).map((t, index) => {
      const fraction = settings.mode === "charge" ? -Math.expm1(-t / tau) : Math.exp(-t / tau);
      return (index === 0 ? "M" : "L") + x(t).toFixed(2) + " " + y(settings.v * fraction).toFixed(2);
    }).join(" ");
  };
  const horizontal = Array.from({ length: 5 }, (_, index) => {
    const value = endVoltage * index / 4;
    return `<path d="M${left} ${y(value)}h${width}"/><text x="${left - 10}" y="${y(value) + 5}" text-anchor="end">${number(value)}</text>`;
  }).join("");
  const vertical = Array.from({ length: 6 }, (_, index) => {
    const t = endTime * index / 5;
    return `<path d="M${x(t)} ${top}v${height}"/><text x="${x(t)}" y="${bottom + 21}" text-anchor="middle">${number(t)}</text>`;
  }).join("");
  const tau = timeConstant(current);
  const tauVoltage = current.v * (current.mode === "charge" ? 1 - Math.exp(-1) : Math.exp(-1));
  const modeName = current.mode === "charge" ? "충전" : "방전";
  plot.innerHTML = `
    <title id="plot-description">${modeName} 곡선. 시정수 ${number(tau)}초, 시정수에서 전압 ${number(tauVoltage)}볼트.${reference ? " 저장 파형과 비교 중입니다." : ""}</title>
    <g stroke="#3b4e6c" fill="#c4d5ed" font-size="14">
      <style>#plot text{stroke:none}</style>
      ${horizontal}${vertical}
      <path d="M${left} ${top}V${bottom}h${width}" fill="none" stroke="#8194b4"/>
      <text x="6" y="17">전압 (V)</text>
      <text x="${left + width / 2}" y="313" text-anchor="middle">시간 (s)</text>
    </g>
    <path d="M${x(tau)} ${bottom}V${y(tauVoltage)}" fill="none" stroke="#68e4d0" stroke-dasharray="3 4" opacity=".65"/>
    <path d="${curve(current)}" fill="none" stroke="#68e4d0" stroke-width="3.2" stroke-linecap="round"/>
    ${reference ? `<path d="${curve(reference)}" fill="none" stroke="#fbc585" stroke-width="2.5" stroke-dasharray="7 5"/>` : ""}
    <circle cx="${x(tau)}" cy="${y(tauVoltage)}" r="5" fill="#68e4d0" stroke="#12213a" stroke-width="2"/>
  `;
}

function render() {
  const current = readControls();
  const charging = current.mode === "charge";
  for (const name of parameters) {
    byId(name + "-value").value = current[name] + " " + units[name];
  }
  byId("tau").textContent = number(timeConstant(current)) + " s";
  byId("v-label").textContent = charging ? "공급 전압 Vₛ" : "초기 전압 V₀";
  byId("formula").textContent = charging ? "V꜀(t) = Vₛ × (1 − e^(−t/τ))" : "V꜀(t) = V₀ × e^(−t/τ)";
  byId("checkpoint").textContent = charging
    ? "시정수 τ가 지나면 전압이 공급 전압의 약 63.2%에 도달합니다."
    : "시정수 τ가 지나면 전압이 초기 전압의 약 36.8%까지 내려갑니다.";
  byId("reference-label").hidden = !reference;
  if (reference) {
    const mode = reference.mode === "charge" ? "충전" : "방전";
    byId("reference-description").textContent = `저장 파형 · ${mode} · ${reference.r} kΩ · ${reference.c} µF · ${reference.v} V`;
  }
  byId("note-count").textContent = notes.value.length + " / 400";
  drawPlot(current);
}

function restore() {
  setControls(defaults);
  reference = null;
  notes.value = "";
  status.textContent = "";
  sharePanel.hidden = true;
  if (location.hash) {
    try {
      const payload = location.hash.slice(5);
      if (!location.hash.startsWith("#lab=") || payload.length > 5000) throw new Error();
      const bytes = Uint8Array.from(atob(payload.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
      const saved = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (saved.version !== 1 || !validSettings(saved.current) ||
        (saved.reference !== null && !validSettings(saved.reference)) ||
        typeof saved.notes !== "string" || saved.notes.length > notes.maxLength) throw new Error();
      setControls(saved.current);
      reference = saved.reference;
      notes.value = saved.notes;
      status.textContent = "공유 링크의 실험을 불러왔습니다.";
    } catch {
      status.textContent = "공유 링크를 읽을 수 없어 기본 설정을 열었습니다.";
    }
  }
  render();
}

function changed() {
  sharePanel.hidden = true;
  status.textContent = "";
  render();
}

for (const input of [...Object.values(inputs), ...modes]) input.addEventListener("input", changed);
notes.addEventListener("input", changed);
byId("compare").addEventListener("click", () => {
  reference = readControls();
  changed();
  status.textContent = "현재 파형을 저장했습니다. 실험 조건을 바꿔 비교해 보세요.";
});
byId("clear").addEventListener("click", () => {
  reference = null;
  changed();
  byId("compare").focus();
});
byId("reset").addEventListener("click", () => {
  setControls(defaults);
  reference = null;
  changed();
  status.textContent = "회로 설정을 초기화했습니다.";
});
byId("share").addEventListener("click", () => {
  const snapshot = JSON.stringify({ version: 1, current: readControls(), reference, notes: notes.value });
  const bytes = new TextEncoder().encode(snapshot);
  const encoded = btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const url = new URL(location.href);
  url.hash = "lab=" + encoded;
  linkField.value = url.href;
  sharePanel.hidden = false;
  linkField.focus();
  linkField.select();
});
byId("copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(linkField.value);
    status.textContent = "공유 링크를 복사했습니다.";
  } catch {
    linkField.focus();
    linkField.select();
    status.textContent = "선택된 링크를 복사해 주세요.";
  }
});
window.addEventListener("hashchange", restore);
restore();
