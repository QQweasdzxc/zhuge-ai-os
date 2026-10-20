import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {durableRecordFromIntent} from "../labs/taskflow/pages-client/dispatch-persistence-contract.mjs";
import {
  projectAndValidateDispatchRuntimeReadModel,
  projectDispatchRuntimeReadModel,
  validateRuntimeReadModel
} from "../labs/taskflow/pages-client/runtime-read-model-projector.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(fs.readFileSync(join(ROOT, "labs/taskflow/docs/DM00_DM03_PHASE2_RUNTIME_SCHEMA.json"), "utf8"));

function record(overrides = {}) {
  return durableRecordFromIntent({
    intentId: "intent:read-model-1",
    issuerUserId: "cto-user-1",
    issuerAuthorization: "AUTHORIZED",
    workspace: "workspace-1",
    workCode: "DM-02",
    issueId: "issue-1",
    executorId: "CO-02",
    provider: "codex",
    taskId: "taskflow-task-1",
    ...overrides
  }, {createdAt: "2026-10-20T20:30:00.000Z"});
}

test("projector validates the actual checked-in runtime read model schema", () => {
  const model = projectAndValidateDispatchRuntimeReadModel({
    record: record(),
    nativeTaskRuns: [{id: "taskflow-task-1", status: "queued"}],
    nativePullRequests: [{number: 106, head_sha: "0123456789abcdef0123456789abcdef01234567"}]
  }, schema);

  assert.equal(model.schema, "zhuge-taskflow-dispatch-persistence-v1");
  assert.equal(model.task_id, "taskflow-task-1");
  assert.equal(model.provider_run_id, null);
  assert.equal(model.authorization, "AUTHORIZED");
  assert.equal(model.evidence.provider_ack, "UNVERIFIED");
  assert.equal(model.evidence.provider_run_id_source, "UNVERIFIED");
  assert.equal(model.evidence.github_sha_source, "native_github_mirror");
});

test("native TaskFlow task readback never becomes a Provider Run ID", () => {
  const model = projectDispatchRuntimeReadModel({
    record: record({taskId: ""}),
    nativeTaskRuns: [{id: "native-task-only", status: "running"}]
  });

  assert.equal(model.task_id, "native-task-only");
  assert.equal(model.provider_run_id, null);
  assert.equal(model.evidence.provider_ack, "UNVERIFIED");
  assert.equal(model.state, "INTENT_CREATED");
});

test("schema validation rejects forged authorization and incomplete evidence", () => {
  const forged = projectDispatchRuntimeReadModel({record: record()});
  forged.authorization = "CTO_METADATA";
  delete forged.evidence.provider_ack;
  const result = validateRuntimeReadModel(forged, schema);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("authorization")));
  assert.ok(result.errors.some(error => error.includes("provider_ack")));
});

test("blocked records expose a traceable reason without claiming a run", () => {
  const model = projectAndValidateDispatchRuntimeReadModel({
    record: record({issuerAuthorization: "UNVERIFIED"})
  }, schema);

  assert.equal(model.state, "BLOCKED");
  assert.equal(model.authorization, "UNVERIFIED");
  assert.equal(model.evidence.blocked_reason, "CTO_AUTHORIZATION_UNVERIFIED");
  assert.equal(model.evidence.provider_run_id_source, "NOT_AVAILABLE");
});
