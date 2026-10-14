// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TaskFlowProjectStatusScopeProvider,
  encodeTaskFlowProjectStatusKey,
  useTaskFlowProjectStatusSettings,
} from "./taskflow-project-status-scope";

type Preference = {
  scope_type: "project";
  scope_id: string;
  prefs: Record<string, unknown> & { hidden: string[]; order: string[] };
  updated_at: string;
};

const state = vi.hoisted(() => ({
  preferences: new Map<string, Preference>(),
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@multica/core/api", () => ({
  api: {
    getIssueViewPreference: state.get,
    putIssueViewPreference: state.put,
  },
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("@multica/core/issue-views/preferences", () => ({
  issueViewPrefKeys: {
    scope: (workspaceId: string, scope: { scope_type: string; scope_id?: string | null }) => [
      "issue-view-prefs", workspaceId, scope.scope_type, scope.scope_id ?? null,
    ],
  },
  issueViewPreferenceOptions: (workspaceId: string, scope: { scope_type: string; scope_id?: string | null }) => ({
    queryKey: ["issue-view-prefs", workspaceId, scope.scope_type, scope.scope_id ?? null],
    queryFn: () => state.get(scope),
  }),
}));
vi.mock("@multica/core/issues/stores/view-store", () => ({ DEFAULT_HIDDEN_STATUSES: ["cancelled"] }));

const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const PROJECT_B = "22222222-2222-4222-8222-222222222222";
const KEY_A = encodeTaskFlowProjectStatusKey(PROJECT_A, "0001");
const KEY_B = encodeTaskFlowProjectStatusKey(PROJECT_B, "0001");

function preference(projectId: string): Preference {
  return {
    scope_type: "project",
    scope_id: projectId,
    prefs: {
      hidden: ["done"],
      order: ["board"],
      preserved_setting: "keep",
      taskflow_project_status_labels: {},
    },
    updated_at: "",
  };
}

function Probe({ projectId, statusKey }: { projectId: string; statusKey: string }) {
  const settings = useTaskFlowProjectStatusSettings();
  const label = settings.statusLabels[statusKey] ?? "unset";
  return (
    <>
      <output data-testid="label">{label}</output>
      <button type="button" onClick={() => void settings.setStatusLabel(statusKey, "Waiting for approval").catch(() => undefined)}>
        Save label
      </button>
      <button type="button" onClick={() => void settings.setStatusVisible(statusKey, false)}>
        Hide status
      </button>
      <button type="button" onClick={() => void settings.setStatusVisible(statusKey, true)}>
        Restore status
      </button>
      <output data-testid="project">{projectId}</output>
    </>
  );
}

function mount(projectId: string, statusKey: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TaskFlowProjectStatusScopeProvider projectId={projectId}>
        <Probe projectId={projectId} statusKey={statusKey} />
      </TaskFlowProjectStatusScopeProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

describe("TaskFlow Project status label persistence", () => {
  beforeEach(() => {
    state.preferences.clear();
    state.preferences.set(PROJECT_A, preference(PROJECT_A));
    state.preferences.set(PROJECT_B, preference(PROJECT_B));
    state.get.mockReset().mockImplementation(async ({ scope_id }: { scope_id: string }) => structuredClone(state.preferences.get(scope_id)));
    state.put.mockReset().mockImplementation(async (input: Preference) => {
      const saved = structuredClone(input);
      state.preferences.set(input.scope_id, saved);
      return saved;
    });
  });

  it("persists same display names independently for two Projects and preserves existing view preferences", async () => {
    const projectA = mount(PROJECT_A, KEY_A);
    await screen.findByRole("button", { name: "Save label" });
    fireEvent.click(screen.getByRole("button", { name: "Save label" }));
    await waitFor(() => expect(state.preferences.get(PROJECT_A)?.prefs.taskflow_project_status_labels).toEqual({ [KEY_A]: "Waiting for approval" }));
    expect(state.put).toHaveBeenLastCalledWith(expect.objectContaining({
      scope_type: "project",
      scope_id: PROJECT_A,
      prefs: expect.objectContaining({ hidden: ["done"], order: ["board"], preserved_setting: "keep" }),
    }));
    fireEvent.click(screen.getByRole("button", { name: "Hide status" }));
    await waitFor(() => expect(state.preferences.get(PROJECT_A)?.prefs.taskflow_hidden_statuses).toContain(KEY_A));
    expect(state.preferences.get(PROJECT_A)?.prefs.taskflow_project_status_labels).toEqual({ [KEY_A]: "Waiting for approval" });
    fireEvent.click(screen.getByRole("button", { name: "Restore status" }));
    await waitFor(() => expect(state.preferences.get(PROJECT_A)?.prefs.taskflow_hidden_statuses).not.toContain(KEY_A));
    projectA.unmount();

    const projectB = mount(PROJECT_B, KEY_B);
    await screen.findByRole("button", { name: "Save label" });
    fireEvent.click(screen.getByRole("button", { name: "Save label" }));
    await waitFor(() => expect(state.preferences.get(PROJECT_B)?.prefs.taskflow_project_status_labels).toEqual({ [KEY_B]: "Waiting for approval" }));
    expect(state.put).toHaveBeenLastCalledWith(expect.objectContaining({ scope_type: "project", scope_id: PROJECT_B }));
    projectB.unmount();

    const refreshedA = mount(PROJECT_A, KEY_A);
    await waitFor(() => expect(screen.getByTestId("label").textContent).toBe("Waiting for approval"));
    refreshedA.unmount();
    const refreshedB = mount(PROJECT_B, KEY_B);
    await waitFor(() => expect(screen.getByTestId("label").textContent).toBe("Waiting for approval"));
    expect(state.preferences.get(PROJECT_A)?.prefs.taskflow_project_status_labels).not.toEqual(
      state.preferences.get(PROJECT_B)?.prefs.taskflow_project_status_labels,
    );
    refreshedB.unmount();
  });

  it("rejects saving a status key owned by another Project", async () => {
    const projectA = mount(PROJECT_A, KEY_B);
    await screen.findByRole("button", { name: "Save label" });
    fireEvent.click(screen.getByRole("button", { name: "Save label" }));
    await waitFor(() => expect(state.put).not.toHaveBeenCalled());
    expect(state.preferences.get(PROJECT_A)?.prefs.taskflow_project_status_labels).toEqual({});
    projectA.unmount();
  });
});
