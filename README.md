# Lynxtron native RAF minimal reproduction

macOS-only reproduction for Lynxtron **0.0.28**. Requires macOS 14+, an awake
attached display, Node.js 22.18+ and Xcode Command Line Tools. It contains no Rust,
terminal, custom native view, GPU renderer, JS RAF loop or preload bridge.

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

## Observed result

Verified on 2026-10-04: macOS 27.0.1 (26A434), arm64, Node.js 24.15.0,
Lynxtron 0.0.28. The display was awake at the start and end of every run, and
`attachedOnBts` was true. `pnpm build` and `pnpm repro` completed successfully.

| Window mode | Native requests | Native callbacks | Callbacks with diagnostic pump |
| --- | ---: | ---: | ---: |
| Windowless | 1 | 0 | 1 |
| Normal window | 1 | 0 | 1 |

The normal regression test (`pnpm test`) expects one callback, so the zero-callback
baseline above violates its assertion. A later separate `pnpm test` invocation
was rejected as an invalid experiment because the display had gone to sleep;
that invocation is not counted as proof of the bug. No screenshots or GPU
rendering are involved.
