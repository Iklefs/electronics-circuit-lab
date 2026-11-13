const circle = "M26 0a26 26 0 1 1-52 0a26 26 0 1 1 52 0";
const leads = "M-50 0h24m52 0h24";
const resistor = "M-50 0h17l6-11 9 22 9-22 9 22 9-22 9 22 9-22 6 11h17";
const capacitor = "M-50 0h43m14 0h43 M-7-18v36m14-36v36";
const diode = "M-50 0h38m24 0h38 M-12-16v32l24-16z M12-17v34";

export const frequencyRange = { min: 0.1, max: 500, initial: 5 };
export const motorSettings = {
  inductance: { label: "권선 인덕턴스 (mH)", initial: 5, min: 0.001, max: 10000, scale: 1e-3 },
  inertia: { label: "회전자·부하 관성 (g·cm²)", initial: 10, min: 0.01, max: 100000, scale: 1e-7 },
  constant: { label: "토크 상수 (mN·m/A)", initial: 10, min: 0.01, max: 1000, scale: 1e-3 },
  damping: { label: "회전 마찰·부하 계수 (µN·m·s/rad)", initial: 2, min: 0.01, max: 100000, scale: 1e-6 },
  load: { label: "외부 부하 토크 (mN·m)", initial: 0, min: -1000, max: 1000, scale: 1e-3 },
};

export function validMotorSettings(settings) {
  return settings === undefined || (settings !== null && typeof settings === "object" &&
    Object.entries(motorSettings).every(([key, { min, max }]) =>
      Number.isFinite(settings[key]) && settings[key] >= min && settings[key] <= max));
}

function generator(name, icon, shape, path) {
  return {
    name, icon, shape, group: 0, model: "voltage", value: 5, unit: "V", label: "최대 진폭",
    min: 0, max: 24, labels: ["출력 (+)", "기준 (−)"], symbol: leads + path + circle,
    note: "0 V를 중심으로 ±진폭을 출력합니다. 주파수와 파형은 오실로스코프에서 확인하세요.",
  };
}

export const logicChipGroup = 5;
export const groups = ["전원·접지", "수동소자", "반도체", "스위치", "출력·계측", "논리 칩"];
export const components = {
  source: { name: "직류 전원", icon: "±", group: 0, model: "voltage", value: 5, unit: "V", label: "전압", min: 0, max: 24,
    labels: ["양극", "음극"], symbol: leads + " M-18 0h12m-6-6v12 M7 0h12 " + circle },
  battery: { name: "배터리", icon: "▮", group: 0, model: "voltage", value: 9, unit: "V", label: "전압", min: 0, max: 24,
    labels: ["양극", "음극"], symbol: "M-50 0h44m12 0h44 M-6-20v40 M6-12v24" },
  current: { name: "전류원", icon: "→", group: 0, model: "current", value: 10, unit: "mA", label: "전류", min: 0, max: 1000,
    labels: ["전류 유입", "전류 유출"], symbol: leads + " M-17 0h33m-8-8l8 8-8 8 " + circle,
    note: "화살표 방향으로 지정한 전류를 공급하는 이상 모델입니다." },
  sine: generator("교류 전원 · 사인", "∿", "sine", " M-16 0q8-19 16 0t16 0 "),
  square: generator("구형파 발생기", "⊓", "square", " M-17 9h8v-18H8V9h9 "),
  triangle: generator("삼각파 발생기", "△", "triangle", " M-18 8l9-16L9 8l9-16 "),
  ground: { name: "접지", icon: "⏚", group: 0, value: 0, pins: [[0, -26]], labels: ["접지"],
    symbol: "M0-26V0m-18 0h36m-30 7h24m-18 7h12" },
  resistor: { name: "저항", icon: "Ω", group: 1, model: "resistance", value: 100, unit: "Ω", label: "저항값", min: 1, max: 1000000,
    symbol: resistor },
  pot: { name: "가변저항", icon: "↗", group: 1, model: "pot", value: 50, unit: "%", label: "와이퍼 위치", min: 0, max: 100,
    pins: [[-50, 0], [50, 0], [0, -43]], labels: ["왼쪽", "오른쪽", "와이퍼"],
    symbol: resistor + " M0-43v29m-5-6l5 6 5-6", note: "전체 저항은 10 kΩ입니다. 0%는 왼쪽, 100%는 오른쪽 단자 위치입니다." },
  capacitor: { name: "커패시터", icon: "‖", group: 1, model: "capacitor", value: 100, unit: "µF", label: "커패시턴스", min: 0.001, max: 100000,
    symbol: capacitor, note: "DC 정상상태에서는 전류가 0 A입니다. 오실로스코프를 양단에 연결해 충전·방전 파형을 보세요." },
  electrolytic: { name: "전해 커패시터", icon: "+‖", group: 1, model: "capacitor", value: 470, unit: "µF", label: "커패시턴스", min: 0.001, max: 100000,
    labels: ["양극", "음극"], symbol: capacitor + " M-24-17h10m-5-5v10",
    note: "극성이 있는 커패시터입니다. DC 정상상태에서 전류는 0 A이며, 역극성 손상은 모델링하지 않습니다." },
  inductor: { name: "인덕터", icon: "∿", group: 1, model: "inductor", value: 10, unit: "mH", label: "인덕턴스", min: 0.001, max: 10000,
    symbol: "M-50 0h15a8.75 8.75 0 0 1 17.5 0a8.75 8.75 0 0 1 17.5 0a8.75 8.75 0 0 1 17.5 0a8.75 8.75 0 0 1 17.5 0h15",
    note: "권선 저항을 0.1 Ω으로 가정합니다. 파형 실행 중 인덕턴스에 따른 전류 변화를 계산합니다." },
  diode: { name: "다이오드", icon: "▷", group: 2, model: "diode", value: 0.7, unit: "V", label: "순방향 문턱", min: 0.1, max: 5,
    labels: ["애노드", "캐소드"], symbol: diode },
  schottky: { name: "쇼트키 다이오드", icon: "▷", group: 2, model: "diode", value: 0.3, unit: "V", label: "순방향 문턱", min: 0.05, max: 5,
    labels: ["애노드", "캐소드"], symbol: diode + " M6-17h6v5m0 24v5h6" },
  zener: { name: "제너 다이오드", icon: "↯", group: 2, model: "diode", value: 5.1, unit: "V", label: "역방향 항복 전압", min: 1, max: 24,
    labels: ["애노드", "캐소드"], symbol: diode + " M5-22l7 5m0 34l7 5" },
  led: { name: "LED", icon: "✦", group: 2, model: "diode", light: true, value: 2, unit: "V", label: "순방향 문턱", min: 0.1, max: 6,
    labels: ["애노드", "캐소드"], symbol: diode + " M16-18l10-10m-6 0h6v6 M27-13l10-10m-6 0h6v6" },
  switch: { name: "스위치", icon: "⏼", group: 3, value: 0, toggle: true,
    symbol: "M-50 0h31m38 0h31 M-19 0l38-17", closed: "M-50 0h100" },
  spdt: { name: "전환 스위치", icon: "⤨", group: 3, value: 0, toggle: true, pins: [[-50, 0], [50, -18], [50, 18]],
    labels: ["공통", "A", "B"], symbol: "M-50 0h28l44-18h28 M22 18h28", closed: "M-50 0h28l44 18h28 M22-18h28" },
  lamp: { name: "램프", icon: "⊗", group: 4, model: "resistance", light: true, value: 100, unit: "Ω", label: "저항값", min: 1, max: 1000000,
    symbol: "M-50 0h29m42 0h29 M-13-13l26 26m0-26l-26 26 M21 0a21 21 0 1 1-42 0a21 21 0 1 1 42 0" },
  motor: { name: "DC 모터", icon: "M", group: 4, model: "motor", value: 10, unit: "Ω", label: "권선 저항", min: 1, max: 1000000,
    symbol: leads + " M-12 11v-22l12 15 12-15v22 " + circle,
    note: "브러시 DC 모터의 평균 모델입니다. 권선 전류가 토크를 만들고, 회전 속도에 비례한 역기전력이 권선 전류에 다시 영향을 줍니다." },
  voltmeter: { name: "전압계", icon: "V", group: 4, model: "open", value: 0,
    labels: ["양극", "음극"], symbol: leads + " M-10-12l10 24 10-24 " + circle,
    note: "두 단자의 전압 차를 표시합니다. 이상적인 전압계로 전류는 0 A입니다." },
  scope: { name: "오실로스코프", icon: "⌁", group: 4, model: "open", value: 0,
    labels: ["프로브 (+)", "기준 (−)"],
    symbol: "M-50 0h24m52 0h24 M-26-17h52v34h-52z M-18 0h7l5-8L3 8l5-8h10",
    note: "두 단자의 전압 차를 기록합니다. 오실로스코프 입력으로 전류는 흐르지 않으므로, 전류가 흐를 경로를 따로 연결한 뒤 측정할 부품 양단에 병렬로 연결하세요." },
  ammeter: { name: "전류계", icon: "A", group: 4, model: "ammeter", value: 0,
    labels: ["양극", "음극"], symbol: leads + " M-12 12l12-24 12 24 M-7 3h14 " + circle,
    note: "회로에 직렬로 연결하세요. 내부 저항을 0.01 Ω으로 가정합니다." },
  logicChip: { name: "논리 칩", icon: "▣", group: logicChipGroup, value: 0,
    note: "VCC–GND에 2–6 V를 연결하세요. 입력은 전원의 30% 이하에서 0, 70% 이상에서 1로 읽습니다. X 출력은 고임피던스입니다." },
};

export function chipPackage(chip) {
  const height = 54 + (Math.max(chip.inputs.length, chip.outputs.length) - 1) * 27;
  const side = (count, x) => Array.from({ length: count }, (_, i) => [x, (i - (count - 1) / 2) * 27]);
  return {
    height,
    pins: [[0, -height / 2 - 14], [0, height / 2 + 14],
      ...side(chip.inputs.length, -86), ...side(chip.outputs.length, 86)],
    labels: ["VCC", "GND", ...chip.inputs, ...chip.outputs.map(({ name }) => name)],
  };
}

export const pinsFor = (part) => part.type === "logicChip" ? chipPackage(part.chip).pins :
  components[part.type].pins ?? [[-50, 0], [50, 0]];
