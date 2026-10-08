import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const matrixUrl = new URL("../docs/GENSPARK_CAPABILITY_MATRIX.md", import.meta.url);
const allowedImplementationStatuses = new Set(["READY", "NOT_READY"]);
const allowedAcceptanceGates = new Set(["NONE", "FINAL_AUTHENTICATED_PRODUCTION_ACCEPTANCE", "SECRET_OR_PAID_PROVIDER"]);

test("Genspark capability matrix separates implementation, provider, local, and Production states", async () => {
  const matrix = await readFile(matrixUrl, "utf8");
  assert.match(matrix, /7f9cfc5de61227faacd27d3baafa82bb41cba6ab/);
  assert.doesNotMatch(matrix, /35182db578b0b8c693d34f52f3988534d4c52f83/);
  const rows = matrix.split("\n").filter(line => line.startsWith("|") && !line.includes("---"));
  assert.equal(rows.length - 1, 32, "the inventory must cover all 32 capability groups");
  const counts = { READY: 0, NOT_READY: 0 };
  for (const [index, row] of rows.slice(1).entries()) {
    const cells = row.split("|").slice(1, -1).map(value => value.trim());
    assert.equal(cells.length, 12, `matrix row ${index + 1} has all 12 columns`);
    assert.ok(allowedImplementationStatuses.has(cells[7]), `matrix row ${index + 1} implementation status is governed`);
    assert.ok(cells[8], `matrix row ${index + 1} has a data provider state`);
    assert.ok(cells[9], `matrix row ${index + 1} has a local runtime state`);
    assert.match(cells[10], /^PENDING/);
    assert.ok(allowedAcceptanceGates.has(cells[11]), `matrix row ${index + 1} acceptance gate is governed`);
    counts[cells[7]] += 1;
  }
  assert.deepEqual(counts, { READY: 32, NOT_READY: 0 });
  const secretProviders = rows.slice(1).filter(row => /(?:token|Secret) required|requires Sponsor token/i.test(row.split("|").slice(1, -1)[8]));
  assert.equal(secretProviders.length, 3, "only broker history, AI invocation and notification delivery retain secret gates");
  assert.doesNotMatch(matrix, /\|\s*(?:HUMAN_GATE|EXTERNAL_PROVIDER_BLOCKED|IMPLEMENTATION_NOT_READY|EXTERNAL_SECRET_REQUIRED)\s*\|/);
  assert.match(matrix, /IMPLEMENTATION READY`:\s*`32`/);
  assert.match(matrix, /IMPLEMENTATION NOT READY`:\s*`0`/);
  assert.equal((matrix.match(/SECRET_OR_PAID_PROVIDER/g) || []).length, 3);
  for (const capability of [
    "Stock symbol/name search", "Technical analysis", "Broker/branch flows",
    "Scanner / scoring / ranking", "Sector heatmap", "Opening-pressure dashboard",
    "Watchlist news notifications", "Current holdings and P/L", "Closed-position history",
    "Original author admin / Worker / notification identity",
  ]) assert.ok(matrix.includes(capability), `matrix covers ${capability}`);
  assert.match(matrix, /Alpaca is optional/);
  assert.match(matrix, /AAPL\/NVDA quote uses Zhuge-owned bounded Yahoo-compatible read Edge/);
  assert.match(matrix, /SOX, TSM ADR, Korea index/);
});
