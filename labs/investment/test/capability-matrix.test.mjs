import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const matrixUrl = new URL("../docs/GENSPARK_CAPABILITY_MATRIX.md", import.meta.url);
const allowedRuntimeStatuses = new Set(["PASS", "HUMAN_GATE", "EXTERNAL_PROVIDER_BLOCKED"]);

test("Genspark capability matrix is pinned to the requested upstream and uses only governed runtime statuses", async () => {
  const matrix = await readFile(matrixUrl, "utf8");
  assert.match(matrix, /7f9cfc5de61227faacd27d3baafa82bb41cba6ab/);
  assert.doesNotMatch(matrix, /35182db578b0b8c693d34f52f3988534d4c52f83/);
  const rows = matrix.split("\n").filter(line => line.startsWith("|") && !line.includes("---"));
  assert.ok(rows.length > 25, "the inventory must cover the full upstream feature surface");
  for (const [index, row] of rows.slice(1).entries()) {
    const cells = row.split("|").slice(1, -1).map(value => value.trim());
    assert.equal(cells.length, 8, `matrix row ${index + 1} has all 8 columns`);
    assert.ok(allowedRuntimeStatuses.has(cells[7]), `matrix row ${index + 1} runtime status is governed`);
  }
  for (const capability of [
    "Stock symbol/name search", "Technical analysis", "Broker/branch flows",
    "Scanner / scoring / ranking", "Sector heatmap", "Opening-pressure dashboard",
    "Watchlist news notifications", "Current holdings and P/L", "Closed-position history",
    "Original author admin / Worker / notification identity",
  ]) assert.ok(matrix.includes(capability), `matrix covers ${capability}`);
});
