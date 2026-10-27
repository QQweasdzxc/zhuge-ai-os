"""Install the AI native dual entries (派工中心 / 任務中心) into a temporary build copy.

Runs AFTER apply-taskflow-dispatch-center.py. Reuses the native ProjectsPage
(leadKind/pageKey) and the native IssueSurfaceWithStore (actorKind agents);
no parallel task store, no self-made kanban.
"""
import argparse
import json
from pathlib import Path

def replace(source, marker, value, count=1):
    if source.count(marker) != count:
        raise ValueError(f"AI native views upstream drift ({source.count(marker)}x): {marker[:80]}")
    return source.replace(marker, value)

def apply(root, overlays):
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

    # F. Package exports for the two overlay pages.
    package = root / "packages/views/package.json"
    data = json.loads(package.read_text())
    data["exports"]["./common/taskflow-ai-dispatch-page"] = "./common/taskflow-ai-dispatch-page.tsx"
    data["exports"]["./common/taskflow-ai-tasks-page"] = "./common/taskflow-ai-tasks-page.tsx"
    package.write_text(json.dumps(data, indent=2) + "\n")

    # G. Overlay components into views/common.
    common = root / "packages/views/common"
    for name in ("taskflow-ai-dispatch-page.tsx", "taskflow-ai-tasks-page.tsx"):
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
        'import { TaskFlowAiTasksPage } from "@multica/views/common/taskflow-ai-tasks-page";\n'
        'export default function AiTasksRoute() { return <TaskFlowAiTasksPage />; }\n')

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--overlays", type=Path, required=True)
    args = parser.parse_args()
    apply(args.root, args.overlays)
    print("apply-taskflow-ai-native-views: OK")
