#!/usr/bin/env python3
"""Install the Pages-only access panel on the copied TaskFlow web source."""
import argparse
from pathlib import Path

TARGET = "packages/views/settings/components/settings-page.tsx"

def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f"access management marker must occur once: {old!r}")
    return source.replace(old, new, 1)

def patch(source):
    if "useTaskFlowAccessManagement" in source:
        raise ValueError("access management already patched")
    source = replace_once(source, 'import { WorkspaceTab } from "./workspace-tab";', 'import { WorkspaceTab } from "./workspace-tab";\nimport { useTaskFlowAccessManagement } from "./taskflow-access-management";')
    source = replace_once(source, '  const pluginsEnabled =', '  const accessActive = navigation.searchParams.get("tab") === "app-access";\n  const accessManagement = useTaskFlowAccessManagement(user?.id, accessActive);\n  const pluginsEnabled =')
    source = replace_once(source, '            entry("workspace",', '            ...(accessManagement.visible ? [entry("app-access", "全站存取管理", Lock, null)] : []),\n            entry("workspace",')
    return replace_once(source, '          {active.content}', '          {accessManagement.frame}\n          {accessActive ? null : active.content}')

def apply(root, overlays):
    root = root.resolve()
    if root.name == "multica" and root.parent.name == "third_party":
        raise ValueError("refusing frozen vendor; use a copied build tree")
    target = root / TARGET
    source = patch(target.read_text())
    component = (overlays / "taskflow-access-management.tsx").read_text()
    test = (overlays / "taskflow-access-management.test.tsx").read_text()
    target.write_text(source)
    (target.parent / "taskflow-access-management.tsx").write_text(component)
    (target.parent / "taskflow-access-management.test.tsx").write_text(test)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--overlays", type=Path, required=True)
    args = parser.parse_args()
    apply(args.root, args.overlays)
