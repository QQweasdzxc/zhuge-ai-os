import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const reference = "server-protected-detail-store-reference.mjs";
const browserEntries = [
  "../labs/taskflow/pages-client/app.mjs",
  "../labs/taskflow/pages-client/index.html",
  "../labs/taskflow/tests/native-dispatch-browser/index.html",
  "../labs/taskflow/tests/native-dispatch-browser/vite.config.mts"
];

test("protected detail store reference remains Node-only and outside browser entrypoints", async () => {
  const source = await readFile(new URL(`../labs/taskflow/pages-client/${reference}`, import.meta.url), "utf8");
  assert.match(source, /node:crypto/);
  for (const entry of browserEntries) {
    const contents = await readFile(new URL(entry, import.meta.url), "utf8");
    assert.equal(contents.includes(reference), false, `${entry} must not load the Node-only reference`);
  }
});
