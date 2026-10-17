import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTaskFlowAIIssueSettings, useTaskFlowAIProjectSettings } from "./taskflow-ai-settings-store";

vi.mock("@multica/core/api", async () => {
  const actual = await vi.importActual<typeof import("@multica/core/api")>("@multica/core/api");
  return { ...actual, api: { getBaseUrl: () => "https://taskflow-api.test", getToken: () => "native-token" } };
});

function response(status: number, value: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => value } as Response;
}

describe("persisted TaskFlow AI settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads and saves project and issue settings through the authenticated native API", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, { enabled: false, engineer: "co" }))
      .mockResolvedValueOnce(response(200, { enabled: true, engineer: "co" }))
      .mockResolvedValueOnce(response(200, { enabled: false, engineer: "co" }))
      .mockResolvedValueOnce(response(200, { enabled: false, engineer: "gem" }));
    vi.stubGlobal("fetch", fetchMock);

    const project = renderHook(() => useTaskFlowAIProjectSettings(
      "00000000-0000-0000-0000-000000000010", "00000000-0000-0000-0000-000000000020"));
    await waitFor(() => expect(project.result.current.phase).toBe("ready"));
    await act(async () => expect(await project.result.current.setEnabled(true)).toBe(true));
    expect(project.result.current.enabled).toBe(true);

    const issue = renderHook(() => useTaskFlowAIIssueSettings(
      "00000000-0000-0000-0000-000000000010", "00000000-0000-0000-0000-000000000030"));
    await waitFor(() => expect(issue.result.current.phase).toBe("ready"));
    await act(async () => expect(await issue.result.current.setEngineer("gem")).toBe(true));
    expect(issue.result.current).toMatchObject({ enabled: false, engineer: "gem", phase: "ready" });

    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url, init]) => [new URL(url).pathname, init.method])).toEqual([
      ["/api/projects/00000000-0000-0000-0000-000000000020/zhuge-ai/settings", "GET"],
      ["/api/projects/00000000-0000-0000-0000-000000000020/zhuge-ai/settings", "PUT"],
      ["/api/issues/00000000-0000-0000-0000-000000000030/zhuge-ai/settings", "GET"],
      ["/api/issues/00000000-0000-0000-0000-000000000030/zhuge-ai/settings", "PUT"],
    ]);
    for (const [url, init] of calls) {
      expect(new URL(url).searchParams.get("workspace_id")).toBe("00000000-0000-0000-0000-000000000010");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer native-token");
      expect(url).not.toMatch(/token|jwt/i);
    }
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ enabled: true, engineer: "co" });
    expect(JSON.parse(String(calls[3][1].body))).toEqual({ enabled: false, engineer: "gem" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("keeps the last read value when a save fails and ignores a stale workspace response", async () => {
    let resolveFirst: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("00000000-0000-0000-0000-000000000020")) {
        return new Promise<Response>(resolve => { resolveFirst = resolve; });
      }
      return Promise.resolve(response(200, { enabled: false, engineer: "co" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const first = "00000000-0000-0000-0000-000000000020";
    const second = "00000000-0000-0000-0000-000000000021";
    const view = renderHook(({ projectId }) => useTaskFlowAIProjectSettings(
      "00000000-0000-0000-0000-000000000010", projectId), { initialProps: { projectId: first } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    view.rerender({ projectId: second });
    await waitFor(() => expect(view.result.current.phase).toBe("ready"));
    resolveFirst?.(response(200, { enabled: true, engineer: "co" }));
    await act(async () => Promise.resolve());
    expect(view.result.current.enabled).toBe(false);

    fetchMock.mockResolvedValueOnce(response(503, {}));
    await act(async () => expect(await view.result.current.setEnabled(true)).toBe(false));
    expect(view.result.current).toMatchObject({ enabled: false, phase: "ready", saving: false });
    expect(view.result.current.error).toContain("已保留最後一次讀回的設定");
  });
});
