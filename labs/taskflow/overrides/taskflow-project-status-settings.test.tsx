import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TaskFlowProjectStatusSettings } from "./taskflow-project-status-settings";

const state = vi.hoisted(() => ({
  projectId: "11111111-1111-4111-8111-111111111111",
  ownedKey: "p00000000000000000000000000_0001",
  hidden: ["cancelled"] as string[],
  save: vi.fn().mockResolvedValue(undefined),
  setVisible: vi.fn().mockResolvedValue(undefined),
  create: vi.fn().mockResolvedValue({ key: "project_status" }),
  update: vi.fn().mockResolvedValue(undefined),
  statuses: [
    ...["backlog", "todo", "in_progress", "in_review", "done", "blocked", "cancelled"].map((key) => ({
      id: `system-${key}`,
      key,
      name: key,
      is_system: true,
      category: "unstarted",
    })),
    {
      id: "custom-status-1",
      key: "p00000000000000000000000000_0001",
      name: "Waiting for vendor",
      is_system: false,
      category: "started",
    },
  ],
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: [{ user_id: "user-1", role: "owner" }] }),
}));
vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("@multica/core/auth", () => ({
  useAuthStore: (selector: (value: { user: { id: string } }) => unknown) => selector({ user: { id: "user-1" } }),
}));
vi.mock("@multica/core/workspace/queries", () => ({ memberListOptions: () => ({ queryKey: ["members"] }) }));
vi.mock("@multica/core/issue-statuses/hooks", () => ({
  useIssueStatuses: () => ({ statuses: state.statuses, activeStatuses: state.statuses }),
}));
vi.mock("@multica/core/issue-statuses/mutations", () => ({
  useCreateIssueStatus: () => ({ mutateAsync: state.create, isPending: false }),
  useUpdateIssueStatus: () => ({ mutateAsync: state.update, isPending: false }),
}));
vi.mock("@multica/core/issue-statuses/taskflow-project-status-scope", () => ({
  useTaskFlowProjectStatusSettings: () => ({
    projectId: state.projectId,
    hiddenStatusKeys: state.hidden,
    isLoading: false,
    saveHiddenStatusKeys: state.save,
    setStatusVisible: state.setVisible,
  }),
  createTaskFlowProjectStatusKey: () => "p00000000000000000000000000_0002",
  taskFlowProjectIdFromStatusKey: (key: string) => key === state.ownedKey ? state.projectId : null,
}));
vi.mock("../../i18n", () => ({
  useT: () => ({
    t: (resolve: (value: any) => unknown, params?: Record<string, string>) => {
      const messages = {
        taskflow_project_status: {
          button: "Project statuses",
          title: "Project statuses and fields",
          description: "Project-only settings. Hidden columns can be restored without deleting tasks.",
          fields: "Project status fields",
          visibility: "Show {{name}} status column",
          built_in: "Built-in",
          new_status: "New status name",
          edit_status: "Edit status name",
          save_status: "Save status name",
          cancel_edit: "Cancel editing",
          category: "Status category",
          categories: { unstarted: "Not started", started: "In progress", done: "Completed", closed: "Closed" },
          add: "Add status",
          admin_required: "Owner or admin only",
          restore_defaults: "Restore default columns",
          done: "Done",
          save_failed: "Save failed",
        },
      };
      const value = resolve(messages);
      return typeof value === "string" && params
        ? value.replace("{{name}}", params.name ?? "")
        : value;
    },
  }),
}));
vi.mock("@multica/ui/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));
vi.mock("@multica/ui/components/ui/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));
vi.mock("@multica/ui/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <>{children}</> : null,
  DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <section role="dialog" className={className}>{children}</section>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));
vi.mock("@multica/ui/components/ui/select", () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
  SelectValue: () => <span />,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("TaskFlow project status controls", () => {
  beforeEach(() => {
    state.hidden = ["cancelled"];
    state.save.mockClear();
    state.setVisible.mockClear();
    state.create.mockClear();
    state.update.mockClear();
  });

  it("shows the settings in a project-scoped mobile-safe dialog and saves visibility per project", () => {
    render(<TaskFlowProjectStatusSettings projectId={state.projectId} />);
    fireEvent.click(screen.getByTestId("taskflow-project-status-settings"));
    expect(screen.getByRole("dialog").className).toContain("max-h-[85dvh]");
    expect(screen.getAllByRole("checkbox")).toHaveLength(8);
    expect(screen.getByText(/Hidden columns can be restored without deleting tasks/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show done status column" }));
    expect(state.setVisible).toHaveBeenCalledWith("done", false);
  });

  it("edits only a Project-owned custom status through the native status mutation", async () => {
    render(<TaskFlowProjectStatusSettings projectId={state.projectId} />);
    fireEvent.click(screen.getByTestId("taskflow-project-status-settings"));
    fireEvent.click(screen.getByRole("button", { name: "Edit status name" }));
    const input = screen.getByRole("textbox", { name: "Edit status name" });
    fireEvent.change(input, { target: { value: "Waiting for review" } });
    fireEvent.click(screen.getByRole("button", { name: "Save status name" }));
    expect(state.update).toHaveBeenCalledWith({ id: "custom-status-1", name: "Waiting for review" });
  });

  it("creates a namespaced custom status without changing its native category", () => {
    render(<TaskFlowProjectStatusSettings projectId={state.projectId} />);
    fireEvent.click(screen.getByTestId("taskflow-project-status-settings"));
    fireEvent.change(screen.getByRole("textbox", { name: "New status name" }), {
      target: { value: "Waiting for purchase" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add status" }));
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({
      key: "p00000000000000000000000000_0002",
      name: "Waiting for purchase",
      category: "started",
    }));
  });

  it("does not render when routed Project context differs", () => {
    render(<TaskFlowProjectStatusSettings projectId="22222222-2222-4222-8222-222222222222" />);
    expect(screen.queryByTestId("taskflow-project-status-settings")).toBeNull();
  });

  it("restores defaults without deleting statuses or issue data", () => {
    render(<TaskFlowProjectStatusSettings projectId={state.projectId} />);
    fireEvent.click(screen.getByTestId("taskflow-project-status-settings"));
    fireEvent.click(screen.getByRole("button", { name: "Restore default columns" }));
    expect(state.save).toHaveBeenCalledWith(null);
    expect(state.create).not.toHaveBeenCalled();
  });
});
