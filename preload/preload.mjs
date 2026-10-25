// Runs in the Lynxtron preload context (BTS). The UI calls these through
// NativeModules.nodejs.exposed.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { contextBridge } = require("lynxtron");
const native = require("../dist/preload_probe.node");

console.log("[preload-probe] loaded");

contextBridge.exposeInLynxBTS({
  testCase: process.env.PRELOAD_CASE || "sync",
  ping: () => "pong",
  // Pure-JS async controls: these prove the preload bridge itself supports
  // promises and callbacks.
  jsAsyncAdd: async (a, b) => a + b,
  jsCallbackAdd: (a, b, callback) => {
    setTimeout(() => callback(a + b), 10);
  },
  // Native N-API async paths: both crash on Lynxtron 0.0.30.
  syncAdd: (a, b) => native.syncAdd(a, b),
  asyncAdd: (a, b) => native.asyncAdd(a, b),
  callbackAdd: (a, b, callback) => native.callbackAdd(a, b, callback),
});
