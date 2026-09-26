const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const reader = require("../shared/attachments/attachment-context.js");

function attachment(overrides = {}) {
  return {
    id: "att-086-1",
    filename: "handoff.txt",
    mimeType: "text/plain",
    byteSize: 14,
    createdAt: "2026-09-25T15:00:00.000Z",
    signedUrl: "https://signed.example.invalid/secret-url",
    ...overrides
  };
}

function response(body, { ok = true, status = 200, mimeType = "text/plain" } = {}) {
  return {
    ok,
    status,
    headers: { get: name => name === "content-length" ? String(Buffer.byteLength(body)) : (name === "content-type" ? mimeType : "") },
    blob: async () => new Blob([body], { type: mimeType })
  };
}

test("TASK-086 text attachment read returns bounded evidence and no signed URL", async () => {
  let requestedUrl = "";
  const result = await reader.read(attachment(), {
    load: async url => {
      requestedUrl = url;
      return response("這是可以交給 AI 閱讀的正式附件內容。\n第二行。");
    }
  });
  assert.equal(result.contract, "zhuge-shared-attachment-context-v1");
  assert.equal(result.status, "ready");
  assert.equal(result.modality, "text");
  assert.match(result.content, /正式附件內容/);
  assert.equal(result.source.provider, "supabase-storage");
  assert.equal(result.mutation, "none");
  assert.equal(requestedUrl, "https://signed.example.invalid/secret-url");
  assert.equal(Object.prototype.hasOwnProperty.call(result, "signedUrl"), false);
  assert.equal(JSON.stringify(result).includes("secret-url"), false);
});

test("TASK-086 image attachment produces in-memory multimodal evidence", async () => {
  const result = await reader.read(attachment({ filename: "chart.png", mimeType: "image/png", byteSize: 12 }), {
    load: async () => response("image-bytes", { mimeType: "image/png" })
  });
  assert.equal(result.status, "ready");
  assert.equal(result.modality, "image");
  assert.equal(result.readMode, "multimodal-reference");
  assert.equal(result.media.mimeType, "image/png");
  assert.equal(result.evidenceStatus, "AVAILABLE");
});

test("TASK-086 produces a bounded AI input envelope and never invents failed evidence", async () => {
  const textResult = await reader.read(attachment(), { load: async () => response("可供模型閱讀的內容") });
  const textInput = reader.toAIInput(textResult);
  assert.equal(textInput.contract, "zhuge-attachment-ai-input-v1");
  assert.equal(textInput.status, "ready");
  assert.equal(textInput.parts[0].type, "input_text");
  assert.match(textInput.parts[0].text, /模型閱讀/);
  assert.equal(JSON.stringify(textInput).includes("signed.example"), false);

  const imageResult = await reader.read(attachment({ filename: "chart.png", mimeType: "image/png" }), {
    load: async () => response("image-bytes", { mimeType: "image/png" })
  });
  const imageInput = reader.toAIInput(imageResult);
  assert.equal(imageInput.parts[0].type, "input_image");
  assert.equal(imageInput.parts[0].mimeType, "image/png");

  const failedInput = reader.toAIInput({ status: "unavailable", evidenceStatus: "UNAVAILABLE" });
  assert.equal(failedInput.status, "unavailable");
  assert.deepEqual([...failedInput.parts], []);
});

test("TASK-086 document attachment reuses the existing KnowledgeEngine parser", async () => {
  const previous = globalThis.KnowledgeEngine;
  globalThis.KnowledgeEngine = {
    supports: input => input.mimeType === "application/pdf",
    ingest: async (_document, payload) => {
      assert.equal(payload.name, "brief.pdf");
      assert.equal(typeof payload.data.arrayBuffer, "function");
      return { parser: "existing-knowledge-parser", content: "PDF extracted evidence", metadata: { supportLevel: "pdfjs-text-layer" } };
    }
  };
  try {
    const result = await reader.read(attachment({ filename: "brief.pdf", mimeType: "application/pdf" }), {
      load: async () => response("pdf-bytes", { mimeType: "application/pdf" })
    });
    assert.equal(result.status, "ready");
    assert.equal(result.parser, "existing-knowledge-parser");
    assert.equal(result.content, "PDF extracted evidence");
    assert.equal(result.quality, "pdfjs-text-layer");
  } finally {
    if (previous === undefined) delete globalThis.KnowledgeEngine;
    else globalThis.KnowledgeEngine = previous;
  }
});

test("TASK-086 fails closed for empty, unavailable, unsupported, and missing signed sources", async () => {
  const empty = await reader.read(attachment(), { load: async () => response("   ") });
  assert.equal(empty.status, "insufficient_evidence");
  const unavailable = await reader.read(attachment(), { load: async () => response("", { ok: false, status: 403 }) });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.evidenceStatus, "UNAVAILABLE");
  const unsupported = await reader.read(attachment({ filename: "archive.zip", mimeType: "application/zip" }), { load: async () => response("zip") });
  assert.equal(unsupported.status, "unsupported");
  const missing = await reader.read(attachment({ signedUrl: "" }));
  assert.equal(missing.status, "unavailable");
  assert.equal(missing.reason, "ATTACHMENT_SIGNED_URL_MISSING");
});

test("TASK-086 fails closed when the attachment body or parser is unavailable", async () => {
  const unreadable = await reader.read(attachment(), {
    load: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "" },
      blob: async () => { throw Object.assign(new Error("body unavailable"), { code: "ATTACHMENT_BODY_UNREADABLE" }); }
    })
  });
  assert.equal(unreadable.status, "unavailable");
  assert.equal(unreadable.reason, "ATTACHMENT_BODY_UNREADABLE");

  const previous = globalThis.KnowledgeEngine;
  globalThis.KnowledgeEngine = {
    supports: () => true,
    ingest: async () => { throw Object.assign(new Error("parser unavailable"), { code: "ATTACHMENT_PARSE_FAILED" }); }
  };
  try {
    const parsed = await reader.read(attachment({ filename: "brief.pdf", mimeType: "application/pdf" }), {
      load: async () => response("pdf-bytes", { mimeType: "application/pdf" })
    });
    assert.equal(parsed.status, "error");
    assert.equal(parsed.reason, "ATTACHMENT_PARSE_FAILED");
    assert.equal(parsed.evidenceStatus, "ERROR");
  } finally {
    if (previous === undefined) delete globalThis.KnowledgeEngine;
    else globalThis.KnowledgeEngine = previous;
  }
});

test("TASK-086 converts a bounded fetch timeout into unavailable evidence", async () => {
  const result = await reader.read(attachment(), {
    timeoutMs: 1000,
    load: async (_url, options = {}) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { code: "ATTACHMENT_CONTEXT_TIMEOUT" })), { once: true });
    })
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "ATTACHMENT_CONTEXT_TIMEOUT");
  assert.match(result.nextStep, /逾時/);
});

test("TASK-086 Shared Drawer exposes the read-only context action and result surface", () => {
  const root = path.resolve(__dirname, "..");
  const runtime = fs.readFileSync(path.join(root, "shared/components/golden-master-runtime.js"), "utf8");
  const adapter = fs.readFileSync(path.join(root, "modules/worklog/components/worktodo-task-adapter.js"), "utf8");
  const page = fs.readFileSync(path.join(root, "app/Board/worktodo/index.html"), "utf8");
  assert.ok(runtime.includes('data-attachment-menu-action="context"'));
  assert.ok(runtime.includes("data-shared-attachment-context-result"));
  assert.match(runtime, /emitAIContext/);
  assert.ok(adapter.includes("data-worktodo-attachment-context"));
  assert.ok(adapter.includes("onReadContext"));
  assert.match(page, /attachment-context\.js/);
  assert.ok(page.includes("shared/attachments/attachment-context.js"));
  assert.ok(page.includes("knowledge-engine.js"));
});
