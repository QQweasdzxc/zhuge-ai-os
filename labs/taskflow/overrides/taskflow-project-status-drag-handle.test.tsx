// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskFlowProjectStatusDragHandle } from "./taskflow-project-status-drag-handle";
const state = vi.hoisted(() => ({ save: vi.fn().mockResolvedValue(undefined), projectId: "project-a" as string | null }));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "workspace-a" }));
vi.mock("@multica/core/issue-statuses/hooks", () => ({ useIssueStatuses: () => ({ activeStatuses: ["todo", "in_progress", "in_review"].map(key => ({ key })), isLoaded: true, isError: false }) }));
vi.mock("@multica/core/issue-statuses/taskflow-project-status-scope", () => ({
  useTaskFlowProjectStatusSettings: () => ({ projectId: state.projectId, isLoading: false, saveStatusOrder: state.save }),
  moveTaskFlowStatus: (keys: string[], from: string, to: string) => { const copy = [...keys]; const a=copy.indexOf(from),b=copy.indexOf(to);copy.splice(a,1);copy.splice(b,0,from);return copy; },
}));
vi.mock("../utils/status-label", () => ({ useStatusLabel: () => (key: string) => key }));
vi.mock("../../i18n", () => ({ useT: () => ({ t: (fn: (m: any) => string, params?: any) => fn({ taskflow_project_status: { drag_order: "Reorder {{name}}", drag_help: "Drag", order_saved: "Saved", save_failed: "Failed" } }).replace("{{name}}", params?.name ?? "") }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => { state.projectId="project-a"; state.save.mockClear(); });
describe("Project header order", () => {
 it("keyboard changes only the Project preference, not card state", async () => {
  render(<TaskFlowProjectStatusDragHandle status="in_progress" />);
  fireEvent.keyDown(screen.getByRole("button",{name:"Reorder in_progress"}),{key:"ArrowLeft"});
  await waitFor(()=>expect(state.save).toHaveBeenCalledWith(["in_progress","todo","in_review"]));
 });
 it("does not expose Project reorder in a global board", () => {
  state.projectId=null; const view=render(<TaskFlowProjectStatusDragHandle status="todo" />);
  expect(view.container.innerHTML).toBe("");expect(state.save).not.toHaveBeenCalled();
 });
 it("does nothing at the first boundary", () => {
  render(<TaskFlowProjectStatusDragHandle status="todo" />);
  fireEvent.keyDown(screen.getByRole("button",{name:"Reorder todo"}),{key:"ArrowLeft"});
  expect(state.save).not.toHaveBeenCalled();
 });
});
