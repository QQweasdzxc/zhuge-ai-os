/* ZG-ERP 掃描解碼契約測試：合成 QR 幀 →  vendored jsQR 解碼 → 去重複邏輯（不需實體相機） */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");
const jsQR = require(path.join(ROOT, "ZG-ERP/vendor/jsQR.js"));
const Core = require(path.join(ROOT, "ZG-ERP/erp-scan-core.js"));

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/fixtures/qr-asset-tp-0001.json"), "utf8"));

test("vendored jsQR decodes a synthetic QR frame to the encoded asset code", () => {
  const frame = Core.matrixToRGBA(fixture.modules, 10, 4);
  const val = Core.decodeWithJsQR(jsQR, frame.data, frame.width, frame.height);
  assert.strictEqual(val, fixture.value);
});

test("decode is stable at a smaller render scale", () => {
  const frame = Core.matrixToRGBA(fixture.modules, 4, 4);
  const val = Core.decodeWithJsQR(jsQR, frame.data, frame.width, frame.height);
  assert.strictEqual(val, fixture.value);
});

test("blank frame decodes to empty string, not an error", () => {
  const W = 64, data = new Uint8ClampedArray(W * W * 4).fill(255);
  assert.strictEqual(Core.decodeWithJsQR(jsQR, data, W, W), "");
});

test("deduper rejects the same code inside the window and accepts after it", () => {
  const d = Core.makeDeduper(3000);
  assert.strictEqual(d.accept("ASSET-TP-0001", 10000), true);
  assert.strictEqual(d.accept("ASSET-TP-0001", 12000), false);
  assert.strictEqual(d.accept("ASSET-TP-0002", 12500), true);
  assert.strictEqual(d.accept("ASSET-TP-0001", 13100), true);
});

test("deduper ignores empty and whitespace-only values", () => {
  const d = Core.makeDeduper(3000);
  assert.strictEqual(d.accept("", 1000), false);
  assert.strictEqual(d.accept("   ", 1000), false);
  assert.strictEqual(d.accept(null, 1000), false);
});


test("camera holds a label once, rearming only after a stable blank interval", () => {
  const d = Core.makePresenceDeduper(1500);
  assert.equal(d.accept("CSMN112020004", 1000), true);
  assert.equal(d.accept("CSMN112020004", 5000), false);
  assert.equal(d.accept("", 5100), false);
  assert.equal(d.accept("CSMN112020004", 5500), false); // one missed frame is not removal
  assert.equal(d.accept("", 6000), false);
  assert.equal(d.accept("", 7600), false);
  assert.equal(d.accept("CSMN112020004", 7700), true);
  assert.equal(d.accept("CSMN112020005", 7800), true);
  assert.equal(d.accept("CSMN112020005", 18000), false);
});

test('QR frame uses actual native corner points, rectangle fallback, or no geometry without inventing a box', () => {
 const corners=[{x:10,y:20},{x:80,y:22},{x:78,y:91},{x:9,y:90}];
 assert.deepEqual(Core.qrDetection({rawValue:'REAL',cornerPoints:corners},1920,1080).points,corners);
 assert.deepEqual(Core.qrDetection({rawValue:'REAL',boundingBox:{x:3,y:4,width:10,height:20}},100,100).points,[{x:3,y:4},{x:13,y:4},{x:13,y:24},{x:3,y:24}]);
 assert.equal(Core.qrDetection({rawValue:'REAL'},100,100).points,null);
 assert.equal(Core.qrDetection(null,100,100).value,'');
 assert.equal(Core.qrDetection({rawValue:'REAL',cornerPoints:[{x:NaN,y:0}]},100,100).points,null);
});
test('jsQR exposes decoded geometry from the same full frame used for detection', () => {
 const frame=Core.matrixToRGBA(fixture.modules,4,4);
 const d=Core.decodeDetectionWithJsQR(jsQR,frame.data,frame.width,frame.height);
 assert.equal(d.value,fixture.value); assert.equal(d.points.length,4); assert.equal(d.width,frame.width); assert.equal(d.height,frame.height);
 const blank=new Uint8ClampedArray(64*64*4).fill(255);
 assert.equal(Core.decodeDetectionWithJsQR(jsQR,blank,64,64).points,null);
});
