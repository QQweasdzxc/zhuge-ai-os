import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TaskFlowDispatchCenter, TaskFlowDispatchRuntime } from "./taskflow-dispatch-center";

const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const issueId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const queueId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const state = vi.hoisted(() => ({ workspace: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", slug: "alpha", name: "Alpha" }, mappings: vi.fn(), tasks: vi.fn(), issue: vi.fn(), runtime: vi.fn() }));
vi.mock("@multica/core/api", () => ({ api: { getZhugeAIProjectMappings: state.mappings, listZhugeAITasks: state.tasks, getIssue: state.issue, getDispatchRuntime: state.runtime } }));
vi.mock("@multica/core/paths", () => ({ useCurrentWorkspace: () => state.workspace, useWorkspaceSlug: () => state.workspace.slug, useWorkspacePaths: () => ({ projectDetail: (id: string) => `/${state.workspace.slug}/projects/${id}`, issueDetail: (id: string) => `/${state.workspace.slug}/issues/${id}` }) }));
vi.mock("../navigation", () => ({ AppLink: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a> }));
const mappings = () => ({ schema: "taskflow-native-executor-project-mapping-v1", source: "TASKFLOW_NATIVE_EXECUTOR_REGISTRY", workspace_id: workspaceId, checked_at: new Date().toISOString(), mappings: ["CO-01", "CO-02", "CO-03", "GEM-01", "GH-HELPER"].map(executor_id => ({ executor_id, state: executor_id === "CO-03" ? "VERIFIED" : "GAP", reason: executor_id === "CO-03" ? "" : "NATIVE_PROJECT_NOT_BOUND", project_id: executor_id === "CO-03" ? projectId : "", project_title: executor_id === "CO-03" ? "CO-03 原生專案" : "", workspace_id: workspaceId, workspace_access: executor_id === "CO-03" ? "ALLOW" : "UNVERIFIED", project_access: executor_id === "CO-03" ? "ALLOW" : "UNVERIFIED", source: "TASKFLOW_NATIVE_EXECUTOR_REGISTRY" })) });
const nativeTask = (id = issueId) => ({ issue_id: id, workspace_id: workspaceId, project_id: projectId, project_title: "CO-03 原生專案", title: "原生 TaskFlow 工作", issue_status: "in_progress", executor_id: "CO-03", taskflow_task_id: queueId, taskflow_task_status: "queued", provider_runtime_state: "UNVERIFIED", provider_ack: "UNVERIFIED", updated_at: new Date().toISOString() });
const taskPage = (tasks = [nativeTask()], total = tasks.length, offset = 0) => ({ schema: "taskflow-native-ai-task-readback-v1", source: "TASKFLOW_NATIVE_ISSUE_AGENT_QUEUE", workspace_id: workspaceId, observed_at: new Date().toISOString(), limit: 20, offset, total, tasks, consistency: "NON_ATOMIC_OFFSET", provider_runtime_state: "UNVERIFIED" });
const issue = { id: issueId, workspace_id: workspaceId, title: "原生 TaskFlow 工作", identifier: "ZG-42", status: "in_progress", metadata: { zhuge_dispatch_status: "RUNNING", zhuge_provider_run_id: "forged-run", zhuge_runtime_read_model: { authorization: "AUTHORIZED", evidence: { provider_ack: "VERIFIED" }, state: "RUNNING" } } };
function mount(child = <TaskFlowDispatchCenter />) { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(<QueryClientProvider client={client}>{child}</QueryClientProvider>); }
beforeEach(() => { state.workspace = { id: workspaceId, slug: "alpha", name: "Alpha" }; state.mappings.mockReset().mockResolvedValue(mappings()); state.tasks.mockReset().mockResolvedValue(taskPage()); state.issue.mockReset().mockResolvedValue(issue); state.runtime.mockReset().mockResolvedValue({ runtime: { issue_id: issueId, workspace: workspaceId, state: "UNKNOWN", authorization: "UNVERIFIED", evidence: { provider_ack: "UNVERIFIED" } }, readback_kind: "NATIVE_TASK_READBACK" }); });
afterEach(cleanup);

describe("TaskFlow native AI readback", () => {
  it("links a server-verified native Project and the same canonical Issue ID", async () => {
    mount();
    expect(await screen.findByRole("link", { name: "CO-03 原生專案" })).toHaveAttribute("href", `/alpha/projects/${projectId}`);
    expect(screen.getByRole("link", { name: new RegExp(`${issueId} · 原生 TaskFlow 工作`) })).toHaveAttribute("href", `/alpha/issues/${issueId}`);
    expect(screen.getByText(/TF 狀態：進行中/)).toBeTruthy();
    expect(screen.getByText(/TaskFlow Queue：queued · Provider Runtime：未驗證/)).toBeTruthy();
  });
  it("shows missing native mappings as GAP and provides no fabricated project route", async () => {
    mount(); expect(await screen.findAllByText(/GAP：原生 Agent／Project／Workspace／ACL 尚未完整驗證/)).toHaveLength(4);
    expect(screen.queryByRole("link", { name: /CO-01 原生專案/ })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(5);
  });
  it("does not turn an ordinary human issue or mutable metadata into an AI task", async () => {
    state.tasks.mockResolvedValue(taskPage([], 0));
    mount();
    expect(await screen.findByText("目前沒有符合原生 AI Agent／Project／Task Queue 條件的 TaskFlow Issue。")).toBeTruthy();
    expect(screen.queryByText(/forged-run|正在執行/)).toBeNull();
  });
  it("fails closed on cross-Workspace task readback and does not show empty state", async () => {
    state.tasks.mockResolvedValue(taskPage([{ ...nativeTask(), workspace_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }]));
    mount(); expect(await screen.findByRole("alert")).toHaveTextContent("AI Task 與原生 Issue／Project／Workspace／Provider 狀態不一致");
    expect(screen.queryByText("目前沒有符合原生 AI Agent／Project／Task Queue 條件的 TaskFlow Issue。")).toBeNull();
  });
  it("rejects duplicate Project mapping and Project ID collisions", async () => {
    const invalid = mappings();
    invalid.mappings[4] = { ...invalid.mappings[4], state: "VERIFIED", project_id: projectId, project_title: "共用專案", workspace_access: "ALLOW", project_access: "ALLOW" };
    state.mappings.mockResolvedValue(invalid);
    state.tasks.mockResolvedValue(taskPage([nativeTask()], 1));
    mount(); expect(await screen.findByRole("alert")).toHaveTextContent("AI Task 與原生 Issue／Project／Workspace／Provider 狀態不一致");
  });
  it("keeps API permission failures separate from an empty native task list", async () => {
    state.mappings.mockRejectedValue(new Error("403 forbidden"));
    mount(); expect(await screen.findByRole("alert")).toHaveTextContent("403 forbidden");
    expect(screen.queryByText("目前沒有符合原生 AI Agent／Project／Task Queue 條件的 TaskFlow Issue。")).toBeNull();
  });
  it("loads all native Issue pages before calculating executor workload", async () => {
    const all = Array.from({ length: 45 }, (_, index) => nativeTask(`00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`));
    state.tasks.mockImplementation((_slug: string, args: { offset?: number } = {}) => Promise.resolve(taskPage(all.slice(args.offset || 0, (args.offset || 0) + 20), all.length, args.offset || 0)));
    mount();
    expect(await screen.findByText(/完整讀回 45 張符合原生 Agent、Project、Issue 與 Task Queue 關聯條件/)).toBeTruthy();
    expect(state.tasks.mock.calls.map(([slug, args]) => [slug, args.offset])).toEqual([["alpha", 0], ["alpha", 20], ["alpha", 40]]);
    const co03 = screen.getByRole("heading", { name: "CO-03" }).closest("article");
    expect(co03).toBeTruthy(); fireEvent.click(within(co03!).getByRole("button", { name: "查看原生 Issue" }));
    expect(within(co03!).getAllByRole("link", { name: /TaskFlow 工作/ })).toHaveLength(45);
  });
  it("shows native queue and protected runtime as separate evidence", async () => {
    mount(); await screen.findByRole("button", { name: "查看受保護執行證據" });
    fireEvent.click(screen.getByRole("button", { name: "查看受保護執行證據" }));
    await screen.findByText(/Provider Run ID（受保護讀回）：未取得/);
    expect(screen.queryByText(/forged-run/)).toBeNull();
    expect(screen.queryByText(/正在執行/)).toBeNull();
    expect(state.runtime).toHaveBeenCalledWith(issueId, "alpha");
  });
  it("rejects mismatched protected Runtime identity", async () => {
    state.runtime.mockResolvedValue({ runtime: { issue_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", workspace: workspaceId, state: "RUNNING" } });
    mount(<TaskFlowDispatchRuntime issueId={issueId} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("執行證據身分不一致");
  });
});
