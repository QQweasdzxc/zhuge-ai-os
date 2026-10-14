#!/usr/bin/env python3
"""Apply TaskFlow project-scoped status fields over the frozen Multica build copy."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f"{label}: expected one upstream marker, found {count}")
    return source.replace(old, new, 1)


def patch_status_hook(source: str) -> str:
    if "TASKFLOW_PROJECT_STATUS_SCOPE" in source:
        raise ValueError("TaskFlow project status scope already applied")
    source = replace_once(
        source,
        'import { useCallback, useMemo } from "react";\n',
        'import { useCallback, useMemo } from "react";\n'
        'import { scopeTaskFlowStatusCatalog, useTaskFlowProjectStatusSettings } from "./taskflow-project-status-scope";\n',
        "project status catalog scope import",
    )
    source = replace_once(
        source,
        '''  return useMemo(
    () => buildIssueStatusCatalog(data, { isPending, isError, retry }),
    [data, isPending, isError, retry],
  );''',
        '''  const projectStatusSettings = useTaskFlowProjectStatusSettings();
  const catalog = useMemo(
    () => buildIssueStatusCatalog(data, { isPending, isError, retry }),
    [data, isPending, isError, retry],
  );
  // TASKFLOW_PROJECT_STATUS_SCOPE: project-owned keys are assignable only in
  // their Project surface; all rows remain available for historical labels.
  return useMemo(
    () => scopeTaskFlowStatusCatalog(catalog, projectStatusSettings.projectId, projectStatusSettings.statusLabels),
    [catalog, projectStatusSettings.projectId, projectStatusSettings.statusLabels],
  );''',
        "scope project-owned status choices",
    )
    return source


def patch_issue_surface(source: str) -> str:
    if "TaskFlowProjectStatusScopeProvider" in source:
        raise ValueError("TaskFlow Project status provider already applied")
    source = replace_once(
        source,
        'import type { IssueViewScope } from "@multica/core/issue-views/queries";\n',
        'import type { IssueViewScope } from "@multica/core/issue-views/queries";\n'
        'import { TaskFlowProjectStatusScopeProvider } from "@multica/core/issue-statuses/taskflow-project-status-scope";\n',
        "project status provider import",
    )
    source = replace_once(
        source,
        '''  return <ViewStoreProvider store={store}>
    <ViewBaselineProvider baseline={baseline}>
      <IssueSurfaceContent key={wsId} {...props} />
    </ViewBaselineProvider>
  </ViewStoreProvider>;''',
        '''  const projectId = props.scope.type === "project" ? props.scope.projectId : null;
  return <TaskFlowProjectStatusScopeProvider projectId={projectId}>
    <ViewStoreProvider store={store}>
      <ViewBaselineProvider baseline={baseline}>
        <IssueSurfaceContent key={wsId} {...props} />
      </ViewBaselineProvider>
    </ViewStoreProvider>
  </TaskFlowProjectStatusScopeProvider>;''',
        "explicit-store Project status scope",
    )
    source = replace_once(
        source,
        '''  return (
    <ViewStoreProvider store={store}>
      <ViewBaselineProvider baseline={viewBaseline}>''',
        '''  return (
    <TaskFlowProjectStatusScopeProvider projectId={effectiveScope.type === "project" ? effectiveScope.projectId : null}>
      <ViewStoreProvider store={store}>
        <ViewBaselineProvider baseline={viewBaseline}>''',
        "surface Project status scope provider",
    )
    source = replace_once(
        source,
        '''      </ViewBaselineProvider>
    </ViewStoreProvider>
  );
}

function IssueSurfaceContent''',
        '''        </ViewBaselineProvider>
      </ViewStoreProvider>
    </TaskFlowProjectStatusScopeProvider>
  );
}

function IssueSurfaceContent''',
        "close Project status scope provider",
    )
    return source


def patch_surface_controller(source: str) -> str:
    if "TASKFLOW_PROJECT_STATUS_VISIBILITY" in source:
        raise ValueError("TaskFlow Project status visibility already applied")
    source = replace_once(
        source,
        'import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";\n',
        'import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";\n'
        'import { useTaskFlowProjectStatusSettings } from "@multica/core/issue-statuses/taskflow-project-status-scope";\n',
        "Project status preferences import",
    )
    source = replace_once(
        source,
        '''  const hiddenStatusKeys = useViewStore((s) => s.hiddenStatuses);
  const catalog = useIssueStatuses(wsId);''',
        '''  const localHiddenStatusKeys = useViewStore((s) => s.hiddenStatuses);
  const projectStatusSettings = useTaskFlowProjectStatusSettings();
  // TASKFLOW_PROJECT_STATUS_VISIBILITY: project status columns are shared
  // across that Project's native views and devices via its existing preference.
  const hiddenStatusKeys = projectId && projectStatusSettings.projectId === projectId
    ? projectStatusSettings.hiddenStatusKeys
    : localHiddenStatusKeys;
  const catalog = useIssueStatuses(wsId);''',
        "project preference drives native status columns",
    )
    return source


def patch_issue_header(source: str) -> str:
    if "TaskFlowProjectStatusSettings" in source:
        raise ValueError("TaskFlow Project status settings already mounted")
    source = replace_once(
        source,
        'import { TableColumnPicker } from "./table-view";\n',
        'import { TableColumnPicker } from "./table-view";\n'
        'import { TaskFlowProjectStatusSettings } from "./taskflow-project-status-settings";\n',
        "Project status settings component import",
    )
    source = replace_once(
        source,
        '''          <IssueDisplayControls
            scopedIssues={scopedIssues}
            allowGantt={allowGantt}''',
        '''          {saveViewScope?.kind === "project" && (
            <TaskFlowProjectStatusSettings projectId={saveViewScope.projectId} />
          )}
          <IssueDisplayControls
            scopedIssues={scopedIssues}
            allowGantt={allowGantt}''',
        "Project status settings entry",
    )
    return source


def patch_hidden_columns(source: str) -> str:
    if "useTaskFlowProjectStatusSettings" in source:
        raise ValueError("TaskFlow hidden column actions already patched")
    source = replace_once(
        source,
        'import { useStatusLabel } from "../utils/status-label";\n',
        'import { useStatusLabel } from "../utils/status-label";\n'
        'import { useTaskFlowProjectStatusSettings } from "@multica/core/issue-statuses/taskflow-project-status-scope";\n',
        "hidden column Project preferences import",
    )
    source = replace_once(
        source,
        '''  const viewStoreApi = useViewStoreApi();
  return (''',
        '''  const viewStoreApi = useViewStoreApi();
  const projectStatusSettings = useTaskFlowProjectStatusSettings();
  const showStatus = () => {
    if (projectStatusSettings.projectId) {
      void projectStatusSettings.setStatusVisible(status, true)
        .catch(() => toast.error(t(($) => $.taskflow_project_status.save_failed)));
    } else {
      viewStoreApi.getState().showStatus(status);
    }
  };
  return (''',
        "hidden-column show behavior",
    )
    source = replace_once(
        source,
        'onClick={() => viewStoreApi.getState().showStatus(status)}',
        'onClick={showStatus}',
        "hidden-column show click",
    )
    source = replace_once(
        source,
        'import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";\n',
        'import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";\n'
        'import { toast } from "sonner";\n',
        "hidden column toast import",
    )
    return source


def patch_board_column(source: str) -> str:
    if "TASKFLOW_PROJECT_HIDE_STATUS" in source:
        raise ValueError("TaskFlow board column hide action already patched")
    source = replace_once(
        source,
        'import { useViewStoreApi } from "@multica/core/issues/stores/view-store-context";\n',
        'import { useViewStoreApi } from "@multica/core/issues/stores/view-store-context";\n'
        'import { useTaskFlowProjectStatusSettings } from "@multica/core/issue-statuses/taskflow-project-status-scope";\n'
        'import { toast } from "sonner";\n',
        "board column Project status preferences import",
    )
    source = replace_once(
        source,
        '''  const viewStoreApi = useViewStoreApi();
  // A status fixed by the open saved view cannot be hidden from the board —''',
        '''  const viewStoreApi = useViewStoreApi();
  const projectStatusSettings = useTaskFlowProjectStatusSettings();
  const hideStatus = () => {
    if (!status) return;
    if (projectStatusSettings.projectId) {
      void projectStatusSettings.setStatusVisible(status, false)
        .catch(() => toast.error(t(($) => $.taskflow_project_status.save_failed)));
    } else {
      viewStoreApi.getState().hideStatus(status);
    }
  };
  // TASKFLOW_PROJECT_HIDE_STATUS: persist the action at Project scope.
  // A status fixed by the open saved view cannot be hidden from the board —''',
        "board column hide behavior",
    )
    source = replace_once(
        source,
        'onClick={() => viewStoreApi.getState().hideStatus(status)}',
        'onClick={hideStatus}',
        "board column hide click",
    )
    return source


def patch_swimlane(source: str) -> str:
    if "TASKFLOW_PROJECT_HIDE_SWIMLANE_STATUS" in source:
        raise ValueError("TaskFlow swimlane status hide action already patched")
    source = replace_once(
        source,
        'import { useViewStore, useViewStoreApi } from "@multica/core/issues/stores/view-store-context";\n',
        'import { useViewStore, useViewStoreApi } from "@multica/core/issues/stores/view-store-context";\n'
        'import { useTaskFlowProjectStatusSettings } from "@multica/core/issue-statuses/taskflow-project-status-scope";\n'
        'import { toast } from "sonner";\n',
        "swimlane Project status preferences import",
    )
    source = replace_once(
        source,
        '''  const paths = useWorkspacePaths();
  const viewStoreApi = useViewStoreApi();
  const viewBaseline = useViewBaseline();''',
        '''  const paths = useWorkspacePaths();
  const viewStoreApi = useViewStoreApi();
  const projectStatusSettings = useTaskFlowProjectStatusSettings();
  const viewBaseline = useViewBaseline();''',
        "swimlane Project status preferences hook",
    )
    source = replace_once(
        source,
        'onClick={() => viewStoreApi.getState().hideStatus(status)}',
        '''onClick={() => {
                              if (projectStatusSettings.projectId) {
                                void projectStatusSettings.setStatusVisible(status, false)
                                  .catch(() => toast.error(t(($) => $.taskflow_project_status.save_failed)));
                              } else {
                                viewStoreApi.getState().hideStatus(status);
                              }
                            }}''',
        "swimlane hide click",
    )
    source = replace_once(
        source,
        'onClick={() => {\n                              if (projectStatusSettings.projectId)',
        'onClick={() => {\n                              // TASKFLOW_PROJECT_HIDE_SWIMLANE_STATUS: preserve workspace behavior.\n                              if (projectStatusSettings.projectId)',
        "swimlane Project status hide marker",
    )
    return source


def patch_preferences(source: str) -> str:
    if "TASKFLOW_PRESERVE_PROJECT_STATUS_PREFS" in source:
        raise ValueError("TaskFlow project preference merge already applied")
    source = replace_once(
        source,
        '''    mutationFn: (prefs: ViewBarPrefs) =>
      api.putIssueViewPreference({ ...scope, prefs }),''',
        '''    mutationFn: async (prefs: ViewBarPrefs) => {
      const current = await queryClient.fetchQuery(issueViewPreferenceOptions(wsId, scope));
      // TASKFLOW_PRESERVE_PROJECT_STATUS_PREFS: the native endpoint stores a
      // whole JSON document, so preserve TaskFlow's Project-scoped fields.
      return api.putIssueViewPreference({
        ...scope,
        prefs: { ...current.prefs, ...prefs },
      });
    },''',
        "merge native ViewBar preference updates",
    )
    source = replace_once(
        source,
        'prefs: { ...prefs },',
        'prefs: { ...previous?.prefs, ...prefs },',
        "optimistic preference merge",
    )
    return source


def patch_locales(root: Path, locale_overlay: Path) -> None:
    additions = json.loads((locale_overlay / "taskflow-project-status-locales.json").read_text())
    for locale, messages in additions.items():
        path = root / "packages/views/locales" / locale / "issues.json"
        data = json.loads(path.read_text())
        if "taskflow_project_status" in data:
            raise ValueError(f"Project status locale already exists: {locale}")
        data["taskflow_project_status"] = messages
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")


def patch_core_exports(root: Path) -> None:
    path = root / "packages/core/package.json"
    package = json.loads(path.read_text())
    export_name = "./issue-statuses/taskflow-project-status-scope"
    if export_name in package.get("exports", {}):
        raise ValueError(f"TaskFlow status scope export already exists: {export_name}")
    package.setdefault("exports", {})[export_name] = "./issue-statuses/taskflow-project-status-scope.tsx"
    path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n")


def write_patch(root: Path, relative_path: str, patcher) -> None:
    path = root / relative_path
    if not path.is_file():
        raise FileNotFoundError(path)
    path.write_text(patcher(path.read_text()))


def apply(root: Path, overlay: Path) -> None:
    status_scope = overlay / "taskflow-project-status-scope.tsx"
    settings_component = overlay / "taskflow-project-status-settings.tsx"
    for required in (status_scope, settings_component):
        if not required.is_file():
            raise FileNotFoundError(required)

    copy_targets = {
        status_scope: root / "packages/core/issue-statuses/taskflow-project-status-scope.tsx",
        overlay / "taskflow-project-status-scope.test.ts": root / "packages/core/issue-statuses/taskflow-project-status-scope.test.ts",
        overlay / "taskflow-project-status-preferences.test.tsx": root / "packages/core/issue-statuses/taskflow-project-status-preferences.test.tsx",
        settings_component: root / "packages/views/issues/components/taskflow-project-status-settings.tsx",
        overlay / "taskflow-project-status-settings.test.tsx": root / "packages/views/issues/components/taskflow-project-status-settings.test.tsx",
    }
    for source, target in copy_targets.items():
        if not source.is_file():
            raise FileNotFoundError(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source.read_text())

    write_patch(root, "packages/core/issue-statuses/hooks.ts", patch_status_hook)
    write_patch(root, "packages/views/issues/surface/issue-surface.tsx", patch_issue_surface)
    write_patch(root, "packages/views/issues/surface/use-issue-surface-controller.ts", patch_surface_controller)
    write_patch(root, "packages/views/issues/components/issues-header.tsx", patch_issue_header)
    write_patch(root, "packages/views/issues/components/hidden-columns-panel.tsx", patch_hidden_columns)
    write_patch(root, "packages/views/issues/components/board-column.tsx", patch_board_column)
    write_patch(root, "packages/views/issues/components/swimlane-view.tsx", patch_swimlane)
    write_patch(root, "packages/core/issue-views/preferences.ts", patch_preferences)
    patch_core_exports(root)
    patch_locales(root, overlay)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--overlays", type=Path, required=True)
    args = parser.parse_args()
    apply(args.root.resolve(), args.overlays.resolve())


if __name__ == "__main__":
    main()
