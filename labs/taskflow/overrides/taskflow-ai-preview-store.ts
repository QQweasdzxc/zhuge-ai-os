"use client";
/**
 * Deliberately ephemeral in-memory UI PREVIEW.
 * Never treat this map as a source of authorization, cross-device persistence,
 * PM approval, native TaskFlow Issue/Run state, or provider activation.
 */
import { useCallback, useSyncExternalStore } from "react";

type PreviewValues = { projectEnabled?: boolean; cardEnabled?: boolean };
const values = new Map<string, PreviewValues>();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {listeners.add(fn); return () => {listeners.delete(fn);};};
const falseOnServer = () => false;
function key(workspaceId: string, objectId: string, kind: "project"|"issue") {
  return workspaceId + ":" + kind + ":" + objectId;
}
function getValue(id: string, prop: keyof PreviewValues): boolean {
  return values.get(id)?.[prop] === true;
}
function change(id: string, prop: keyof PreviewValues, enabled: boolean) {
  values.set(id, {...values.get(id), [prop]: enabled});
  for (const listener of listeners) listener();
}
export function useTaskFlowAIProjectPreview(workspaceId: string, projectId: string) {
  const id = key(workspaceId, projectId, "project");
  const get = useCallback(() => getValue(id, "projectEnabled"), [id]);
  const enabled = useSyncExternalStore(subscribe, get, falseOnServer);
  return { enabled, setEnabled: (newValue: boolean) => change(id, "projectEnabled", newValue) };
}
export function useTaskFlowAICardPreview(workspaceId: string, issueId: string) {
  const id = key(workspaceId, issueId, "issue");
  const get = useCallback(() => getValue(id, "cardEnabled"), [id]);
  const enabled = useSyncExternalStore(subscribe, get, falseOnServer);
  return { enabled, setEnabled: (newValue: boolean) => change(id, "cardEnabled", newValue) };
}
