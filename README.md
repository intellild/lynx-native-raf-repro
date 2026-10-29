# Lynxtron native RAF and preload async reproductions

macOS-only reproductions for Lynxtron **0.0.31** (the RAF case was originally
verified on 0.0.28). Requires macOS 14+, an awake attached display, Node.js
22.18+ and Xcode Command Line Tools. The RAF case contains no Rust, terminal,
custom native view, GPU renderer, JS RAF loop or preload bridge. A second,
independent case adds a minimal preload script and Node-API addon.

```sh
pnpm install
pnpm build
pnpm test
```

`pnpm test` opens one windowless and one normal window sequentially. Each process
registers one native extension, requests **one** frame from `runtime_attach` on
BTS, observes for five seconds, prints `RAF_RESULT`, then quits. The test expects
one callback and exits nonzero when the bug reproduces. The five-second host
timer only ends observation; it never produces a frame.

```text
main.mjs: load probe.node before creating the window
     ↓
native/probe.mm: runtime_attach (BTS)
     ↓
lynx_vsync_observer_request_animation_frame(observer, 1, callback, nullptr)
     ↓
expected: one callback with start/target timestamps
actual: inspect RAF_RESULT and .tmp/*.log
```

Diagnostic control:

```sh
pnpm test:control
pnpm repro
```

`test:control` makes the **same** request, then temporarily runs BTS NSRunLoop
for 0.5 seconds. This blocking pump is an experiment, not a production fix.
`repro` runs both modes with and without the pump; success means normal native
RAF received zero callbacks and the control received one. A sleeping display,
missing attach, wrong thread, crash or timeout fails validation instead of being
reported as a reproduction. Logs and binaries are ignored by Git.

For manual use: `pnpm start`; set `RAF_WINDOWLESS=1` or
`RAF_PUMP_NS_RUN_LOOP=1` to select a mode. Close the sample window normally or let
it exit after five seconds. Every invocation is a fresh process.

## References

- [Official extension lifecycle and VSyncObserver documentation](https://lynxjs.org/next/api/lynx-native-api/lynx-extension-module.html)
- [Observer request and BTS callback dispatch](https://github.com/lynx-family/lynx/blob/6dc0784fde6135466c21f51262a81e42a547f6d9/core/shell/vsync_observer_impl.cc)
- [macOS DisplayLink implementation](https://github.com/lynx-family/lynx/blob/6dc0784fde6135466c21f51262a81e42a547f6d9/platform/darwin/macos/common/vsync_monitor_macos.mm)
- [Lynxtron libuv BTS patch](https://github.com/lynx-family/lynxtron/blob/main/src/patches/lynx/0003-Replace-MessageLoopimpl-with-libuv-for-lynx-bts.patch)

The Lynx revision above comes from the local Lynxtron checkout's DEPS.lynx;
it is source-analysis context, not a runtime-reported embedded commit.

## Native RAF observed result

Verified on 2026-10-04: macOS 27.0.1 (26A434), arm64, Node.js 24.15.0,
Lynxtron 0.0.28. The display was awake at the start and end of every run, and
`attachedOnBts` was true. `pnpm build` and `pnpm repro` completed successfully.

| Window mode | Native requests | Native callbacks | Callbacks with diagnostic pump |
| --- | ---: | ---: | ---: |
| Windowless | 1 | 0 | 1 |
| Normal window | 1 | 0 | 1 |

Re-verified on 2026-10-25 with **Lynxtron 0.0.30**, macOS 27.0.1, Node.js
24.17.0: identical results in both window modes (`pnpm repro` exit 0,
`pnpm test` exit 1).

Re-verified on 2026-10-29 with **Lynxtron 0.0.31**: both window modes now
receive one callback. `pnpm test` exits 0. `pnpm repro` exits 1 only because it
is a bug-expectation script; native callbacks are 1 in both modes, so the bug no
longer reproduces.

The normal regression test (`pnpm test`) expects one callback, so the zero-callback
baseline above violates its assertion. A later separate `pnpm test` invocation
was rejected as an invalid experiment because the display had gone to sleep;
that invocation is not counted as proof of the bug. No screenshots or GPU
rendering are involved.

## Preload native async crash

This case covers functions exposed from `preload` through
`contextBridge.exposeInLynxBTS()` and called by the UI through
`NativeModules.nodejs.exposed`. `native/preload_probe.cc` exposes native
synchronous, promise and callback functions; `preload/preload.mjs` additionally
exposes pure-JS promise/callback controls. See
[preload/README.md](preload/README.md) for the isolated minimal example.

```sh
pnpm build
pnpm test:preload
```

`pnpm test:preload` runs `sync`, `js-promise`, `js-callback`,
`native-promise` and `native-callback` in both window modes. It uses
`lynxBridge` only to report observations. It exits 0 when the bug is reproduced
(JS/native sync and JS async controls pass, native async aborts) or when it is
fixed (native async resolves normally); it exits 1 for an invalid or
inconclusive run. Logs are written to `.tmp/preload-*.log`.

Re-verified on 2026-10-25 with **Lynxtron 0.0.30**, macOS 27.0.1, arm64, Node.js
24.17.0:

| Case | Windowless | Normal window |
| --- | --- | --- |
| Native sync (`syncAdd`) | 5 | 5 |
| JS promise (`jsAsyncAdd`) | 5 | 5 |
| JS callback (`jsCallbackAdd`) | 5 | 5 |
| Native promise (`asyncAdd`, TSFN) | abort | abort |
| Native callback (`callbackAdd`, TSFN) | abort | abort |

Re-verified on 2026-10-29 with **Lynxtron 0.0.31**: all cases pass in both
window modes; native Promise resolves `5` and native callback receives `5`, with
no assertion or abort. `PRELOAD_VERDICT` reports `"fixed": true`.

The native async runs queue the TSFN successfully, but on 0.0.30 the JS
completion never executes:

```text
[preload-probe] worker queueing tsfn
[preload-probe] tsfn queue status=0
  #  Assertion failed: (Environment::GetCurrent(isolate)) == (env)
...
lynxtron.app/Contents/MacOS/lynxtron exited with signal SIGABRT
```

No `tsfn resolve callback entered` or `tsfn callback entered` line appears. The
stack reaches Node's `InternalCallbackScope` from `ThreadPoolWork::ScheduleWork`
on the Lynx BTS libuv loop. Lynxtron hosts the preload and Lynx BTS Node
environments on one isolate/libuv loop; the completion carries the preload
environment, while `Environment::GetCurrent(isolate)` is the BTS environment.
The failed attempt is retried (up to three total attempts) by the verifier only
when the app produces no preload output at all (a display/window-server startup
issue), never when the assertion was observed.

This is why the Catus Terminal workaround keeps native objects and async
completions in the Node main process and relays JSON through `lynxBridge.handle`
/ `NativeModules.bridge.call`; preload only exposes sync functions. See its
`docs/sftp-async.md` and `src/main/desktop/main.ts` comment. Lynxtron 0.0.30
already includes [PR #307](https://github.com/lynx-family/lynxtron/pull/307)'s
`v8::Context::Scope` fix for Node-API async work, but the TSFN completion path
still aborted at that time. Lynxtron 0.0.31 fixed it; see the re-verification
below.

## Lynxtron 0.0.31 re-verification (2026-10-29)

Upgraded this repository to Lynxtron **0.0.31** (released 2026-10-27) and reran
both cases on macOS 27.0.1, arm64, Node.js 24.17.0, with the display awake.

### Native RAF

| Window mode | Native requests | Native callbacks |
| --- | ---: | ---: |
| Windowless | 1 | 1 |
| Normal window | 1 | 1 |

All valid runs report `attachedOnBts=true` and the display awake. `pnpm test`
exits 0. The diagnostic pump is no longer needed for the normal request. The
`pnpm repro` command exits 1 because it still expects the old zero-callback
behavior; this is not a failure of the app.

### Preload native async

| Case | Windowless | Normal window |
| --- | --- | --- |
| Native sync / JS Promise / JS callback | 5 | 5 |
| Native Promise (`asyncAdd`, TSFN) | **5** | **5** |
| Native callback (`callbackAdd`, TSFN) | **5** | **5** |

All 10 cases (5 cases × 2 modes) passed in two consecutive runs, all on attempt
1. No `Environment::GetCurrent(isolate) == env` assertion, no SIGABRT, and the
windowless startup issue no longer appeared. The final verdict was:

```json
{"lynxtron":"0.0.31","allValid":true,"nativeAsyncCrashed":false,
 "nativeAsyncFixed":true,"reproduced":false,"fixed":true,"assertion":null}
```

Both Lynxtron issues [#352](https://github.com/lynx-family/lynxtron/issues/352)
and [#353](https://github.com/lynx-family/lynxtron/issues/353) are fixed by
0.0.31.

## Latest source build verification (2026-10-25)

> Historical: this section predates Lynxtron 0.0.31. The released 0.0.31 fixes
> both bugs; see the re-verification above.

Built locally outside this repository with:

- Lynxtron `main` at `3aff47a7e775cfaa690a3e1f0855e9b49485cac3`
- Lynx `develop` at `66b413c982f0d2ae52aa2d476270975436a4538f` plus the
  Lynxtron Lynx patches (TestBench patch 0006 skipped; replay is
  Release-disabled)
- Textra at `aacb462eccc5874822e1fc598653723ef5aa483b`; the revision pinned by
  latest Lynx (`14a7c14`) lacks the `GetGraphemeBoundary` API required by Clay
- Node patch `8ace6a7` (PR #307) applied
- Local app: `/Users/xiexiaofa/lynxtron/out/Release/lynxtron.app`

The verifier's `lynxtron` version field still reports the npm JS API package
(0.0.30); the `runtime` field points at the locally built app.

| Case | Local latest source |
| --- | --- |
| RAF windowless | 0 native callbacks |
| RAF normal window | 0 native callbacks |
| RAF diagnostic pump | 1 callback in both modes |
| The latest Lynx VSync fix | not triggered |

The latest Lynx fix checks `runner_ && !runner_->GetLoop()`. Lynxtron's BTS loop
is a libuv `MessageLoopNode`, so `GetLoop()` is non-null. The built app logged
`[vsync-debug] Init ... loop=0x...` and `DisplayLink on current run loop`; it
never logged the fallback, and both modes still reported zero callbacks. The
latest Lynx RAF fix therefore does not cover Lynxtron's libuv BTS.

The same build includes Node patch `8ace6a7` (PR #307), yet windowed native
promise/callback still abort with the same
`Environment::GetCurrent(isolate) == env` assertion (TSFN queued, JS callback
not entered). JS sync/promise/callback controls pass. Windowless + preload on
the local build stalled before any output in repeated attempts, so that mode is
inconclusive for the local build; the npm 0.0.30 runtime windowless case
reproduced earlier.

macOS 27 build workarounds: `use_lld=false` and
`fatal_linker_warnings=false` (Chromium 140's LLD cannot parse the macOS 27 SDK
TBD stubs), add `build/config/templates/templates.gni` from Lynx buildroot,
bridge `buildtools/tools_shared/tools_shared`, and install `git-lfs`. The local
VSync instrumentation in `vsync_monitor_macos.mm` is uncommitted.
