const test = require("node:test");
const assert = require("node:assert/strict");
const reader = require("../shared/ai/attachment-reader.js");

function contextResult(overrides = {}) {
  return {
    attachmentId: "att-1",
    filename: "brief.txt",
    mimeType: "text/plain",
    status: "ready",
    evidenceStatus: "AVAILABLE",
    source: { provider: "supabase-storage", asOf: "2026-09-26T00:00:00Z", freshness: "point-in-time", dataQuality: "parsed", parser: "plain-text" },
    content: "bounded source text",
    ...overrides
  };
}

function contextModule(result) {
  return {
    read: async () => result,
    toAIInput: value => ({
      contract: "zhuge-attachment-ai-input-v1",
      status: value.status === "ready" ? "ready" : value.status,
      attachmentId: value.attachmentId,
      filename: value.filename,
      mimeType: value.mimeType,
      evidence: { source: value.source },
      parts: value.status === "ready" ? [{ type: "input_text", text: value.content || "" }] : []
    })
  };
}

test("TASK-086 protected AI reader passes bounded attachment context to injected executor", async () => {
  let received;
  const result = await reader.readAttachment(contextResult(), {
    attachmentContext: contextModule(contextResult()),
    executor: async input => {
      received = input;
      return { provider: "protected-test-reader", model: "test-model", output: { summary: "已讀取" } };
    }
  });
  assert.equal(result.status, "ready");
  assert.equal(result.mutation, "none");
  assert.equal(result.provider, "protected-test-reader");
  assert.equal(received.contract, "zhuge-attachment-ai-input-v1");
  assert.equal(received.evidence.source.provider, "supabase-storage");
  assert.equal("signedUrl" in received, false);
});

test("TASK-086 does not call an AI executor for failed or unsupported attachment evidence", async () => {
  let calls = 0;
  const result = await reader.readAttachment(contextResult({ status: "unsupported", evidenceStatus: "INSUFFICIENT_EVIDENCE", reason: "ATTACHMENT_FORMAT_UNSUPPORTED" }), {
    attachmentContext: contextModule(contextResult({ status: "unsupported", evidenceStatus: "INSUFFICIENT_EVIDENCE", reason: "ATTACHMENT_FORMAT_UNSUPPORTED" })),
    executor: async () => { calls += 1; return { output: "should not run" }; }
  });
  assert.equal(result.status, "unsupported");
  assert.equal(calls, 0);
  assert.equal(result.evidenceStatus, "INSUFFICIENT_EVIDENCE");
});

test("TASK-086 returns explicit unavailable when no protected AI executor is configured", async () => {
  const result = await reader.readAttachment(contextResult(), { attachmentContext: contextModule(contextResult()) });
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "AI_READER_EXECUTOR_UNAVAILABLE");
  assert.equal(result.mutation, "none");
});

test("TASK-086 bounds AI output and converts executor failure to sanitized unavailable evidence", async () => {
  const long = "x".repeat(20_000);
  const bounded = await reader.readAttachment(contextResult(), {
    attachmentContext: contextModule(contextResult()),
    executor: async () => ({ output: long })
  });
  assert.equal(bounded.status, "ready");
  assert.equal(bounded.output.length, reader.MAX_OUTPUT_CHARS);

  const failed = await reader.readAttachment(contextResult(), {
    attachmentContext: contextModule(contextResult()),
    executor: async () => { throw Object.assign(new Error("provider down"), { code: "AI_PROVIDER_UNAVAILABLE" }); }
  });
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.reason, "AI_PROVIDER_UNAVAILABLE");
  assert.equal(failed.mutation, "none");
});

test("TASK-086 function executor serializes text and in-memory image without Storage identity", async () => {
  let call;
  const executor = reader.createFunctionExecutor({
    invokeFunction: async (name, payload, options) => {
      call = { name, payload, options };
      return { provider: "protected-ai-reader", output: { summary: "可驗證摘要" } };
    }
  });
  const image = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
  const result = await reader.analyzeInput({
    contract: reader.INPUT_CONTRACT,
    status: "ready",
    attachmentId: "att-image",
    filename: "chart.png",
    mimeType: "image/png",
    evidence: { source: { provider: "supabase-storage", asOf: "2026-09-26T00:00:00Z" } },
    parts: [{ type: "input_image", mimeType: "image/png", blob: image }]
  }, { executor, timeoutMs: 1_000 });
  assert.equal(result.status, "ready");
  assert.equal(call.name, reader.FUNCTION_NAME);
  assert.equal(call.payload.contract, reader.INPUT_CONTRACT);
  assert.equal(call.payload.parts[0].type, "input_image");
  assert.match(call.payload.parts[0].data_url, /^data:image\/png;base64,/);
  assert.equal("signedUrl" in call.payload, false);
  assert.equal("storagePath" in call.payload, false);
});
