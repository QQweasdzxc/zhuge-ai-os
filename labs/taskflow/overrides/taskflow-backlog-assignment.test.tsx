// Fixed-backlog planning eligibility through the real native picker.
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "@multica/core/i18n/react";
import enIssues from "../../../locales/en/issues.json";
import { AssigneePicker } from "./assignee-picker";

const MEMBERS = [
  { user_id: "user-1", name: "Ada Lovelace", role: "member" },
  { user_id: "user-2", name: "Grace Hopper", role: "member" },
];

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => {
    if (queryKey[0] === "members") return { data: MEMBERS };
    if (queryKey[0] === "agents") return { data: [{ id: "agent-1", name: "CO-01", owner_id: "user-1", permission_mode: "private", runtime_id: "", runtime_bound: false }] };
    return { data: [] };
  },
}));

vi.mock("@multica/core/hooks", () => ({ useWorkspaceId: () => "workspace-1" }));
vi.mock("@multica/core/auth", () => ({ useAuthStore: () => ({ id: "user-1" }) }));
const runtime = vi.hoisted(() => ({ bound: false }));
vi.mock("@multica/core/agents", () => ({ isAgentRuntimeBound: () => runtime.bound }));
const permission = vi.hoisted(() => ({ allowed: true }));
vi.mock("@multica/core/permissions", () => ({
  canAssignAgentToIssue: () => permission,
}));
vi.mock("@multica/core/workspace/hooks", () => ({
  useActorName: () => ({ getActorName: () => "Ada Lovelace" }),
}));
vi.mock("@multica/core/workspace/queries", () => ({
  memberListOptions: () => ({ queryKey: ["members"] }),
  agentListOptions: () => ({ queryKey: ["agents"] }),
  squadListOptions: () => ({ queryKey: ["squads"] }),
  assigneeFrequencyOptions: () => ({ queryKey: ["frequency"] }),
}));
vi.mock("../../../common/actor-avatar", () => ({
  ActorAvatar: () => <span data-testid="actor-avatar" />,
}));


afterEach(() => { cleanup(); permission.allowed = true; runtime.bound = false; });
function renderPicker(issueStatus?: string) {
  const onUpdate = vi.fn();
  render(<I18nProvider locale="en" resources={{ en: { issues: enIssues } }}>
    <AssigneePicker assigneeType={null} assigneeId={null} issueStatus={issueStatus}
      onUpdate={onUpdate} open onOpenChange={() => {}} />
  </I18nProvider>);
  return onUpdate;
}
describe("TaskFlow fixed-backlog inert agent planning", () => {
  it("lets an allowed actor assign unbound agent in exact backlog without runtime", async () => {
    const user = userEvent.setup(); const update = renderPicker("backlog");
    const row = await screen.findByRole("button", { name: /CO-01/ });
    expect(row).not.toBeDisabled(); await user.click(row);
    expect(update).toHaveBeenCalledExactlyOnceWith({ assignee_type: "agent", assignee_id: "agent-1" });
  });
  it.each([undefined, "todo", "in_progress", "done", "custom_backlog", "待規劃", "Backlog", " backlog"])(
    "keeps unbound runtime blocked for status %s", async (status) => {
      const update = renderPicker(status);
      expect(await screen.findByRole("button", { name: /CO-01/ })).toBeDisabled();
      expect(update).not.toHaveBeenCalled();
    });
  it("keeps runtime-bound permitted agents assignable outside backlog", async () => {
    runtime.bound = true; const update = renderPicker("todo");
    const row = await screen.findByRole("button", { name: /CO-01/ });
    expect(row).not.toBeDisabled(); await userEvent.click(row);
    expect(update).toHaveBeenCalledExactlyOnceWith({ assignee_type: "agent", assignee_id: "agent-1" });
  });
  it("does not bypass denied invocation permission even in backlog", async () => {
    permission.allowed = false; const update = renderPicker("backlog");
    expect(await screen.findByRole("button", { name: /CO-01/ })).toBeDisabled();
    expect(update).not.toHaveBeenCalled();
  });
});
