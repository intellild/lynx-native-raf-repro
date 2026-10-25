import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin")
  throw new Error("This reproduction requires macOS.");
const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const headers = path.join(
  path.dirname(require.resolve("@lynx-js/lynx-library-headers/package.json")),
  "include",
);
mkdirSync(path.join(root, "dist"), { recursive: true });
execFileSync(
  "clang++",
  [
    "-std=c++17",
    "-fobjc-arc",
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-I",
    headers,
    "-framework",
    "Foundation",
    "-framework",
    "CoreGraphics",
    path.join(root, "native/probe.mm"),
    "-o",
    path.join(root, "dist/probe.node"),
  ],
  { stdio: "inherit" },
);
// Plain N-API addon used by the preload async-callback reproduction.
execFileSync(
  "clang++",
  [
    "-std=c++17",
    "-bundle",
    "-undefined",
    "dynamic_lookup",
    "-I",
    headers,
    path.join(root, "native/preload_probe.cc"),
    "-o",
    path.join(root, "dist/preload_probe.node"),
  ],
  { stdio: "inherit" },
);
