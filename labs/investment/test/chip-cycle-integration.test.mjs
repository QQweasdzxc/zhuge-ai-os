import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("research and Taiwan chip views integrate provider OHLCV plus canonical institution evidence into the same observation", async () => {
  const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /import \{ renderChipCycleObservation \}/);
  assert.match(app, /import \{ buildChipCycleObservation \}/);
  assert.match(app, /buildChipCycleObservation\(\{[\s\S]{0,300}institutionalSummary: taiwanEvidence\.institutional\?\.data\?\.historySummary,[\s\S]{0,300}tdccHistory: \{ observations: tdccObservations \},[\s\S]{0,300}historySource: history\.source/);
  assert.match(app, /labMarketProvider\.getTaiwanEvidence\(request\)[\s\S]{0,180}labMarketProvider\.getHistory\(request\)/);
  assert.match(app, /renderChipCycleObservation\(chipCycle\)/);
  assert.match(app, /renderTdccHistoricalSeries\(tdccSeries, \{ localObservations: tdccObservations \}\)/);
  assert.match(app, /renderChipCycleObservation\(chipCycle\)/);
  assert.match(app, /tdccHistory: \{ observations: tdccObservations \}/);
  assert.doesNotMatch(app, /WyckoffMock|fakeInstitutional|seededChipPhase/i);
});
