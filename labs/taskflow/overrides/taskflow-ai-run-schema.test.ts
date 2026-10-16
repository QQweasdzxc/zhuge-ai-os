import { describe, expect, it } from "vitest";
import { TaskFlowAIEngineeringRunListSchema } from "./taskflow-ai-run-schema";

const run = {
  id: "00000000-0000-0000-0000-000000000001",
  task_identifier: "ZG-42",
  engineer: "co",
  state: "approved",
  github_pr: null,
  github_pr_state: null,
  github_checks_state: null,
  github_head_sha: null,
  github_snapshot_head_sha: null,
  github_snapshot_fetched_at: null,
  created_at: "2026-10-16T00:00:00Z",
  approval_expires_at: "2026-10-16T00:05:00Z",
  provider_thread_id: null,
  last_evidence_sha: null,
  revision: 1,
  events: [{
    run_id: "00000000-0000-0000-0000-000000000001",
    kind: "pm_approved",
    state: "approved",
    github_sha: null,
    created_at: "2026-10-16T00:00:00Z",
  }],
};

describe("TaskFlow AI Run readback contract", () => {
  it("accepts only persisted Run evidence with dispatch disabled", () => {
    expect(TaskFlowAIEngineeringRunListSchema.safeParse({
      runs: [run], dispatch_enabled: false, message: "provider is not connected",
    }).success).toBe(true);
  });

  it("rejects provider-enabled or malformed Run payloads", () => {
    expect(TaskFlowAIEngineeringRunListSchema.safeParse({
      runs: [run], dispatch_enabled: true,
    }).success).toBe(false);
    expect(TaskFlowAIEngineeringRunListSchema.safeParse({
      runs: [{ ...run, task_identifier: "not-a-task" }], dispatch_enabled: false,
    }).success).toBe(false);
    expect(TaskFlowAIEngineeringRunListSchema.safeParse({
      runs: [{ ...run, events: [{ ...run.events[0], kind: "unknown" }] }], dispatch_enabled: false,
    }).success).toBe(false);
  });
});
