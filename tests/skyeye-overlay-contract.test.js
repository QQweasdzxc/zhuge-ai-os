const test = require("node:test");
const assert = require("node:assert/strict");
const overlay = require("../modules/skyeye/services/skyeye-overlay-contract.js");

const marker = id => ({ id, label: `標記 ${id}`, lat: 23.7, lng: 121 });

test("SkyEye overlay keeps one primary and at most two minimized windows", () => {
  let windows = [];
  ["weather", "radar", "earthquake", "aqi"].forEach((layerKey, index) => {
    windows = overlay.open(windows, marker(String(index + 1)), layerKey, index + 1, { left: 12, top: 72 }).windows;
  });
  assert.deepEqual(overlay.counts(windows), { primary: 1, minimized: 2, total: 3 });
  assert.equal(windows.some(item => item.layerKey === "weather"), false, "oldest minimized window is evicted at the bound");
  assert.equal(windows.find(item => item.mode === "primary").layerKey, "aqi");
});

test("SkyEye overlay expand/minimize/close is deterministic", () => {
  let windows = overlay.open([], marker("weather"), "weather", 1).windows;
  windows = overlay.open(windows, marker("cctv"), "cctv", 2).windows;
  assert.equal(windows.find(item => item.layerKey === "weather").mode, "minimized");
  windows = overlay.expand(windows, "weather:weather", 3).windows;
  assert.equal(windows.find(item => item.layerKey === "weather").mode, "primary");
  windows = overlay.minimize(windows, "weather:weather", 4).windows;
  assert.equal(windows.find(item => item.layerKey === "weather").mode, "minimized");
  windows = overlay.close(windows, "cctv:cctv");
  assert.equal(windows.some(item => item.layerKey === "cctv"), false);
});

test("SkyEye overlay positions stay inside safe viewport bounds", () => {
  const position = overlay.clampPosition({ left: 999, top: -50 }, { width: 375, height: 667 }, { cardWidth: 264, cardHeight: 260, safeTop: 44, safeBottom: 20 });
  assert.deepEqual(position, { left: 99, top: 44 });
  assert.deepEqual(overlay.snapPosition({ left: 28, top: 61 }, { width: 375, height: 667 }, { cardWidth: 264, cardHeight: 260, safeTop: 44, safeBottom: 20, snapDistance: 36 }), { left: 12, top: 44 });
});

test("SkyEye overlay contract has no provider or Product Data authority", () => {
  assert.equal(overlay.MAX_PRIMARY, 1);
  assert.equal(overlay.MAX_MINIMIZED, 2);
  assert.equal(typeof overlay.open, "function");
  assert.equal(typeof overlay.setPosition, "function");
});
