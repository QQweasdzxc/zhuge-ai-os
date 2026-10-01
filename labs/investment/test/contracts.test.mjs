import test from "node:test";
import assert from "node:assert/strict";
import { makeEvidence, dataTruthLabel } from "../src/lib/contract.mjs";

test("evidence contract preserves official, delayed, source and freshness metadata", () => {
  const evidence = makeEvidence({
    status: "AVAILABLE", dataTruth: "OFFICIAL", provider: "TWSE", source: ["https://openapi.twse.com.tw/v1/example"],
    dataTimestamp: "2026-09-30", fetchedAt: "2026-10-01T01:00:00.000Z", delayed: true, stale: false, data: { close: 2480 },
  });
  assert.equal(evidence.provider, "TWSE");
  assert.equal(evidence.delayed, true);
  assert.equal(evidence.dataTimestamp, "2026-09-30");
  assert.equal(dataTruthLabel(evidence), "DELAYED");
});

test("unavailable and not-connected states never carry fabricated runtime values", () => {
  for (const status of ["UNAVAILABLE", "NOT_CONNECTED", "PROVIDER_REVIEW_REQUIRED", "NOT_APPLICABLE"]) {
    const evidence = makeEvidence({ status, dataTruth: "NOT_CONNECTED", data: null, fetchedAt: null, dataTimestamp: null });
    assert.equal(evidence.data, null);
    assert.equal(evidence.fetchedAt, null);
    assert.equal(evidence.dataTimestamp, null);
    assert.equal(dataTruthLabel(evidence), status === "UNAVAILABLE" ? "UNAVAILABLE" : "NOT_CONNECTED");
  }
});

test("test-only SIMULATED label exists in the contract but is not a valid evidence pass", () => {
  const sample = makeEvidence({ status: "PARTIAL", dataTruth: "SIMULATED", data: { testOnly: true }, note: "fixture only" });
  assert.equal(sample.dataTruth, "SIMULATED");
  assert.equal(sample.status, "PARTIAL");
  assert.match(sample.note, /fixture only/);
});
