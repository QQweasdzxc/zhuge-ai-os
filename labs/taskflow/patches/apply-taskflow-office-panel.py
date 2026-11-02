#!/usr/bin/env python3
"""Install the office overlay in a copied web tree; frozen vendor is read-only."""
from __future__ import annotations
import argparse
from pathlib import Path

LAYOUT = "packages/views/layout/dashboard-layout.tsx"
COMMON = "packages/views/common"
MODULES = ("taskflow-office-panel.tsx", "taskflow-office-panel.test.tsx")


def replace_exact(text: str, old: str, replacement: str, purpose: str) -> str:
    count = text.count(old)
    if count != 1:
        raise ValueError(f"{purpose}: exact upstream marker required, found {count}")
    return text.replace(old, replacement, 1)


def patch_layout(text: str) -> str:
    if "TASKFLOW_OFFICE_PANEL_V1" in text:
        raise ValueError("office panel already patched")
    text = replace_exact(text,
        'import { GlobalShortcuts } from "./global-shortcuts";',
        'import { GlobalShortcuts } from "./global-shortcuts";\n'
        'import { TaskFlowOfficePanel } from "../common/taskflow-office-panel";',
        "office panel import")
    return replace_exact(text,
        '        <WorkspacePresencePrefetch />',
        '        <WorkspacePresencePrefetch />\n'
        '        {/* TASKFLOW_OFFICE_PANEL_V1 */}\n'
        '        <TaskFlowOfficePanel />',
        "shared dashboard shell")


def apply(root: Path, overlays: Path) -> None:
    root = root.resolve()
    # A mistaken --root must never edit the frozen source in-place.
    if root.name == "multica" and root.parent.name == "third_party":
        raise ValueError("refusing frozen third_party/multica; use a copied build tree")
    target = root / LAYOUT
    result = patch_layout(target.read_text())
    sources = {}
    for name in MODULES:
        destination = root / COMMON / name
        if destination.exists():
            raise ValueError(f"office source already installed: {destination}")
        sources[destination] = (overlays / name).read_text()
    # Validate every input and destination before writing anything.
    for destination, content in sources.items():
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content)
    target.write_text(result)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--overlays", type=Path, required=True)
    args = parser.parse_args()
    apply(args.root, args.overlays)


if __name__ == "__main__":
    main()
