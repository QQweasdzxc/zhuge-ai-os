import { describe, expect, it } from "vitest";
import {
  encodeTaskFlowProjectStatusKey,
  isTaskFlowProjectStatusKey,
  scopeTaskFlowStatusCatalog,
  taskFlowProjectIdFromStatusKey,
} from "./taskflow-project-status-scope";
import { buildIssueStatusCatalog } from "@multica/core/issue-statuses/queries";
import type { IssueStatusEntry } from "@multica/core/types";

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";

function status(key: string, isSystem = false): IssueStatusEntry {
  return {
    id: key,
    workspace_id: "workspace-1",
    key,
    name: key,
    description: "",
    category: "started",
    color: "#64748b",
    icon: null,
    is_system: isSystem,
    position: 0,
    archived_at: null,
    created_at: "",
    updated_at: "",
  };
}

describe("TaskFlow Project status scope", () => {
  it("round-trips a Project UUID through a native-length status key", () => {
    const key = encodeTaskFlowProjectStatusKey(PROJECT_A, "00ab");
    expect(key).toHaveLength(32);
    expect(isTaskFlowProjectStatusKey(key)).toBe(true);
    expect(taskFlowProjectIdFromStatusKey(key)).toBe(PROJECT_A);
    expect(taskFlowProjectIdFromStatusKey("project_qa")).toBeNull();
  });

  it("keeps all seven built-ins and scopes project custom statuses independently", () => {
    const builtIns = ["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"]
      .map((key) => status(key, true));
    const projectAKey = encodeTaskFlowProjectStatusKey(PROJECT_A, "0001");
    const projectBKey = encodeTaskFlowProjectStatusKey(PROJECT_B, "0001");
    const catalog = buildIssueStatusCatalog([
      ...builtIns,
      status("global_review"),
      status(projectAKey),
      status(projectBKey),
    ]);

    const projectA = scopeTaskFlowStatusCatalog(catalog, PROJECT_A);
    const projectB = scopeTaskFlowStatusCatalog(catalog, PROJECT_B);
    const workspace = scopeTaskFlowStatusCatalog(catalog, null);

    expect(projectA.activeStatuses.map((entry) => entry.key)).toEqual(
      expect.arrayContaining([...builtIns.map((entry) => entry.key), "global_review", projectAKey]),
    );
    expect(projectA.activeStatuses.map((entry) => entry.key)).not.toContain(projectBKey);
    expect(projectB.activeStatuses.map((entry) => entry.key)).not.toContain(projectAKey);
    expect(projectA.statuses.map((entry) => entry.key)).not.toContain(projectBKey);
    expect(workspace.activeStatuses.map((entry) => entry.key)).not.toContain(projectAKey);
    expect(workspace.activeStatuses.map((entry) => entry.key)).not.toContain(projectBKey);
    // Historical rows still resolve even when their status is not assignable here.
    expect(projectA.entryOf(projectBKey)?.name).toBe(projectBKey);
    expect(projectA.statuses).toHaveLength(builtIns.length + 2);
  });
});
