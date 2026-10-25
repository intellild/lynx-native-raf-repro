import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(
  path.dirname(require.resolve("@lynx-js/lynxtron/package.json")),
  "cli.js",
);
const verifyRepro = process.argv.includes("--verify-repro");
const controlOnly = process.argv.includes("--control");
const executable = process.env.LYNXTRON_EXECUTABLE || null;
const artifacts = path.join(root, ".tmp");
await mkdir(artifacts, { recursive: true });
console.log(`RAF_RUNTIME ${executable || "npm-runtime"}`);
let failed = false;

async function run(windowless, pump) {
  const name = `${windowless ? "windowless" : "windowed"}-${pump ? "control" : "native"}`;
  const child = spawn(
    executable || process.execPath,
    executable ? [root] : [cli, root],
    {
      cwd: root,
      detached: true,
      env: {
        ...process.env,
        RAF_WINDOWLESS: String(Number(windowless)),
        RAF_PUMP_NS_RUN_LOOP: String(Number(pump)),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      log += chunk;
    });
  const timeout = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, 20000);
  const exit = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ error: error.message }));
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  await writeFile(path.join(artifacts, `${name}.log`), log);
  const line = log.split("\n").find((line) => line.startsWith("RAF_RESULT "));
  const result = line ? JSON.parse(line.slice("RAF_RESULT ".length)) : null;
  const valid =
    exit.code === 0 &&
    result &&
    !result.displayAsleepAtStart &&
    !result.displayAsleep &&
    result.attachedOnBts &&
    result.requests === 1;
  const expectedCallbacks = verifyRepro && !pump ? 0 : 1;
  const ok = valid && result.callbacks === expectedCallbacks;
  failed ||= !ok;
  console.log(
    JSON.stringify({ name, ok: Boolean(ok), expectedCallbacks, exit, result }),
  );
  if (!valid)
    console.error(
      `${name}: invalid experiment; check display wake state and .tmp/${name}.log`,
    );
}

for (const windowless of [true, false]) {
  if (!controlOnly) await run(windowless, false);
  if (verifyRepro || controlOnly) await run(windowless, true);
}
process.exitCode = failed ? 1 : 0;
