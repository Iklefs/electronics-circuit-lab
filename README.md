# 회로 실험실

[회로 작업대](https://iklefs.github.io/electronics-circuit-lab/#bench) · [논리회로 작업대](https://iklefs.github.io/electronics-circuit-lab/#logic)

## 로컬 실행

Node.js 22와 Rust stable을 설치한 뒤 아래 명령을 실행합니다.

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run dev
```

`npm run build`는 `engine/`의 Rust 코드를 WebAssembly로 컴파일하고 정적 배포 파일을 `dist/`에 생성합니다. `cargo test --manifest-path engine/Cargo.toml`로 엔진 테스트를 실행할 수 있습니다.
