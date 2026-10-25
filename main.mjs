import { app, LynxWindow, lynxBridge } from "@lynx-js/lynxtron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// Load and register the extension before constructing a LynxWindow.
const probe = require("./dist/probe.node");
const initial = JSON.parse(probe.getStats());
const windowless = process.env.RAF_WINDOWLESS === "1";
const pump = process.env.RAF_PUMP_NS_RUN_LOOP === "1";
const preloadTest = process.env.PRELOAD_TEST === "1";
const preloadCase = process.env.PRELOAD_CASE || "sync";
let window;

lynxBridge.handle("preload-probe", (_event, payload) => {
  console.log("PRELOAD_PROBE " + JSON.stringify(payload));
  return { ok: true };
});

app.whenReady().then(() => {
  console.log(
    "PRELOAD_MAIN " +
      JSON.stringify({ enabled: preloadTest, testCase: preloadCase, windowless }),
  );
  window = new LynxWindow({
    width: 480,
    height: 240,
    windowless,
    title: "Native RAF reproduction",
    ...(preloadTest
      ? {
          lynxPreference: {
            preload: fileURLToPath(
              new URL("./preload/preload.mjs", import.meta.url),
            ),
          },
        }
      : {}),
  });
  window.loadFile(
    fileURLToPath(new URL("./dist/main.lynx.bundle", import.meta.url)),
  );
  window.show();
  // Observation timeout only: it does not request frames or render anything.
  setTimeout(() => {
    console.log(
      "RAF_RESULT " +
        JSON.stringify({
          windowless,
          pump,
          displayAsleepAtStart: initial.displayAsleep,
          ...JSON.parse(probe.getStats()),
        }),
    );
    app.quit();
  }, 5000);
});
app.on("window-all-closed", () => app.quit());
