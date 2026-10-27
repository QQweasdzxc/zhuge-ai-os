"""Install the AI native dual entries (派工中心 / 任務中心) into a temporary build copy.

Runs AFTER apply-taskflow-dispatch-center.py. Reuses the native ProjectsPage
(leadKind/pageKey) and the native IssueSurface (actorKind agents);
no parallel task store, no self-made kanban.
"""
import argparse
import json
from pathlib import Path

def replace(source, marker, value, count=1):
    if source.count(marker) != count:
        raise ValueError(f"AI native views upstream drift ({source.count(marker)}x): {marker[:80]}")
    return source.replace(marker, value)

def patch_backlog_assignment(root, overlays):
    """Allow inert planning only for the fixed native backlog key.

    This does not grant invocation access. The existing owner/invocation
    decision remains mandatory, and all server execution gates stay unchanged.
    Unknown status and mixed batches deliberately retain the runtime gate.
    """
    picker = root / "packages/views/issues/components/pickers/assignee-picker.tsx"
    source = picker.read_text()
    source = replace(source, "  mixed?: boolean;", "  mixed?: boolean;\n  /** Fixed native status only; omitted/mixed remains execution-gated. */\n  issueStatus?: string;")
    source = replace(source, "  mixed = false,", "  mixed = false,\n  issueStatus,")
    source = replace(source, "const allowed = decision.allowed && runtimeBound;", 'const allowed = decision.allowed && (issueStatus === "backlog" || runtimeBound);')
    source = replace(source, ": !runtimeBound\n", ': !runtimeBound && issueStatus !== "backlog"\n')
    # Squads intentionally keep their existing runtime requirement. This change
    # is only native agent planning; it adds no new squad routing semantics.
    picker.write_text(source)
    # Manual drafts can select an inert agent in backlog and later change
    # status. Clear that stale assignment on promotion; submit-time recheck also
    # covers restored drafts/shortcuts. Cache-missing agents fail closed.
    draft = root / "packages/views/modals/create-issue.tsx"
    source = draft.read_text()
    source = replace(source, 'import { issueStatusCategory }', 'import { agentListOptions } from "@multica/core/workspace/queries";\nimport { isAgentRuntimeBound } from "@multica/core/agents";\nimport type { Agent } from "@multica/core/types";\nimport { issueStatusCategory }')
    source = replace(source,
        '  const updateStatus = (v: IssueStatus) => { setStatus(v); setManual({ status: v }); };',
        """  const manualAgentReady = (nextStatus: string) => {
    if (nextStatus === "backlog" || assigneeType !== "agent") return true;
    const agents = queryClient.getQueryData<Agent[]>(agentListOptions(wsId).queryKey);
    const target = agents?.find((agent) => agent.id === assigneeId && !agent.archived_at);
    return !!target && isAgentRuntimeBound(target);
  };
  const updateStatus = (v: IssueStatus) => {
    setStatus(v);
    if (!manualAgentReady(v)) {
      setAssigneeType(undefined); setAssigneeId(undefined);
      setManual({ status: v, assigneeType: undefined, assigneeId: undefined });
      toast.error(t(($) => $.create_issue.planning_assignment_cleared));
      return;
    }
    setManual({ status: v });
  };""")
    source = replace(source,
        '    onSubmit: async (): Promise<boolean> => {\n      setUnavailablePropertyRemoved(false);',
        '    onSubmit: async (): Promise<boolean> => {\n      if (!manualAgentReady(status)) {\n        toast.error(t(($) => $.create_issue.planning_runtime_unverified));\n        return false;\n      }\n      setUnavailablePropertyRemoved(false);')
    draft.write_text(source)
    messages = {
        "en": ("Agent runtime could not be verified; assignment cleared. Keep planning work in backlog.", "Agent runtime could not be verified. Keep work in backlog or remove the assignment."),
        "zh-Hant": ("無法確認此 Agent 的執行時，已取消指派；規劃工作可保留在待規劃。", "無法確認此 Agent 的執行時。請改為待規劃或取消指派。"),
        "zh-Hans": ("无法确认此 Agent 的运行时，已取消分配；规划工作可保留在待规划。", "无法确认此 Agent 的运行时。请改为待规划或取消分配。"),
        "ja": ("Agent のランタイムを確認できないため、割り当てを解除しました。計画中の作業はバックログに残せます。", "Agent のランタイムを確認できません。バックログに戻すか、割り当てを解除してください。"),
        "fr": ("Impossible de vérifier le runtime de cet agent ; affectation supprimée. Gardez le travail de planification dans le backlog.", "Impossible de vérifier le runtime de cet agent. Gardez le travail dans le backlog ou supprimez l’affectation."),
    }
    for locale, (cleared, unverified) in messages.items():
        path = root / "packages/views/locales" / locale / "modals.json"
        if not path.exists():
            continue  # zh-Hant is present after its owning locale overlay.
        data = json.loads(path.read_text())
        data["create_issue"]["planning_assignment_cleared"] = cleared
        data["create_issue"]["planning_runtime_unverified"] = unverified
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    (root / "packages/views/issues/components/pickers/taskflow-backlog-assignment.test.tsx").write_text((overlays / "taskflow-backlog-assignment.test.tsx").read_text())
    for relative, actor in [
        ("modals/create-issue.tsx", "draft"),
        ("issues/components/issue-property-pills.tsx", "issue"),
        ("issues/components/board-card.tsx", "issue"),
        ("issues/components/issue-detail.tsx", "detail"),
        ("issues/components/table-view.tsx", "issue"),
        ("issues/actions/issue-actions-dropdown.tsx", "issue"),
        ("issues/actions/issue-actions-context-menu.tsx", "issue"),
        ("issues/components/batch-action-toolbar.tsx", "batch"),
    ]:
        path = root / "packages/views" / relative
        source = path.read_text()
        if actor == "detail":
            source = replace(source, "<AssigneePicker\n", "<AssigneePicker\n            issueStatus={child.status}\n")
            source = replace(source, "<AssigneePicker assigneeType={issue.assignee_type}", "<AssigneePicker issueStatus={issue.status} assigneeType={issue.assignee_type}")
        else:
            value = {"draft": "status", "issue": "issue.status", "batch": 'selectedIssues.length > 0 && selectedIssues.every((issue) => issue.status === "backlog") ? "backlog" : undefined'}[actor]
            source = replace(source, "<AssigneePicker\n", "<AssigneePicker\n                  issueStatus={" + value + "}\n")
        path.write_text(source)
    batch_test = root / "packages/views/issues/components/batch-action-toolbar.test.tsx"
    source = batch_test.read_text()
    source = replace(source, "    mixed,\n", "    mixed,\n    issueStatus,\n")
    source = replace(source, "    mixed?: boolean;", "    mixed?: boolean;\n    issueStatus?: string;")
    source = replace(source, '      data-testid="assignee-picker"', '      data-testid="assignee-picker"\n      data-issue-status={issueStatus ?? "__unknown__"}')
    source += """
// A mixed status batch must not inherit backlog's no-runtime exception.
describe("TaskFlow batch planning eligibility", () => {
  it.each([
    ["backlog", "backlog", "backlog"],
    ["backlog", "todo", "__unknown__"],
    ["custom_backlog", "custom_backlog", "__unknown__"],
  ])("passes exact selection status %s / %s", (a, b, expected) => {
    selection.selectedIds = new Set(["a", "b"]);
    render(<BatchActionToolbar issues={[makeIssue({id:"a",status:a}),makeIssue({id:"b",status:b})]} />);
    expect(screen.getByTestId("assignee-picker")).toHaveAttribute("data-issue-status", expected);
  });
});
"""
    batch_test.write_text(source)
    draft_test = root / "packages/views/modals/create-issue.test.tsx"
    source = draft_test.read_text()
    source = replace(source, '  StatusPicker: () => <div data-testid="status-picker" />,',
        '  StatusPicker: ({onUpdate}: {onUpdate: (u: {status: string}) => void}) => <button data-testid="status-picker" onClick={() => onUpdate({status:"todo"})}>Promote draft</button>,')
    source = replace(source, 'describe("CreateIssueModal", () => {', 'describe("CreateIssueModal", () => {\n  it("blocks a restored active draft with an unbound or unknown agent at submit", async () => {\n    mockDraftStore.draft.manual.assigneeType = "agent";\n    mockDraftStore.draft.manual.assigneeId = "inert-agent";\n    renderModal(<CreateIssueModal onClose={vi.fn()} />);\n    fireEvent.change(screen.getByPlaceholderText("Issue title"), {target:{value:"inert active draft"}});\n    await userEvent.click(screen.getByRole("button", {name:"Create Issue"}));\n    expect(mockCreateIssue).not.toHaveBeenCalled();\n    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining("backlog"));\n  });\n  it("clears inert assignment when a backlog draft is promoted", async () => {\n    mockDraftStore.draft.manual.status = "backlog" as never;\n    mockDraftStore.draft.manual.assigneeType = "agent";\n    mockDraftStore.draft.manual.assigneeId = "inert-agent";\n    renderModal(<CreateIssueModal onClose={vi.fn()} />);\n    await userEvent.click(screen.getByTestId("status-picker"));\n    expect(mockSetManual).toHaveBeenCalledWith({status:"todo",assigneeType:undefined,assigneeId:undefined});\n    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining("assignment cleared"));\n  });')
    draft_test.write_text(source)

def apply(root, overlays):
    patch_backlog_assignment(root, overlays)
    # A. Routes in the native path helper.
    paths = root / "packages/core/paths/paths.ts"
    paths.write_text(replace(paths.read_text(),
        '    aiDispatch: () => `${ws}/ai-dispatch`,',
        '    aiDispatch: () => `${ws}/ai-dispatch`,\n'
        '    aiDispatchConsole: () => `${ws}/ai-dispatch/console`,\n'
        '    aiTasks: () => `${ws}/ai-tasks`,'))

    # B. Sidebar: icons + two native entries; the old console demoted to a link.
    sidebar = root / "packages/views/layout/app-sidebar.tsx"
    sidebar.write_text(replace(sidebar.read_text(),
        'import { Layers,',
        'import { Layers, ListTodo, BarChart3,'))
    sidebar.write_text(replace(sidebar.read_text(),
        '                    <Layers /><span>AI 派工中心</span>\n'
        '                  </SidebarMenuButton>\n'
        '                </SidebarMenuItem>\n',
        '                    <Layers /><span>AI 派工中心</span>\n'
        '                  </SidebarMenuButton>\n'
        '                </SidebarMenuItem>\n'
        '                {/* TASKFLOW_NATIVE_AI_TASKS: native issues module scoped to AI agents. */}\n'
        '                <SidebarMenuItem>\n'
        '                  <SidebarMenuButton isActive={isNavActive(pathname, p.aiTasks())}\n'
        '                    render={<AppLink href={p.aiTasks()} />} className={NAV_ITEM_CLASS_NAME}>\n'
        '                    <ListTodo /><span>AI 任務中心</span>\n'
        '                  </SidebarMenuButton>\n'
        '                </SidebarMenuItem>\n'
        '                {/* TASKFLOW_DISPATCH_CONSOLE_DEMOTED: statistics/PM Inbox/Provider are auxiliary. */}\n'
        '                <SidebarMenuItem>\n'
        '                  <SidebarMenuButton isActive={isNavActive(pathname, p.aiDispatchConsole())}\n'
        '                    render={<AppLink href={p.aiDispatchConsole()} />} className={NAV_ITEM_CLASS_NAME}>\n'
        '                    <BarChart3 /><span>派工統計</span>\n'
        '                  </SidebarMenuButton>\n'
        '                </SidebarMenuItem>\n'))

    # B2. Sidebar test mock: cover the new path helpers (also backfills the
    # dispatch-center console entry, whose mock key was never added).
    sidebar_test = root / "packages/views/layout/app-sidebar.test.tsx"
    sidebar_test.write_text(replace(sidebar_test.read_text(),
        '    aiDispatch: () => "/acme/ai-dispatch",\n',
        '    aiDispatch: () => "/acme/ai-dispatch",\n'
        '    aiDispatchConsole: () => "/acme/ai-dispatch/console",\n'
        '    aiTasks: () => "/acme/ai-tasks",\n'))

    # C. Project view store: factory + keyed instances (human page key unchanged).
    store = root / "packages/core/projects/stores/view-store.ts"
    store.write_text(replace(store.read_text(),
        'export const useProjectViewStore = create<ProjectViewState>()(',
        'function createProjectViewStore(persistName: string) {\n  return create<ProjectViewState>()('))
    store.write_text(replace(store.read_text(),
        '      name: "multica_projects_view",',
        '      name: persistName,'))
    store.write_text(replace(store.read_text(),
        '  )\n);\n\nregisterForWorkspaceRehydration(() => useProjectViewStore.persist.rehydrate());',
        '  )\n  );\n}\n\n'
        '/** Human 專案 page store: identical persistence key as before. */\n'
        'export const useProjectViewStore = createProjectViewStore("multica_projects_view");\n\n'
        'registerForWorkspaceRehydration(() => useProjectViewStore.persist.rehydrate());\n\n'
        '// TASKFLOW_AI_DISPATCH: per-page keyed stores, same state shape and defaults.\n'
        'const keyedProjectViewStores = new Map<string, typeof useProjectViewStore>();\n'
        'export function useProjectViewStoreForKey(pageKey?: string) {\n'
        '  if (!pageKey || pageKey === "projects") return useProjectViewStore;\n'
        '  const cached = keyedProjectViewStores.get(pageKey);\n'
        '  if (cached) return cached;\n'
        '  const created = createProjectViewStore(`multica_projects_view:${pageKey}`);\n'
        '  keyedProjectViewStores.set(pageKey, created);\n'
        '  registerForWorkspaceRehydration(() => created.persist.rehydrate());\n'
        '  return created;\n'
        '}'))

    # D. Re-export the factory selector.
    index = root / "packages/core/projects/index.ts"
    index.write_text(replace(index.read_text(),
        '  useProjectViewStore,',
        '  useProjectViewStore,\n  useProjectViewStoreForKey,'))

    # E. ProjectsPage: optional pageKey (view-store isolation) + leadKind constraint.
    page = root / "packages/views/projects/components/projects-page.tsx"
    src = page.read_text()
    src = replace(src,
        '  useProjectViewStore,\n  type ProjectColumnKey,',
        '  useProjectViewStoreForKey,\n  type ProjectColumnKey,')
    src = replace(src,
        'export function ProjectsPage() {\n  const { t } = useT("projects");',
        'export function ProjectsPage({ pageKey, leadKind }: { pageKey?: string; leadKind?: "agent" } = {}) {\n'
        '  const { t } = useT("projects");\n'
        '  const useViewStore = useProjectViewStoreForKey(pageKey);')
    n = src.count('useProjectViewStore(')
    if n != 12:
        raise ValueError(f"ProjectsPage store call sites drift: {n}")
    src = src.replace('useProjectViewStore(', 'useViewStore(')
    src = replace(src,
        '      const v = leadFilterValue(p);\n      if (!v || !p.lead_type || !p.lead_id) continue;',
        '      const v = leadFilterValue(p);\n      if (!v || !p.lead_type || !p.lead_id) continue;\n'
        '      if (leadKind && p.lead_type !== leadKind) continue;')
    src = replace(src,
        '      if (filters.leads.length) {',
        '      if (leadKind && p.lead_type !== leadKind) return false;\n'
        '      if (filters.leads.length) {')
    src = replace(src,
        '        title={t(($) => $.page.title)}',
        '        title={leadKind === "agent" ? "AI 派工中心" : t(($) => $.page.title)}')
    src = replace(src,
        '        count={projects.length}',
        '        count={leadKind ? projects.filter((p) => p.lead_type === leadKind).length : projects.length}')
    page.write_text(src)

    # E2. ProjectsPage test mock: factory selector alongside the legacy hook.
    page_test = root / "packages/views/projects/components/projects-page.test.tsx"
    page_test.write_text(replace(page_test.read_text(),
        """  useProjectViewStore: (selector: (state: unknown) => unknown) =>
    selector(mocks.projectViewState),
}));""",
        """  useProjectViewStore: (selector: (state: unknown) => unknown) =>
    selector(mocks.projectViewState),
  useProjectViewStoreForKey: () => (selector: (state: unknown) => unknown) =>
    selector(mocks.projectViewState),
}));"""))

    # I. Saved-view isolation: useActiveIssueView gains an optional variant
    # discriminator. Native callers pass nothing (keys/behaviour unchanged);
    # AI pages pass their variant, giving them an independent active-view key
    # AND a variant-filtered view list (the container list query is shared,
    # so create/edit/delete invalidation stays native).
    uav = root / "packages/core/issue-views/use-active-view.ts"
    uav_src = uav.read_text()
    uav_src = replace(uav_src,
        'export function useActiveIssueView(\n  wsId: string,\n  scope: IssueViewScope | null,\n) {\n  const containerKey = scope ? issueViewContainerKey(wsId, scope) : "";',
        'export function useActiveIssueView(\n  wsId: string,\n  scope: IssueViewScope | null,\n  viewVariant?: "members" | "agents",\n) {\n'
        '  // TASKFLOW_AI_VIEW_ISOLATION: variant-scoped container key so an AI\n'
        '  // page\'s open view never collides with the human page\'s.\n'
        '  const containerKey = scope\n'
        '    ? issueViewContainerKey(wsId, scope) + (viewVariant ? `#${viewVariant}` : "")\n'
        '    : "";')
    uav_src = replace(uav_src,
        '  const views = listQuery.data ?? EMPTY_VIEWS;',
        '  const allViews = listQuery.data ?? EMPTY_VIEWS;\n'
        '  // TASKFLOW_AI_VIEW_ISOLATION: a variant-scoped surface sees only its\n'
        '  // own variant\'s saved views; unscoped callers see everything.\n'
        '  const views = viewVariant\n'
        '    ? allViews.filter((v) => v.query.taskflow_surface === `ai-${viewVariant}` && v.scope_variant === viewVariant)\n'
        '    : allViews.filter((v) => !v.query.taskflow_surface);')
    uav.write_text(uav_src)

    # J. IssueSurface forwards an optional viewVariant to useActiveIssueView.
    surf = root / "packages/views/issues/surface/issue-surface.tsx"
    surf_src = surf.read_text()
    surf_src = replace(surf_src,
        'interface IssueSurfaceComponentProps extends IssueSurfaceProps {\n  renderHeader?: (context: IssueSurfaceRenderContext) => ReactNode;',
        'interface IssueSurfaceComponentProps extends IssueSurfaceProps {\n'
        '  /** TASKFLOW_AI_VIEW_ISOLATION: opt-in saved-view variant scope. */\n'
        '  viewVariant?: "members" | "agents";\n'
        '  renderHeader?: (context: IssueSurfaceRenderContext) => ReactNode;')
    surf_src = replace(surf_src,
        'export function IssueSurface({\n  scope,\n  modes,\n  surfaceKey,',
        'export function IssueSurface({\n  scope,\n  modes,\n  surfaceKey,\n  viewVariant,')
    surf_src = replace(surf_src,
        '  const { activeView } = useActiveIssueView(wsId, viewScope);',
        '  const { activeView } = useActiveIssueView(wsId, viewScope, viewVariant);')
    surf.write_text(surf_src)

    # K. IssuesHeader: optional viewVariant isolates the view list + active
    # key, restricts built-in tabs to the matching one, and fixes the tab
    # fallback so the save dialog files the AI variant (never widens).
    hdr = root / "packages/views/issues/components/issues-header.tsx"
    hdr_src = hdr.read_text()
    hdr_src = replace(hdr_src,
        '  saveViewScope = { kind: "workspace" },\n}: {',
        '  saveViewScope = { kind: "workspace" },\n  viewVariant,\n}: {')
    hdr_src = replace(hdr_src,
        '  /** Where "save as view" files the view. /issues keeps the workspace\n'
        '   *  default; the project-detail fallback passes its project scope; `null`\n'
        '   *  hides the save affordance entirely. */\n'
        '  saveViewScope?: SaveViewScope | null;\n'
        '}) {',
        '  /** Where "save as view" files the view. /issues keeps the workspace\n'
        '   *  default; the project-detail fallback passes its project scope; `null`\n'
        '   *  hides the save affordance entirely. */\n'
        '  saveViewScope?: SaveViewScope | null;\n'
        '  /** TASKFLOW_AI_VIEW_ISOLATION: when set, the header\'s saved-view\n'
        '   *  list, active key and built-in tabs are scoped to this variant\n'
        '   *  (AI pages); native pages omit it and behave exactly as before. */\n'
        '  viewVariant?: "members" | "agents";\n'
        '}) {')
    hdr_src = replace(hdr_src,
        '  const { activeView, views, viewsReady, setActive, missing } = useActiveIssueView(\n    headerWsId,\n    viewListScope,\n  );',
        '  const { activeView, views, viewsReady, setActive, missing } = useActiveIssueView(\n    headerWsId,\n    viewListScope,\n    viewVariant,\n  );')
    hdr_src = replace(hdr_src,
        '  const scopePage: IssuesScopePageKey =\n    saveViewScope?.kind === "project"\n      ? `project:${saveViewScope.projectId}`\n      : "issues";\n  const scope = useIssuesScope(scopePage);',
        '  const scopePage: IssuesScopePageKey =\n    saveViewScope?.kind === "project"\n      ? `project:${saveViewScope.projectId}`\n      : "issues";\n'
        '  const pageScope = useIssuesScope(scopePage);\n'
        '  // TASKFLOW_AI_VIEW_ISOLATION: a variant-locked header never consults\n'
        '  // the shared per-page tab store — the AI page is always its variant.\n'
        '  const scope = viewVariant ?? pageScope;')
    hdr_src = replace(hdr_src,
        '  const setScope = useCallback(\n    (next: IssuesScope) => setScopeForPage(scopePage, next),\n    [setScopeForPage, scopePage],\n  );',
        '  const setScope = useCallback(\n    (next: IssuesScope) => {\n'
        '      // TASKFLOW_AI_VIEW_ISOLATION: variant-locked headers never write\n'
        '      // the shared per-page tab store (the human page\'s tab must not move).\n'
        '      if (viewVariant) return;\n'
        '      setScopeForPage(scopePage, next);\n'
        '    },\n'
        '    [setScopeForPage, scopePage, viewVariant],\n  );')
    hdr_src = replace(hdr_src,
        '              builtins={SCOPE_VALUES.map((s) => ({',
        '              builtins={(viewVariant ? SCOPE_VALUES.filter((s) => s === viewVariant) : SCOPE_VALUES).map((s) => ({')
    hdr_src = replace(hdr_src,
        '              {SCOPE_VALUES.map((s) => (',
        '              {(viewVariant ? SCOPE_VALUES.filter((s) => s === viewVariant) : SCOPE_VALUES).map((s) => (')
    hdr.write_text(hdr_src)

    # L. Preserve full namespace isolation through create/edit/pin/prefs.
    dialog = root / "packages/views/issues/components/save-view-dialog.tsx"
    dialog_src = dialog.read_text()
    dialog_src = replace(dialog_src, '  seedFromDefinition = false,\n}: {', '  seedFromDefinition = false,\n  viewVariant,\n}: {')
    dialog_src = replace(dialog_src, '  seedFromDefinition?: boolean;\n}) {', '  seedFromDefinition?: boolean;\n  viewVariant?: "members" | "agents";\n}) {')
    dialog_src = replace(dialog_src, '      query: {\n        statusFilters:', '      query: {\n        ...(viewVariant ? { taskflow_surface: `ai-${viewVariant}` } : {}),\n        statusFilters:')
    dialog_src = replace(dialog_src, '            }),\n            created.id,', '            }) + (viewVariant ? `#${viewVariant}` : ""),\n            created.id,')
    dialog_src = replace(dialog_src, '              <Select\n                items={(scope.kind', '              <Select\n                disabled={!!viewVariant}\n                items={(scope.kind')
    dialog.write_text(dialog_src)
    hdr_src = hdr.read_text()
    hdr_src = replace(hdr_src, '              scope={viewListScope}\n              builtins=', '              scope={viewListScope}\n              preferenceNamespace={viewVariant ? `ai-${viewVariant}` : undefined}\n              builtins=')
    hdr_src = replace(hdr_src, '        scope={dialogScope}\n        editView=', '        scope={dialogScope}\n        viewVariant={viewVariant}\n        editView=')
    hdr.write_text(hdr_src)
    bar = root / "packages/views/issues/components/view-bar.tsx"
    bar_src = bar.read_text()
    bar_src = replace(bar_src, '  onEditView,\n}: {', '  onEditView,\n  preferenceNamespace,\n}: {')
    bar_src = replace(bar_src, '  scope: IssueViewScope;\n  builtins:', '  scope: IssueViewScope;\n  preferenceNamespace?: string;\n  builtins:')
    bar_src = replace(bar_src, '  const { data: preference } = useQuery(issueViewPreferenceOptions(wsId, scope));\n  const prefs = preference?.prefs ?? EMPTY_VIEW_BAR_PREFS;\n  const updatePreference = useUpdateIssueViewPreference(wsId, scope);', '  const { data: serverPreference } = useQuery({ ...issueViewPreferenceOptions(wsId, scope), enabled: !preferenceNamespace && !!wsId });\n  // AI-only view-bar order/visibility has its own per-user/workspace local\n  // persistence. Native server prefs remain untouched, including prune writes.\n  const localPrefKey = `taskflow-viewbar:${wsId}:${currentUserId}:${preferenceNamespace}`;\n  const [localPreference, setLocalPreference] = useState<{ prefs: typeof EMPTY_VIEW_BAR_PREFS } | undefined>();\n  useEffect(() => {\n    if (!preferenceNamespace) return;\n    try { const raw = localStorage.getItem(localPrefKey); setLocalPreference(raw ? { prefs: JSON.parse(raw) } : undefined); }\n    catch { setLocalPreference(undefined); }\n  }, [localPrefKey, preferenceNamespace]);\n  const preference = preferenceNamespace ? localPreference : serverPreference;\n  const prefs = preference?.prefs ?? EMPTY_VIEW_BAR_PREFS;\n  const serverUpdatePreference = useUpdateIssueViewPreference(wsId, scope);\n  const updatePreference = preferenceNamespace ? {\n    mutate: (next: typeof EMPTY_VIEW_BAR_PREFS) => {\n      setLocalPreference({ prefs: next });\n      try { localStorage.setItem(localPrefKey, JSON.stringify(next)); } catch { /* unavailable storage stays session-only */ }\n    },\n  } : serverUpdatePreference;')
    bar.write_text(bar_src)
    surf_src = surf.read_text()
    surf_src = replace(surf_src, '    ? `view:${activeView.id}`', '    ? `view:${activeView.id}${viewVariant ? `#${viewVariant}` : ""}`')
    surf.write_text(surf_src)
    sidebar_src = sidebar.read_text()
    sidebar_src = replace(sidebar_src, '          : p.issues();\n    const containerKey', '          : view.query.taskflow_surface === "ai-agents" ? p.aiTasks() : p.issues();\n    const containerKey')
    sidebar_src = replace(sidebar_src, '      scope_type: scopeType,\n      scope_id: scopeType === "project" ? view.scope_id : null,\n    });', '      scope_type: scopeType,\n      scope_id: scopeType === "project" ? view.scope_id : null,\n    }) + (view.query.taskflow_surface === "ai-agents" ? "#agents" : "");')
    sidebar.write_text(sidebar_src)

    urlhook = root / "apps/web/platform/use-issue-view-url-sync.ts"
    urlhook_src = urlhook.read_text()
    urlhook_src = replace(urlhook_src, 'export function useIssueViewUrlSync(scope: IssueViewScope) {', 'export function useIssueViewUrlSync(scope: IssueViewScope, viewVariant?: "members" | "agents") {')
    urlhook_src = replace(urlhook_src, '  const containerKey = issueViewContainerKey(wsId, scope);', '  const containerKey = issueViewContainerKey(wsId, scope) + (viewVariant ? `#${viewVariant}` : "");')
    urlhook.write_text(urlhook_src)

    # F. Package exports for the two overlay pages.
    package = root / "packages/views/package.json"
    data = json.loads(package.read_text())
    data["exports"]["./common/taskflow-ai-dispatch-page"] = "./common/taskflow-ai-dispatch-page.tsx"
    data["exports"]["./common/taskflow-ai-tasks-page"] = "./common/taskflow-ai-tasks-page.tsx"
    package.write_text(json.dumps(data, indent=2) + "\n")

    # G. Overlay components into views/common.
    common = root / "packages/views/common"
    for name in ("taskflow-ai-dispatch-page.tsx", "taskflow-ai-tasks-page.tsx", "taskflow-ai-saved-view-isolation.test.tsx"):
        (common / name).write_text((overlays / name).read_text())

    # H. Routes: 派工中心 takes /ai-dispatch; console demoted to /console; 任務中心 new.
    dash = root / "apps/web/app/[workspaceSlug]/(dashboard)"
    (dash / "ai-dispatch/page.tsx").write_text(
        'import { TaskFlowAiDispatchPage } from "@multica/views/common/taskflow-ai-dispatch-page";\n'
        'export default function DispatchRoute() { return <TaskFlowAiDispatchPage />; }\n')
    console_dir = dash / "ai-dispatch/console"
    console_dir.mkdir(parents=True, exist_ok=True)
    (console_dir / "page.tsx").write_text(
        'import { TaskFlowDispatchCenter } from "@multica/views/common/taskflow-dispatch-center";\n'
        'export default function DispatchConsoleRoute() { return <TaskFlowDispatchCenter />; }\n')
    tasks_dir = dash / "ai-tasks"
    tasks_dir.mkdir(parents=True, exist_ok=True)
    (tasks_dir / "page.tsx").write_text(
        '"use client";\n'
        'import { TaskFlowAiTasksPage } from "@multica/views/common/taskflow-ai-tasks-page";\n'
        'import { useIssueViewUrlSync } from "../../../../platform/use-issue-view-url-sync";\n'
        'export default function AiTasksRoute() { useIssueViewUrlSync({ scope_type: "workspace" }, "agents"); return <TaskFlowAiTasksPage />; }\n')

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--overlays", type=Path, required=True)
    args = parser.parse_args()
    apply(args.root, args.overlays)
    print("apply-taskflow-ai-native-views: OK")
