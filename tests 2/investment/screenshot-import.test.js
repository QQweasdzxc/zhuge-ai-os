const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Position = require("../../modules/investment/models/position.js");
const Engine = require("../../modules/investment/services/screenshot-import-engine.js");
const Provider = require("../../modules/investment/services/investment-recognition-provider.js");
const Page = require("../../modules/investment/pages/screenshot-import-page.js");
const SafeHtml = require("../../modules/investment/utils/safe-html.js");

function cloudPosition(overrides = {}) {
  return Position.normalize({
    symbol: "2330",
    name: "台積電",
    market: "TW",
    quantity: 10,
    avg_cost: 900,
    invested_cost: 9000,
    last_price: 950,
    market_value: 9500,
    unrealized_pnl: 500,
    currency: "TWD",
    ...overrides
  });
}

function recognized(overrides = {}) {
  return {
    market: "TW",
    symbol: "2330",
    name: "台積電",
    quantity: 10,
    unit: "股",
    averageCost: 900,
    investedCost: 9000,
    currentPrice: 950,
    marketValue: 9500,
    unrealizedPnl: 500,
    returnRate: 500 / 9000 * 100,
    currency: "TWD",
    confidence: .98,
    ...overrides
  };
}

test("Screenshot Import normalizes through the canonical Investment Position model", () => {
  const row = Engine.normalizeRecognitionRow(recognized());

  assert.equal(row.sourceType, "screenshot");
  assert.equal(row.position.symbol, "2330");
  assert.equal(row.position.quantity, 10);
  assert.equal(row.position.lastPrice, 950);
  assert.equal(row.isComplete, true);
  assert.equal(row.missingFields.length, 0);
  assert.equal(row.known.unit, true);
});

test("Missing recognition values remain unknown instead of guessed zeroes", () => {
  const row = Engine.normalizeRecognitionRow(recognized({ currentPrice: "", marketValue: null, confidence: null }));

  assert.equal(row.known.currentPrice, false);
  assert.equal(row.known.marketValue, false);
  assert.equal(row.position.lastPrice, 0);
  assert.equal(row.isComplete, false);
  assert.ok(row.missingFields.includes("currentPrice"));
  assert.ok(row.missingFields.includes("marketValue"));
});

test("Reconciliation returns UNCHANGED only when all required comparable content matches", () => {
  const result = Engine.reconcile([cloudPosition()], [recognized()], { scope: "full" });

  assert.equal(result.phase, "ready");
  assert.equal(result.counts.UNCHANGED, 1);
  assert.equal(result.hasGap, false);
  assert.equal(result.items[0].comparison, "MATCH");
});

test("Same identity with changed content is CHANGED and exposes field differences", () => {
  const result = Engine.reconcile([cloudPosition()], [recognized({ quantity: 11 })], { scope: "full" });

  assert.equal(result.counts.CHANGED, 1);
  assert.equal(result.items[0].comparison, "DIFFERENT");
  assert.ok(result.items[0].differences.some(difference => difference.field === "quantity"));
});

test("A screenshot-only identity is NEW, while an incomplete one is UNKNOWN", () => {
  const result = Engine.reconcile(
    [cloudPosition()],
    [
      recognized({ symbol: "0050", name: "元大台灣50" }),
      recognized({ symbol: "00929", name: "", confidence: .9 })
    ],
    { scope: "full" }
  );

  assert.equal(result.counts.NEW, 1);
  assert.equal(result.counts.UNKNOWN, 1);
  assert.equal(result.items.find(item => item.identity === "TW::0050").status, "NEW");
  assert.equal(result.items.find(item => item.identity === "TW::00929").status, "UNKNOWN");
});

test("Cloud-only positions are MISSING_FROM_SCREENSHOT only for an explicitly full inventory", () => {
  const full = Engine.reconcile([cloudPosition()], [], { scope: "full" });
  const partial = Engine.reconcile([cloudPosition()], [], { scope: "partial" });

  assert.equal(full.counts.MISSING_FROM_SCREENSHOT, 1);
  assert.match(full.items[0].reason, /不代表已賣出/);
  assert.equal(partial.counts.UNKNOWN, 1);
  assert.match(partial.items[0].reason, /不能把未出現視為已賣出或刪除/);
});

test("Duplicate identities and unavailable recognition results never produce a false match", () => {
  const duplicate = Engine.reconcile([cloudPosition()], [recognized(), recognized()], { scope: "full" });
  const duplicateCloud = Engine.reconcile([cloudPosition(), cloudPosition()], [recognized()], { scope: "full" });
  const pending = Engine.reconcile([cloudPosition()], null);

  assert.equal(duplicate.counts.UNKNOWN, 1);
  assert.equal(duplicate.counts.UNCHANGED, 1);
  assert.equal(duplicateCloud.counts.UNKNOWN, 3);
  assert.equal(pending.phase, "awaiting-recognition");
  assert.equal(pending.items.length, 0);
});

test("Import Session is transient, image-only, deduplicated, and has an explicit OCR provider gate", () => {
  const created = [];
  const revoked = [];
  const session = Engine.createSession({
    createPreviewUrl: file => {
      const url = "blob:test-" + file.name;
      created.push(url);
      return url;
    },
    revokePreviewUrl: url => revoked.push(url)
  });
  const file = { name: "holdings.png", type: "image/png", size: 1200, lastModified: 1 };
  const textFile = { name: "notes.txt", type: "text/plain", size: 20, lastModified: 1 };

  session.addFiles([file, file, textFile]);
  assert.equal(session.getSnapshot().files.length, 1);
  assert.match(session.getSnapshot().notice, /重複圖片/);
  assert.match(session.getSnapshot().notice, /支援 PNG/);
  assert.equal(created.length, 1);

  session.startRecognition();
  assert.equal(session.getSnapshot().recognition.code, "PROVIDER_NOT_CONFIGURED");
  assert.match(session.getSnapshot().recognition.message, /安全設定/);

  session.removeFile("screenshot-1");
  assert.deepEqual(revoked, ["blob:test-holdings.png"]);
  assert.equal(session.getSnapshot().files.length, 0);
});

test("Import session loads PM Confirmed structured rows without re-recognition or image persistence", () => {
  const session = Engine.createSession({ sessionId: "session-pm-confirmed-test" });
  session.openConfirmedInput();
  const snapshot = session.loadConfirmedRows([
    recognized({
      symbol: "0050",
      name: "元大台灣50",
      quantity: 709,
      averageCost: 65.45,
      investedCost: 46404,
      currentPrice: 108.45,
      marketValue: 76891,
      unrealizedPnl: 30302,
      returnRate: 65.3
    })
  ], {
    broker: "Fubon AI PRO",
    snapshotAt: "2026-09-02T08:29",
    source: "fubon_ai_pro_position_screenshot_pm_confirmed",
    idempotencyKey: "pm-confirmed-test-0050",
    provider: "gpt-5.6-luna",
    model: "gpt-5.6-luna"
  });

  assert.equal(snapshot.files.length, 0);
  assert.equal(snapshot.confirmedInputOpen, false);
  assert.equal(snapshot.recognition.status, "recognized");
  assert.equal(snapshot.recognition.sourceType, "pm_confirmed");
  assert.equal(snapshot.recognition.completeness, "full");
  assert.equal(snapshot.recognition.rows.length, 1);
  assert.equal(snapshot.recognition.rows[0].sourceType, "pm_confirmed");
  assert.equal(snapshot.recognition.rows[0].values.symbol, "0050");
  assert.equal(snapshot.recognition.rows[0].isComplete, true);
  assert.equal(snapshot.preview.status, "draft");
  assert.equal(snapshot.confirmedInputMetadata.broker, "Fubon AI PRO");
  assert.match(snapshot.notice, /尚未寫入 Cloud/);
  assert.doesNotMatch(JSON.stringify(snapshot), /data:image|sourceFile/);
});

test("Screenshot Import Runtime entry is honest and contains no Cloud write control", () => {
  const html = Page.render(
    { positions: [cloudPosition()] },
    {
      escape: SafeHtml.escape,
      importEngine: Engine,
      importSession: Engine.createSession().getSnapshot()
    }
  );

  for (const expected of [
    "data-investment-import-page",
    "data-investment-import-files",
    "data-investment-import-dropzone",
    "data-investment-import-action=\"start-recognition\"",
    "Import Session",
    "Reconciliation Preview",
    "Recognition",
    "等待可信辨識結果",
    "不會把任何 Cloud 持倉誤判為新增、刪除或已賣出"
  ]) {
    assert.ok(html.includes(expected), "missing expected markup: " + expected);
  }
  assert.doesNotMatch(html, /data-investment-import-action="confirm-write"|data-investment-import-action="import-to-cloud"/);
  assert.match(html, /受控寫入邊界/);
});

test("Screenshot Import sources do not create a second persistence or authentication path", () => {
  const files = [
    path.join(__dirname, "../../modules/investment/services/screenshot-import-engine.js"),
    path.join(__dirname, "../../modules/investment/services/investment-recognition-provider.js"),
    path.join(__dirname, "../../modules/investment/pages/screenshot-import-page.js")
  ];
  const source = files.map(file => fs.readFileSync(file, "utf8")).join("\n");

  assert.doesNotMatch(source, /localStorage|sessionStorage|createClient|signInWithOAuth|supabase\.auth/);
  assert.doesNotMatch(source, /\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
});

test("Investment runtime wires the public screenshot session factory", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../modules/investment/services/investment-module.js"), "utf8");

  assert.match(source, /InvestmentScreenshotImportEngine\.createSession\(/);
  assert.doesNotMatch(source, /InvestmentScreenshotImportEngine\.create\(/);
});

function providerResult(images, overrides = {}) {
  return {
    session_id: "investment-import-test",
    provider: "openai",
    model: Provider.MODEL,
    status: "ready",
    ...overrides,
    images
  };
}

function imageResult(imageId, positions, overrides = {}) {
  return {
    image_id: imageId,
    status: "ready",
    result: {
      screenshot_type: "holdings",
      completeness: "partial",
      positions,
      warnings: [],
      ...overrides
    }
  };
}

function imageFile(name = "holdings.png", bytes = [1, 2, 3]) {
  return {
    name,
    type: "image/png",
    size: bytes.length,
    lastModified: 1,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer
  };
}

test("Recognition result merges duplicate symbols across images into one row", () => {
  const result = Engine.normalizeRecognitionResult(providerResult([
    imageResult("image-a", [recognized()]),
    imageResult("image-b", [recognized()])
  ]));

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].duplicateCount, 2);
  assert.deepEqual(result.rows[0].sourceImages, ["image-a", "image-b"]);
  assert.equal(result.rows[0].conflicts.length, 0);
});

test("Recognition result safely applies the screenshot-level market to rows that omit it", () => {
  const result = Engine.normalizeRecognitionResult(providerResult([
    imageResult("image-market", [recognized({ market: undefined })], { market: "TW" })
  ]));

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].values.market, "TW");
  assert.equal(result.rows[0].hasIdentity, true);
});

test("Recognition result marks same-symbol content conflict instead of choosing a winner", () => {
  const result = Engine.normalizeRecognitionResult(providerResult([
    imageResult("image-a", [recognized()]),
    imageResult("image-b", [recognized({ currentPrice: 951 })])
  ]));
  const row = result.rows[0];

  assert.equal(result.rows.length, 1);
  assert.equal(row.values.currentPrice, null);
  assert.ok(row.conflicts.includes("currentPrice"));
  assert.equal(Engine.reconcile([cloudPosition()], result.rows, { scope: "partial" }).counts.UNKNOWN, 1);
});

test("Low confidence is visible and never becomes a complete write candidate", () => {
  const row = Engine.normalizeRecognitionRow(recognized({ confidence: 0.42 }));
  const comparison = Engine.reconcile([cloudPosition()], [row], { scope: "partial" });

  assert.equal(row.confidenceLevel, "LOW");
  assert.equal(row.isComplete, false);
  assert.equal(comparison.items[0].status, "UNKNOWN");
  assert.match(comparison.items[0].reason, /信心度偏低/);
});

test("Recognition provider sends image bytes only through the shared function boundary", async () => {
  const calls = [];
  const provider = Provider.create({
    invokeFunction: async (endpoint, payload, options) => {
      // Capture only the request assertion while the in-memory data URL is in
      // flight; the provider must release it before recognize() resolves.
      calls.push({
        endpoint,
        payload: {
          session_id: payload.session_id,
          images: payload.images.map(image => ({ image_id: image.image_id, data_url: image.data_url }))
        },
        options
      });
      return providerResult([imageResult("screenshot-1", [recognized()])]);
    }
  });
  const output = await provider.recognize([{ id: "screenshot-1", sourceFile: imageFile() }], { sessionId: "session-test-1" });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, Provider.DEFAULT_ENDPOINT);
  assert.equal(calls[0].payload.session_id, "session-test-1");
  assert.equal(calls[0].payload.images[0].data_url, "data:image/png;base64,AQID");
  assert.equal(typeof calls[0].options.signal?.aborted, "boolean");
  assert.equal(output.images[0].result.positions[0].data_url, undefined);
  assert.equal(output.model, "gpt-5.6-luna");
});

test("Recognition provider retries one transient backend failure and stops retrying", async () => {
  let attempts = 0;
  const provider = Provider.create({
    invokeFunction: async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("temporary"), { status: 503 });
      return providerResult([imageResult("screenshot-1", [recognized()])]);
    }
  });

  await provider.recognize([{ id: "screenshot-1", sourceFile: imageFile() }], { sessionId: "session-test-2" });
  assert.equal(attempts, 2);
});

test("Recognition provider has a bounded timeout and does not retry an intentional timeout", async () => {
  let attempts = 0;
  const provider = Provider.create({
    timeoutMs: 100,
    maxRetries: 1,
    invokeFunction: async (_endpoint, _payload, options) => new Promise((_resolve, reject) => {
      attempts += 1;
      options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    })
  });

  await assert.rejects(
    provider.recognize([{ id: "screenshot-1", sourceFile: imageFile() }], { sessionId: "session-test-3" }),
    error => error.code === "PROVIDER_TIMEOUT"
  );
  assert.equal(attempts, 1);
});

test("Recognition provider returns a bounded snake_case contract and never exposes image payloads", () => {
  const response = Provider.sanitizeResponse({
    status: "ready",
    images: [{
      image_id: "image-1",
      status: "ready",
      result: {
        screenshot_type: "holdings",
        broker_or_app: "Example Broker",
        market: "tw",
        completeness: "partial",
        positions: [{
          symbol: "2330",
          name: "台積電",
          quantity: "1,000",
          averageCost: "900",
          totalCost: 900000,
          currentPrice: 950,
          marketValue: 950000,
          unrealizedPnl: 50000,
          returnRate: "5.55%",
          currency: "twd",
          confidenceScore: 0.98,
          confidenceLevel: "high",
          sourceFields: ["代號", "市值"],
          data_url: "data:image/png;base64,should-not-return"
        }],
        warnings: []
      }
    }]
  }, "session-contract-test");
  const row = response.images[0].result.positions[0];

  assert.equal(response.session_id, "session-contract-test");
  assert.equal(response.model, Provider.MODEL);
  assert.equal(row.market_value, 950000);
  assert.equal(row.average_cost, 900);
  assert.equal(row.return_rate, 5.55);
  assert.equal(row.confidence_level, "HIGH");
  assert.equal(row.data_url, undefined);
  assert.deepEqual(Object.keys(row).sort(), [
    "average_cost",
    "confidence",
    "confidence_level",
    "currency",
    "current_price",
    "market_value",
    "name",
    "quantity",
    "return_rate",
    "source_fields",
    "symbol",
    "total_cost",
    "unit",
    "unrealized_pnl"
  ]);
});

test("Recognition provider failures are safe and never surface raw provider details", async () => {
  const session = Engine.createSession({ sessionId: "session-error-test" });
  session.addFiles([imageFile()]);
  await session.startRecognition(async () => {
    throw Object.assign(new Error("OPENAI_API_KEY=secret-provider-detail"), {
      code: "RECOGNITION_FAILED",
      status: 502
    });
  });

  const snapshot = session.getSnapshot();
  assert.equal(snapshot.recognition.status, "error");
  assert.equal(snapshot.recognition.code, "RECOGNITION_FAILED");
  assert.match(snapshot.recognition.message, /目前無法完成/);
  assert.doesNotMatch(JSON.stringify(snapshot), /secret-provider-detail|OPENAI_API_KEY/);
});

test("Recognition Edge Function keeps AAL2, structured output, and no-persistence boundaries", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../supabase/functions/investment-screenshot-recognition/index.ts"), "utf8");

  assert.match(source, /requireAal2\(request\)/);
  assert.match(source, /AAL2_REQUIRED/);
  assert.match(source, /claims\.aal.*aal2/);
  assert.match(source, /store:\s*false/);
  assert.match(source, /type:\s*"input_image"/);
  assert.match(source, /type:\s*"json_schema"/);
  assert.match(source, /untrusted data/);
  assert.match(source, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
  assert.doesNotMatch(source, /createClient\s*\(|SUPABASE_SERVICE_ROLE_KEY|supabase\.from\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|storage\.from\s*\(/i);
});

test("Import session supports recognition, edit, ignore, restore, and Preview Confirmed without Cloud writes", async () => {
  const session = Engine.createSession({ sessionId: "session-edit-test" });
  session.addFiles([imageFile()]);
  await session.startRecognition(async (_files, metadata) => providerResult([
    imageResult("screenshot-1", [recognized()], { completeness: "partial" })
  ], { session_id: metadata.sessionId }));

  let snapshot = session.getSnapshot();
  const rowId = snapshot.recognition.rows[0].id;
  assert.equal(snapshot.recognition.status, "recognized");
  assert.equal(snapshot.recognition.rows.length, 1);
  session.updateRecognitionRow(rowId, { quantity: "11", averageCost: "901" });
  snapshot = session.getSnapshot();
  assert.equal(snapshot.recognition.rows[0].values.quantity, 11);
  assert.ok(snapshot.recognition.rows[0].editedFields.includes("quantity"));
  session.ignoreRecognitionRow(rowId);
  assert.equal(session.getSnapshot().recognition.rows[0].ignored, true);
  session.restoreRecognitionResult();
  assert.equal(session.getSnapshot().recognition.rows[0].ignored, false);
  session.confirmPreview();
  assert.equal(session.getSnapshot().preview.status, "confirmed");
  assert.match(session.getSnapshot().notice, /不會寫入 Investment Cloud/);
  assert.equal("sourceFile" in session.getSnapshot(), false);
  assert.doesNotMatch(JSON.stringify(session.getSnapshot()), /data:image/);
});

test("Import session enforces image type, count, and size limits in browser memory", () => {
  const session = Engine.createSession({ sessionId: "session-limit-test" });
  const files = Array.from({ length: Engine.IMPORT_LIMITS.maxFiles + 1 }, (_, index) => ({
    ...imageFile(`holdings-${index}.png`),
    size: index === 0 ? Engine.IMPORT_LIMITS.maxBytesPerFile + 1 : 10
  }));
  session.addFiles(files);
  const snapshot = session.getSnapshot();

  assert.equal(snapshot.files.length, Engine.IMPORT_LIMITS.maxFiles);
  assert.match(snapshot.notice, /8 MB|5 張/);
});

test("Runtime preview exposes Cloud values, screenshot values, edit controls, and no write action before confirmation", async () => {
  const session = Engine.createSession({ sessionId: "session-page-test" });
  session.addFiles([imageFile()]);
  await session.startRecognition(async () => providerResult([imageResult("screenshot-1", [recognized()])], { completeness: "partial" }));
  const snapshot = session.getSnapshot();
  const html = Page.render(
    { positions: [cloudPosition()] },
    {
      escape: SafeHtml.escape,
      importEngine: Engine,
      importSession: snapshot,
      reconciliation: Engine.reconcile([cloudPosition()], snapshot.recognition.rows, { scope: "partial" })
    }
  );

  assert.match(html, /目前 Cloud/);
  assert.match(html, /本次確認輸入/);
  assert.match(html, /name="quantity"/);
  assert.match(html, /data-investment-import-action="ignore-row"/);
  assert.match(html, /data-investment-import-action="confirm-preview"/);
  assert.match(html, /Controlled Write/);
  assert.doesNotMatch(html, /confirm-write|import-to-cloud|data-investment-import-action="write/);
});

test("PM Confirmed input renders a generic local loader and only exposes write after Preview Confirmed", () => {
  const session = Engine.createSession({ sessionId: "session-pm-confirmed-page-test" });
  session.openConfirmedInput();
  let snapshot = session.getSnapshot();
  let html = Page.render(
    { positions: [cloudPosition()] },
    {
      escape: SafeHtml.escape,
      importEngine: Engine,
      importSession: snapshot,
      reconciliation: Engine.reconcile([cloudPosition()], null, { scope: "unknown" })
    }
  );

  assert.match(html, /data-investment-confirmed-input-form/);
  assert.match(html, /PM Confirmed Snapshot JSON/);
  assert.match(html, /載入並產生 Reconciliation/);
  assert.doesNotMatch(html, /data-investment-snapshot-write-form/);

  snapshot = session.loadConfirmedRows([recognized()], {
    broker: "Fubon AI PRO",
    snapshotAt: "2026-09-02T08:29",
    source: "fubon_ai_pro_position_screenshot_pm_confirmed",
    idempotencyKey: "pm-confirmed-page-test"
  });
  session.confirmPreview();
  snapshot = session.getSnapshot();
  const comparison = Engine.reconcile([cloudPosition()], snapshot.recognition.rows, { scope: "full" });
  html = Page.render(
    { positions: [cloudPosition()] },
    {
      escape: SafeHtml.escape,
      importEngine: Engine,
      importSession: snapshot,
      reconciliation: comparison,
      snapshotWrite: { status: "idle", form: {} },
      onSnapshotWrite: () => {}
    }
  );

  assert.match(html, /data-investment-snapshot-write-form/);
  assert.match(html, /value="Fubon AI PRO"/);
  assert.match(html, /pm-confirmed-page-test/);
  assert.match(html, /確認並寫入 1 筆 Snapshot/);
});

test("Preview Confirmed exposes only the controlled Snapshot Write contract for a complete result", async () => {
  const session = Engine.createSession({ sessionId: "session-write-page-test" });
  session.addFiles([imageFile()]);
  await session.startRecognition(async () => providerResult([imageResult("screenshot-1", [recognized()], { completeness: "full", broker_or_app: "Fubon AI PRO" })], { completeness: "full" }));
  session.confirmPreview();
  const snapshot = session.getSnapshot();
  const comparison = Engine.reconcile([cloudPosition()], snapshot.recognition.rows, { scope: "full" });
  const html = Page.render(
    { positions: [cloudPosition()] },
    {
      escape: SafeHtml.escape,
      importEngine: Engine,
      importSession: snapshot,
      reconciliation: comparison,
      snapshotWrite: { status: "idle", form: {} },
      onSnapshotWrite: () => {}
    }
  );

  assert.equal(Page.snapshotWriteEligibility(snapshot, comparison).ok, true);
  assert.match(html, /data-investment-snapshot-write-form/);
  assert.match(html, /name="snapshotAt"/);
  assert.match(html, /確認並寫入 1 筆 Snapshot/);
  assert.match(html, /受控安全驗證/);
  assert.doesNotMatch(html, /data-investment-import-action="import-to-cloud"|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/);
});

test("Snapshot write Step-up keeps the confirmed form and exposes an in-place verification action", () => {
  const session = Engine.createSession({ sessionId: "session-step-up-page-test" });
  session.loadConfirmedRows([recognized()], {
    broker: "Fubon AI PRO",
    snapshotAt: "2026-09-02T08:29",
    source: "fubon_ai_pro_position_screenshot_pm_confirmed",
    idempotencyKey: "pm-confirmed-step-up-test"
  });
  session.confirmPreview();
  const snapshot = session.getSnapshot();
  const comparison = Engine.reconcile([cloudPosition()], snapshot.recognition.rows, { scope: "full" });
  const html = Page.render(
    { positions: [cloudPosition()] },
    {
      escape: SafeHtml.escape,
      importEngine: Engine,
      importSession: snapshot,
      reconciliation: comparison,
      snapshotWrite: {
        status: "step-up-required",
        form: {
          broker: "Fubon AI PRO",
          snapshotAt: "2026-09-02T08:29",
          source: "fubon_ai_pro_position_screenshot_pm_confirmed",
          idempotencyKey: "pm-confirmed-step-up-test"
        },
        stepUp: { status: "ready", mode: "challenge", factorId: "factor-1" }
      },
      onSnapshotWrite: () => {}
    }
  );

  assert.match(html, /需要安全驗證/);
  assert.match(html, /data-investment-sensitive-write-step-up/);
  assert.match(html, /驗證並繼續/);
  assert.match(html, /value="2026-09-02T08:29"/);
  assert.match(html, /pm-confirmed-step-up-test/);
});

test("Snapshot Write eligibility blocks partial or incomplete recognition before the RPC", () => {
  const session = Engine.createSession({ sessionId: "session-write-blocked-test" });
  session.addFiles([imageFile()]);
  const snapshot = session.getSnapshot();
  const comparison = Engine.reconcile([cloudPosition()], null, { scope: "unknown" });
  const eligibility = Page.snapshotWriteEligibility(snapshot, comparison);

  assert.equal(eligibility.ok, false);
  assert.match(eligibility.reason, /確認完整/);
});

test("Screenshot import session discards stale recognition after the user clears it", async () => {
  const session = Engine.createSession({ sessionId: "session-stale-test" });
  session.addFiles([imageFile()]);
  const pending = session.startRecognition(() => new Promise(resolve => setTimeout(() => resolve(providerResult([imageResult("screenshot-1", [recognized()])])), 40)));
  session.clear();
  await pending;

  const snapshot = session.getSnapshot();
  assert.equal(snapshot.files.length, 0);
  assert.equal(snapshot.recognition.status, "idle");
  assert.equal(snapshot.recognition.rows.length, 0);
});
