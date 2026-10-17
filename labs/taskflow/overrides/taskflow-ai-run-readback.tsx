"use client";
/** TaskFlow approval, gated GitHub @codex handoff, and persisted execution evidence. */
import { useEffect, useRef, useState } from "react";
import { api } from "@multica/core/api";
import {
  TaskFlowAIEngineeringRunListSchema,
  type TaskFlowAIEngineeringRun,
} from "@multica/core/api";

const STATUS: Record<string, string> = {
  approved: "PM 已核准・尚未派工",
  expired: "核准已逾期・尚未派工",
  dispatch_pending: "等待正式派工服務",
  provider_ack_pending: "等待 Codex 官方確認",
  running: "Codex 已確認・執行中",
  blocked: "執行受阻",
  review_pending: "等待 PM 驗收",
  completed: "完成",
  failed: "執行失敗",
  cancelled: "已取消",
};
const EVENT_LABEL: Record<string, string> = {
  pm_approved: "PM 核准已記錄",
  approval_expired: "核准已逾期",
  dispatch_blocked: "派工受阻",
  provider_pending: "等待 Provider",
  provider_ack: "Provider 確認",
  progress: "進度回報",
  review: "提交審查",
  completed: "完成回報",
  failed: "失敗回報",
  cancelled: "取消",
  github_pr_updated: "GitHub PR 更新已保存",
  github_pr_merged: "GitHub PR 合併已保存",
};
type View = { phase: "loading" | "unavailable" | "ready"; runs: TaskFlowAIEngineeringRun[]; dispatchEnabled: boolean };
type ApprovalView = "idle" | "submitting" | "created" | "unavailable" | "denied" | "conflict" | "failed";

function newIdempotencyKey(): string {
  if (!globalThis.crypto?.getRandomValues) throw new Error("secure randomness unavailable");
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function TaskFlowAIRunReadback({ workspaceId, issueId, issueRevision, enabledForDispatch }: {
  workspaceId: string; issueId: string; issueRevision: number; enabledForDispatch: boolean;
}) {
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<View>({ phase: "loading", runs: [], dispatchEnabled: false });
  const [approval, setApproval] = useState<ApprovalView>("idle");
  const [approvalMessage, setApprovalMessage] = useState("");
  const [acceptingRun, setAcceptingRun] = useState<string | null>(null);
  const requestKey = useRef<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setView(current => ({ phase: "loading", runs: [], dispatchEnabled: current.dispatchEnabled }));
    const run = async () => {
      try {
        const base = api.getBaseUrl();
        const token = api.getToken();
        if (!base || !token || !/^[0-9a-f-]{36}$/i.test(issueId) || !/^[0-9a-f-]{36}$/i.test(workspaceId))
          throw Error("native identity unavailable");
        const target = new URL(base.replace(/\/$/, "") + "/api/issues/" +
          encodeURIComponent(issueId) + "/zhuge-ai/runs");
        target.searchParams.set("workspace_id", workspaceId);
        const headers: Record<string, string> = { Accept: "application/json" };
        if (token) headers.Authorization = "Bearer " + token;
        const response = await fetch(target.toString(), {
          method: "GET", headers, credentials: "include", cache: "no-store", signal: controller.signal
        });
        if (response.status !== 200) throw Error("native Run API not available");
        const parsed = TaskFlowAIEngineeringRunListSchema.safeParse(await response.json());
        if (!parsed.success) throw Error("invalid native Run evidence");
        if (!controller.signal.aborted) setView({ phase: "ready", runs: parsed.data.runs,
          dispatchEnabled: parsed.data.dispatch_enabled });
      } catch {
        if (!controller.signal.aborted) setView(current => ({ phase: "unavailable", runs: [],
          dispatchEnabled: current.dispatchEnabled }));
      }
    };
    void run();
    return () => controller.abort();
  }, [workspaceId, issueId, reload]);
  const approveAndMaybeDispatch = async () => {
    if (approval === "submitting" || !Number.isSafeInteger(issueRevision) || issueRevision <= 0) return;
    const dispatch = enabledForDispatch && view.phase === "ready" && view.dispatchEnabled;
    if (dispatch && !window.confirm("將此任務標題與描述張貼到公開 GitHub PR，並要求 Codex Cloud 執行。請先確認內容不含密碼、Token、個資或其他機密。")) return;
    setApproval("submitting");
    setApprovalMessage("");
    try {
      const base = api.getBaseUrl();
      const token = api.getToken();
      if (!base || !token || !/^[0-9a-f-]{36}$/i.test(issueId) ||
          !/^[0-9a-f-]{36}$/i.test(workspaceId)) throw Error("API unavailable");
      requestKey.current ??= newIdempotencyKey();
      const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
      headers.Authorization = "Bearer " + token;
      const target = new URL(base.replace(/\/$/, "") + "/api/issues/" +
        encodeURIComponent(issueId) + "/zhuge-ai/approve");
      target.searchParams.set("workspace_id", workspaceId);
      const response = await fetch(target.toString(), {
        method: "POST", headers, credentials: "include", cache: "no-store",
        body: JSON.stringify({ expected_issue_revision: issueRevision, idempotency_key: requestKey.current,
          confirm_public_github_dispatch: dispatch }),
      });
      if (response.status === 201 || response.status === 200 || response.status === 202) {
        const result = await response.json() as { dispatch_started?: boolean; dispatch_request_posted?: boolean;
          dispatch_outcome_unknown?: boolean; github_dispatch_url?: string; taskflow_identifier?: string;
          state?: string; provider_status?: string };
        setApproval("created");
        const taskLabel = result.taskflow_identifier ?? "TaskFlow 任務";
        setApprovalMessage(dispatch
          ? taskLabel + (result.dispatch_started ? " 已收到 Codex 接單確認。"
            : result.dispatch_outcome_unknown ? " 派工連線結果不確定，系統不會自動重送；等待 GitHub 回呼核對。"
            : result.dispatch_request_posted ? " 已送出 GitHub 派工要求；等待 Codex 官方接單確認。"
            : " 派工受阻：" + (result.provider_status ?? result.state ?? "未知狀態") + "。")
          : taskLabel + (result.state === "expired" ? " 的核准已逾期；Codex 未接單。" : " 已記錄 PM 核准；雲端派工目前未啟用。"));
        requestKey.current = null;
        setReload(value => value + 1);
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setApproval("denied");
        setApprovalMessage("目前登入者沒有核准此工作區工程 Run 的權限。");
      } else if (response.status === 409) {
        // A conflict is a definitive rejection, so a new approval attempt
        // after refreshing must get a new idempotency identity. Network/5xx
        // uncertainty retains the key so a committed request can be replayed.
        requestKey.current = null;
        setApproval("conflict");
        setApprovalMessage("任務版本已變更或已有未結束 Run；請重新載入任務狀態後再試。");
        setReload(value => value + 1);
      } else if (response.status === 404 || response.status === 503) {
        setApproval("unavailable");
        setApprovalMessage("Run 或 Codex 派工服務尚未啟用；目前不會送出派工。");
      } else {
        setApproval("failed");
        setApprovalMessage("核准紀錄未完成；可安全重試相同請求。");
      }
    } catch {
      setApproval("failed");
      setApprovalMessage("無法確認核准結果；重試會沿用同一個冪等請求，不會重複建立。");
    }
  };
  const acceptRun = async (run: TaskFlowAIEngineeringRun) => {
    if (acceptingRun) return;
    setAcceptingRun(run.id);
    try {
      const base = api.getBaseUrl();
      const token = api.getToken();
      if (!base || !token) throw Error("API unavailable");
      const target = new URL(base.replace(/\/$/, "") + "/api/issues/" + encodeURIComponent(issueId) + "/zhuge-ai/accept");
      target.searchParams.set("workspace_id", workspaceId);
      const response = await fetch(target.toString(), { method: "POST", credentials: "include", cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: "Bearer " + token },
        body: JSON.stringify({ expected_run_revision: run.revision }) });
      if (!response.ok) throw Error("acceptance was not saved");
      setApprovalMessage(run.task_identifier + " 已由 PM 驗收。 ");
      setReload(value => value + 1);
    } catch {
      setApprovalMessage("PM 驗收結果尚未保存，請更新 Run 狀態後再確認。");
    } finally {
      setAcceptingRun(null);
    }
  };
  return <section aria-label="TaskFlow 原生 AI Run 紀錄" className="space-y-1">
    <div className="flex items-center justify-between">
      <span>工程執行紀錄</span>
      <button type="button" className="text-muted-foreground underline"
        onClick={() => setReload(value => value + 1)} aria-label="重新讀取 TaskFlow AI Run">
        更新狀態
      </button>
    </div>
    <button type="button" className="w-full rounded-md border px-2 py-1 text-left disabled:opacity-60"
      disabled={!enabledForDispatch || view.phase !== "ready" || approval === "submitting" || !Number.isSafeInteger(issueRevision) || issueRevision <= 0}
      onClick={() => void approveAndMaybeDispatch()}>
      {approval === "submitting" ? "正在核准並派工…" : !enabledForDispatch ? "先啟用專案與本任務的 Co 工程師" :
        view.phase !== "ready" ? "正在確認派工設定…" : view.dispatchEnabled ? "確認並派工至 Codex Cloud" : "記錄 PM 核准（Codex 派工待啟用）"}
    </button>
    {approvalMessage && <p role={approval === "created" ? "status" : "alert"}
      className="text-muted-foreground">{approvalMessage}</p>}
    {view.phase === "loading" && <p className="text-muted-foreground">正在讀取 TaskFlow Run 紀錄…</p>}
    {view.phase === "unavailable" && <p className="text-muted-foreground">Run 服務尚未安裝，不能確認 Co 已接單。</p>}
    {view.phase === "ready" && view.runs.length === 0 &&
      <p className="text-muted-foreground">尚無 TaskFlow 核准或執行紀錄。</p>}
    {view.phase === "ready" && view.runs.map(item => <div key={item.id} className="rounded border p-2 space-y-1">
      <div>Co｜Codex：{STATUS[item.state]}</div>
      <div>{item.task_identifier} · Run {item.id}</div>
      <div>{item.github_pr ? "GitHub PR #" + item.github_pr + " · " + (item.github_pr_state ?? "未知狀態") : "等待 PR 自動關聯"} ·
        {item.last_evidence_sha ? " Commit " + item.last_evidence_sha.slice(0, 8) : " 尚無執行 Commit"}</div>
      {item.github_pr && <div>CI：{item.github_head_sha && item.github_head_sha === item.github_snapshot_head_sha
          ? (item.github_checks_state ?? "尚無 Checks 結果") : "尚無目前 PR Commit 的 API 快照"}
        {item.github_snapshot_fetched_at ? " · 更新於 " + new Date(item.github_snapshot_fetched_at).toLocaleString() : ""}</div>}
      <div className="text-muted-foreground">
        {item.events.map((event, index) => <span key={event.run_id + ":" + event.kind + ":" + index}>
          {index ? " · " : ""}{EVENT_LABEL[event.kind]}
        </span>)}
      </div>
      {item.github_dispatch_url && <a className="underline" href={item.github_dispatch_url} target="_blank" rel="noreferrer">查看 GitHub 派工留言</a>}
      {item.provider_thread_id && <div>Codex Cloud Thread：{item.provider_thread_id}</div>}
      {item.result_summary && <div className="whitespace-pre-wrap">執行結果：{item.result_summary}</div>}
      {item.state === "review_pending" && <button type="button" className="rounded-md border px-2 py-1"
        onClick={() => void acceptRun(item)} disabled={acceptingRun === item.id}>PM 驗收完成</button>}
    </div>)}
    <p className="text-muted-foreground">此紀錄只顯示持久化的 TaskFlow 狀態；核准或 GitHub 註解不代表 Codex 已執行。</p>
  </section>;
}
