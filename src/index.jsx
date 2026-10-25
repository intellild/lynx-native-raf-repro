import { root, useEffect } from "@lynx-js/react";

function report(testCase, stage, data = {}) {
  const payload = { testCase, stage, ...data };
  console.log("PRELOAD_PROBE " + JSON.stringify(payload));
  try {
    if (typeof NativeModules !== "undefined" && NativeModules.bridge) {
      NativeModules.bridge.call("preload-probe", payload, () => {});
    }
  } catch (error) {
    console.log("PRELOAD_PROBE_BRIDGE_ERROR " + String(error));
  }
}

function App() {
  useEffect(() => {
    if (typeof NativeModules === "undefined") return;
    const api = NativeModules.nodejs?.exposed;
    if (!api) return;
    const testCase = api.testCase || "sync";
    report(testCase, "loaded", { keys: Object.keys(api) });
    try {
      if (testCase === "sync") {
        report(testCase, "sync", { value: api.syncAdd(2, 3) });
      } else if (testCase === "js-promise") {
        report(testCase, `${testCase}-requested`);
        api.jsAsyncAdd(2, 3).then(
          (value) => report(testCase, testCase, { value }),
          (error) => report(testCase, `${testCase}-error`, { error: String(error) }),
        );
      } else if (testCase === "js-callback") {
        report(testCase, `${testCase}-requested`);
        api.jsCallbackAdd(2, 3, (value) => report(testCase, testCase, { value }));
      } else if (testCase === "native-promise") {
        report(testCase, `${testCase}-requested`);
        api.asyncAdd(2, 3).then(
          (value) => report(testCase, testCase, { value }),
          (error) => report(testCase, `${testCase}-error`, { error: String(error) }),
        );
      } else if (testCase === "native-callback") {
        report(testCase, `${testCase}-requested`);
        api.callbackAdd(2, 3, (value) => report(testCase, testCase, { value }));
      } else {
        report(testCase, "unknown");
      }
    } catch (error) {
      report(testCase, "throw", { error: String(error) });
    }
  }, []);

  return (
    <view>
      <text>Native RAF one-shot reproduction</text>
      <text>
        The result is printed to the host process log after five seconds.
      </text>
    </view>
  );
}

root.render(<App />);
