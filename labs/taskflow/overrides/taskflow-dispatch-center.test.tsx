import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TaskFlowDispatchCenter, TaskFlowDispatchRuntime } from "./taskflow-dispatch-center";

const state = vi.hoisted(() => ({ workspace: { id: "ws-a", slug: "alpha", name: "Alpha" }, list: vi.fn(), issue: vi.fn(), runtime: vi.fn() }));
vi.mock("@multica/core/api", () => ({ api: { listIssues: state.list, getIssue: state.issue, getDispatchRuntime: state.runtime } }));
vi.mock("@multica/core/paths", () => ({ useCurrentWorkspace: () => state.workspace, useWorkspaceSlug: () => state.workspace.slug, useWorkspacePaths: () => ({ issueDetail: (id: string) => `/${state.workspace.slug}/issues/${id}` }) }));
vi.mock("../navigation", () => ({ AppLink: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
const issue = { id: "issue-a", workspace_id: "ws-a", title: "真實案件入口", identifier: "ZG-42", metadata: { zhuge_work_code: "P2", zhuge_executor: "CO-03", zhuge_dispatch_status: "RUNNING", zhuge_provider_run_id: "forged-run", zhuge_pm_decision_required: true, zhuge_runtime_read_model: { authorization: "AUTHORIZED", evidence: { provider_ack: "VERIFIED" }, state: "RUNNING" } } };
function mount(child = <TaskFlowDispatchCenter />) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}>{child}</QueryClientProvider>); }
beforeEach(() => { state.workspace = { id: "ws-a", slug: "alpha", name: "Alpha" }; state.list.mockReset().mockResolvedValue({ issues: [issue], total: 1 }); state.issue.mockReset().mockResolvedValue(issue); state.runtime.mockReset().mockResolvedValue({ runtime: { issue_id: "issue-a", workspace: "ws-a", state: "UNKNOWN", authorization: "UNVERIFIED", evidence: { provider_ack: "UNVERIFIED" } }, readback_kind: "NATIVE_TASK_READBACK" }); });
afterEach(cleanup);
describe("native dispatch center", () => {
  it("links the same issue, retains five executors and separates PM Inbox without fan-out", async () => { mount(); await screen.findByText(/ZG-42/); expect(screen.getAllByRole("link").every(link => link.getAttribute("href") === "/alpha/issues/issue-a")).toBe(true); expect(screen.getAllByRole("option")).toHaveLength(6); expect(screen.getByText(/待 PM 裁示/)).toBeTruthy(); expect(state.runtime).not.toHaveBeenCalled(); expect(screen.getByText("派工尚未開放").hasAttribute("disabled")).toBe(true); });
  it("never presents forged metadata Run ID as official evidence", async () => { mount(); await screen.findByText(/ZG-42/); fireEvent.click(screen.getByText("查看執行證據")); await screen.findByText(/Provider Run ID（受保護讀回）：未取得/); expect(screen.queryByText(/forged-run/)).toBeNull(); expect(screen.queryByText(/正在執行/)).toBeNull(); expect(state.runtime).toHaveBeenCalledWith("issue-a", "alpha"); });
  it("rejects mismatched readback identities", async () => { state.runtime.mockResolvedValue({ runtime: { issue_id: "other", workspace: "ws-a", state: "RUNNING" } }); mount(<TaskFlowDispatchRuntime issueId="issue-a" />); expect(await screen.findByRole("alert")).toHaveTextContent("執行證據身分不一致"); });
  it("keeps API permission failure distinct from empty", async () => { state.list.mockRejectedValue(new Error("403 forbidden")); mount(); expect(await screen.findByRole("alert")).toHaveTextContent("403 forbidden"); expect(screen.queryByText("本頁沒有符合條件的 AI 工作。")).toBeNull(); });
  it("rejects cross-workspace issues", async () => { state.list.mockResolvedValue({ issues: [{ ...issue, workspace_id: "ws-b" }] }); mount(); expect(await screen.findByRole("alert")).toHaveTextContent("工作空間不一致"); });
  it("shows a real empty state", async () => { state.list.mockResolvedValue({ issues: [], total: 0 }); mount(); expect(await screen.findByText("本頁沒有符合條件的 AI 工作。")).toBeTruthy(); });
  it("keeps native DONE separate from provider success", async () => { state.runtime.mockResolvedValue({ runtime: { issue_id: issue.id, workspace: "ws-a", state: "DONE", evidence: { provider_ack: "UNVERIFIED" } }, readback_kind: "NATIVE_TASK_READBACK" }); mount(<TaskFlowDispatchRuntime issueId="issue-a" />); await screen.findByText("TaskFlow 原生任務狀態：完成"); expect(screen.getByText("原生任務結果不代表官方 Provider 執行結果。")).toBeTruthy(); });
});
