#!/usr/bin/env python3
"""TaskFlow AI approval/readback panels layered over frozen Multica source.

Fail closed on upstream drift. Provider dispatch is intentionally not
configured. This script only changes a copied TaskFlow web build tree.
"""
from __future__ import annotations
import argparse
from pathlib import Path

ISSUE = "packages/views/issues/components/issue-detail.tsx"
PROJECT = "packages/views/projects/components/project-detail.tsx"
COMMON = "packages/views/common"
API_INDEX = "packages/core/api/index.ts"
MODULES = (
    "taskflow-ai-engineering-policy.ts",
    "taskflow-ai-settings-store.ts",
    "taskflow-ai-engineering.tsx",
    "taskflow-ai-engineering-policy.test.ts",
    "taskflow-ai-run-readback.tsx",
    "taskflow-ai-run-readback.test.tsx",
)
API_MODULES = (
    "taskflow-ai-run-schema.ts",
    "taskflow-ai-run-schema.test.ts",
)

def replace_exact(text: str, old: str, replacement: str, purpose: str) -> str:
    n = text.count(old)
    if n != 1:
        raise ValueError(f"{purpose}: exact upstream marker required, found {n}")
    return text.replace(old, replacement, 1)

def patch_issue(text: str) -> str:
    if "TASKFLOW_AI_EXECUTION_V1" in text:
        raise ValueError("AI execution sidebar already patched")
    text = replace_exact(text,
        'import { PluginPanelSection } from "../../plugins";',
        'import { PluginPanelSection } from "../../plugins";\n'
        'import { TaskFlowAIIssueSection } from "../../common/taskflow-ai-engineering";',
        "native issue import")
    text = replace_exact(text,
        'import { TaskFlowAIIssueSection } from "../../common/taskflow-ai-engineering";',
        'import { TaskFlowAIIssueSection } from "../../common/taskflow-ai-engineering";\n'
        'import { TaskFlowAIRunReadback } from "../../common/taskflow-ai-run-readback";',
        "native Run readback import")
    text = replace_exact(text,
        '      <PluginPanelSection issueId={issue.id} />',
        '      <PluginPanelSection issueId={issue.id} />\n'
        '      {/* TASKFLOW_AI_EXECUTION_V1: optional panel, not an assignee or Wakeup. */}\n'
        '      <TaskFlowAIIssueSection workspaceId={wsId} projectId={issue.project_id}'
        ' issueId={issue.id} canManage={currentUserRole === "owner" || currentUserRole === "admin"} />\n'
        '      <TaskFlowAIRunReadback workspaceId={wsId} issueId={issue.id}'
        ' issueRevision={issue.revision ?? 0} />',
        "native sidebar between Wakeups and PR")
    return text

def patch_project(text: str) -> str:
    if "TASKFLOW_AI_PROJECT_V1" in text:
        raise ValueError("AI project preview already patched")
    text = replace_exact(text,
        'import { ProjectResourcesSection } from "./project-resources-section";',
        'import { ProjectResourcesSection } from "./project-resources-section";\n'
        'import { TaskFlowAIProjectSettings } from "../../common/taskflow-ai-engineering";',
        "native project import")
    text = replace_exact(text,
        '      {/* Progress */}',
        '      {/* TASKFLOW_AI_PROJECT_V1: persisted setting, default OFF. */}\n'
        '      <TaskFlowAIProjectSettings workspaceId={wsId} projectId={projectId}'
        ' canManage={isWorkspaceAdmin} />\n\n'
        '      {/* Progress */}',
        "native project settings location")
    return text

def patch_api_index(text: str) -> str:
    marker = 'export { DuplicateIssueErrorBodySchema } from "./schemas";'
    if "TaskFlowAIEngineeringRunListSchema" in text:
        raise ValueError("TaskFlow AI Run API exports already patched")
    return replace_exact(
        text,
        marker,
        marker + '\nexport { TaskFlowAIEngineeringRunListSchema } from "./taskflow-ai-run-schema";'
        + '\nexport type { TaskFlowAIEngineeringRun, TaskFlowAIEngineeringEvent } from "./taskflow-ai-run-schema";',
        "TaskFlow API response schema export",
    )

def apply(root: Path, overlays: Path) -> None:
    for name in (*MODULES, *API_MODULES):
        source = overlays / name
        if not source.is_file():
            raise FileNotFoundError(f"required TaskFlow AI overlay missing: {source}")
    for relative, transform in ((ISSUE, patch_issue), (PROJECT, patch_project), (API_INDEX, patch_api_index)):
        target = root / relative
        if not target.is_file():
            raise FileNotFoundError(target)
        result = transform(target.read_text())
        target.write_text(result)
    for target_dir, names in ((root / COMMON, MODULES), (root / "packages/core/api", API_MODULES)):
        target_dir.mkdir(parents=True, exist_ok=True)
        for name in names:
            dst = target_dir / name
            if dst.exists():
                raise ValueError(f"AI source already installed in build copy: {dst}")
            dst.write_text((overlays / name).read_text())

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--overlays", type=Path, required=True)
    args = parser.parse_args()
    apply(args.root.resolve(), args.overlays.resolve())

if __name__ == "__main__":
    main()
