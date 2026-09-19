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
