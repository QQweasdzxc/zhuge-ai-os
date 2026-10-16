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

const emptyRunList = { runs: [], dispatch_enabled: false };

describe("TaskFlow AI approval handoff", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("records only PM approval and reuses the same idempotency key after an uncertain network result", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, emptyRunList))
      .mockRejectedValueOnce(new Error("connection dropped after request"))
      .mockResolvedValueOnce(response(201, {
        id: "00000000-0000-0000-0000-000000000001",
        taskflow_identifier: "ZG-42",
        state: "approved",
        dispatch_started: false,
        provider_status: "not_configured",
      }))
      .mockResolvedValueOnce(response(200, emptyRunList));
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskFlowAIRunReadback workspaceId="00000000-0000-0000-0000-000000000010"
      issueId="00000000-0000-0000-0000-000000000020" issueRevision={7} />);

    const button = await screen.findByRole("button", { name: "記錄 PM 核准（不派工、不產生費用）" });
    fireEvent.click(button);
    await screen.findByText("無法確認核准結果；重試會沿用同一個冪等請求，不會重複建立。");
    fireEvent.click(button);

    await screen.findByText("ZG-42 已記錄 PM 核准；Codex 尚未接單。");
    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(2);
    const first = posts[0][1] as RequestInit;
    const second = posts[1][1] as RequestInit;
    expect((first.headers as Record<string, string>).Authorization).toBe("Bearer native-token");
    expect(first.body).toBe(second.body);
    expect(JSON.parse(String(first.body))).toMatchObject({ expected_issue_revision: 7 });
    expect(JSON.parse(String(first.body)).idempotency_key).toMatch(/^[a-f0-9]{32}$/);
    expect(String(posts[0][0])).toContain("/api/issues/00000000-0000-0000-0000-000000000020/zhuge-ai/approve");
    expect(new URL(String(posts[0][0])).searchParams.get("workspace_id"))
      .toBe("00000000-0000-0000-0000-000000000010");
    expect(String(posts[0][0])).not.toMatch(/token|jwt/i);
    expect(screen.getByText("ZG-42 已記錄 PM 核准；Codex 尚未接單。")).toBeTruthy();
  });

  it("shows an authorization refusal without claiming a Run exists", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, emptyRunList))
      .mockResolvedValueOnce(response(403, {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<TaskFlowAIRunReadback workspaceId="00000000-0000-0000-0000-000000000010"
      issueId="00000000-0000-0000-0000-000000000020" issueRevision={3} />);

    fireEvent.click(await screen.findByRole("button", { name: "記錄 PM 核准（不派工、不產生費用）" }));
    await screen.findByText("目前登入者沒有核准此工作區工程 Run 的權限。");
    expect(screen.getByText("尚無 TaskFlow 核准或執行紀錄。")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a fresh idempotency key after a definitive revision conflict", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(200, emptyRunList))
      .mockResolvedValueOnce(response(409, {}))
      .mockResolvedValueOnce(response(200, emptyRunList))
      .mockResolvedValueOnce(response(201, {
        id: "00000000-0000-0000-0000-000000000001",
        taskflow_identifier: "ZG-42",
        state: "approved",
        dispatch_started: false,
        provider_status: "not_configured",
      }))
      .mockResolvedValueOnce(response(200, emptyRunList));
    vi.stubGlobal("fetch", fetchMock);
    const props = { workspaceId: "00000000-0000-0000-0000-000000000010",
      issueId: "00000000-0000-0000-0000-000000000020", issueRevision: 7 };
    const view = render(<TaskFlowAIRunReadback {...props} />);
    const button = await screen.findByRole("button", { name: "記錄 PM 核准（不派工、不產生費用）" });

    fireEvent.click(button);
    await screen.findByText("任務版本已變更或已有未結束 Run；請重新載入任務狀態後再試。");
    view.rerender(<TaskFlowAIRunReadback {...props} issueRevision={8} />);
    fireEvent.click(button);
    await screen.findByText("ZG-42 已記錄 PM 核准；Codex 尚未接單。");

    const posts = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(posts).toHaveLength(2);
    const first = JSON.parse(String((posts[0][1] as RequestInit).body));
    const second = JSON.parse(String((posts[1][1] as RequestInit).body));
    expect(first.expected_issue_revision).toBe(7);
    expect(second.expected_issue_revision).toBe(8);
    expect(first.idempotency_key).not.toBe(second.idempotency_key);
  });
});
