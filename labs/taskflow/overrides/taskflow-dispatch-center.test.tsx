import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TaskFlowDispatchCenter, TaskFlowDispatchRuntime } from "./taskflow-dispatch-center";
import { DISPATCH_EXECUTORS } from "./taskflow-dispatch-logic.mjs";

const state = vi.hoisted(() => ({ workspace: { id: "ws-a", slug: "alpha", name: "Alpha" }, list: vi.fn(), issue: vi.fn(), runtime: vi.fn() }));
vi.mock("@multica/core/api", () => ({ api: { listIssues: state.list, getIssue: state.issue, getDispatchRuntime: state.runtime } }));
vi.mock("@multica/core/paths", () => ({ useCurrentWorkspace: () => state.workspace, useWorkspaceSlug: () => state.workspace.slug, useWorkspacePaths: () => ({ issueDetail: (id: string) => `/${state.workspace.slug}/issues/${id}` }) }));
vi.mock("../navigation", () => ({ AppLink: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
const issue = { id: "issue-a", workspace_id: "ws-a", title: "真實案件入口", identifier: "ZG-42", status: "todo", metadata: { zhuge_work_code: "P2", zhuge_executor: "CO-03", zhuge_dispatch_status: "RUNNING", zhuge_provider_run_id: "forged-run", zhuge_pm_decision_required: true, zhuge_runtime_read_model: { authorization: "AUTHORIZED", evidence: { provider_ack: "VERIFIED" }, state: "RUNNING" } } };
function mount(child = <TaskFlowDispatchCenter />) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}>{child}</QueryClientProvider>); }
beforeEach(() => { state.workspace = { id: "ws-a", slug: "alpha", name: "Alpha" }; state.list.mockReset().mockResolvedValue({ issues: [issue], total: 1 }); state.issue.mockReset().mockResolvedValue(issue); state.runtime.mockReset().mockResolvedValue({ runtime: { issue_id: "issue-a", workspace: "ws-a", state: "UNKNOWN", authorization: "UNVERIFIED", evidence: { provider_ack: "UNVERIFIED" } }, readback_kind: "NATIVE_TASK_READBACK" }); });
afterEach(cleanup);
describe("native dispatch center", () => {
  it("separates native TaskFlow status from protected provider status", async () => { mount(); await screen.findByText(/ZG-42/); expect(screen.getByText(/TF 原生狀態：待處理 · Provider Runtime：未驗證/)).toBeTruthy(); expect(screen.getByText("待 PM 裁示 · 真實案件入口")).toBeTruthy(); });
  it("links the same issue, retains five executors and separates PM Inbox without fan-out", async () => { mount(); await screen.findByText(/ZG-42/); expect(screen.getAllByRole("link").every(link => link.getAttribute("href") === "/alpha/issues/issue-a")).toBe(true); expect(screen.getAllByRole("option")).toHaveLength(6); expect(screen.getByText(/待 PM 裁示/)).toBeTruthy(); expect(state.runtime).not.toHaveBeenCalled(); expect(screen.getByText("派工尚未開放").hasAttribute("disabled")).toBe(true); });
  it("exposes each executor's native workload and issue links", async () => { mount(); await screen.findByText(/ZG-42/); fireEvent.click(screen.getByText("查看工作清單")); expect(screen.getByText(/ZG-42 · 真實案件入口/)).toBeTruthy(); expect(screen.getByText(/（TF：待處理）/)).toBeTruthy(); });
  it("never presents forged metadata Run ID as official evidence", async () => { mount(); await screen.findByText(/ZG-42/); fireEvent.click(screen.getByText("查看執行證據")); await screen.findByText(/Provider Run ID（受保護讀回）：未取得/); expect(screen.queryByText(/forged-run/)).toBeNull(); expect(screen.queryByText(/正在執行/)).toBeNull(); expect(state.runtime).toHaveBeenCalledWith("issue-a", "alpha"); });
  it("rejects mismatched readback identities", async () => { state.runtime.mockResolvedValue({ runtime: { issue_id: "other", workspace: "ws-a", state: "RUNNING" } }); mount(<TaskFlowDispatchRuntime issueId="issue-a" />); expect(await screen.findByRole("alert")).toHaveTextContent("執行證據身分不一致"); });
  it("keeps API permission failure distinct from empty", async () => { state.list.mockRejectedValue(new Error("403 forbidden")); mount(); expect(await screen.findByRole("alert")).toHaveTextContent("403 forbidden"); expect(screen.queryByText("本 Workspace 沒有符合條件的 AI 工作。")).toBeNull(); });
  it("rejects cross-workspace issues", async () => { state.list.mockResolvedValue({ issues: [{ ...issue, workspace_id: "ws-b" }] }); mount(); expect(await screen.findByRole("alert")).toHaveTextContent("工作空間不一致"); });
  it("shows a real empty state", async () => { state.list.mockResolvedValue({ issues: [], total: 0 }); mount(); expect(await screen.findByText("本 Workspace 沒有符合條件的 AI 工作。")).toBeTruthy(); });
  it("loads all Workspace pages before calculating workload and Inbox", async () => {
    const all = Array.from({ length: 45 }, (_, index) => ({ ...issue, id: `issue-${index}`, identifier: `ZG-${index}`, metadata: { ...issue.metadata, zhuge_executor: DISPATCH_EXECUTORS[index % DISPATCH_EXECUTORS.length], zhuge_pm_decision_required: index === 0 } }));
    state.list.mockImplementation(({ offset = 0 }: { offset?: number }) => Promise.resolve({ issues: all.slice(offset, offset + 20), total: all.length }));
    mount();
    expect(await screen.findByText(/已載入 Workspace 全部 45 件 AI 派工案件/)).toBeTruthy();
    expect(state.list.mock.calls.map(([args]) => args.offset)).toEqual([0, 20, 40]);
    expect(screen.getByRole("heading", { name: /PM Inbox · Workspace 總數/ })).toBeTruthy();
    expect(screen.getAllByText(/負責工作：9/)).toHaveLength(5);
  });
  it("keeps native DONE separate from provider success", async () => { state.runtime.mockResolvedValue({ runtime: { issue_id: issue.id, workspace: "ws-a", state: "DONE", evidence: { provider_ack: "UNVERIFIED" } }, readback_kind: "NATIVE_TASK_READBACK" }); mount(<TaskFlowDispatchRuntime issueId="issue-a" />); await screen.findByText("TaskFlow 原生任務狀態：完成"); expect(screen.getByText("原生任務結果不代表官方 Provider 執行結果。")).toBeTruthy(); });
});
