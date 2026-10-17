"use client";
/**
 * Persisted TaskFlow AI eligibility settings. Native TaskFlow Issue/Project and
 * the authenticated API remain the authority; this store never dispatches a
 * provider or represents an approval/Run.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@multica/core/api";

export type Engineer = "co" | "gem";
type SettingKind = "project" | "issue";
type Setting = { enabled: boolean; engineer: Engineer };
type SettingState = Setting & {
  phase: "loading" | "ready" | "unavailable";
  saving: boolean;
  error: string;
};

const initial: SettingState = {
  enabled: false, engineer: "co", phase: "loading", saving: false, error: "",
};

function settingsURL(kind: SettingKind, workspaceId: string, objectId: string): URL {
  const base = api.getBaseUrl();
  if (!base || !api.getToken() || !/^[0-9a-f-]{36}$/i.test(workspaceId) ||
      !/^[0-9a-f-]{36}$/i.test(objectId)) throw new Error("TaskFlow identity unavailable");
  const url = new URL(base.replace(/\/$/, "") + "/api/" +
    (kind === "project" ? "projects/" : "issues/") + encodeURIComponent(objectId) + "/zhuge-ai/settings");
  url.searchParams.set("workspace_id", workspaceId);
  return url;
}

async function requestSetting(kind: SettingKind, workspaceId: string, objectId: string,
  method: "GET" | "PUT", setting?: Setting, signal?: AbortSignal): Promise<Setting> {
  const url = settingsURL(kind, workspaceId, objectId);
  const token = api.getToken();
  if (!token) throw new Error("TaskFlow session unavailable");
  const response = await fetch(url.toString(), {
    method,
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + token,
      ...(setting ? { "Content-Type": "application/json" } : {}),
    },
    credentials: "include",
    cache: "no-store",
    signal,
    ...(setting ? { body: JSON.stringify(setting) } : {}),
  });
  if (!response.ok) throw new Error("TaskFlow AI settings unavailable");
  const value = await response.json() as Partial<Setting>;
  if (typeof value.enabled !== "boolean" || (value.engineer !== "co" && value.engineer !== "gem"))
    throw new Error("Invalid TaskFlow AI settings response");
  return { enabled: value.enabled, engineer: value.engineer };
}

function useSetting(kind: SettingKind, workspaceId: string, objectId: string) {
  const [state, setState] = useState<SettingState>(initial);
  const activeKey = useRef("");
  const key = `${kind}:${workspaceId}:${objectId}`;
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    activeKey.current = key;
    setState(initial);
    const load = async () => {
      try {
        const value = await requestSetting(kind, workspaceId, objectId, "GET", undefined, controller.signal);
        if (active && !controller.signal.aborted) setState({ ...value, phase: "ready", saving: false, error: "" });
      } catch {
        if (active && !controller.signal.aborted) setState({ ...initial, phase: "unavailable", error: "設定讀取失敗；目前不會啟用或派工。" });
      }
    };
    if (objectId) void load();
    return () => {
      active = false;
      controller.abort();
      if (activeKey.current === key) activeKey.current = "";
    };
  }, [kind, workspaceId, objectId, key]);

  const save = useCallback(async (next: Setting) => {
    if (state.phase !== "ready" || state.saving) return false;
    const requestKey = key;
    setState(current => ({ ...current, saving: true, error: "" }));
    try {
      const value = await requestSetting(kind, workspaceId, objectId, "PUT", next);
      if (activeKey.current !== requestKey) return false;
      setState({ ...value, phase: "ready", saving: false, error: "" });
      return true;
    } catch {
      if (activeKey.current !== requestKey) return false;
      setState(current => ({ ...current, saving: false, error: "設定儲存失敗；已保留最後一次讀回的設定。" }));
      return false;
    }
  }, [kind, workspaceId, objectId, key, state.phase, state.saving]);

  return {
    ...state,
    setEnabled: (enabled: boolean) => save({ enabled, engineer: state.engineer }),
    setEngineer: (engineer: Engineer) => save({ enabled: state.enabled, engineer }),
  };
}

export function useTaskFlowAIProjectSettings(workspaceId: string, projectId: string) {
  return useSetting("project", workspaceId, projectId);
}

export function useTaskFlowAIIssueSettings(workspaceId: string, issueId: string) {
  return useSetting("issue", workspaceId, issueId);
}
