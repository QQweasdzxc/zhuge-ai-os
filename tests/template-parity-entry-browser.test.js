const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

test("the current browser fixture mounts one shared Golden Master parity entry for every Consumer", () => {
  const fixture = fs.readFileSync(path.join(__dirname, "template-parity-entry-browser.html"), "utf8");
  const goldenMasterIndex = fixture.indexOf("../shared/components/golden-master.js");
  const parityEngineIndex = fixture.indexOf("../shared/components/template-parity-engine.js");
  const runtimeIndex = fixture.indexOf("../shared/components/golden-master-runtime.js");

  assert.ok(goldenMasterIndex >= 0, "the fixture must load the shared Golden Master");
  assert.ok(parityEngineIndex > goldenMasterIndex, "the fixture must load the shared parity engine after the Golden Master");
  assert.ok(runtimeIndex > parityEngineIndex, "the fixture must load the shared runtime after the parity engine");
  assert.equal((fixture.match(/\["ai_board", "AI Board"/g) || []).length, 1);
  assert.equal((fixture.match(/\["worktodo", "WorkTodo"/g) || []).length, 1);
  assert.equal((fixture.match(/\["c", "QAT"/g) || []).length, 1);
  assert.match(fixture, /id = "template-parity-entry-audit"/);
  assert.match(fixture, /templateParityBtn/);
  assert.match(fixture, /inventoryCount/);
  assert.match(fixture, /inventoryStatuses/);
  assert.match(fixture, /drawerInventory/);
  assert.doesNotMatch(fixture, /Consumer-specific.*templateParityBtn/i);
});
