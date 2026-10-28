// @vitest-environment jsdom

/**
 * TASKFLOW_WORKSPACE_GROUPS: the header project filter submenu is group-local.
 * Rendered-path assertions against the REAL IssueFilterMenu (not the helper):
 *  - human partition lists member-led and unled projects plus "No project";
 *  - ai partition lists only agent-led projects and never "No project";
 *  - without a partition (project detail etc.) the menu is unchanged;
 *  - menu search never brings back projects the partition excludes.
 * Same rule everywhere: real project lead_type, never card fields.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore } from "zustand/vanilla";
import { setApiInstance } from "@multica/core/api";
import type { ApiClient } from "@multica/core/api/client";
import {
  type IssueViewState,
  viewStoreSlice,
} from "@multica/core/issues/stores/view-store";
import { ViewStoreProvider } from "@multica/core/issues/stores/view-store-context";
import type { Project } from "@multica/core/types";
import { renderWithI18n } from "../../test/i18n";
import { IssueFilterMenu } from "./issues-header";

vi.mock("@multica/core/hooks", () => ({
  useWorkspaceId: () => "ws-1",
}));

const MEMBER = { id: "p-member", title: "Human Board", lead_type: "member" } as unknown as Project;
const UNLED = { id: "p-unled", title: "Loose Notes", lead_type: null } as unknown as Project;
const AGENT = { id: "p-agent", title: "Agent Ops", lead_type: "agent" } as unknown as Project;

function renderMenu(projectPartition?: "human" | "ai") {
  setApiInstance({
    listIssueStatuses: async () => ({ statuses: [], categories: [], total: 0 }),
    listProperties: async () => ({ properties: [] }),
    listProjects: async () => ({ projects: [MEMBER, UNLED, AGENT] }),
  } as unknown as ApiClient);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const store = createStore<IssueViewState>()(viewStoreSlice);
  return renderWithI18n(
    <QueryClientProvider client={qc}>
      <ViewStoreProvider store={store}>
        <IssueFilterMenu
          trigger={<button type="button">Filter</button>}
          projectPartition={projectPartition}
        />
      </ViewStoreProvider>
    </QueryClientProvider>,
  );
}

/** Opens the Filter menu, then its Project submenu, and waits for its rows. */
async function openProjectSubmenu() {
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  const trigger = await screen.findByRole("menuitem", { name: /^Project$/ });
  fireEvent.click(trigger);
  await waitFor(() =>
    expect(screen.getByPlaceholderText("Filter...")).toBeInTheDocument(),
  );
  await waitFor(() =>
    expect(screen.getAllByRole("menuitemcheckbox").length).toBeGreaterThan(0),
  );
}

function rowTexts(): string[] {
  return screen
    .queryAllByRole("menuitemcheckbox")
    .map((el) => el.textContent ?? "");
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("IssueFilterMenu project section partition (TASKFLOW_WORKSPACE_GROUPS)", () => {
  it("human lists member-led and unled projects plus No project, never agent-led", async () => {
    renderMenu("human");
    await openProjectSubmenu();
    const rows = rowTexts();
    expect(rows.some((t) => t.includes("No project"))).toBe(true);
    expect(rows.some((t) => t.includes("Human Board"))).toBe(true);
    expect(rows.some((t) => t.includes("Loose Notes"))).toBe(true);
    expect(rows.some((t) => t.includes("Agent Ops"))).toBe(false);
  });

  it("ai lists only agent-led projects and never offers No project", async () => {
    renderMenu("ai");
    await openProjectSubmenu();
    const rows = rowTexts();
    expect(rows.some((t) => t.includes("Agent Ops"))).toBe(true);
    expect(rows.some((t) => t.includes("Human Board"))).toBe(false);
    expect(rows.some((t) => t.includes("Loose Notes"))).toBe(false);
    expect(rows.some((t) => t.includes("No project"))).toBe(false);
  });

  it("without a partition the menu lists every project plus No project", async () => {
    renderMenu(undefined);
    await openProjectSubmenu();
    const rows = rowTexts();
    expect(rows.some((t) => t.includes("No project"))).toBe(true);
    expect(rows.some((t) => t.includes("Human Board"))).toBe(true);
    expect(rows.some((t) => t.includes("Loose Notes"))).toBe(true);
    expect(rows.some((t) => t.includes("Agent Ops"))).toBe(true);
  });

  it("search never brings back projects the partition excludes", async () => {
    renderMenu("ai");
    await openProjectSubmenu();
    fireEvent.change(screen.getByPlaceholderText("Filter..."), {
      target: { value: "board" },
    });
    await waitFor(() =>
      expect(screen.getByText("No results")).toBeInTheDocument(),
    );
    const rows = rowTexts();
    expect(rows.some((t) => t.includes("Human Board"))).toBe(false);
    expect(rows.some((t) => t.includes("Agent Ops"))).toBe(false);
  });
});
