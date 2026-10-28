"""Split the sidebar into two independent groups on the temporary build copy.

Group 1 (human): Projects (dropdown + overview) and Tasks.
Group 2 (intelligent): AI dispatch center (dropdown + overview) and AI tasks.
Classification is the real project lead_type: "agent" is intelligent, everything
else (member lead, no lead) stays in the human group, so no project is hidden.
Runs AFTER apply-taskflow-ai-native-views.py. Moves no data; only filters views.
"""
import argparse
from pathlib import Path


def replace(source, marker, value, label):
    if source.count(marker) != 1:
        raise ValueError(f"workspace groups upstream drift ({source.count(marker)}x): {label}")
    return source.replace(marker, value)


def cut(source, start, end, label):
    a = source.index(start)
    b = source.index(end, a) + len(end)
    if source.count(start) != 1:
        raise ValueError(f"workspace groups upstream drift: {label}")
    return source[:a], source[a:b], source[b:]


def patch_sidebar(src):
    if "TASKFLOW_WORKSPACE_GROUPS" in src:
        raise ValueError("workspace groups already applied")
    src = replace(src, 'import React, { useCallback, useEffect, useRef, useState } from "react";',
        'import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";', "react import")
    # 1. Human dropdown excludes agent-led projects; AI dropdown gets them.
    src = replace(src, "  const { data: workspaceProjects = EMPTY_PROJECTS } = useQuery({",
        "  const { data: allWorkspaceProjects = EMPTY_PROJECTS } = useQuery({", "project query")
    src = replace(src, "  const wsId = workspace?.id;\n",
        "  const wsId = workspace?.id;\n", "wsId anchor")
    # derive the two lists right after the query block
    q_end = "    enabled: Boolean(wsId),\n  });\n"
    idx = src.index("allWorkspaceProjects = EMPTY_PROJECTS")
    j = src.index(q_end, idx) + len(q_end)
    src = (src[:j]
        + "  // TASKFLOW_WORKSPACE_GROUPS: real lead_type decides the group; unled projects stay human.\n"
        + "  const workspaceProjects = useMemo(() => allWorkspaceProjects.filter((pr) => pr.lead_type !== \"agent\"), [allWorkspaceProjects]);\n"
        + "  const aiWorkspaceProjects = useMemo(() => allWorkspaceProjects.filter((pr) => pr.lead_type === \"agent\"), [allWorkspaceProjects]);\n"
        + "  const [aiProjectsExpandedOverride, setAiProjectsExpandedOverride] = useState<boolean | null>(null);\n"
        + "  const aiProjectsExpanded = aiProjectsExpandedOverride ?? !isMobile;\n"
        + src[j:])
    # 2. Extract the three AI entries and the apps block.
    pre, apps, post = cut(src, "          <Collapsible defaultOpen>\n            <SidebarGroup className=\"group/taskflow-apps\">",
                          "            </SidebarGroup>\n          </Collapsible>\n", "apps block")
    src = pre + "{/*TASKFLOW_APPS_SLOT*/}" + post
    pre, ai_items, post = cut(src, "                {/* TASKFLOW_NATIVE_DISPATCH_CENTER: same Workspace and session. */}\n",
                              "                    <BarChart3 /><span>派工統計</span>\n                  </SidebarMenuButton>\n                </SidebarMenuItem>\n", "ai items")
    src = pre + post
    # 3. New AI group with dropdown for dispatch center, then apps, then AI team.
    ai_group = '''          {/* TASKFLOW_WORKSPACE_GROUPS: intelligent work, independent from the human Projects/Tasks group. */}
          <SidebarGroup>
            <SidebarGroupLabel>{t(($) => $.sidebar.ai_work_group)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                <SidebarMenuItem>
                  <Collapsible
                    open={aiProjectsExpanded}
                    onOpenChange={(open) => setAiProjectsExpandedOverride(open)}
                  >
                    <div className="flex min-w-0 items-center gap-1">
                      <SidebarMenuButton
                        isActive={!isActivePinnedRoute && pathname === p.aiDispatch()}
                        render={<AppLink href={p.aiDispatch()} />}
                        className={cn(NAV_ITEM_CLASS_NAME, "min-w-0 flex-1")}
                      >
                        <Layers /><span>{t(($) => $.sidebar.ai_dispatch_center)}</span>
                      </SidebarMenuButton>
                      <CollapsibleTrigger
                        type="button"
                        data-testid="ai-dispatch-navigation-toggle"
                        aria-label={t(($) => $.sidebar.ai_dispatch_center)}
                        className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
                      >
                        <ChevronRight aria-hidden="true" className={cn("size-4 transition-transform", aiProjectsExpanded && "rotate-90")} />
                      </CollapsibleTrigger>
                    </div>
                    <CollapsibleContent>
                      <SidebarMenu className="ml-3 mt-0.5 max-h-56 gap-0.5 overflow-y-auto border-l border-sidebar-border pl-1 pr-1">
                        {aiWorkspaceProjects.map((project) => {
                          const projectHref = p.projectDetail(project.id);
                          const isProjectActive = !isActivePinnedRoute && isNavActive(pathname, projectHref);
                          return (
                            <SidebarMenuItem key={project.id}>
                              <SidebarMenuButton
                                isActive={isProjectActive}
                                render={<AppLink href={projectHref} />}
                                size="sm"
                                className={cn(NAV_ITEM_CLASS_NAME, "min-w-0")}
                              >
                                <ProjectIcon project={project} size="sm" />
                                <span className="min-w-0 truncate">{project.title}</span>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          );
                        })}
                      </SidebarMenu>
                    </CollapsibleContent>
                  </Collapsible>
                </SidebarMenuItem>
''' + ai_items.split("{/* TASKFLOW_NATIVE_AI_TASKS")[1].join(["                {/* TASKFLOW_NATIVE_AI_TASKS", ""]) + '''              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

'''
    src = replace(src, "{/*TASKFLOW_APPS_SLOT*/}", ai_group + apps, "apps slot")
    # Inherited literals from the AI-native views patch get locale keys too (i18next rule).
    src = replace(src, "<BarChart3 /><span>派工統計</span>",
        "<BarChart3 /><span>{t(($) => $.sidebar.ai_dispatch_stats)}</span>", "dispatch stats label")
    src = replace(src, "<ListTodo /><span>AI 任務中心</span>",
        "<ListTodo /><span>{t(($) => $.sidebar.ai_task_center)}</span>", "ai tasks label")
    # 4. AI team group keeps agents/squads/skills/runtimes; its dispatch-center link moved above.
    src = replace(src, "<SidebarGroupLabel>{t(($) => $.sidebar.ai_team_group)}</SidebarGroupLabel>",
                  "<SidebarGroupLabel>{t(($) => $.sidebar.ai_team_group)}</SidebarGroupLabel>", "label")
    return src


def patch_sidebar_test_needs(src):
    return src


def patch_projects_page(src):
    src = replace(src, 'leadKind }: { pageKey?: string; leadKind?: "agent" } = {}) {',
                  'leadKind }: { pageKey?: string; leadKind?: "agent" | "human" } = {}) {', "signature")
    src = replace(src, "  const { data: projects = [], isLoading } = useQuery(projectListOptions(wsId));",
        "  const { data: allProjects = [], isLoading } = useQuery(projectListOptions(wsId));\n"
        "  // Group-scoped base: counts, empty state and the n / total denominator all use this list.\n"
        "  const projects = useMemo(\n"
        "    () => allProjects.filter((pr) => projectMatchesLeadKind(pr, leadKind)),\n"
        "    [allProjects, leadKind],\n"
        "  );", "project query")
    src = replace(src, "      if (leadKind && p.lead_type !== leadKind) continue;\n", "", "lead options")
    src = replace(src, "      if (leadKind && p.lead_type !== leadKind) return false;\n", "", "visible filter")
    src = replace(src, "count={leadKind ? projects.filter((p) => p.lead_type === leadKind).length : projects.length}",
                  "count={projects.length}", "count")
    src = replace(src, "export function ProjectsPage(",
        "// human = every project not led by an AI agent (member lead or no lead); agent = AI-led only.\n"
        "function projectMatchesLeadKind(pr: { lead_type?: string | null }, leadKind?: \"agent\" | \"human\") {\n"
        "  if (!leadKind) return true;\n"
        "  return leadKind === \"human\" ? pr.lead_type !== \"agent\" : pr.lead_type === \"agent\";\n"
        "}\n\nexport function ProjectsPage(", "helper")
    return src


def patch_locales(root):
    # TASKFLOW_WORKSPACE_GROUPS: sidebar/page labels for the two-group UI.
    # String-inserted after ai_team_group to keep vendor diffs minimal.
    entries = {
        "en": ("AI Work", "AI Dispatch Center", "AI Tasks", "Dispatch Stats", "No AI work cards yet"),
        "fr": ("Travail IA", "Centre de dispatch IA", "T\u00e2ches IA", "Stats de dispatch", "Aucune carte IA pour l'instant"),
        "ja": ("AI \u30ef\u30fc\u30af", "AI \u30c7\u30a3\u30b9\u30d1\u30c3\u30c1", "AI \u30bf\u30b9\u30af", "\u30c7\u30a3\u30b9\u30d1\u30c3\u30c1\u7d71\u8a08", "AI \u30ef\u30fc\u30af\u30ab\u30fc\u30c9\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093"),
        "ko": ("AI \uc791\uc5c5", "AI \ub514\uc2a4\ud328\uce58 \uc13c\ud130", "AI \ud0dc\uc2a4\ud06c", "\ub514\uc2a4\ud328\uce58 \ud1b5\uacc4", "AI \uc791\uc5c5 \uce74\ub4dc \uc5c6\uc74c"),
        "zh-Hans": ("AI \u667a\u80fd\u5de5\u4f5c", "AI \u6d3e\u5de5\u4e2d\u5fc3", "AI \u4efb\u52a1\u4e2d\u5fc3", "\u6d3e\u5de5\u7edf\u8ba1", "\u6682\u65e0 AI \u5de5\u4f5c\u5361"),
        "zh-Hant": ("AI \u667a\u80fd\u5de5\u4f5c", "AI \u6d3e\u5de5\u4e2d\u5fc3", "AI \u4efb\u52d9\u4e2d\u5fc3", "\u6d3e\u5de5\u7d71\u8a08", "\u5c1a\u7121 AI \u5de5\u4f5c\u5361"),
    }
    for locale, (grp, disp, tasks, stats, empty) in entries.items():
        f = root / "packages/views/locales" / locale / "layout.json"
        text = f.read_text()
        lines = [ln for ln in text.splitlines() if '"ai_team_group":' in ln]
        if len(lines) != 1:
            raise ValueError(f"workspace groups locale anchor drift: {locale}")
        anchor = lines[0]
        indent = anchor[: anchor.index('"')]
        keys = (
            f'{indent}"ai_work_group": "{grp}",\n'
            f'{indent}"ai_dispatch_center": "{disp}",\n'
            f'{indent}"ai_task_center": "{tasks}",\n'
            f'{indent}"ai_dispatch_stats": "{stats}",\n'
            f'{indent}"ai_tasks_empty": "{empty}",'
        )
        text = text.replace(anchor, anchor + "\n" + keys, 1)
        f.write_text(text)


def patch_scope(src):
    src = replace(src, "      return `workspace:${scope.actorKind ?? \"all\"}`;",
        "      // Partition-aware identity: window, content and selection keys never collide across groups.\n"
        "      return `workspace:${scope.actorKind ?? \"all\"}${scope.projectPartition ? `:${scope.projectPartition}` : \"\"}`;", "scope key")
    return replace(src, '  | { type: "workspace"; actorKind?: WorkspaceIssueActorKind }',
        '  | {\n      type: "workspace";\n      actorKind?: WorkspaceIssueActorKind;\n'
        '      /** TASKFLOW_WORKSPACE_GROUPS: project-origin partition by real project lead_type. */\n'
        '      projectPartition?: "human" | "ai";\n    }', "scope type")


def patch_surface(src):
    # Keep the human page's persisted display-state key unchanged (partition is not part of preferences).
    src = replace(src, "    : (surfaceKey ?? issueScopeKey(scope));",
        "    : (surfaceKey ?? issueScopeKey(scope.type === \"workspace\" ? { ...scope, projectPartition: undefined } : scope));", "preference key")
    return replace(src,
        "      ? { ...scope, actorKind: actorKindForViewVariant(activeView.scope_variant) }",
        "      ? {\n          ...scope,\n          // The AI partition is project-origin; its saved views must not re-add an assignee axis.\n"
        "          actorKind:\n            scope.type === \"workspace\" && scope.projectPartition === \"ai\"\n"
        "              ? scope.actorKind\n              : actorKindForViewVariant(activeView.scope_variant),\n        }", "surface effective scope")


def patch_issues_header(src):
    # TASKFLOW_WORKSPACE_GROUPS: group-local project filter submenu. The header
    # project list only shows the partition's projects (real lead_type), and
    # the AI partition never offers the no-project row (its cards always have
    # an AI-led project).
    src = replace(src,
        "  noProjectFixed = false,\n  fixedTitle,\n}: {\n  counts: Map<string, number>;",
        "  noProjectFixed = false,\n  fixedTitle,\n  partition,\n}: {\n  counts: Map<string, number>;",
        "subcontent destructure")
    src = replace(src,
        "  noProjectFixed?: boolean;\n  fixedTitle?: string;",
        "  noProjectFixed?: boolean;\n  fixedTitle?: string;\n"
        "  /** TASKFLOW_WORKSPACE_GROUPS: only this partition's projects are listed. */\n"
        "  partition?: \"human\" | \"ai\";",
        "subcontent type")
    src = replace(src,
        "  const filtered = projects.filter((p) =>\n    p.title.toLowerCase().includes(query),\n  );",
        "  // Group-local list: real project lead_type decides membership, never the card.\n"
        "  const filtered = projects.filter(\n"
        "    (p) =>\n"
        "      (!partition ||\n"
        "        (partition === \"ai\" ? p.lead_type === \"agent\" : p.lead_type !== \"agent\")) &&\n"
        "      p.title.toLowerCase().includes(query),\n"
        "  );",
        "subcontent filter")
    src = replace(src,
        "        {(!query || \"no project\".includes(query) || \"unassigned\".includes(query)) && (",
        "        {partition !== \"ai\" &&\n"
        "          (!query || \"no project\".includes(query) || \"unassigned\".includes(query)) && (",
        "no-project row")
    src = replace(src,
        "                <ProjectSubContent\n                  counts={counts.project}",
        "                <ProjectSubContent\n                  counts={counts.project}\n"
        "                  partition={projectPartition}",
        "subcontent call")
    src = replace(src,
        "  freezeAnchor = false,\n  viewBaseline,\n}: {\n  trigger: React.ReactElement;",
        "  freezeAnchor = false,\n  viewBaseline,\n  projectPartition,\n}: {\n  trigger: React.ReactElement;",
        "filter menu destructure")
    src = replace(src,
        "  viewBaseline?: IssueViewBaseline;\n}) {\n  const { t } = useT(\"issues\");\n  const triggerRef",
        "  viewBaseline?: IssueViewBaseline;\n"
        "  /** TASKFLOW_WORKSPACE_GROUPS: group-local project submenu (real lead_type). */\n"
        "  projectPartition?: \"human\" | \"ai\";\n}) {\n  const { t } = useT(\"issues\");\n  const triggerRef",
        "filter menu type")
    src = replace(src,
        "  onTableFacetChange,\n  viewBaseline,\n}: {\n  scopedIssues: Issue[];\n  hideViewToggle?: boolean;",
        "  onTableFacetChange,\n  viewBaseline,\n  projectPartition,\n}: {\n  scopedIssues: Issue[];\n  hideViewToggle?: boolean;",
        "display controls destructure")
    src = replace(src,
        "  onTableFacetChange?: (facet: IssueTableFacetSpec | null) => void;\n}) {\n  const { t } = useT(\"issues\");\n  const [tableGroupMenuOpen",
        "  onTableFacetChange?: (facet: IssueTableFacetSpec | null) => void;\n"
        "  /** TASKFLOW_WORKSPACE_GROUPS: group-local project submenu (real lead_type). */\n"
        "  projectPartition?: \"human\" | \"ai\";\n}) {\n  const { t } = useT(\"issues\");\n  const [tableGroupMenuOpen",
        "display controls type")
    src = replace(src,
        "          onDateFilterChange={onDateFilterChange}\n          viewBaseline={viewBaseline}\n        />",
        "          onDateFilterChange={onDateFilterChange}\n          viewBaseline={viewBaseline}\n"
        "          projectPartition={projectPartition}\n        />",
        "filter menu call")
    src = replace(src,
        "  saveViewScope = { kind: \"workspace\" },\n  viewVariant,\n}: {",
        "  saveViewScope = { kind: \"workspace\" },\n  viewVariant,\n  projectPartition,\n}: {",
        "header destructure")
    src = replace(src,
        "  viewVariant?: \"members\" | \"agents\";\n}) {",
        "  viewVariant?: \"members\" | \"agents\";\n"
        "  /** TASKFLOW_WORKSPACE_GROUPS: group-local project submenu (real lead_type). */\n"
        "  projectPartition?: \"human\" | \"ai\";\n}) {",
        "header type")
    return replace(src,
        "            onTableFacetChange={onTableFacetChange}\n            viewBaseline={viewBaseline}\n          />",
        "            onTableFacetChange={onTableFacetChange}\n            viewBaseline={viewBaseline}\n"
        "            projectPartition={projectPartition}\n          />",
        "display controls call")


def patch_issues_page(src):
    src = replace(src, 'scope={{ type: "workspace", actorKind: scope }}',
                   'scope={{ type: "workspace", actorKind: scope, projectPartition: "human" }}', "issues page scope")
    # The human group's header project submenu only lists human projects.
    return replace(src,
        "        onTableFacetChange={onTableFacetChange}\n      />",
        "        onTableFacetChange={onTableFacetChange}\n        projectPartition=\"human\"\n      />",
        "issues page header partition")


def patch_controller(src):
    src = replace(src, 'import { hashKey, keepPreviousData, useQuery } from "@tanstack/react-query";\n',
        'import { hashKey, keepPreviousData, useQuery } from "@tanstack/react-query";\n'
        'import { projectListOptions } from "@multica/core/projects/queries";\n'
        'import { resolveProjectPartitionFilter, scopeFacetsToPartition } from "@multica/core/issues/surface/taskflow-project-partition";\n', "query import")
    marker = "  const { projectFilters: viewProjectFilters, includeNoProject: viewIncludeNoProject } =\n    projectFilterState;\n"
    guard = marker + """
  // TASKFLOW_WORKSPACE_GROUPS: project-origin partition (match-none when empty; see the helper).
  const partition = scope.type === "workspace" ? scope.projectPartition : undefined;
  const partitionProjects = useQuery({ ...projectListOptions(wsId), enabled: Boolean(partition) });
  const { projectFilters: queryProjectFilters, includeNoProject: queryIncludeNoProject } = useMemo(
    () =>
      !partition
        ? { projectFilters: viewProjectFilters, includeNoProject: viewIncludeNoProject }
        : resolveProjectPartitionFilter(
            partition,
            // Never fall back to an unfiltered list: load failure is match-none plus the surface error/retry state.
            partitionProjects.isError ? undefined : partitionProjects.data,
            viewProjectFilters,
            viewIncludeNoProject,
          ),
    [partition, partitionProjects.data, partitionProjects.isError, viewProjectFilters, viewIncludeNoProject],
  );
"""
    src = replace(src, marker, guard, "filter state")
    src = replace(src, "        ? tableFacetsQuery.data\n        : undefined,",
        "        ? scopeFacetsToPartition(tableFacetsQuery.data, partition, partitionProjects.isError ? undefined : partitionProjects.data)\n        : undefined,", "facet scope")
    src = replace(src, "    isLoading: data.isLoading || workingFilterPending,",
        "    isLoading: data.isLoading || workingFilterPending || Boolean(partition && partitionProjects.isPending),", "partition loading")
    src = replace(src, "      !workingFilterUnresolved &&\n      data.isEmpty &&",
        "      !workingFilterUnresolved &&\n      !(partition && partitionProjects.isPending) &&\n      data.isEmpty &&", "partition not empty while pending")
    src = replace(src, "    isStatusCatalogError: data.isStatusCatalogError,\n",
        "    isStatusCatalogError: data.isStatusCatalogError || Boolean(partition && partitionProjects.isError),\n", "error state")
    src = replace(src, "      catalog.retry();\n      data.retryProjectCatalog();",
        "      catalog.retry();\n      if (partition) void partitionProjects.refetch();\n      data.retryProjectCatalog();", "retry")
    src = replace(src,
        "        ...(viewProjectFilters.length > 0\n          ? { project_ids: viewProjectFilters }\n          : {}),\n        ...(viewIncludeNoProject ? { include_no_project: true } : {}),",
        "        ...(queryProjectFilters.length > 0\n          ? { project_ids: queryProjectFilters }\n          : {}),\n        ...(queryIncludeNoProject ? { include_no_project: true } : {}),", "table spec filters")
    src = replace(src, "    viewIncludeNoProject,\n    viewProjectFilters,\n    workingFilterUnresolved,",
        "    queryIncludeNoProject,\n    queryProjectFilters,\n    workingFilterUnresolved,", "spec deps")
    src = replace(src, "    projectFilters: viewProjectFilters,\n    includeNoProject: viewIncludeNoProject,\n    projectStatusFilters,\n    labelFilters,",
        "    projectFilters: queryProjectFilters,\n    includeNoProject: queryIncludeNoProject,\n    projectStatusFilters,\n    labelFilters,", "data hook filters")
    src = replace(src, "        viewProjectFilters,\n        viewIncludeNoProject,\n        projectStatusFilters,",
        "        queryProjectFilters,\n        queryIncludeNoProject,\n        projectStatusFilters,", "membership key")
    src = replace(src, "      viewIncludeNoProject,\n      viewProjectFilters,\n    ],\n  );\n  const selection",
        "      queryIncludeNoProject,\n      queryProjectFilters,\n    ],\n  );\n  const selection", "membership deps")
    return src


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--overlays", required=True)
    args = ap.parse_args()
    root = Path(args.root)
    overlays = Path(args.overlays)
    target = root / "packages/core/issues/surface"
    for name in ("taskflow-project-partition.ts", "taskflow-project-partition.test.ts"):
        if (target / name).exists():
            raise ValueError("workspace groups already applied")
    f = root / "packages/views/layout/app-sidebar.tsx"
    f.write_text(patch_sidebar(f.read_text()))
    patch_locales(root)
    f = root / "packages/views/projects/components/projects-page.tsx"
    f.write_text(patch_projects_page(f.read_text()))
    for rel, fn in (
        ("packages/core/issues/surface/scope.ts", patch_scope),
        ("packages/views/issues/surface/issue-surface.tsx", patch_surface),
        ("packages/views/issues/components/issues-page.tsx", patch_issues_page),
        ("packages/views/issues/components/issues-header.tsx", patch_issues_header),
        ("packages/views/issues/surface/use-issue-surface-controller.ts", patch_controller),
    ):
        f = root / rel
        f.write_text(fn(f.read_text()))
    for name in ("taskflow-project-partition.ts", "taskflow-project-partition.test.ts"):
        (target / name).write_text((overlays / name).read_text())
    header_test = root / "packages/views/issues/components/taskflow-header-project-partition.test.tsx"
    if header_test.exists():
        raise ValueError("workspace groups already applied")
    header_test.write_text((overlays / "taskflow-header-project-partition.test.tsx").read_text())
    f = root / "packages/views/projects/components/projects-page.test.tsx"
    f.write_text(f.read_text() + (overlays / "taskflow-projects-groups-test-block.txt").read_text())
    f = root / "apps/web/app/[workspaceSlug]/(dashboard)/projects/page.tsx"
    f.write_text(replace(f.read_text(), "<ProjectsPage />", '<ProjectsPage leadKind="human" />', "projects route"))
    print("apply-taskflow-workspace-groups: OK")


if __name__ == "__main__":
    main()
