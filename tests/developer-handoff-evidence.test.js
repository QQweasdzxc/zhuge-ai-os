const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const file = path.join(root, "tools/governance/developer-completion-evidence.json");

test("developer handoff package covers every requested task without direct Board mutation", () => {
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(payload.write_mode, "payload-ready-only");
  assert.equal(payload.direct_sql_or_board_dml, false);
  assert.deepEqual(Object.keys(payload.tasks).sort(), [
    "TASK-086", "TASK-087", "TASK-088", "TASK-093", "TASK-094",
    "TASK-097", "TASK-098", "TASK-099", "TASK-100", "TASK-101"
  ]);
  for (const [task, item] of Object.entries(payload.tasks)) {
    assert.ok(item.developer_status, `${task}: missing developer status`);
    assert.ok(item.evidence.length > 0, `${task}: missing evidence`);
    assert.ok(item.human_gate.length > 0, `${task}: missing human gate`);
    assert.equal(item.handoff.operation, "engineering_review");
    assert.equal(item.handoff.next_gate, "gpt");
    assert.equal(item.handoff.claim_token_source, "active_authenticated_co_claim");
  }
});
