import { loadFubonSdk, runReadOnlyProof, sanitizedError, CONTRACT, SDK_NAME, SDK_VERSION } from "./adapter.mjs";

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (process.argv.includes("--load-only")) {
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
      stream_subscriptions: 0,
      websocket_connected: false,
      mutating_operations_invoked: false,
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
      "SDK_INSTANTIATE_REQUIRES_WEBSOCKET",
    ].includes(error?.code) ? 2 : 1;
  }
}
