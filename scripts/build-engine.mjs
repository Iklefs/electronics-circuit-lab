import { spawnSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const build = spawnSync("cargo", [
  "build", "--locked", "--release", "--target", "wasm32-unknown-unknown",
  "--manifest-path", "engine/Cargo.toml", "--target-dir", "engine/target",
], { cwd: root, stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

copyFileSync(
  new URL("../engine/target/wasm32-unknown-unknown/release/circuit_engine.wasm", import.meta.url),
  new URL("../engine/engine.wasm", import.meta.url),
);
