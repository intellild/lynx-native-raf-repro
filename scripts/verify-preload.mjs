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
const lynxtronVersion = require("@lynx-js/lynxtron/package.json").version;
const executable = process.env.LYNXTRON_EXECUTABLE || null;
const artifacts = path.join(root, ".tmp");
await mkdir(artifacts, { recursive: true });

// Windowless rendering and normal window creation both need an awake display.
// Keep it awake for this batch; the child exits even if this process crashes.
const caffeinate =
  process.platform === "darwin"
    ? spawn("caffeinate", ["-dimsu", "-t", "900"], { stdio: "ignore" })
    : null;
caffeinate?.on("error", () => {});

const cases = [
  "sync",
  "js-promise",
  "js-callback",
  "native-promise",
  "native-callback",
];
const modeFilter = process.env.PRELOAD_MODES
  ? process.env.PRELOAD_MODES.split(",")
      .map((mode) => mode.trim())
      .filter(Boolean)
  : null;
const modes = modeFilter
  ? modeFilter.map((mode) => mode === "windowless")
  : [false, true];
const results = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runOnce(windowless, testCase, attempt) {
  const name = `${windowless ? "windowless" : "windowed"}-${testCase}`;
  const logName =
    attempt === 1 ? `preload-${name}.log` : `preload-${name}-retry${attempt}.log`;
  const child = spawn(
    executable || process.execPath,
    executable ? [root] : [cli, root],
    {
      cwd: root,
      detached: true,
      env: {
        ...process.env,
        PRELOAD_TEST: "1",
        PRELOAD_CASE: testCase,
        RAF_WINDOWLESS: String(Number(windowless)),
        RAF_PUMP_NS_RUN_LOOP: "0",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  let timedOut = false;
  let stopTimer = null;
  const hasTerminalResult = () => {
    for (const line of log.split("\n")) {
      if (!line.startsWith("PRELOAD_PROBE ")) continue;
      try {
        const probe = JSON.parse(line.slice("PRELOAD_PROBE ".length));
        if (probe.value !== 5) continue;
        if (probe.stage === testCase) return true;
      } catch {}
    }
    return false;
  };
  const stopWhenDone = () => {
    if (stopTimer || timedOut) return;
    if (
      hasTerminalResult() ||
      /Assertion failed.*Environment::GetCurrent/.test(log)
    ) {
      stopTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, 1500);
    }
  };
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      log += chunk;
      stopWhenDone();
    });
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, 15000);
  const exit = await new Promise((resolve) => {
    child.on("error", (error) => resolve({ error: error.message }));
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  clearTimeout(timeout);
  if (stopTimer) clearTimeout(stopTimer);
  await writeFile(path.join(artifacts, logName), log);

  const lines = log.split("\n");
  const probes = lines
    .filter((line) => line.startsWith("PRELOAD_PROBE "))
    .map((line) => JSON.parse(line.slice("PRELOAD_PROBE ".length)));
  const assertion =
    lines.find((line) =>
      /Assertion failed.*Environment::GetCurrent|Environment::GetCurrent\(isolate\)/.test(
        line,
      ),
    ) || null;
  const abortLine =
    lines.find((line) => /exited with signal SIGABRT/.test(line)) || null;
  const crashed = Boolean(assertion) || Boolean(abortLine);
  const stage =
    testCase === "sync"
      ? probes.find((probe) => probe.stage === "sync")
      : probes.find((probe) => probe.stage === testCase && probe.value === 5);
  const requested = probes.some(
    (probe) => probe.stage === `${testCase}-requested`,
  );
  const loaded = probes.some((probe) => probe.stage === "loaded");
  const synced = probes.find(
    (probe) => probe.stage === "sync" && probe.value === 5,
  );

  return {
    name,
    attempt,
    windowless,
    testCase,
    valid: Boolean(loaded && (testCase !== "sync" || synced)),
    requested,
    crashed,
    timedOut,
    exit,
    assertion: assertion
      ? assertion.trim()
      : abortLine
        ? abortLine.trim()
        : null,
    stage: stage || null,
    probes,
  };
}

async function run(windowless, testCase) {
  let result;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = await runOnce(windowless, testCase, attempt);
    if (result.valid) break;
    console.error(
      `${result.name}: no usable preload output (attempt ${attempt}); retrying`,
    );
    await sleep(1500);
  }
  results.push(result);
  console.log(JSON.stringify(result));
  return result;
}

for (const windowless of modes) {
  for (const testCase of cases) {
    await run(windowless, testCase);
    await sleep(1000);
  }
}

const syncRuns = results.filter((result) => result.testCase === "sync");
const jsRuns = results.filter((result) => result.testCase.startsWith("js-"));
const nativeRuns = results.filter((result) =>
  result.testCase.startsWith("native-"),
);
const allValid = results.every((result) => result.valid);
const syncValid = syncRuns.every(
  (result) => result.valid && !result.crashed && result.stage,
);
const jsAsyncOk = jsRuns.every(
  (result) =>
    result.valid &&
    result.requested &&
    !result.crashed &&
    result.stage &&
    result.stage.value === 5,
);
const nativeAsyncCrashed = nativeRuns.every(
  (result) =>
    result.valid && result.requested && result.crashed && !result.stage,
);
const nativeAsyncFixed = nativeRuns.every(
  (result) =>
    result.valid &&
    result.requested &&
    !result.crashed &&
    result.stage &&
    result.stage.value === 5,
);
const verdict = {
  lynxtron: lynxtronVersion,
  runtime: executable || "npm-runtime",
  machine: process.platform + "-" + process.arch,
  allValid,
  syncValid,
  jsAsyncOk,
  nativeAsyncCrashed,
  nativeAsyncFixed,
  reproduced: allValid && syncValid && jsAsyncOk && nativeAsyncCrashed,
  fixed: allValid && syncValid && jsAsyncOk && nativeAsyncFixed,
  assertion:
    nativeRuns.find((result) => result.assertion)?.assertion || null,
};
console.log("PRELOAD_VERDICT " + JSON.stringify(verdict));
console.log(
  verdict.reproduced
    ? "PRELOAD_RESULT reproduced: JS sync/promise/callback pass, native N-API promise/callback abort with Environment::GetCurrent assertion"
    : verdict.fixed
      ? "PRELOAD_RESULT fixed: native N-API promise/callback now resolve normally"
      : "PRELOAD_RESULT inconclusive: see per-run JSON above",
);
process.exitCode =
  allValid && syncValid && jsAsyncOk && (nativeAsyncCrashed || nativeAsyncFixed)
    ? 0
    : 1;
caffeinate?.kill();
