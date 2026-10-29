# Preload native async minimal reproduction

This is the isolated case for the preload/N-API bug. A native addon is loaded
inside a Lynxtron preload script and exposed to the UI with
`contextBridge.exposeInLynxBTS()`; the UI calls it through
`NativeModules.nodejs.exposed`.

## Files

| File | Purpose |
| --- | --- |
| `native/preload_probe.cc` | N-API addon: `syncAdd`, `asyncAdd` (Promise resolved via TSFN), `callbackAdd` (TSFN callback) |
| `preload/preload.mjs` | Preload script: exposes the addon plus pure-JS Promise/callback controls |
| `src/index.jsx` | UI calls the selected case through `NativeModules.nodejs.exposed` |
| `main.mjs` | Loads `preload/preload.mjs` via `lynxPreference.preload` when `PRELOAD_TEST=1` |
| `scripts/verify-preload.mjs` | Runs each case in a fresh app process and captures the abort |

The minimal exposure is:

```js
const native = require("../dist/preload_probe.node");
contextBridge.exposeInLynxBTS({
  syncAdd: (a, b) => native.syncAdd(a, b),
  asyncAdd: (a, b) => native.asyncAdd(a, b),
  callbackAdd: (a, b, callback) => native.callbackAdd(a, b, callback),
});
```

`asyncAdd` creates a Promise with `napi_create_promise` and resolves it from a
TSFN; `callbackAdd` calls the JS callback from a TSFN. Both are deliberately
minimal N-API, not a framework wrapper.

## Run

```sh
pnpm install
pnpm build
pnpm test:preload
```

Only the normal window:

```sh
PRELOAD_MODES=windowed pnpm test:preload
```

Against a locally built Lynxtron:

```sh
LYNXTRON_EXECUTABLE=/path/to/Lynxtron.app/Contents/MacOS/lynxtron \
  pnpm test:preload
```

`pnpm test:preload` exits 0 when the bug is reproduced or fixed; inspect
`PRELOAD_VERDICT` and `.tmp/preload-*.log`.

## Observed on Lynxtron 0.0.30 (broken)

| Case | Result |
| --- | --- |
| native sync / JS Promise / JS callback | returns `5` |
| native Promise (`asyncAdd`) | abort |
| native callback (`callbackAdd`) | abort |

The TSFN is accepted, then Node aborts before the JS completion runs:

```text
[preload-probe] worker queueing tsfn
[preload-probe] tsfn queue status=0
  #  Assertion failed: (Environment::GetCurrent(isolate)) == (env)
  #  node::InternalCallbackScope::InternalCallbackScope(...)
...
Lynxtron Framework ... exited with signal SIGABRT
```

The same assertion occurs with the locally built Lynxtron `main`
(`3aff47a`) and latest Lynx, which already contains Node patch `8ace6a7`
(PR #307). Pure-JS Promise/callback functions still work, so the preload
bridge itself is not the problem; the failure is the native TSFN completion
crossing into the preload environment while the Lynx BTS environment is
current.

## Verified fixed in Lynxtron 0.0.31 (2026-10-29)

| Case | Windowless | Normal window |
| --- | --- | --- |
| Native sync / JS Promise / JS callback | 5 | 5 |
| Native Promise (`asyncAdd`, TSFN) | 5 | 5 |
| Native callback (`callbackAdd`, TSFN) | 5 | 5 |

All 10 cases (5 cases × 2 modes) passed in two consecutive runs, all on attempt
1. There is no `Environment::GetCurrent(isolate) == env` assertion and no
SIGABRT:

```json
{"lynxtron":"0.0.31","allValid":true,"nativeAsyncCrashed":false,
 "nativeAsyncFixed":true,"reproduced":false,"fixed":true,"assertion":null}
```

## Workaround

On 0.0.30, keep native objects and async completions in the Node main process
and relay JSON through `lynxBridge.handle()` / `NativeModules.bridge.call()`;
expose only synchronous functions from preload. `src/main/desktop/main.ts` in
Catus Terminal documents the same workaround. Lynxtron 0.0.31 no longer requires
this workaround for the pattern above.
