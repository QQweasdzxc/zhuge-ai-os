import {
  loadFubonSdk,
  runControlSocketProof,
  runReadOnlyProof,
  sanitizedError,
  CONTRACT,
  SDK_NAME,
  SDK_VERSION,
} from "./adapter.mjs";

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (process.argv.includes("--control-only")) {
  try {
    print(await runControlSocketProof());
  } catch (error) {
    print(sanitizedError(error));
    process.exitCode = 1;
  }
} else if (process.argv.includes("--load-only")) {
  try {
    const loaded = loadFubonSdk();
    print({
      contract: CONTRACT,
      result: "PASS",
      stage: "sdk_load",
      sdk: {
        name: SDK_NAME,
        version: loaded.version ?? SDK_VERSION,
        module_specifier: loaded.moduleSpecifier,
      },
      sdk_constructor_available: typeof loaded.FubonSDK === "function",
      credentials_read: false,
      control_websocket: {
        allowed: true,
        attempted: false,
        connected: false,
      },
      market_data_subscription: {
        active: false,
        count: 0,
      },
      trading_operation: {
        invoked: false,
      },
    });
  } catch (error) {
    print(sanitizedError(error));
    process.exitCode = 1;
  }
} else {
  try {
    print(await runReadOnlyProof());
  } catch (error) {
    print(sanitizedError(error));
    process.exitCode = [
      "CREDENTIALS_NOT_INJECTED",
      "SDK_CONTROL_WEBSOCKET_UNAVAILABLE",
    ].includes(error?.code) ? 2 : 1;
  }
}
