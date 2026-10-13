"use client";

import { createContext, useCallback, useContext, useMemo, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { useWorkspaceId } from "@multica/core/hooks";
import { issueViewPreferenceOptions, issueViewPrefKeys } from "@multica/core/issue-views/preferences";
import type { IssueStatusCatalog } from "@multica/core/issue-statuses/queries";
import type { IssueViewPreference } from "@multica/core/api/schemas";
import { DEFAULT_HIDDEN_STATUSES } from "@multica/core/issues/stores/view-store";

const PROJECT_STATUS_KEY_RE = /^p([0-9a-v]{26})_([0-9a-v]{4})$/;
const DIGITS = "0123456789abcdefghijklmnopqrstuv";

export interface TaskFlowProjectStatusSettings {
  projectId: string | null;
  hiddenStatusKeys: string[];
  isLoading: boolean;
  saveHiddenStatusKeys: (keys: string[] | null) => Promise<void>;
  setStatusVisible: (key: string, visible: boolean) => Promise<void>;
}

const EMPTY_SETTINGS: TaskFlowProjectStatusSettings = {
  projectId: null,
  hiddenStatusKeys: [...DEFAULT_HIDDEN_STATUSES],
  isLoading: false,
  saveHiddenStatusKeys: async () => undefined,
  setStatusVisible: async () => undefined,
};

const TaskFlowProjectStatusContext = createContext<TaskFlowProjectStatusSettings>(EMPTY_SETTINGS);

/**
 * Project-specific custom statuses live in the native workspace status catalog.
 * The key embeds the owning Project UUID, allowing this overlay to scope the
 * assignable catalog without adding a table or modifying the frozen vendor.
 */
export function encodeTaskFlowProjectStatusKey(projectId: string, suffix: string): string {
  const hex = projectId.replaceAll("-", "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex) || !/^[0-9a-v]{4}$/.test(suffix)) {
    throw new Error("Invalid Project ID or status suffix");
  }
  const encodedId = BigInt(`0x${hex}`).toString(32).padStart(26, "0");
  const key = `p${encodedId}_${suffix}`;
  if (key.length > 32) throw new Error("Project status key exceeds native limit");
  return key;
}

export function taskFlowProjectIdFromStatusKey(key: string): string | null {
  const match = PROJECT_STATUS_KEY_RE.exec(key);
  if (!match) return null;
  const encodedId = match[1];
  if (!encodedId) return null;
  let value = 0n;
  for (const character of encodedId) {
    value = value * 32n + BigInt(DIGITS.indexOf(character));
  }
  if (value >= (1n << 128n)) return null;
  const hex = value.toString(16).padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createTaskFlowProjectStatusKey(projectId: string, existingKeys: Set<string>): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const random = new Uint32Array(1);
    globalThis.crypto.getRandomValues(random);
    const suffix = ((random[0] ?? 0) & 0xfffff).toString(32).padStart(4, "0");
    const key = encodeTaskFlowProjectStatusKey(projectId, suffix);
    if (!existingKeys.has(key)) return key;
  }
  throw new Error("Unable to allocate a unique Project status key");
}

export function isTaskFlowProjectStatusKey(key: string): boolean {
  return taskFlowProjectIdFromStatusKey(key) !== null;
}

/** Filter only assignable columns; retain the full label lookup for historic rows. */
export function scopeTaskFlowStatusCatalog(
  catalog: IssueStatusCatalog,
  projectId: string | null,
): IssueStatusCatalog {
  // A project-owned status must not leak into the workspace-wide surface. A
  // project surface sees the native workspace statuses plus only its own
  // namespaced entries.
  const scopedStatuses = catalog.statuses.filter((entry) => {
    const ownerId = taskFlowProjectIdFromStatusKey(entry.key);
    return projectId
      ? ownerId === null || ownerId === projectId.toLowerCase()
      : ownerId === null;
  });
  const scopedKeys = new Set(scopedStatuses.map((entry) => entry.key));
  const activeStatuses = catalog.activeStatuses.filter((entry) => scopedKeys.has(entry.key));
  return {
    ...catalog,
    // Keep archived statuses in this Project for historical columns. Other
    // Project labels remain available through entryOf/labelOf, but never add
    // columns or assignment choices to this Project's surface.
    statuses: scopedStatuses,
    activeStatuses,
    inCategory: (category) => activeStatuses.filter((entry) => entry.category === category),
    hasCustomStatuses: activeStatuses.some((entry) => !entry.is_system),
  };
}

export function TaskFlowProjectStatusScopeProvider({
  projectId,
  children,
}: {
  projectId: string | null;
  children: ReactNode;
}) {
  const workspaceId = useWorkspaceId();
  const queryClient = useQueryClient();
  const writeQueue = useRef<Promise<void>>(Promise.resolve());
  const scope = useMemo(
    () => (projectId ? { scope_type: "project" as const, scope_id: projectId } : null),
    [projectId],
  );
  const query = useQuery<IssueViewPreference | null>({
    queryKey: scope
      ? issueViewPrefKeys.scope(workspaceId, scope)
      : ["taskflow-project-status-preferences", workspaceId, null],
    queryFn: async () => scope ? api.getIssueViewPreference(scope) : null,
    enabled: Boolean(workspaceId && scope),
  });
  const hiddenStatusKeys = useMemo(() => {
    const saved = query.data?.prefs.taskflow_hidden_statuses;
    if (!Array.isArray(saved)) return [...DEFAULT_HIDDEN_STATUSES];
    return [...new Set(saved.filter((key): key is string => typeof key === "string"))];
  }, [query.data]);

  const enqueue = useCallback(<T,>(operation: () => Promise<T>) => {
    const result = writeQueue.current.then(operation, operation);
    writeQueue.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  const persistHiddenStatusKeys = useCallback(async (
    update: { kind: "replace"; keys: string[] | null } | { kind: "visibility"; key: string; visible: boolean },
  ) => {
    if (!workspaceId || !projectId || !scope) throw new Error("Project status preferences require an active Project");
    const options = issueViewPreferenceOptions(workspaceId, scope);
    const current = await queryClient.fetchQuery(options);
    const prefs: Record<string, unknown> = { ...current.prefs };
    const stored = prefs.taskflow_hidden_statuses;
    const hidden = new Set(
      Array.isArray(stored)
        ? stored.filter((key): key is string => typeof key === "string")
        : DEFAULT_HIDDEN_STATUSES,
    );
    if (update.kind === "replace") {
      if (update.keys === null) delete prefs.taskflow_hidden_statuses;
      else prefs.taskflow_hidden_statuses = [...new Set(update.keys)];
    } else {
      if (update.visible) hidden.delete(update.key);
      else hidden.add(update.key);
      prefs.taskflow_hidden_statuses = [...hidden];
    }
    const updated = await api.putIssueViewPreference({
      ...scope,
      prefs: {
        ...prefs,
        hidden: current.prefs.hidden,
        order: current.prefs.order,
      } as typeof current.prefs,
    });
    queryClient.setQueryData(issueViewPrefKeys.scope(workspaceId, scope), updated);
  }, [projectId, queryClient, scope, workspaceId]);
  const saveHiddenStatusKeys = useCallback(
    (keys: string[] | null) => enqueue(() => persistHiddenStatusKeys({ kind: "replace", keys })),
    [enqueue, persistHiddenStatusKeys],
  );
  const setStatusVisible = useCallback(
    (key: string, visible: boolean) => enqueue(() => persistHiddenStatusKeys({ kind: "visibility", key, visible })),
    [enqueue, persistHiddenStatusKeys],
  );

  const value = useMemo<TaskFlowProjectStatusSettings>(() => ({
    projectId,
    hiddenStatusKeys,
    isLoading: Boolean(projectId && query.isPending),
    saveHiddenStatusKeys,
    setStatusVisible,
  }), [hiddenStatusKeys, projectId, query.isPending, saveHiddenStatusKeys, setStatusVisible]);

  return <TaskFlowProjectStatusContext.Provider value={value}>{children}</TaskFlowProjectStatusContext.Provider>;
}

export function useTaskFlowProjectStatusSettings(): TaskFlowProjectStatusSettings {
  return useContext(TaskFlowProjectStatusContext);
}
