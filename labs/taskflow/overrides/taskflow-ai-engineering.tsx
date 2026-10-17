"use client";
import { useState } from "react";
import { Bot, ChevronRight } from "lucide-react";
import { evaluateAIExecution } from "./taskflow-ai-engineering-policy";
import { useTaskFlowAIProjectSettings, useTaskFlowAIIssueSettings } from "./taskflow-ai-settings-store";
import { TaskFlowAIRunReadback } from "./taskflow-ai-run-readback";

/** Project-scoped, default-OFF preference saved by the authenticated TaskFlow API. */
export function TaskFlowAIProjectSettings({
  workspaceId, projectId, canManage,
}: { workspaceId: string; projectId: string; canManage: boolean }) {
  const setting = useTaskFlowAIProjectSettings(workspaceId, projectId);
  return <section data-testid="taskflow-ai-project-settings" className="space-y-1 rounded-md border border-dashed p-2">
    <label className="flex min-h-9 items-center justify-between gap-2 text-caption font-medium">
      <span className="flex items-center gap-1.5"><Bot className="size-4 shrink-0" />啟用 AI 工程師</span>
      <input type="checkbox" className="size-4 accent-primary"
        checked={setting.enabled}
        disabled={!canManage || setting.phase !== "ready" || setting.saving}
        onChange={event => void setting.setEnabled(event.currentTarget.checked)}
        aria-label="專案 AI 工程師選項" />
    </label>
    <p className="text-caption text-muted-foreground">
      {setting.phase === "loading" ? "正在讀取專案設定…" : setting.phase === "unavailable" ? setting.error :
        setting.saving ? "正在儲存…" : "此設定會保存於 TaskFlow；啟用不會自行派工或產生費用。"}
    </p>
    {setting.phase === "ready" && setting.error && <p role="alert" className="text-caption text-destructive">{setting.error}</p>}
    {!canManage && <p className="text-caption text-muted-foreground">僅專案管理權限者可調整此選項。</p>}
  </section>;
}

/** Independent issue-sidebar section. Does not alter human assignee or Wakeups. */
export function TaskFlowAIIssueSection({
  workspaceId, projectId, issueId, issueRevision, canManage, canApprove,
}: { workspaceId: string; projectId: string | null; issueId: string; issueRevision: number; canManage: boolean; canApprove: boolean }) {
  const project = useTaskFlowAIProjectSettings(workspaceId, projectId ?? "");
  const card = useTaskFlowAIIssueSettings(workspaceId, issueId);
  const [open, setOpen] = useState(true);
  // Always display the native TaskFlow issue panel on the official site.
  // Visibility is informational only: the strict native dispatch gate still
  // requires project/card authorization and all provider prerequisites.
  const gate = evaluateAIExecution({
    projectEnabled: project.enabled,
    cardEnabled: card.enabled,
    engineer: card.engineer,
    pmApproved: false,
    nativeMemberAuthorized: false,
    correctWorkspace: false,
    nativeRunApiReady: false,
    backendServiceIdentityReady: false,
    providerVerified: false,
    providerQuota: "unknown",
    branchHeadVerified: false,
    exactSha: null,
    writerStopped: false,
    durableClaimCommitted: false,
  });
  return <section data-testid="taskflow-ai-issue-settings" className="space-y-1">
    <button type="button" aria-expanded={open} aria-controls={"taskflow-ai-" + issueId}
      className="flex min-h-8 w-full items-center gap-1 rounded-md px-2 py-1 text-caption font-medium hover:bg-accent/70"
      onClick={() => setOpen(!open)}>
      <Bot className="size-3.5 shrink-0" />
      <span className="flex-1 text-left">AI 工程執行</span>
      <span className="text-muted-foreground">{project.enabled && card.enabled ? "尚未連接派工" : "尚未啟用"}</span>
      <ChevronRight className={"size-3 shrink-0 text-muted-foreground transition-transform " + (open ? "rotate-90" : "")} />
    </button>
    {open && <div id={"taskflow-ai-" + issueId} className="space-y-2 rounded-md border border-dashed p-2 text-caption">
      <label className="flex items-center justify-between gap-2">
        <span>本任務使用 AI 工程師</span>
        <input type="checkbox" className="size-4 accent-primary" checked={card.enabled}
          disabled={!canManage || card.phase !== "ready" || card.saving}
          onChange={event => void card.setEnabled(event.currentTarget.checked)}
          aria-label="任務卡 AI 工程師選項" />
      </label>
      {card.phase === "loading" && <p className="text-muted-foreground">正在讀取任務設定…</p>}
      {card.phase === "unavailable" && <p role="alert" className="text-destructive">{card.error}</p>}
      {card.phase === "ready" && card.error && <p role="alert" className="text-destructive">{card.error}</p>}
      <div className="space-y-2">
        <label className="flex items-center justify-between gap-2">
          <span>指定工程師</span>
          <select value={card.engineer} className="max-w-[55%] rounded border bg-background px-2 py-1"
            disabled={!canManage || card.phase !== "ready" || card.saving}
            aria-label="選擇 AI 工程師"
            onChange={event => void card.setEngineer(event.target.value === "gem" ? "gem" : "co")}>
            <option value="co">Co｜Codex（優先）</option>
            <option value="gem">Gem｜Gemini（手動）</option>
          </select>
        </label>
        <p>{card.saving ? "設定儲存中…" : "備援工程師：Gem（需另行核准，不會自動接手）"}</p>
        <p>執行狀態：{gate.state === "NEEDS_PM_APPROVAL" ? "待 PM 核准" : "未配置／阻擋派工"}</p>
        <p>額度：未知　Cloud Run：尚未建立</p>
        <p>GitHub PR／Commit SHA／CI：尚未連接正式證據</p>
        <p>工作紀錄：尚無經 TaskFlow 驗證的 Run 事件</p>
        <TaskFlowAIRunReadback workspaceId={workspaceId} issueId={issueId} issueRevision={issueRevision}
          enabledForDispatch={canApprove && project.enabled && card.enabled && card.engineer === "co"} />
      </div>
      <p className="text-muted-foreground">
        此設定不取代真人負責人。派工只會透過已連結的公開 GitHub PR 要求 Codex；沒有收到簽章接單回呼前不會標記為執行中。
      </p>
    </div>}
  </section>;
}
