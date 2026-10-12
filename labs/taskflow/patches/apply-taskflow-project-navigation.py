#!/usr/bin/env python3
"""Apply the TaskFlow-owned workspace project navigation overlay."""

from __future__ import annotations

import argparse
from pathlib import Path


SIDEBAR_PATH = Path("packages/views/layout/app-sidebar.tsx")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f"{label}: expected one upstream marker, found {count}")
    return source.replace(old, new, 1)


def patch_sidebar(source: str) -> str:
    if "TASKFLOW_PROJECT_NAV_OVERLAY" in source:
        raise ValueError("TaskFlow project navigation overlay already applied")

    source = replace_once(
        source,
        'import { useScrollFade } from "@multica/ui/hooks/use-scroll-fade";\n',
        'import { useScrollFade } from "@multica/ui/hooks/use-scroll-fade";\n'
        'import { useIsMobile } from "@multica/ui/hooks/use-mobile";\n',
        "mobile sidebar breakpoint import",
    )
    source = replace_once(
        source,
        'import { projectDetailOptions } from "@multica/core/projects/queries";\n',
        'import { projectDetailOptions, projectListOptions } from "@multica/core/projects/queries";\n',
        "workspace project list query import",
    )
    source = replace_once(
        source,
        'import type { PinnedItem } from "@multica/core/types";\n',
        'import type { PinnedItem, Project } from "@multica/core/types";\n',
        "project row type import",
    )
    source = replace_once(
        source,
        'const workNav: { key: NavKey; labelKey: NavLabelKey }[] = [\n'
        '  { key: "issues", labelKey: "issues" },\n'
        '  { key: "projects", labelKey: "projects" },\n'
        '  { key: "autopilots", labelKey: "autopilots" },\n'
        '];',
        'const workNav: { key: NavKey; labelKey: NavLabelKey }[] = [\n'
        '  { key: "projects", labelKey: "projects" },\n'
        '  { key: "issues", labelKey: "issues" },\n'
        '  { key: "autopilots", labelKey: "autopilots" },\n'
        '];',
        "Work navigation order",
    )
    source = replace_once(
        source,
        "const EMPTY_PINS: PinnedItem[] = [];\n",
        "const EMPTY_PINS: PinnedItem[] = [];\n"
        "const EMPTY_PROJECTS: Project[] = [];\n",
        "stable empty workspace projects",
    )
    source = replace_once(
        source,
        "  const workspace = useCurrentWorkspace();\n",
        "  const workspace = useCurrentWorkspace();\n"
        "  const isMobile = useIsMobile();\n"
        "  const [projectsExpandedOverride, setProjectsExpandedOverride] = useState<boolean | null>(null);\n"
        "  const projectsExpanded = projectsExpandedOverride ?? !isMobile;\n",
        "responsive project menu state",
    )
    source = replace_once(
        source,
        "  const wsId = workspace?.id;\n",
        "  const wsId = workspace?.id;\n"
        "  const { data: workspaceProjects = EMPTY_PROJECTS } = useQuery({\n"
        "    ...projectListOptions(wsId ?? \"\"),\n"
        "    enabled: Boolean(wsId),\n"
        "  });\n",
        "workspace-scoped project query",
    )

    original_nav_map = '''                {workNav.map((item) => {
                  const href = p[item.key]();
                  const Icon = routeIconForPath(href);
                  const isActive = !isActivePinnedRoute && isNavActive(pathname, href);
                  return (
                    <SidebarMenuItem key={item.key}>
                      <SidebarMenuButton
                        isActive={isActive}
                        render={<AppLink href={href} />}
                        className={NAV_ITEM_CLASS_NAME}
                      >
                        <Icon />
                        <span>{t(($) => $.nav[item.labelKey])}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}'''

    taskflow_nav_map = '''                {/* TASKFLOW_PROJECT_NAV_OVERLAY: overview navigation and the project picker are separate controls. */}
                {workNav.map((item) => {
                  const href = p[item.key]();
                  const Icon = routeIconForPath(href);
                  const isProjectsItem = item.key === "projects";
                  const isActive = !isActivePinnedRoute && (
                    isProjectsItem ? pathname === href : isNavActive(pathname, href)
                  );

                  return (
                    <SidebarMenuItem key={item.key}>
                      {isProjectsItem ? (
                        <Collapsible
                          open={projectsExpanded}
                          onOpenChange={(open) => setProjectsExpandedOverride(open)}
                        >
                          <div className="flex min-w-0 items-center gap-1">
                            <SidebarMenuButton
                              isActive={isActive}
                              render={<AppLink href={href} />}
                              className={cn(NAV_ITEM_CLASS_NAME, "min-w-0 flex-1")}
                            >
                              <Icon />
                              <span>{t(($) => $.nav[item.labelKey])}</span>
                            </SidebarMenuButton>
                            <CollapsibleTrigger
                              type="button"
                              data-testid="project-navigation-toggle"
                              aria-label={t(($) => $.nav.projects)}
                              className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
                            >
                              <ChevronRight
                                aria-hidden="true"
                                className={cn("size-4 transition-transform", projectsExpanded && "rotate-90")}
                              />
                            </CollapsibleTrigger>
                          </div>
                          <CollapsibleContent>
                            <SidebarMenu className="ml-3 mt-0.5 max-h-56 gap-0.5 overflow-y-auto border-l border-sidebar-border pl-1 pr-1">
                              {workspaceProjects.map((project) => {
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
                      ) : (
                        <SidebarMenuButton
                          isActive={isActive}
                          render={<AppLink href={href} />}
                          className={NAV_ITEM_CLASS_NAME}
                        >
                          <Icon />
                          <span>{t(($) => $.nav[item.labelKey])}</span>
                        </SidebarMenuButton>
                      )}
                    </SidebarMenuItem>
                  );
                })}'''
    return replace_once(source, original_nav_map, taskflow_nav_map, "Work navigation project menu")


def patch_sidebar_tests(source: str) -> str:
    if "TASKFLOW_PROJECT_NAV_TESTS" in source:
        raise ValueError("TaskFlow project navigation tests already applied")

    source = replace_once(
        source,
        'const { appForeground, chatSessions, chatStore, detail, deletePin, invitationApi, navigation, pins, sidebarState, summary, workspaces } = vi.hoisted(() => ({',
        'const { appForeground, chatSessions, chatStore, detail, deletePin, invitationApi, navigation, pins, sidebarState, summary, workspaces, taskflowNav } = vi.hoisted(() => ({',
        "sidebar test state destructuring",
    )
    source = replace_once(
        source,
        '  workspaces: {\n    current: [] as { id: string; name: string; slug: string; avatar_url: string | null }[],\n  },\n  pins: {',
        '  workspaces: {\n    current: [] as { id: string; name: string; slug: string; avatar_url: string | null }[],\n  },\n'
        '  taskflowNav: {\n'
        '    workspace: { current: { id: "ws-1", name: "Acme", slug: "acme" } },\n'
        '    mobile: { current: false },\n'
        '    projectsByWorkspace: {\n'
        '      "ws-1": [{ id: "project-a", workspace_id: "ws-1", title: "Project A", icon: null }],\n'
        '      "ws-2": [{ id: "project-b", workspace_id: "ws-2", title: "QA | Project B", icon: null }],\n'
        '    } as Record<string, { id: string; workspace_id: string; title: string; icon: string | null }[]>,\n'
        '  },\n'
        '  pins: {',
        "sidebar project fixtures",
    )
    source = replace_once(
        source,
        'vi.mock("@multica/ui/components/ui/sidebar", () => ({',
        'vi.mock("@multica/ui/hooks/use-mobile", () => ({\n'
        '  useIsMobile: () => taskflowNav.mobile.current,\n'
        '}));\n'
        'vi.mock("@multica/ui/components/ui/sidebar", () => ({',
        "mobile breakpoint test mock",
    )
    source = replace_once(
        source,
        '  SidebarMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,',
        '  SidebarMenu: ({ children, className }: { children: React.ReactNode; className?: string }) => <ul className={className}>{children}</ul>,',
        "sidebar menu class test passthrough",
    )
    source = replace_once(
        source,
        'vi.mock("@multica/ui/components/ui/collapsible", () => ({\n'
        '  Collapsible: ({ children }: { children: React.ReactNode }) => <>{children}</>,\n'
        '  CollapsibleContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,\n'
        '  CollapsibleTrigger: () => <button type="button" />,\n'
        '}));',
        'vi.mock("@multica/ui/components/ui/collapsible", async () => {\n'
        '  const React = await import("react");\n'
        '  const Context = React.createContext<{ open: boolean; change: (open: boolean) => void }>({ open: false, change: () => undefined });\n'
        '  function Collapsible({ children, open: controlledOpen, defaultOpen = false, onOpenChange }: { children: React.ReactNode; open?: boolean; defaultOpen?: boolean; onOpenChange?: (open: boolean) => void }) {\n'
        '    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);\n'
        '    const open = controlledOpen ?? uncontrolledOpen;\n'
        '    const change = (next: boolean) => {\n'
        '      if (controlledOpen === undefined) setUncontrolledOpen(next);\n'
        '      onOpenChange?.(next);\n'
        '    };\n'
        '    return <Context.Provider value={{ open, change }}>{children}</Context.Provider>;\n'
        '  }\n'
        '  function CollapsibleTrigger({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {\n'
        '    const state = React.useContext(Context);\n'
        '    return <button {...props} aria-expanded={state.open} onClick={() => state.change(!state.open)}>{children}</button>;\n'
        '  }\n'
        '  function CollapsibleContent({ children }: { children: React.ReactNode }) {\n'
        '    return React.useContext(Context).open ? <>{children}</> : null;\n'
        '  }\n'
        '  return { Collapsible, CollapsibleContent, CollapsibleTrigger };\n'
        '});',
        "controlled collapsible behavior test mock",
    )
    source = replace_once(
        source,
        '  useCurrentWorkspace: () => ({ id: "ws-1", name: "Acme", slug: "acme" }),',
        '  useCurrentWorkspace: () => taskflowNav.workspace.current,',
        "active workspace test mock",
    )
    source = replace_once(
        source,
        '    projectDetail: (id: string) => `/acme/projects/${id}`,',
        '    projectDetail: (id: string) => `/${taskflowNav.workspace.current.slug}/projects/${id}`,',
        "workspace-aware project route test mock",
    )
    source = replace_once(
        source,
        'vi.mock("@multica/core/projects/queries", () => ({ projectDetailOptions: () => ({ queryKey: ["project"] }) }));',
        'vi.mock("@multica/core/projects/queries", () => ({\n'
        '  projectDetailOptions: () => ({ queryKey: ["project"] }),\n'
        '  projectListOptions: (wsId: string) => ({ queryKey: ["projects", wsId, "list"] }),\n'
        '}));',
        "workspace project list query test mock",
    )
    source = replace_once(
        source,
        '  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {\n'
        '    if (queryKey[0] === "pins") return { data: pins.current };',
        '  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {\n'
        '    if (queryKey[0] === "projects" && queryKey[2] === "list") {\n'
        '      return { data: taskflowNav.projectsByWorkspace[String(queryKey[1])] ?? [] };\n'
        '    }\n'
        '    if (queryKey[0] === "pins") return { data: pins.current };',
        "workspace project list query fixture",
    )

    marker = '\ndescribe("Pending invitation self-heal", () => {'
    suite = '''
// TASKFLOW_PROJECT_NAV_TESTS: exercise the overlay against the existing sidebar test harness.
describe("TaskFlow workspace project navigation", () => {
  beforeEach(() => {
    taskflowNav.workspace.current = { id: "ws-1", name: "Acme", slug: "acme" };
    taskflowNav.mobile.current = false;
    taskflowNav.projectsByWorkspace = {
      "ws-1": [{ id: "project-a", workspace_id: "ws-1", title: "Project A", icon: null }],
      "ws-2": [{ id: "project-b", workspace_id: "ws-2", title: "QA | Project B", icon: null }],
    };
    navigation.current.pathname = "/acme/issues";
  });

  it("keeps the project overview link separate from its desktop expand control", () => {
    const { container } = render(<AppSidebar />);
    const overview = container.querySelector('button[data-href="/acme/projects"]');
    const toggle = screen.getByTestId("project-navigation-toggle");

    expect(overview).toBeInTheDocument();
    expect(overview).not.toHaveAttribute("data-active");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Project A")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Project A")).not.toBeInTheDocument();
    expect(container.querySelector('button[data-href="/acme/projects"]')).toBe(overview);
  });

  it("opens the selected project and marks only that project active", () => {
    navigation.current.pathname = "/acme/projects/project-a";
    const { container } = render(<AppSidebar />);
    const overview = container.querySelector('button[data-href="/acme/projects"]');
    const project = container.querySelector('button[data-href="/acme/projects/project-a"]');

    expect(project).toHaveAttribute("data-active", "true");
    expect(overview).not.toHaveAttribute("data-active", "true");
  });

  it("updates rows when the current workspace changes", () => {
    const { container, rerender } = render(<AppSidebar />);
    expect(screen.getByText("Project A")).toBeInTheDocument();

    taskflowNav.workspace.current = { id: "ws-2", name: "QA", slug: "qa" };
    navigation.current.pathname = "/qa/projects/project-b";
    rerender(<AppSidebar />);

    expect(screen.getByText("QA | Project B")).toBeInTheDocument();
    expect(screen.queryByText("Project A")).not.toBeInTheDocument();
    expect(container.querySelector('button[data-href="/qa/projects/project-b"]')).toHaveAttribute("data-active", "true");
  });

  it("defaults collapsed on mobile and keeps a long list independently scrollable", () => {
    taskflowNav.mobile.current = true;
    const { container, rerender } = render(<AppSidebar />);
    const toggle = screen.getByTestId("project-navigation-toggle");

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Project A")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("Project A")).toBeInTheDocument();

    taskflowNav.projectsByWorkspace["ws-1"] = Array.from({ length: 30 }, (_, index) => ({
      id: `project-${index}`,
      workspace_id: "ws-1",
      title: `Project ${index}`,
      icon: null,
    }));
    rerender(<AppSidebar />);

    expect(container.querySelector("ul.max-h-56.overflow-y-auto")).toBeInTheDocument();
    expect(container.querySelector('button[data-href="/acme/autopilots"]')).toBeInTheDocument();
  });
});
'''
    return replace_once(source, marker, "\n" + suite + marker, "TaskFlow sidebar behavior test insertion")


def apply(root: Path) -> None:
    sidebar = root / SIDEBAR_PATH
    if not sidebar.is_file():
        raise FileNotFoundError(f"TaskFlow sidebar source is missing: {sidebar}")
    sidebar.write_text(patch_sidebar(sidebar.read_text()))

    sidebar_tests = root / "packages/views/layout/app-sidebar.test.tsx"
    if not sidebar_tests.is_file():
        raise FileNotFoundError(f"TaskFlow sidebar test source is missing: {sidebar_tests}")
    sidebar_tests.write_text(patch_sidebar_tests(sidebar_tests.read_text()))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/src"))
    args = parser.parse_args()
    apply(args.root)
    print("TaskFlow project navigation overlay applied")


if __name__ == "__main__":
    main()
