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
  statusLabels: Record<string, string>;
  statusOrder: string[];
  setStatusOrder: (keys: string[]) => Promise<void>;
  isLoading: boolean;
  saveHiddenStatusKeys: (keys: string[] | null) => Promise<void>;
  setStatusVisible: (key: string, visible: boolean) => Promise<void>;
  setStatusLabel: (key: string, label: string) => Promise<void>;
}

const EMPTY_SETTINGS: TaskFlowProjectStatusSettings = {
  projectId: null,
  hiddenStatusKeys: [...DEFAULT_HIDDEN_STATUSES],
  statusLabels: {},
  statusOrder: [],
  setStatusOrder: async () => undefined,
  isLoading: false,
  saveHiddenStatusKeys: async () => undefined,
  setStatusVisible: async () => undefined,
  setStatusLabel: async () => undefined,
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

/**
 * The native status table enforces active-name uniqueness per Workspace.
 * Store an opaque, stable native name and keep the Project's display label in
 * its existing per-user view preference instead. This permits two Projects
 * to use the same visible label without changing the native schema or index.
 */
export function taskFlowInternalProjectStatusName(key: string): string {
  if (!isTaskFlowProjectStatusKey(key)) throw new Error("Invalid TaskFlow Project status key");
  return `TF:${key}`;
}

/**
 * The workspace-wide status catalog excludes Project-owned keys: they are
 * created and managed on their Project surface with per-user display labels,
 * so the opaque `TF:<key>` native names must not render in workspace
 * settings. Render-only; entries and keys are never modified.
 */
export function excludeTaskFlowProjectStatuses<T extends { key: string }>(entries: readonly T[]): T[] {
  return entries.filter((entry) => !isTaskFlowProjectStatusKey(entry.key));
}

/** The native reorder API requires every active row in the category. */
export function mergeTaskFlowWorkspaceStatusOrder<T extends { key: string }>(
  allEntries: readonly T[],
  visibleOrder: readonly T[],
): T[] {
  let index = 0;
  return allEntries.map((entry) => isTaskFlowProjectStatusKey(entry.key)
    ? entry
    : visibleOrder[index++] ?? entry);
}

/** Unknown/duplicate keys never add columns; newly created statuses append. */
export function orderTaskFlowStatuses<T extends { key: string }>(entries: readonly T[], order: readonly string[]): T[] {
  const rank = new Map<string, number>();
  for (const key of order) if (!rank.has(key)) rank.set(key, rank.size);
  return entries.map((entry, index) => ({ entry, index }))
    .sort((a, b) => (rank.get(a.entry.key) ?? order.length + a.index) - (rank.get(b.entry.key) ?? order.length + b.index))
    .map(({ entry }) => entry);
}

/** Filter only assignable columns; retain the full label lookup for historic rows. */
export function scopeTaskFlowStatusCatalog(
  catalog: IssueStatusCatalog,
  projectId: string | null,
  statusLabels: Record<string, string> = {},
  statusOrder: string[] = [],
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
  const withProjectLabels = (entry: IssueStatusCatalog["statuses"][number]) => {
    const ownerId = taskFlowProjectIdFromStatusKey(entry.key);
    const label = projectId && ownerId === projectId.toLowerCase() ? statusLabels[entry.key] : undefined;
    return label?.trim() ? { ...entry, name: label.trim() } : entry;
  };
  const statuses = orderTaskFlowStatuses(scopedStatuses.map(withProjectLabels), projectId ? statusOrder : []);
  const byKey = new Map(statuses.map((entry) => [entry.key, entry]));
  const scopedKeys = new Set(statuses.map((entry) => entry.key));
  const activeStatuses = orderTaskFlowStatuses(catalog.activeStatuses
    .filter((entry) => scopedKeys.has(entry.key))
    .map(withProjectLabels), projectId ? statusOrder : []);
  return {
    ...catalog,
    // Keep archived statuses in this Project for historical columns. Other
    // Project labels remain available through entryOf/labelOf, but never add
    // columns or assignment choices to this Project's surface.
    statuses,
    activeStatuses,
    entryOf: (statusKey) => byKey.get(statusKey) ?? catalog.entryOf(statusKey),
    labelOf: (statusKey) => byKey.get(statusKey)?.name ?? catalog.labelOf(statusKey),
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
  const statusLabels = useMemo(() => {
    const saved = query.data?.prefs.taskflow_project_status_labels;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved).filter(([key, value]) =>
        taskFlowProjectIdFromStatusKey(key) === projectId?.toLowerCase()
        && typeof value === "string"
        && value.trim().length > 0
        && value.length <= 64,
      ),
    );
  }, [projectId, query.data]);

  const statusOrder = useMemo(() => {
    const saved = query.data?.prefs.taskflow_project_status_order;
    return Array.isArray(saved) ? [...new Set(saved.filter((key): key is string => typeof key === "string" && (!taskFlowProjectIdFromStatusKey(key) || taskFlowProjectIdFromStatusKey(key) === projectId?.toLowerCase())))] : [];
  }, [projectId, query.data]);

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
  const persistStatusLabel = useCallback(async (key: string, label: string) => {
    if (!workspaceId || !projectId || !scope) throw new Error("Project status labels require an active Project");
    if (taskFlowProjectIdFromStatusKey(key) !== projectId.toLowerCase()) {
      throw new Error("Status label does not belong to the active Project");
    }
    const normalized = label.trim();
    if (!normalized || normalized.length > 64) throw new Error("Status label must contain 1 to 64 characters");
    const options = issueViewPreferenceOptions(workspaceId, scope);
    const current = await queryClient.fetchQuery(options);
    const prefs: Record<string, unknown> = { ...current.prefs };
    const stored = prefs.taskflow_project_status_labels;
    const labels = stored && typeof stored === "object" && !Array.isArray(stored)
      ? { ...(stored as Record<string, unknown>) }
      : {};
    labels[key] = normalized;
    const updated = await api.putIssueViewPreference({
      ...scope,
      prefs: {
        ...prefs,
        taskflow_project_status_labels: labels,
        hidden: current.prefs.hidden,
        order: current.prefs.order,
      } as typeof current.prefs,
    });
    queryClient.setQueryData(issueViewPrefKeys.scope(workspaceId, scope), updated);
  }, [projectId, queryClient, scope, workspaceId]);
  const persistStatusOrder = useCallback(async (keys: string[]) => {
    if (!workspaceId || !projectId || !scope) throw new Error("Project status order requires an active Project");
    const normalized = [...new Set(keys)];
    if (normalized.some(key => taskFlowProjectIdFromStatusKey(key) && taskFlowProjectIdFromStatusKey(key) !== projectId.toLowerCase())) throw new Error("Status order contains another Project's status");
    const current = await queryClient.fetchQuery({ ...issueViewPreferenceOptions(workspaceId, scope), staleTime: 0 });
    const updated = await api.putIssueViewPreference({ ...scope, prefs: { ...current.prefs, taskflow_project_status_order: normalized } as typeof current.prefs });
    queryClient.setQueryData(issueViewPrefKeys.scope(workspaceId, scope), updated);
  }, [projectId, queryClient, scope, workspaceId]);
  const setStatusOrder = useCallback((keys: string[]) => enqueue(() => persistStatusOrder(keys)), [enqueue, persistStatusOrder]);
  const saveHiddenStatusKeys = useCallback(
    (keys: string[] | null) => enqueue(() => persistHiddenStatusKeys({ kind: "replace", keys })),
    [enqueue, persistHiddenStatusKeys],
  );
  const setStatusVisible = useCallback(
    (key: string, visible: boolean) => enqueue(() => persistHiddenStatusKeys({ kind: "visibility", key, visible })),
    [enqueue, persistHiddenStatusKeys],
  );
  const setStatusLabel = useCallback(
    (key: string, label: string) => enqueue(() => persistStatusLabel(key, label)),
    [enqueue, persistStatusLabel],
  );

  const value = useMemo<TaskFlowProjectStatusSettings>(() => ({
    projectId,
    hiddenStatusKeys,
    statusLabels,
    statusOrder,
    setStatusOrder,
    isLoading: Boolean(projectId && query.isPending),
    saveHiddenStatusKeys,
    setStatusVisible,
    setStatusLabel,
  }), [hiddenStatusKeys, projectId, query.isPending, saveHiddenStatusKeys, setStatusLabel, setStatusVisible, statusLabels, statusOrder, setStatusOrder]);

  return <TaskFlowProjectStatusContext.Provider value={value}>{children}</TaskFlowProjectStatusContext.Provider>;
}

export function useTaskFlowProjectStatusSettings(): TaskFlowProjectStatusSettings {
  return useContext(TaskFlowProjectStatusContext);
    }
