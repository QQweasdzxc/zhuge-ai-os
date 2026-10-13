#!/usr/bin/env python3
"""Add a TaskFlow Apps section to the staged Multica sidebar copy."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


SIDEBAR = Path("packages/views/layout/app-sidebar.tsx")
SIDEBAR_TEST = Path("packages/views/layout/app-sidebar.test.tsx")
LOCALE_PATHS = [Path(f"packages/views/locales/{locale}/layout.json") for locale in ("en", "zh-Hant", "zh-Hans", "ja", "fr")]
APPS = {
    "en": {
        "group": "Apps",
        "names": {"legacy_dashboard": "AIOS Dashboard", "worklog": "WorkLog", "knowledge": "Knowledge (WorkLog)", "management": "Management (WorkLog)", "labs": "Lab Center", "investment_lab": "Investment Lab", "investment_legacy": "Official Investment", "skyeye": "SkyEye"},
        "states": {"available": "Available", "transition": "Transition", "experimental": "Experimental", "parked": "Parked", "unverified": "Not verified"},
    },
    "zh-Hant": {
        "group": "應用程式",
        "names": {"legacy_dashboard": "AIOS 儀表板", "worklog": "WorkLog", "knowledge": "知識庫（WorkLog）", "management": "管理（WorkLog）", "labs": "Lab 實驗室", "investment_lab": "Investment Lab", "investment_legacy": "正式 Investment", "skyeye": "天眼"},
        "states": {"available": "可使用", "transition": "過渡入口", "experimental": "實驗中", "parked": "已暫停", "unverified": "尚未驗證"},
    },
    "zh-Hans": {
        "group": "应用程序",
        "names": {"legacy_dashboard": "AIOS 仪表板", "worklog": "WorkLog", "knowledge": "知识库（WorkLog）", "management": "管理（WorkLog）", "labs": "Lab 实验室", "investment_lab": "Investment Lab", "investment_legacy": "正式 Investment", "skyeye": "天眼"},
        "states": {"available": "可用", "transition": "过渡入口", "experimental": "实验中", "parked": "已暂停", "unverified": "尚未验证"},
    },
    "ja": {
        "group": "アプリ",
        "names": {"legacy_dashboard": "AIOS ダッシュボード", "worklog": "WorkLog", "knowledge": "ナレッジ（WorkLog）", "management": "管理（WorkLog）", "labs": "Lab センター", "investment_lab": "Investment Lab", "investment_legacy": "正式 Investment", "skyeye": "SkyEye"},
        "states": {"available": "利用可能", "transition": "移行中", "experimental": "実験中", "parked": "停止中", "unverified": "未確認"},
    },
    "fr": {
        "group": "Applications",
        "names": {"legacy_dashboard": "Tableau de bord AIOS", "worklog": "WorkLog", "knowledge": "Connaissances (WorkLog)", "management": "Gestion (WorkLog)", "labs": "Centre Lab", "investment_lab": "Investment Lab", "investment_legacy": "Investment officiel", "skyeye": "SkyEye"},
        "states": {"available": "Disponible", "transition": "Transition", "experimental": "Expérimental", "parked": "Suspendu", "unverified": "Non vérifié"},
    },
}

SIDEBAR_CONSTANT = '''const TASKFLOW_AIOS_ORIGIN = "https://qqweasdzxc.github.io/zhuge-ai-os";
const TASKFLOW_APP_LINKS = [
  { key: "legacy_dashboard", path: "/app/dashboard/", state: "transition" },
  { key: "worklog", path: "/modules/worklog/?app=1&workspace=worklog", state: "available" },
  { key: "knowledge", path: "/modules/worklog/?app=1&workspace=library", state: "available" },
  { key: "management", path: "/modules/worklog/?app=1&workspace=management", state: "available" },
  { key: "labs", path: "/labs/", state: "available" },
  { key: "investment_lab", path: "/labs/investment/", state: "experimental" },
  { key: "investment_legacy", path: null, state: "parked" },
  { key: "skyeye", path: "/modules/skyeye/", state: "unverified" },
] as const;

'''

APPS_GROUP = '''          <Collapsible defaultOpen>
            <SidebarGroup className="group/taskflow-apps">
              <SidebarGroupLabel
                render={<CollapsibleTrigger />}
                className="group/trigger cursor-pointer hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
              >
                <LayoutGrid className="size-4" />
                <span>{t(($) => $.sidebar.apps_group)}</span>
                <ChevronRight className="!size-3 ml-auto stroke-[2.5] transition-transform duration-200 group-data-[panel-open]/trigger:rotate-90" />
              </SidebarGroupLabel>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu className="gap-0.5">
                    {TASKFLOW_APP_LINKS.map((app) => {
                      const label = t(($) => $.sidebar.app_names[app.key]);
                      const state = t(($) => $.sidebar.app_states[app.state]);
                      const href = app.path ? `${TASKFLOW_AIOS_ORIGIN}${app.path}` : undefined;
                      return (
                        <SidebarMenuItem key={app.key}>
                          <SidebarMenuButton
                            disabled={!href}
                            render={href ? <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${label} — ${state}`} /> : undefined}
                            className={NAV_ITEM_CLASS_NAME}
                          >
                            <span>{label}</span>
                            <span className="ml-auto truncate text-[10px] text-muted-foreground">{state}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>

'''


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f"{label}: expected one upstream marker, found {count}")
    return source.replace(old, new, 1)


def patch_sidebar(source: str) -> str:
    if "TASKFLOW_APP_LINKS" in source or "sidebar.apps_group" in source:
        raise ValueError("TaskFlow Apps navigation already applied")
    source = replace_once(source, "import { Layers,\n", "import { Layers,\n  LayoutGrid,\n", "Apps icon import")
    source = replace_once(source, "const NAV_ITEM_CLASS_NAME =\n", SIDEBAR_CONSTANT + "const NAV_ITEM_CLASS_NAME =\n", "Apps link registry")
    return replace_once(
        source,
        '''          <SidebarGroup>
            <SidebarGroupLabel>{t(($) => $.sidebar.ai_team_group)}</SidebarGroupLabel>''',
        APPS_GROUP + '''          <SidebarGroup>
            <SidebarGroupLabel>{t(($) => $.sidebar.ai_team_group)}</SidebarGroupLabel>''',
        "Apps navigation group",
    )


def patch_sidebar_test(source: str) -> str:
    if "TaskFlow Apps navigation" in source:
        raise ValueError("TaskFlow Apps navigation test already applied")
    test = '''
describe("TaskFlow Apps navigation", () => {
  it("uses the Zhuge origin and marks experimental or parked modules truthfully", () => {
    const { container } = render(<AppSidebar />);
    expect(screen.getByText("Apps")).toBeInTheDocument();
    expect(container.querySelector('button[data-href="https://qqweasdzxc.github.io/zhuge-ai-os/modules/worklog/?app=1&workspace=worklog"]')).toBeTruthy();
    expect(container.querySelector('button[data-href="https://qqweasdzxc.github.io/zhuge-ai-os/app/dashboard/"]')).toBeTruthy();
    expect(container.querySelector('button[data-href="https://qqweasdzxc.github.io/zhuge-ai-os/labs/investment/"]')).toBeTruthy();
    expect(screen.getByText("Experimental")).toBeInTheDocument();
    expect(screen.getByText("Parked")).toBeInTheDocument();
    expect(container.querySelector('button[data-href="https://zhuge-taskflow-web.onrender.com/"]')).toBeNull();
  });
});
'''
    marker = 'describe("workspace-switcher unread dot", () => {'
    return replace_once(source, marker, test + "\n" + marker, "Apps sidebar runtime contract test")


def patch_locale(path: Path, locale: str) -> None:
    document = json.loads(path.read_text())
    sidebar = document.get("sidebar")
    if not isinstance(sidebar, dict):
        raise ValueError(f"{path}: expected sidebar object")
    if "apps_group" in sidebar or "app_names" in sidebar or "app_states" in sidebar:
        raise ValueError(f"{path}: TaskFlow Apps locale already applied")
    sidebar["apps_group"] = APPS[locale]["group"]
    sidebar["app_names"] = APPS[locale]["names"]
    sidebar["app_states"] = APPS[locale]["states"]
    path.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n")


def apply(root: Path) -> None:
    sidebar = root / SIDEBAR
    sidebar.write_text(patch_sidebar(sidebar.read_text()))
    test_path = root / SIDEBAR_TEST
    test_path.write_text(patch_sidebar_test(test_path.read_text()))
    for locale, path in zip(APPS, LOCALE_PATHS, strict=True):
        patch_locale(root / path, locale)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("third_party/multica"))
    args = parser.parse_args()
    apply(args.root)


if __name__ == "__main__":
    main()
