import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../../../.github/workflows/fubon-readonly-proof.yml", import.meta.url),
  "utf8",
);

test("GitHub proof workflow is manual-only and read-only", () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /environment:\n\s+name: fubon-readonly-proof/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.doesNotMatch(workflow, /upload-artifact|actions\/artifacts/);
  assert.match(workflow, /validate-proof-output\.mjs/);

  for (const secretName of [
    "FUBON_API_PERSONAL_ID",
    "FUBON_API_KEY",
    "FUBON_CERT_PASSWORD",
    "FUBON_CERT_FILE_BASE64",
  ]) {
    assert.match(workflow, new RegExp(`secrets\\.${secretName}`));
  }
});
