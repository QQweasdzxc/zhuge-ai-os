import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskFlowAIRunReadback } from "./taskflow-ai-run-readback";

vi.mock("@multica/core/api", async () => {
  const actual = await vi.importActual<typeof import("@multica/core/api")>("@multica/core/api");
  return { ...actual, api: { getBaseUrl: () => "https://taskflow-api.test", getToken: () => "native-token" } };
});

function response(status: number, body: unknown) {
  return { status, json: async () => body } as Response;
}

const issueId = "00000000-0000-0000-0000-000000000020";
const workspaceId = "00000000-0000-0000-0000-000000000010";
const runId = "00000000-0000-0000-0000-000000000001";
const emptyRunList = { runs: [], dispatch_enabled: false };
const approvedRunList = { runs: [], dispatch_enabled: true };

describe("TaskFlow AI approval and Codex handoff", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("records PM approval without dispatch when the provider gate is off", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, emptyRunList))
      .mockRejectedValueOnce(new Error("connection dropped after request"))
      .mockResolvedValueOnce(response(201, {
        id: runId, taskflow_identifier: "ZG-42", state: "approved",
        dispatch_started: false, provider_status: "not_configured",
      }))
      .mockResolvedValueOnce(response(200, emptyRunList));
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskFlowAIRunReadback workspaceId={workspaceId} issueId={issueId}
      issueRevision={7} enabledForDispatch />);

    const button = await screen.findByRole("button", { name: "記錄 PM 核准（Codex 派工待啟用）" });
    fireEvent.click(button);
    await screen.findByText("無法確認核准結果；重試會沿用同一個冪等請求，不會重複建立。");
    fireEvent.click(button);

    await screen.findByText("ZG-42 已記錄 PM 核准；雲端派工目前未啟用。");
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(2);
    const first = posts[0][1] as RequestInit;
    const second = posts[1][1] as RequestInit;
    expect((first.headers as Record<string, string>).Authorization).toBe("Bearer native-token");
    expect(first.body).toBe(second.body);
    expect(JSON.parse(String(first.body))).toMatchObject({
      expected_issue_revision: 7, confirm_public_github_dispatch: false,
    });
    expect(JSON.parse(String(first.body)).idempotency_key).toMatch(/^[a-f0-9]{32}$/);
    expect(String(posts[0][0])).toContain(`/api/issues/${issueId}/zhuge-ai/approve`);
    expect(new URL(String(posts[0][0])).searchParams.get("workspace_id")).toBe(workspaceId);
    expect(String(posts[0][0])).not.toMatch(/token|jwt/i);
  });

  it("posts the explicit public-dispatch consent and reports pending until a real ACK", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, approvedRunList))
      .mockResolvedValueOnce(response(202, {
        id: runId, taskflow_identifier: "ZG-42", state: "provider_ack_pending",
        dispatch_started: false, dispatch_request_posted: true,
        github_dispatch_url: "https://github.com/QQweasdzxc/zhuge-ai-os/pull/52#issuecomment-1",
        provider_status: "waiting_for_signed_codex_ack",
      }))
      .mockResolvedValueOnce(response(200, approvedRunList));
    const confirm = vi.fn(() => true);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirm);
    render(<TaskFlowAIRunReadback workspaceId={workspaceId} issueId={issueId}
      issueRevision={7} enabledForDispatch />);

    fireEvent.click(await screen.findByRole("button", { name: "確認並派工至 Codex Cloud" }));
    await screen.findByText("ZG-42 已送出 GitHub 派工要求；等待 Codex 官方接單確認。");
    expect(confirm).toHaveBeenCalledOnce();
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(post).toBeTruthy();
    expect(JSON.parse(String((post?.[1] as RequestInit).body))).toMatchObject({
      expected_issue_revision: 7, confirm_public_github_dispatch: true,
    });
    expect(screen.queryByText("Codex 已確認・執行中")).toBeNull();
  });

  it("refuses the dispatch request when public-content confirmation is declined", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(200, approvedRunList));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => false));
    render(<TaskFlowAIRunReadback workspaceId={workspaceId} issueId={issueId}
      issueRevision={7} enabledForDispatch />);
    fireEvent.click(await screen.findByRole("button", { name: "確認並派工至 Codex Cloud" }));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "GET" });
  });

  it("uses a fresh idempotency key after a definitive revision conflict", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, emptyRunList))
      .mockResolvedValueOnce(response(409, {}))
      .mockResolvedValueOnce(response(200, emptyRunList))
      .mockResolvedValueOnce(response(201, {
        id: runId, taskflow_identifier: "ZG-42", state: "approved", dispatch_started: false,
      }))
      .mockResolvedValueOnce(response(200, emptyRunList));
    vi.stubGlobal("fetch", fetchMock);
    const props = { workspaceId, issueId, issueRevision: 7, enabledForDispatch: true };
    const view = render(<TaskFlowAIRunReadback {...props} />);
    const button = await screen.findByRole("button", { name: "記錄 PM 核准（Codex 派工待啟用）" });
    fireEvent.click(button);
    await screen.findByText("任務版本已變更或已有未結束 Run；請重新載入任務狀態後再試。");
    view.rerender(<TaskFlowAIRunReadback {...props} issueRevision={8} />);
    fireEvent.click(button);
    await screen.findByText("ZG-42 已記錄 PM 核准；雲端派工目前未啟用。");

    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(2);
    const first = JSON.parse(String((posts[0][1] as RequestInit).body));
    const second = JSON.parse(String((posts[1][1] as RequestInit).body));
    expect(first.expected_issue_revision).toBe(7);
    expect(second.expected_issue_revision).toBe(8);
    expect(first.idempotency_key).not.toBe(second.idempotency_key);
  });
});
