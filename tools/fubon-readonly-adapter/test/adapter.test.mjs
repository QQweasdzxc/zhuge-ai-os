import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CredentialBoundaryError,
  loadFubonSdk,
  readServerCredentials,
} from "../src/adapter.mjs";
import {
  SanitizedOutputGuardError,
  validateSanitizedProof,
} from "../src/sanitized-output-guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const adapterRoot = join(here, "..");

test("the vendored package is the exact official fubon-neo 2.3.0 artifact", async () => {
  const manifest = JSON.parse(await readFile(join(adapterRoot, "SDK_MANIFEST.json"), "utf8"));
  const packageBytes = await readFile(join(adapterRoot, "vendor", "fubon-neo-2.3.0.tgz"));
  const digest = createHash("sha256").update(packageBytes).digest("hex");

  assert.equal(manifest.package, "fubon-neo");
  assert.equal(manifest.version, "2.3.0");
  assert.equal(digest, manifest.packageSha256);
});

test("official SDK loads without instantiating its native transport", () => {
  const loaded = loadFubonSdk();
  assert.equal(loaded.version, "2.3.0");
  assert.equal(typeof loaded.FubonSDK, "function");
});

test("credential boundary exposes only missing environment names", () => {
  assert.throws(
    () => readServerCredentials({}),
    (error) => {
      assert.ok(error instanceof CredentialBoundaryError);
      assert.deepEqual(error.missing, [
        "FUBON_API_PERSONAL_ID",
        "FUBON_API_KEY",
        "FUBON_CERT_PASSWORD",
        "FUBON_CERT_FILE_BASE64",
      ]);
      assert.equal(error.message, "CREDENTIALS_NOT_INJECTED");
      return true;
    },
  );
});

test("sanitized output guard accepts read-only proof contract", () => {
  const summary = validateSanitizedProof({
    contract: "fubon-node-readonly-proof-v1",
    result: "PASS",
    stage: "complete",
    sdk: { version: "2.3.0" },
    control_websocket: { allowed: true, connected: true },
    market_data_subscription: { active: false, count: 0 },
    trading_operation: { invoked: false },
    credentials_returned: false,
    account: { count: 3 },
    inventory: { per_account: [{ rows: 0 }] },
    quote: { symbol: "2330", available: true, price: 1, as_of: "2026-01-01T00:00:00.000Z" },
  }, {});

  assert.equal(summary.contract, "fubon-node-readonly-proof-v1");
  assert.equal(summary.account_count, 3);
  assert.equal(summary.market_data_subscription.count, 0);
  assert.equal(summary.trading_operation.invoked, false);
});

test("sanitized output guard rejects credential-shaped fields", () => {
  assert.throws(
    () => validateSanitizedProof({
      contract: "fubon-node-readonly-proof-v1",
      result: "PASS",
      apiKey: "must never be present",
    }, {}),
    (error) => error instanceof SanitizedOutputGuardError
      && error.code === "FORBIDDEN_OUTPUT_FIELD",
  );
});

test("Render spike entrypoint is sanitized and has no login path", async () => {
  const source = await readFile(join(adapterRoot, "src", "spike-server.mjs"), "utf8");

  assert.match(source, /0\.0\.0\.0/);
  assert.match(source, /process\.env\.PORT/);
  assert.match(source, /runControlSocketProof/);
  assert.match(source, /credentials_read: false/);
  assert.match(source, /market_data_subscription: \{ active: false, count: 0 \}/);
  assert.match(source, /trading_operation: \{ invoked: false \}/);
  assert.doesNotMatch(source, /runReadOnlyProof/);
  assert.doesNotMatch(source, /apikeyLogin/);
});
