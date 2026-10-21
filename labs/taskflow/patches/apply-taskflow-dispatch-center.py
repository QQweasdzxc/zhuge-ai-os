"""Install the native Workspace dispatch center into a temporary build copy."""
import argparse
import json
from pathlib import Path

def replace(source, marker, value):
    if source.count(marker) != 1:
        raise ValueError(f"Dispatch center upstream drift: {marker[:80]}")
    return source.replace(marker, value, 1)

def apply(root, overlays, logic):
    paths = root / "packages/core/paths/paths.ts"
    if "aiDispatch:" in paths.read_text():
        raise ValueError("Dispatch center already applied")
    paths.write_text(replace(paths.read_text(), '    agents: () => `${ws}/agents`,', '    aiDispatch: () => `${ws}/ai-dispatch`,\n    agents: () => `${ws}/agents`,'))
    client = root / "packages/core/api/client.ts"
    client.write_text(replace(client.read_text(), '  // Issues\n', '''  // TASKFLOW_DISPATCH_READBACK: existing authenticated native transport.
  async getDispatchRuntime(id: string, workspaceSlug: string): Promise<unknown> {
    return this.fetch<unknown>(`/api/issues/${encodeURIComponent(id)}/dispatch-runtime`, {
      headers: { "X-Workspace-Slug": workspaceSlug },
    });
  }

  // Issues
'''))
    sidebar = root / "packages/views/layout/app-sidebar.tsx"
    sidebar.write_text(replace(sidebar.read_text(), '                {aiTeamNav.map((item) => {', '''                {/* TASKFLOW_NATIVE_DISPATCH_CENTER: same Workspace and session. */}
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={isNavActive(pathname, p.aiDispatch())}
                    render={<AppLink href={p.aiDispatch()} />} className={NAV_ITEM_CLASS_NAME}>
                    <Layers /><span>AI 派工中心</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {aiTeamNav.map((item) => {'''))
    sidebar_test = root / "packages/views/layout/app-sidebar.test.tsx"
    if sidebar_test.exists():
        sidebar_test.write_text(replace(sidebar_test.read_text(), '    agents: () => "/acme/agents",', '    aiDispatch: () => "/acme/ai-dispatch",\n    agents: () => "/acme/agents",'))
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
