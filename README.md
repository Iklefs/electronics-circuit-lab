# 회로 실험실

[회로 작업대](https://iklefs.github.io/electronics-circuit-lab/#bench) · [논리회로 작업대](https://iklefs.github.io/electronics-circuit-lab/#logic)

## 논리 칩 JSON

논리회로 작업대에서 **칩 / JSON**을 여세요. **작업대를 칩으로 저장**하면 입력 스위치와 출력 표시등이 칩의 외부 단자가 됩니다. 아래와 같은 JSON을 작성하거나 AI에 생성을 요청한 뒤 **JSON으로 칩 추가**를 누르면 부품 목록에서 배치할 수 있습니다.

```json
{
  "v": 1,
  "name": "반가산기",
  "inputs": ["A", "B"],
  "outputs": [
    { "name": "S", "from": "sum" },
    { "name": "C", "from": "carry" }
  ],
  "gates": [
    { "id": "sum", "type": "xor", "inputs": ["A", "B"] },
    { "id": "carry", "type": "and", "inputs": ["A", "B"] }
  ]
}
```

- 각 게이트의 `inputs`와 출력의 `from`에는 입력 이름, 게이트 ID, 또는 연결되지 않은 신호를 뜻하는 `null`을 사용합니다.
- `low`, `high`의 입력은 0개, `not`, `buf`는 1개, `and`, `nand`, `or`, `nor`, `xor`, `xnor`는 2개입니다.
- 칩 하나에 입력 최대 8개, 출력 1~8개, 게이트 최대 120개를 담을 수 있습니다. 게이트 ID는 영문, 숫자, 밑줄, 하이픈으로 구성하며 입력 이름과 겹치지 않아야 합니다.

## 로컬 실행

Node.js 22와 Rust stable을 설치한 뒤 아래 명령을 실행합니다.

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run dev
```

`npm run build`는 `engine/`의 Rust 코드를 WebAssembly로 컴파일하고 정적 배포 파일을 `dist/`에 생성합니다. `cargo test --manifest-path engine/Cargo.toml`로 엔진 테스트를 실행할 수 있습니다.
