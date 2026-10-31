"use strict";
// Drag-vs-click guard for the 2D office canvas: a drag (press + move beyond
// threshold at ANY point of the gesture, including drag-out-and-back) must
// not fire the click-open, and must not suppress the NEXT genuine click.
// Pure state-machine tests over the exported guard; live desktop/390 gesture
// verification is reported separately and is not claimed here.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "labs/pixel-office-3d/office.js"), "utf8");

function loadGuard() {
  const sandbox = {
    window: {},
    document: { createElement: () => ({ style: {}, classList: { add() {} } }) },
    matchMedia: () => ({ addEventListener() {} }),
    performance: { now: () => 0 },
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    ResizeObserver: class { observe() {} disconnect() {} },
    Image: class {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    navigator: {},
    location: { href: "", search: "" },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.OfficeClickGuard;
}

const ev = (x, y) => ({ clientX: x, clientY: y });

test("plain click (press + release, no move) stays a click", () => {
  const createClickGuard = loadGuard();
  const g = createClickGuard();
  g.down(ev(100, 100));
  g.up();
  assert.equal(g.isClick(), true);
});

test("tiny jitter within threshold stays a click", () => {
  const createClickGuard = loadGuard();
  const g = createClickGuard();
  g.down(ev(100, 100));
  g.move(ev(104, 103)); // 5px < 8px
  g.move(ev(101, 100));
  g.up();
  assert.equal(g.isClick(), true);
});

test("drag beyond threshold is not a click", () => {
  const createClickGuard = loadGuard();
  const g = createClickGuard();
  g.down(ev(100, 100));
  g.move(ev(160, 100)); // 60px
  g.up();
  assert.equal(g.isClick(), false);
});

test("drag out and back to origin is still not a click (whole-gesture max)", () => {
  const createClickGuard = loadGuard();
  const g = createClickGuard();
  g.down(ev(100, 100));
  g.move(ev(180, 100)); // 80px away mid-gesture
  g.move(ev(100, 100)); // returns to the exact start point
  g.up();
  assert.equal(g.isClick(), false);
});

test("a suppressed drag does not pollute the next genuine click", () => {
  const createClickGuard = loadGuard();
  const g = createClickGuard();
  g.down(ev(100, 100));
  g.move(ev(200, 100));
  g.up();
  assert.equal(g.isClick(), false);
  g.down(ev(300, 300));
  g.up();
  assert.equal(g.isClick(), true);
});

test("multi-touch (pinch) counts as a drag and resets cleanly", () => {
  const createClickGuard = loadGuard();
  const g = createClickGuard();
  g.down(ev(100, 100));
  g.down(ev(140, 100)); // second finger
  g.move(ev(105, 100));
  g.up();
  g.up();
  assert.equal(g.isClick(), false);
  g.down(ev(300, 300));
  g.up();
  assert.equal(g.isClick(), true);
});

test("pointercancel resets the gesture; the next click is clean", () => {
  const createClickGuard = loadGuard();
  const g = createClickGuard();
  g.down(ev(100, 100));
  g.move(ev(200, 200));
  g.cancel();
  g.down(ev(50, 50));
  g.up();
  assert.equal(g.isClick(), true);
});
