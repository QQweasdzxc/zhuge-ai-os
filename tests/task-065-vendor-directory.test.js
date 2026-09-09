import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function loadVendorService(invokeFunction) {
  const window = {
    currentGoogleProviderToken: () => "test-google-token",
    ZhugeSupabaseGateway: {
      createDataGateway: () => ({ invokeFunction })
    }
  };
  vm.runInNewContext(read("app/Board/procurement/vendor-sheet-service.js"), {
    window,
    AbortController,
    setTimeout,
    clearTimeout
  });
  return window.VendorSheetService.VendorSheetService;
}

test("vendor bridge list keeps the Google Sheet business category", async () => {
  const VendorSheetService = loadVendorService(async (_name, body) => {
    assert.equal(body.action, "read");
    return {
      vendorCount: 1,
      rows: [{ rowNumber: 2, vendorName: "人工智能", vendorId: "GAS-V0001", purchaseNo: "PO-1", businessCategory: "採購" }]
    };
  });
  const rows = await new VendorSheetService().list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].vendorId, "GAS-V0001");
  assert.equal(rows[0].businessCategory, "採購");
});

test("vendor create sends only Sheet-owned fields and accepts a server-assigned ID", async () => {
  let request;
  const VendorSheetService = loadVendorService(async (_name, body) => {
    request = body;
    return {
      vendor: { rowNumber: 206, vendorName: "QA Vendor", vendorId: "GAS-V0205", businessCategory: "總務" }
    };
  });
  const row = await new VendorSheetService().create({ vendorName: "QA Vendor", businessCategory: "總務" });
  assert.equal(request.action, "create");
  assert.equal(request.vendor.vendorName, "QA Vendor");
  assert.equal(request.vendor.businessCategory, "總務");
  assert.equal(request.vendor.vendorId, undefined);
  assert.equal(row.vendorId, "GAS-V0205");
});

test("vendor create serializes multiple business categories in canonical order", async () => {
  let request;
  const VendorSheetService = loadVendorService(async (_name, body) => {
    request = body;
    return {
      vendor: { rowNumber: 206, vendorName: "QA Vendor", vendorId: "GAS-V0205", businessCategory: "採購、總務" }
    };
  });
  const row = await new VendorSheetService().create({ vendorName: "QA Vendor", businessCategory: ["總務", "採購"] });
  assert.equal(request.vendor.businessCategory, "採購、總務");
  assert.equal(row.businessCategory, "採購、總務");
});

test("vendor create rejects unsupported classification before the bridge call", async () => {
  let called = false;
  const VendorSheetService = loadVendorService(async () => {
    called = true;
    return {};
  });
  await assert.rejects(
    () => new VendorSheetService().create({ vendorName: "Invalid", businessCategory: "其他" }),
    error => error.code === "VENDOR_CATEGORY_INVALID"
  );
  assert.equal(called, false);
});

test("vendor update can write business category while the Vendor ID remains outside the patch", async () => {
  let request;
  const VendorSheetService = loadVendorService(async (_name, body) => {
    request = body;
    return {
      vendor: { rowNumber: 2, vendorName: "人工智能", vendorId: "GAS-V0001", businessCategory: "總務" }
    };
  });
  const row = await new VendorSheetService().update("GAS-V0001", { businessCategory: "總務" });
  assert.equal(request.action, "update");
  assert.equal(request.vendorId, "GAS-V0001");
  assert.equal(request.patch.businessCategory, "總務");
  assert.equal(row.businessCategory, "總務");
});

test("vendor update keeps multi-select categories in one Sheet field", async () => {
  let request;
  const VendorSheetService = loadVendorService(async (_name, body) => {
    request = body;
    return {
      vendor: { rowNumber: 2, vendorName: "人工智能", vendorId: "GAS-V0001", businessCategory: "採購、總務" }
    };
  });
  const row = await new VendorSheetService().update("GAS-V0001", { businessCategory: ["總務", "採購"] });
  assert.equal(request.patch.businessCategory, "採購、總務");
  assert.equal(row.businessCategory, "採購、總務");
});

test("vendor source and runtime expose the additive category/create contract", () => {
  const bridge = read("supabase/functions/gas-vendor-bridge/index.ts");
  const service = read("app/Board/procurement/vendor-sheet-service.js");
  const client = read("app/Board/procurement/vendor-list.js");
  assert.match(bridge, /const RANGE = "A:U"/);
  assert.match(bridge, /businessCategory/);
  assert.match(bridge, /action !== "read" && action !== "update" && action !== "create"/);
  assert.match(bridge, /function nextVendorId/);
  assert.match(service, /range:"A:U"/);
  assert.match(service, /async bridgeCreate\(vendor\)/);
  assert.match(client, /data-vendor-category/);
  assert.match(client, /data-vendor-column-options/);
  assert.match(client, /顯示欄位/);
  assert.match(client, /更多資料（選填）/);
  assert.match(client, /vendor-mobile-list/);
  assert.match(client, /name="businessCategory"/);
  assert.match(client, /data-vendor-add/);
  assert.match(client, /service\.create\(patch/);
  assert.doesNotMatch(client, /Vendor ID 將由/);
});
