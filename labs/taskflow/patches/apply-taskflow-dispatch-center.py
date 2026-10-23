"""Install the native Workspace dispatch center into a temporary build copy."""
import argparse
import json
from pathlib import Path

AI_NAVIGATION_HELPERS = '''const TASKFLOW_AI_EXECUTORS = ["CO-01", "CO-02", "CO-03", "GEM-01", "GH-HELPER"] as const;
const TASKFLOW_AI_MAPPING_SCHEMA = "taskflow-native-executor-project-mapping-v1";
const TASKFLOW_AI_MAPPING_SOURCE = "TASKFLOW_NATIVE_EXECUTOR_REGISTRY";
const TASKFLOW_AI_PROJECT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function resolveTaskFlowAiProjectMappings(value: unknown, workspaceId: string) {
  const envelope = value as { schema?: unknown; source?: unknown; workspace_id?: unknown; checked_at?: unknown; mappings?: unknown } | null;
  if (!envelope || envelope.schema !== TASKFLOW_AI_MAPPING_SCHEMA || envelope.source !== TASKFLOW_AI_MAPPING_SOURCE || envelope.workspace_id !== workspaceId || !Array.isArray(envelope.mappings)) {
    throw new Error("原生 Executor／Project Mapping 回應不完整或 Workspace 不一致");
  }
  const checkedAt = Date.parse(String(envelope.checked_at ?? ""));
  if (!Number.isFinite(checkedAt) || checkedAt > Date.now() || Date.now() - checkedAt > 5 * 60 * 1000) {
    throw new Error("原生 Project Mapping 已過期，請重新讀取");
  }
  const rows = envelope.mappings as Array<Record<string, unknown>>;
  const resolved = TASKFLOW_AI_EXECUTORS.map((executorId) => {
    const matches = rows.filter((row) => row?.executor_id === executorId);
    if (matches.length !== 1) return { executorId, projectId: "", title: "", verified: false, reason: "MISSING_OR_DUPLICATE_EXECUTOR_MAPPING" };
    const row = matches[0]!;
    const verified = row.state === "VERIFIED" && row.source === TASKFLOW_AI_MAPPING_SOURCE && row.workspace_id === workspaceId && row.workspace_access === "ALLOW" && row.project_access === "ALLOW" && typeof row.project_id === "string" && TASKFLOW_AI_PROJECT_UUID.test(row.project_id) && typeof row.project_title === "string" && Boolean(row.project_title.trim());
    return { executorId, projectId: verified ? String(row.project_id) : "", title: verified ? String(row.project_title) : "", verified, reason: verified ? "" : String(row.reason || "NATIVE_PROJECT_OR_ACL_UNVERIFIED") };
  });
  const projectCounts = new Map<string, number>();
  for (const row of resolved) if (row.verified) projectCounts.set(row.projectId.toLowerCase(), (projectCounts.get(row.projectId.toLowerCase()) || 0) + 1);
  return resolved.map((row) => row.verified && projectCounts.get(row.projectId.toLowerCase()) !== 1 ? { ...row, projectId: "", title: "", verified: false, reason: "DUPLICATE_NATIVE_PROJECT_BINDING" } : row);
}
function tryResolveTaskFlowAiProjectMappings(value: unknown, workspaceId: string) {
  try { return { rows: resolveTaskFlowAiProjectMappings(value, workspaceId), invalid: false }; }
  catch { return { rows: [], invalid: true }; }
}

'''

def replace(source, marker, value, label="Dispatch center upstream drift"):
    if source.count(marker) != 1:
        raise ValueError(f"{label}: expected one marker, found {source.count(marker)}: {marker[:80]}")
    return source.replace(marker, value, 1)

def apply(root, overlays, logic):
    paths = root / "packages/core/paths/paths.ts"
    if "aiDispatch:" in paths.read_text():
        raise ValueError("Dispatch center already applied")
    paths.write_text(replace(paths.read_text(), '    agents: () => `${ws}/agents`,', '    aiDispatch: () => `${ws}/ai-dispatch`,\n    aiTasks: () => `${ws}/ai-tasks`,\n    agents: () => `${ws}/agents`,'))
    client = root / "packages/core/api/client.ts"
    client.write_text(replace(client.read_text(), '  // Issues\n', '''  // TASKFLOW_DISPATCH_READBACK: existing authenticated native transport.
  async getDispatchRuntime(id: string, workspaceSlug: string): Promise<unknown> {
    return this.fetch<unknown>(`/api/issues/${encodeURIComponent(id)}/dispatch-runtime`, {
      headers: { "X-Workspace-Slug": workspaceSlug },
    });
  }

  async getZhugeAIProjectMappings(workspaceSlug: string): Promise<unknown> {
    return this.fetch<unknown>(`/api/zhuge/ai/project-mappings`, {
      headers: { "X-Workspace-Slug": workspaceSlug },
    });
  }

  async listZhugeAITasks(workspaceSlug: string, params: { limit?: number; offset?: number } = {}): Promise<unknown> {
    const query = new URLSearchParams();
    if (params.limit !== undefined) query.set("limit", String(params.limit));
    if (params.offset !== undefined) query.set("offset", String(params.offset));
    const encoded = query.toString();
    const suffix = encoded ? `?${encoded}` : "";
    return this.fetch<unknown>(`/api/zhuge/ai/tasks${suffix}`, {
      headers: { "X-Workspace-Slug": workspaceSlug },
    });
  }

  // Issues
'''))
    sidebar = root / "packages/views/layout/app-sidebar.tsx"
    sidebar_text = sidebar.read_text()
    if "TASKFLOW_NATIVE_AI_WORK_NAV_SLOT" not in sidebar_text:
        raise ValueError("Native AI navigation slot is missing; project navigation overlay must run first")
    sidebar_text = replace(sidebar_text, 'import { Layers,\n', 'import { Bot, Layers, ListTodo,\n', "AI navigation icons")
    sidebar_text = replace(sidebar_text, 'const NAV_ITEM_CLASS_NAME =\n', AI_NAVIGATION_HELPERS + 'const NAV_ITEM_CLASS_NAME =\n', "AI executor mapping verifier")
    sidebar_text = replace(sidebar_text, 'const { data: workspaceProjects = EMPTY_PROJECTS } = useQuery({', '''const [aiDispatchExpandedOverride, setAiDispatchExpandedOverride] = useState<boolean | null>(null);
  const aiDispatchExpanded = aiDispatchExpandedOverride ?? !isMobile;
  const aiProjectMappingQuery = useQuery({
    queryKey: ["taskflow-native-executor-project-mappings", wsId, workspace?.slug],
    queryFn: () => api.getZhugeAIProjectMappings(workspace?.slug ?? ""),
    enabled: Boolean(wsId && workspace?.slug), retry: false, staleTime: 30_000,
  });
  const aiProjectMappingResult = wsId && aiProjectMappingQuery.data && !aiProjectMappingQuery.isError
    ? tryResolveTaskFlowAiProjectMappings(aiProjectMappingQuery.data, wsId)
    : { rows: [], invalid: false };
  const aiProjectMappings = aiProjectMappingResult.rows;
  const AutomationIcon = routeIconForPath(p.autopilots());
  const { data: workspaceProjects = EMPTY_PROJECTS } = useQuery({''', "AI project mapping readback")
    nav_slot = '''                {/* TASKFLOW_NATIVE_AI_WORK_NAV_SLOT */}'''
    nav_items = '''                <SidebarMenuItem>
                  <Collapsible open={aiDispatchExpanded} onOpenChange={(open) => setAiDispatchExpandedOverride(open)}>
                    <div className="flex min-w-0 items-center gap-1">
                      <SidebarMenuButton
                        isActive={!isActivePinnedRoute && (pathname === p.aiDispatch() || aiProjectMappings.some((row) => row.verified && isNavActive(pathname, p.projectDetail(row.projectId))))}
                        render={<AppLink href={p.aiDispatch()} />}
                        className={cn(NAV_ITEM_CLASS_NAME, "min-w-0 flex-1")}
                      >
                        <Layers /><span>AI 派工中心</span>
                      </SidebarMenuButton>
                      <CollapsibleTrigger
                        type="button"
                        data-testid="ai-dispatch-navigation-toggle"
                        aria-label="展開或收合 AI 派工中心"
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
                      >
                        <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform", aiDispatchExpanded && "rotate-90")} />
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <SidebarMenu className="ml-3 mt-0.5 gap-0.5 border-l border-sidebar-border pl-1 pr-1">
                        {TASKFLOW_AI_EXECUTORS.map((executorId) => {
                          const mapping = aiProjectMappings.find((row) => row.executorId === executorId);
                          const projectHref = mapping?.verified ? p.projectDetail(mapping.projectId) : undefined;
                          const status = aiProjectMappingQuery.isPending ? "讀取中" : aiProjectMappingQuery.isError || aiProjectMappingResult.invalid ? "讀取失敗" : projectHref ? "原生專案" : "尚未接通";
                          return (
                            <SidebarMenuItem key={executorId}>
                              <SidebarMenuButton
                                disabled={!projectHref}
                                isActive={Boolean(projectHref && !isActivePinnedRoute && isNavActive(pathname, projectHref))}
                                render={projectHref ? <AppLink href={projectHref} /> : undefined}
                                size="sm"
                                aria-label={`${executorId} — ${status}`}
                                className={cn(NAV_ITEM_CLASS_NAME, "min-w-0")}
                              >
                                <Bot /><span className="min-w-0 truncate">{executorId}</span>
                                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{status}</span>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          );
                        })}
                      </SidebarMenu>
                    </CollapsibleContent>
                  </Collapsible>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={!isActivePinnedRoute && isNavActive(pathname, p.aiTasks())} render={<AppLink href={p.aiTasks()} />} className={NAV_ITEM_CLASS_NAME}>
                    <ListTodo /><span>AI 任務</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={!isActivePinnedRoute && isNavActive(pathname, p.autopilots())} render={<AppLink href={p.autopilots()} />} className={NAV_ITEM_CLASS_NAME}>
                    <AutomationIcon /><span>{t(($) => $.nav.autopilots)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>'''
    sidebar_text = replace(sidebar_text, nav_slot, nav_items, "Work group native AI navigation")
    # Stats and Settings belong to AI Team in the PM-approved hierarchy; keep Runtime as an existing item.
    sidebar_text = replace(sidebar_text,
      'const aiTeamNav: { key: NavKey; labelKey: NavLabelKey }[] = [\n  { key: "agents", labelKey: "agents" },\n  { key: "squads", labelKey: "squads" },\n  { key: "skills", labelKey: "skills" },\n  { key: "runtimes", labelKey: "runtimes" },\n];',
      'const aiTeamNav: { key: NavKey; labelKey: NavLabelKey }[] = [\n  { key: "agents", labelKey: "agents" },\n  { key: "squads", labelKey: "squads" },\n  { key: "skills", labelKey: "skills" },\n  { key: "usage", labelKey: "usage" },\n  { key: "settings", labelKey: "settings" },\n  { key: "runtimes", labelKey: "runtimes" },\n];', "AI Team existing navigation")
    sidebar_text = replace(sidebar_text,
      'const utilityNav: { key: NavKey; labelKey: NavLabelKey }[] = [\n  { key: "usage", labelKey: "usage" },\n  { key: "settings", labelKey: "settings" },\n];',
      'const utilityNav: { key: NavKey; labelKey: NavLabelKey }[] = [];', "avoid duplicate Stats and Settings")
    sidebar_text = replace(sidebar_text,
      '<span>{t(($) => $.nav[item.labelKey])}</span>\n                      </SidebarMenuButton>\n                    </SidebarMenuItem>\n                  );\n                })}\n              </SidebarMenu>\n            </SidebarGroupContent>\n          </SidebarGroup>\n        </SidebarContent>',
      '<span>{item.key === "usage" ? "統計" : t(($) => $.nav[item.labelKey])}</span>\n                      </SidebarMenuButton>\n                    </SidebarMenuItem>\n                  );\n                })}\n              </SidebarMenu>\n            </SidebarGroupContent>\n          </SidebarGroup>\n        </SidebarContent>', "Stats label in AI Team")
    sidebar.write_text(sidebar_text)
    sidebar_test = root / "packages/views/layout/app-sidebar.test.tsx"
    if sidebar_test.exists():
        test_text = replace(sidebar_test.read_text(), '    agents: () => "/acme/agents",', '    aiDispatch: () => "/acme/ai-dispatch",\n    aiTasks: () => "/acme/ai-tasks",\n    agents: () => "/acme/agents",')
        test_text = replace(test_text, 'expect(container.querySelector(\'button[data-href="/acme/autopilots"]\')).toBeNull();', 'expect(container.querySelector(\'button[data-href="/acme/autopilots"]\')).toBeInTheDocument();', "preserve native Automations nav in final build")
        marker = '\ndescribe("Pending invitation self-heal", () => {'
        suite = '''
describe("TaskFlow native AI navigation", () => {
  beforeEach(() => {
    taskflowNav.workspace.current = { id: "ws-1", name: "Acme", slug: "acme" };
    taskflowNav.mobile.current = false;
    navigation.current.pathname = "/acme/issues";
  });

  it("places the dispatch overview and five Executor children before AI Tasks and Automations", () => {
    const { container } = render(<AppSidebar />);
    expect(container.querySelector('button[data-href="/acme/ai-dispatch"]')).toBeInTheDocument();
    expect(container.querySelector('button[data-href="/acme/ai-tasks"]')).toBeInTheDocument();
    expect(container.querySelector('button[data-href="/acme/autopilots"]')).toBeInTheDocument();
    for (const executor of ["CO-01", "CO-02", "CO-03", "GEM-01", "GH-HELPER"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${executor} —`) })).toBeInTheDocument();
    }
    expect(container.querySelector('button[data-href="/acme/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]')).toBeInTheDocument();
    for (const executor of ["CO-01", "CO-02", "GEM-01", "GH-HELPER"]) {
      expect(screen.getByRole("button", { name: `${executor} — 尚未接通` })).toBeDisabled();
    }
    expect(screen.getByText("統計")).toBeInTheDocument();
    expect(container.querySelector('button[data-href="/acme/settings"]')).toBeInTheDocument();
    const hrefs = Array.from(container.querySelectorAll<HTMLButtonElement>("button[data-href]")).map((button) => button.dataset.href);
    const requestedWorkOrder = ["/acme/projects", "/acme/issues", "/acme/ai-dispatch", "/acme/ai-tasks", "/acme/autopilots"];
    const workPositions = requestedWorkOrder.map((href) => hrefs.indexOf(href));
    expect(workPositions.every((position) => position >= 0)).toBe(true);
    expect(workPositions).toEqual([...workPositions].sort((left, right) => left - right));
    const requestedTeamOrder = ["/acme/agents", "/acme/squads", "/acme/skills", "/acme/usage", "/acme/settings"];
    const teamPositions = requestedTeamOrder.map((href) => hrefs.indexOf(href));
    expect(teamPositions).toEqual([...teamPositions].sort((left, right) => left - right));
  });

  it("collapses the Executor list by default on mobile and keeps unverified entries non-navigable", () => {
    taskflowNav.mobile.current = true;
    const { container } = render(<AppSidebar />);
    const toggle = screen.getByTestId("ai-dispatch-navigation-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /^CO-01 —/ })).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "CO-01 — 尚未接通" })).toBeDisabled();
    for (const executor of ["CO-01", "CO-02", "GEM-01", "GH-HELPER"]) {
      expect(screen.getByRole("button", { name: `${executor} — 尚未接通` })).toBeDisabled();
    }
    expect(container.querySelector('button[data-href="/acme/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]')).toBeInTheDocument();
  });

  it("rejects duplicate Native Project IDs even when both rows claim verification", () => {
    const data = taskflowNav.aiMappingsByWorkspace["ws-1"] as { mappings: Array<Record<string, unknown>> };
    const priorMapping = data.mappings[4];
    try {
      data.mappings[4] = { ...priorMapping, state: "VERIFIED", project_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", project_title: "Repeated Project", workspace_access: "ALLOW", project_access: "ALLOW" };
      const { container } = render(<AppSidebar />);
      expect(container.querySelector('button[data-href="/acme/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]')).toBeNull();
      expect(screen.getByRole("button", { name: "CO-03 — 尚未接通" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "GH-HELPER — 尚未接通" })).toBeDisabled();
    } finally {
      data.mappings[4] = priorMapping;
    }
  });

  it("selects mappings for the active Workspace and never retains another Workspace project", () => {
    const { container, rerender } = render(<AppSidebar />);
    expect(container.querySelector('button[data-href="/acme/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]')).toBeInTheDocument();
    taskflowNav.workspace.current = { id: "ws-2", name: "QA", slug: "qa" };
    navigation.current.pathname = "/qa/projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    rerender(<AppSidebar />);
    expect(container.querySelector('button[data-href="/qa/projects/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]')).toBeInTheDocument();
    expect(container.querySelector('button[data-href="/acme/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]')).toBeNull();
  });
});
'''
        sidebar_test.write_text(replace(test_text, marker, suite + marker, "AI navigation interaction tests"))
    common = root / "packages/views/common"
    for name in ("taskflow-dispatch-center.tsx", "taskflow-dispatch-center.test.tsx", "taskflow-dispatch-logic.d.mts"):
        (common / name).write_text((overlays / name).read_text())
    (common / "taskflow-dispatch-logic.mjs").write_text(logic.read_text())
    package = root / "packages/views/package.json"
    data = json.loads(package.read_text())
    data["exports"]["./common/taskflow-dispatch-center"] = "./common/taskflow-dispatch-center.tsx"
    package.write_text(json.dumps(data, indent=2) + "\n")
    route = root / "apps/web/app/[workspaceSlug]/(dashboard)/ai-dispatch/page.tsx"
    route.parent.mkdir(parents=True, exist_ok=True)
    route.write_text('import { TaskFlowDispatchCenter } from "@multica/views/common/taskflow-dispatch-center";\nexport default function DispatchRoute() { return <TaskFlowDispatchCenter />; }\n')
    tasks_route = root / "apps/web/app/[workspaceSlug]/(dashboard)/ai-tasks/page.tsx"
    tasks_route.parent.mkdir(parents=True, exist_ok=True)
    tasks_route.write_text('import { TaskFlowNativeAITasks } from "@multica/views/common/taskflow-dispatch-center";\nexport default function NativeAITasksRoute() { return <TaskFlowNativeAITasks />; }\n')
    issue = common / "taskflow-ai-engineering.tsx"
    text = replace(issue.read_text(), 'import { useState } from "react";', 'import { useState } from "react";\nimport { TaskFlowDispatchRuntime } from "./taskflow-dispatch-center";')
    issue.write_text(replace(text, '      <div className="space-y-2">', '      <TaskFlowDispatchRuntime issueId={issueId} />\n      <div className="space-y-2">'))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--overlays", type=Path, required=True)
    parser.add_argument("--logic", type=Path, required=True)
    args = parser.parse_args()
    apply(args.root, args.overlays, args.logic)
