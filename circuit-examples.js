function divider(second, value, angle, supply, first) {
  return {
    parts: [
      ["source", "source", 145, 260, { angle: 90, value: supply }],
      ["top", "resistor", 380, 130, { value: first }],
      ["bottom", second, 565, 260, { angle, value }],
      ["meter", "voltmeter", 755, 260, { angle: 90 }],
      ["gnd", "ground", 455, 420],
    ],
    wires: [
      ["source", 0, "top", 0, [[145, 130]]],
      ["top", 1, "bottom", angle === 90 ? 0 : 1, [[565, 130]]],
      ["bottom", angle === 90 ? 0 : 1, "meter", 0],
      ["bottom", angle === 90 ? 1 : 0, "gnd", 0, [[565, 394]]],
      ["meter", 1, "gnd", 0, [[755, 394]]],
      ["source", 1, "gnd", 0, [[145, 394]]],
    ],
  };
}

function waveComparison(source, series, seriesValue, loadValue, frequency, amplitude, load = "resistor") {
  return {
    parts: [
      ["source", source, 115, 260, { angle: 90, value: amplitude, frequency }],
      ["series", series, 435, 115, { value: seriesValue }],
      ["load", load, 595, 260, { angle: 90, value: loadValue }],
      ["in", "scope", 295, 260, { angle: 90 }],
      ["out", "scope", 775, 260, { angle: 90 }],
      ["gnd", "ground", 465, 420],
    ],
    wires: [
      ["source", 0, "in", 0],
      ["source", 0, "series", 0, [[115, 115]]],
      ["series", 1, "load", 0, [[595, 115]]],
      ["load", 0, "out", 0],
      ["source", 1, "gnd", 0, [[115, 394]]],
      ["in", 1, "gnd", 0, [[295, 394]]],
      ["load", 1, "gnd", 0, [[595, 394]]],
      ["out", 1, "gnd", 0, [[775, 394]]],
    ],
  };
}

export const analogExamples = {
  lamp: {
    name: "스위치 · 램프 켜기",
    role: "스위치는 전류가 흐르는 경로를 열거나 닫습니다.",
    try: "스위치를 열고 닫아 램프가 꺼지고 켜지는지 보세요.",
  },
  rc: {
    name: "커패시터 · 충전과 방전",
    role: "커패시터는 전하를 저장해 양단 전압이 시간에 따라 변합니다.",
    try: "전환 스위치를 A로 놓아 충전하고, B로 바꿔 방전 파형을 보세요.",
  },
  rcFloating: {
    name: "커패시터 · 접지 없는 RC 충전",
    role: "전원, 저항, 커패시터로 닫힌 회로를 만들면 접지 부품 없이도 충전됩니다.",
    try: "부품 아래의 전하량 Q와 오실로스코프의 양단 전압을 보세요. 회로 재시작을 누르면 처음부터 충전합니다.",
    scopeWindow: "5",
    parts: [
      ["source", "source", 150, 260, { angle: 90 }],
      ["resistor", "resistor", 410, 125, { value: 10000 }],
      ["cap", "capacitor", 595, 250, { angle: 90 }],
      ["scope", "scope", 780, 250, { angle: 90 }],
    ],
    wires: [
      ["source", 0, "resistor", 0, [[150, 125]]],
      ["resistor", 1, "cap", 0, [[595, 125]]],
      ["cap", 1, "source", 1, [[595, 385], [150, 385]]],
      ["cap", 0, "scope", 0], ["cap", 1, "scope", 1],
    ],
  },
  ac: {
    name: "커패시터 · 교류 RC 필터",
    role: "저항과 커패시터를 연결하면 높은 주파수의 출력 진폭을 줄일 수 있습니다.",
    try: "교류 전원을 10 Hz에서 50 Hz로 바꾸고 오실로스코프에서 입력과 출력의 진폭을 비교하세요.",
  },
  fastRc: {
    name: "빠른 RC · 100 µs 충전",
    role: "100 Ω과 1 µF의 시정수는 100 µs입니다. 커패시터 전압은 구형파의 변화에 지수곡선으로 응답합니다.",
    try: "CH1의 구형파가 바뀌는 순간과 CH2가 목표 전압으로 다가가는 구간을 비교하세요.",
    scopeWindow: "0.01",
    ...waveComparison("square", "resistor", 100, 1, 100, 5, "capacitor"),
  },
  lc: {
    name: "LC · 감쇠 진동",
    role: "10 mH 인덕터와 10 µF 커패시터 사이에서 에너지가 오가며 약 503 Hz로 진동합니다.",
    try: "CH1의 구형파가 바뀔 때마다 CH2에서 진동이 시작됩니다. 인덕턴스를 높이면 주기가 길어집니다.",
    scopeWindow: "0.05",
    ...waveComparison("square", "inductor", 10, 10, 20, 2, "capacitor"),
  },
  led: {
    name: "저항 · LED 전류 제한",
    role: "LED와 직렬로 연결한 저항은 LED에 흐르는 전류를 제한합니다.",
    try: "저항을 220 Ω에서 1 kΩ으로 높이고 전류계의 mA 값이 줄어드는지 보세요.",
    parts: [
      ["source", "source", 120, 260, { angle: 90 }],
      ["resistor", "resistor", 320, 130, { value: 220 }],
      ["led", "led", 550, 130],
      ["meter", "ammeter", 760, 130],
      ["gnd", "ground", 450, 420],
    ],
    wires: [
      ["source", 0, "resistor", 0, [[120, 130]]],
      ["resistor", 1, "led", 0], ["led", 1, "meter", 0],
      ["meter", 1, "gnd", 0, [[830, 130], [830, 394]]],
      ["source", 1, "gnd", 0, [[120, 394]]],
    ],
  },
  divider: {
    name: "저항 · 전압 분배",
    role: "직렬 저항 두 개의 비율이 중간 지점의 전압을 정합니다.",
    try: "아래쪽 저항을 1 kΩ에서 2 kΩ으로 바꾸고 전압계가 3 V에서 4 V로 변하는지 보세요.",
    ...divider("resistor", 1000, 90, 6, 1000),
  },
  pot: {
    name: "가변저항 · 조절 전압",
    role: "가변저항의 와이퍼는 저항 양끝 사이에서 원하는 전압을 꺼내는 단자입니다.",
    try: "와이퍼를 50%에서 25%로 옮겨 전압계가 5 V에서 7.5 V로 바뀌는지 보세요.",
    parts: [
      ["source", "source", 140, 265, { angle: 90, value: 10 }],
      ["pot", "pot", 425, 220],
      ["meter", "voltmeter", 725, 250, { angle: 90 }],
      ["gnd", "ground", 480, 420],
    ],
    wires: [
      ["source", 0, "pot", 0],
      ["pot", 2, "meter", 0, [[425, 156], [725, 156]]],
      ["pot", 1, "gnd", 0, [[575, 220], [575, 394]]],
      ["meter", 1, "gnd", 0, [[725, 394]]],
      ["source", 1, "gnd", 0, [[140, 394]]],
    ],
  },
  diode: {
    name: "다이오드 · 반파 정류",
    role: "다이오드는 순방향으로 전류를 흘려 교류의 한쪽 반주기를 통과시킵니다.",
    try: "CH1의 사인파와 CH2를 비교하세요. CH2에서 음의 반주기가 거의 사라집니다.",
    scopeWindow: "0.2",
    ...waveComparison("sine", "diode", 0.7, 1000, 5, 5),
  },
  zener: {
    name: "제너 다이오드 · 전압 제한",
    role: "역방향으로 연결한 제너 다이오드는 항복 전압 근처에서 출력 전압의 상승을 제한합니다.",
    try: "직류 전원을 9 V에서 12 V로 높이고 출력이 약 5.1 V에 머무는지 보세요.",
    ...divider("zener", 5.1, 270, 9, 470),
  },
  inductor: {
    name: "인덕터 · 전류 변화 지연",
    role: "인덕터는 전류가 급하게 변하는 것을 막습니다. CH2의 저항 전압으로 전류 변화를 볼 수 있습니다.",
    try: "CH1의 구형파와 둥글게 변하는 CH2를 비교하세요. 인덕턴스를 1,000 mH에서 100 mH로 줄이면 CH2가 더 빠르게 변합니다.",
    scopeWindow: "1",
    ...waveComparison("square", "inductor", 1000, 10, 2, 2),
  },
  motor: {
    name: "DC 모터 · 기동과 역기전력",
    role: "모터가 가속하면 역기전력이 커지고 권선 전류가 줄어듭니다. 전원을 끊으면 회전 관성으로 잠시 더 돕니다.",
    try: "스위치를 닫고 회전 속도를 보세요. 모터 설정에서 부하 토크를 1 mN·m로 높인 뒤 전류와 속도를 비교하세요.",
    parts: [
      ["source", "source", 150, 255, { angle: 90 }],
      ["switch", "switch", 345, 135],
      ["motor", "motor", 555, 250, { angle: 90 }],
      ["diode", "diode", 775, 250, { angle: 270 }],
      ["gnd", "ground", 355, 415],
    ],
    wires: [
      ["source", 0, "switch", 0, [[150, 135]]],
      ["switch", 1, "motor", 0, [[555, 135]]],
      ["motor", 0, "diode", 1],
      ["motor", 1, "diode", 0],
      ["source", 1, "gnd", 0, [[150, 389]]],
      ["motor", 1, "gnd", 0, [[555, 389]]],
    ],
  },
};

function compareGates(upper, lower) {
  return {
    parts: [
      ["a", "input", 130, 150, { label: "입력 A" }],
      ["b", "input", 130, 320, { label: "입력 B" }],
      ["top", upper, 470, 150], ["bottom", lower, 470, 320],
      ["y", "output", 790, 150, { label: upper.toUpperCase() }],
      ["z", "output", 790, 320, { label: lower.toUpperCase() }],
    ],
    wires: [
      ["a", 2, "top", 0, 10], ["a", 2, "bottom", 0, -45],
      ["b", 2, "top", 1, 50], ["b", 2, "bottom", 1, -10],
      ["top", 2, "y", 0], ["bottom", 2, "z", 0],
    ],
  };
}

const halfAdder = compareGates("xor", "and");
halfAdder.parts[4][4].label = "합 S";
halfAdder.parts[5][4].label = "올림 C";

export const logicExamples = {
  half: {
    name: "XOR·AND · 반가산기",
    role: "XOR는 한 자리 합을, AND는 다음 자리로 넘기는 올림을 만듭니다.",
    try: "입력 A와 B를 둘 다 1로 켜면 합 S는 0, 올림 C는 1입니다.",
    ...halfAdder,
  },
  not: {
    name: "NOT · 신호 반전",
    role: "NOT은 입력 0을 1로, 입력 1을 0으로 바꿉니다.",
    try: "스위치를 바꾸면서 직결 출력과 반전 출력이 서로 반대로 움직이는지 보세요.",
    parts: [
      ["a", "input", 150, 215, { label: "입력 A" }],
      ["gate", "not", 460, 300],
      ["direct", "output", 780, 140, { label: "직결" }],
      ["inverted", "output", 780, 300, { label: "반전" }],
    ],
    wires: [["a", 2, "gate", 0], ["a", 2, "direct", 0, -50], ["gate", 2, "inverted", 0]],
  },
  andOr: {
    name: "AND·OR · 둘 다 / 하나 이상",
    role: "AND는 두 입력이 모두 1일 때, OR는 하나 이상 1일 때 출력이 1입니다.",
    try: "A만 1로 켜면 OR만 1이 됩니다. B도 켜면 AND도 1이 됩니다.",
    ...compareGates("and", "or"),
  },
  xorXnor: {
    name: "XOR·XNOR · 다름 / 같음",
    role: "XOR는 두 입력이 다를 때, XNOR는 두 입력이 같을 때 1을 출력합니다.",
    try: "00, 01, 10, 11을 만들어 두 표시등의 값을 비교하세요.",
    ...compareGates("xor", "xnor"),
  },
  nandNor: {
    name: "NAND·NOR · 반전된 조건",
    role: "NAND는 AND의 결과를, NOR는 OR의 결과를 반전합니다.",
    try: "처음에는 둘 다 1입니다. A만 켜면 NOR가 먼저 0이 되고, B까지 켜면 NAND도 0이 됩니다.",
    ...compareGates("nand", "nor"),
  },
  mux: {
    name: "NOT·AND·OR · 신호 선택기",
    role: "NOT은 두 경로의 선택 조건을 반대로 만들고, AND는 경로를 열며, OR는 열린 경로의 값을 출력으로 보냅니다.",
    try: "A는 0, B는 1로 둔 채 선택 S를 바꿔 보세요. S가 0이면 A, 1이면 B가 출력됩니다.",
    parts: [
      ["a", "input", 110, 110, { label: "입력 A" }],
      ["s", "input", 110, 235, { label: "선택 S" }],
      ["b", "input", 110, 355, { label: "입력 B", value: 1 }],
      ["not", "not", 305, 190],
      ["top", "and", 510, 130], ["bottom", "and", 510, 330],
      ["or", "or", 700, 230], ["y", "output", 880, 230, { label: "출력 Y" }],
    ],
    wires: [
      ["a", 2, "top", 0, 15], ["s", 2, "not", 0],
      ["not", 2, "top", 1], ["s", 2, "bottom", 0, 15], ["b", 2, "bottom", 1, -15],
      ["top", 2, "or", 0], ["bottom", 2, "or", 1], ["or", 2, "y", 0],
    ],
  },
  pulse: {
    name: "펄스·AND · 신호 통과",
    role: "펄스 발생기는 0과 1을 반복합니다. AND는 허용 입력이 1일 때 그 펄스를 통과시킵니다.",
    try: "허용 스위치를 0으로 바꾸면 직결 표시등은 계속 깜빡이고 AND 출력은 0이 됩니다.",
    parts: [
      ["clock", "pulse", 130, 155],
      ["enable", "input", 130, 325, { label: "허용", value: 1 }],
      ["and", "and", 465, 295],
      ["direct", "output", 790, 135, { label: "직결" }],
      ["out", "output", 790, 295, { label: "AND 출력" }],
    ],
    wires: [
      ["clock", 2, "direct", 0, -30], ["clock", 2, "and", 0, -35],
      ["enable", 2, "and", 1, 25], ["and", 2, "out", 0],
    ],
  },
};

export function bindExamplePicker(select, guide, examples) {
  for (const [key, example] of Object.entries(examples)) select.add(new Option(example.name, key));
  const showGuide = () => {
    const example = examples[select.value];
    guide.firstElementChild.textContent = example.role;
    guide.lastElementChild.textContent = example.try;
  };
  select.addEventListener("change", showGuide);
  showGuide();
}

export function buildExample(example, addPart, addWire) {
  const ids = new Map(example.parts.map(([key, type, x, y, options]) =>
    [key, addPart(type, x, y, options).id]));
  for (const [from, a, to, b, route] of example.wires) {
    addWire([ids.get(from), a], [ids.get(to), b], route);
  }
}
