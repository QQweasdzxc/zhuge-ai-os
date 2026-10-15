"use client";
import { useState } from "react";
import { Bot, ChevronRight } from "lucide-react";
import { DEFAULT_ENGINEER, evaluateAIExecution, type Engineer } from "./taskflow-ai-engineering-policy";
import { useTaskFlowAIProjectPreview, useTaskFlowAICardPreview } from "./taskflow-ai-preview-store";

/** Project-scoped, default-OFF preview. Not a persistent project preference. */
export function TaskFlowAIProjectSettings({
  workspaceId, projectId, canManage,
}: { workspaceId: string; projectId: string; canManage: boolean }) {
  const setting = useTaskFlowAIProjectPreview(workspaceId, projectId);
  return <section data-testid="taskflow-ai-project-preview" className="space-y-1 rounded-md border border-dashed p-2">
    <label className="flex min-h-9 items-center justify-between gap-2 text-caption font-medium">
      <span className="flex items-center gap-1.5"><Bot className="size-4 shrink-0" />啟用 AI 工程師</span>
      <input type="checkbox" className="size-4 accent-primary"
        checked={setting.enabled}
        disabled={!canManage}
        onChange={event => setting.setEnabled(event.currentTarget.checked)}
        aria-label="專案 AI 工程師預覽開關（不會儲存）" />
    </label>
    <p className="text-caption text-muted-foreground">
      介面預覽：預設關閉，不會儲存至 TaskFlow，重新整理即恢復，也不會派工或產生費用。
    </p>
    {!canManage && <p className="text-caption text-muted-foreground">僅專案管理權限者可調整預覽。</p>}
  </section>;
}

/** Independent issue-sidebar section. Does not alter human assignee or Wakeups. */
export function TaskFlowAIIssueSection({
  workspaceId, projectId, issueId,
}: { workspaceId: string; projectId: string | null; issueId: string }) {
  const project = useTaskFlowAIProjectPreview(workspaceId, projectId ?? "");
  const card = useTaskFlowAICardPreview(workspaceId, issueId);
  const [open, setOpen] = useState(false);
  const [engineer, setEngineer] = useState<Engineer>(DEFAULT_ENGINEER);
  // Project not explicitly enabled => existing cards remain byte-for-byte
  // functionally unchanged. No AI pane and absolutely no provider launch.
  if (!projectId || !project.enabled) return null;
  const gate = evaluateAIExecution({
    projectEnabled: project.enabled,
    cardEnabled: card.enabled,
    engineer,
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
  return <section data-testid="taskflow-ai-issue-preview" className="space-y-1">
    <button type="button" aria-expanded={open} aria-controls={"taskflow-ai-" + issueId}
      className="flex min-h-8 w-full items-center gap-1 rounded-md px-2 py-1 text-caption font-medium hover:bg-accent/70"
      onClick={() => setOpen(!open)}>
      <Bot className="size-3.5 shrink-0" />
      <span className="flex-1 text-left">AI 工程執行</span>
      <span className="text-muted-foreground">{card.enabled ? "預覽中" : "未啟用"}</span>
      <ChevronRight className={"size-3 shrink-0 text-muted-foreground transition-transform " + (open ? "rotate-90" : "")} />
    </button>
    {open && <div id={"taskflow-ai-" + issueId} className="space-y-2 rounded-md border border-dashed p-2 text-caption">
      <label className="flex items-center justify-between gap-2">
        <span>這張任務卡使用 AI 工程師</span>
        <input type="checkbox" className="size-4 accent-primary" checked={card.enabled}
          onChange={event => card.setEnabled(event.currentTarget.checked)}
          aria-label="任務卡 AI 預覽開關（不會儲存）" />
      </label>
      {card.enabled && <>
        <label className="flex items-center justify-between gap-2">
          <span>本輪工程師</span>
          <select value={engineer} className="max-w-[55%] rounded border bg-background px-2 py-1"
            aria-label="選擇 AI 工程師（預覽）"
            onChange={event => setEngineer(event.target.value === "gem" ? "gem" : "co")}>
            <option value="co">Co｜Codex（優先）</option>
            <option value="gem">Gem｜Gemini（手動）</option>
          </select>
        </label>
        <p>備援工程師：Gem（不自動接手）</p>
        <p>執行狀態：{gate.state === "NEEDS_PM_APPROVAL" ? "待 PM 核准" : "未配置／阻擋派工"}</p>
        <p>額度：未知　Cloud Run：尚未建立</p>
        <p>GitHub PR／Commit SHA／CI：尚未連接正式證據</p>
        <p>工作紀錄：尚無經 TaskFlow 驗證的 Run 事件</p>
        <button type="button" disabled aria-disabled="true"
          className="w-full cursor-not-allowed rounded-md border p-2 text-muted-foreground">
          確認並派工（尚未開放）
        </button>
      </>}
      <p className="text-muted-foreground">
        僅供介面驗收；不儲存設定、不取代真人負責人、不執行 Co／Gem。正式啟用需要 TaskFlow API 與 PM 授權。
      </p>
    </div>}
  </section>;
}
