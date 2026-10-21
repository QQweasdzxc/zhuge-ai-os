"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { useCurrentWorkspace, useWorkspacePaths, useWorkspaceSlug } from "@multica/core/paths";
import { AppLink } from "../navigation";
import { DISPATCH_EXECUTORS, normalizeDispatchIssue, hasDispatchEvidence, buildPmInboxEntries, nativeTaskStateKey, nativeTaskStateLabel } from "./taskflow-dispatch-logic.mjs";

const PAGE_SIZE = 20;
const stateLabels: Record<string, string> = { UNKNOWN: "未驗證", STALE: "觀測已過期", BLOCKED: "工程阻擋", FAILED: "失敗", DONE: "完成", ACK_PENDING: "等待 Provider 接單", RUNNING: "正在執行", CANCELLED: "已取消", REVIEW: "待驗收" };
const panel = "min-w-0 rounded-lg border bg-card p-4 text-card-foreground";

type WorkspaceIssues = { issues: any[]; total: number; complete: boolean; observedAt: string };

/** Read all permitted pages; fail closed on observable drift. Native offset
 * pagination has NO snapshot token: successful reads remain non-atomic. */
async function listAllWorkspaceIssues(workspaceId: string): Promise<WorkspaceIssues> {
  const issues: any[] = [];
  const seen = new Set<string>();
  let offset = 0;
  let expectedTotal: number | null = null;
  while (true) {
    const response = await api.listIssues({ workspace_id: workspaceId, limit: PAGE_SIZE, offset });
    const total = response?.total;
    const page = response?.issues;
    if (!Array.isArray(page) || page.length > PAGE_SIZE)
      throw new Error("案件分頁資料與總數不一致");
    // Workspace mismatch takes priority over a malformed/missing count: do not
    // mask authorization and identity errors as a pagination problem.
    for (const issue of page) {
      if (!issue?.id || issue.workspace_id !== workspaceId) throw new Error("案件工作空間不一致");
    }
    if (!Number.isSafeInteger(total) || total < 0)
      throw new Error("案件分頁資料與總數不一致");
    if (expectedTotal !== null && total !== expectedTotal)
      throw new Error("案件總數於分頁讀取期間變動，請重新整理");
    expectedTotal = total;
    if (page.length > total - offset)
      throw new Error("案件分頁資料與總數不一致");
    if (page.length < Math.min(PAGE_SIZE, total - offset))
      throw new Error("案件分頁提早結束或數量不一致，無法顯示全量統計");
    for (const issue of page) {
      if (seen.has(issue.id)) throw new Error("案件分頁重複，工作總覽未完成");
      seen.add(issue.id);
      issues.push(issue);
    }
    offset += page.length;
    if (offset === total) break;
  }
  return { issues, total: expectedTotal!, complete: true, observedAt: new Date().toISOString() };
}

function workloadState(assigned: any[]): string {
  if (!assigned.length) return "本次讀取未發現指派的 TF 工作；Provider 是否在線仍未驗證";
  if (assigned.some(item => item.status === "RUNNING")) return "已驗證 Provider 執行中";
  if (assigned.some(item => ["IN_PROGRESS", "RUNNING"].includes(nativeTaskStateKey(item)))) return "有 TF 進行中的工作；Provider 未驗證";
  if (assigned.every(item => ["UNKNOWN", "UNVERIFIED"].includes(item.status))) return "TF 有工作；Provider Runtime 未驗證";
  if (assigned.some(item => item.status === "STALE")) return "觀測已過期";
  return "目前無可驗證的執行中案件";
}

export function TaskFlowDispatchRuntime({ issueId }: { issueId: string }) {
  const workspace = useCurrentWorkspace();
  const slug = useWorkspaceSlug();
  const query = useQuery({
    queryKey: ["taskflow-dispatch-runtime", workspace?.id, slug, issueId],
    queryFn: async () => {
      const issue = await api.getIssue(issueId);
      if (issue.workspace_id !== workspace?.id) throw new Error("案件不屬於目前工作空間");
      const response = await api.getDispatchRuntime(issueId, slug!) as { runtime?: Record<string, unknown>; readback_kind?: string };
      if (!response.runtime || response.runtime.issue_id !== issue.id || response.runtime.workspace !== workspace?.id) throw new Error("執行證據身分不一致");
      return { item: normalizeDispatchIssue(issue, [], Date.now(), response.runtime), native: response.readback_kind === "NATIVE_TASK_READBACK" };
    },
    enabled: Boolean(workspace?.id && slug && issueId), retry: false, staleTime: 30_000,
  });
  if (query.isError) return <div role="alert">執行證據讀取失敗：{query.error.message} <button onClick={() => void query.refetch()}>重試</button></div>;
  if (!query.data) return <p role="status">讀取受保護執行證據…</p>;
  const { item, native } = query.data;
  return <section aria-label="受保護執行證據" className="space-y-2 break-words text-sm">
    <p>{native ? "TaskFlow 原生任務狀態" : "受保護 Runtime 狀態"}：{stateLabels[item.status] || item.status}</p>
    {native && <p className="text-muted-foreground">原生任務結果不代表官方 Provider 執行結果。</p>}
    <p>Provider Run ID（受保護讀回）：{item.providerRunId || "未取得"}</p>
    <p>Provider ACK：{item.providerAck || "未驗證"} · 授權：{item.authorizedBy || "未驗證"}</p>
    <p>觀測時間：{item.observedAt || "未取得"}</p>
    {item.reason && <p>{item.reason}</p>}
    <button className="min-h-10 rounded border px-3" onClick={() => void query.refetch()}>重新讀取證據</button>
  </section>;
}

export function TaskFlowDispatchCenter() {
  const workspace = useCurrentWorkspace();
  const paths = useWorkspacePaths();
  const [offset, setOffset] = useState(0);
  const [executor, setExecutor] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState("");
  const query = useQuery({
    queryKey: ["taskflow-dispatch-issues", workspace?.id],
    queryFn: () => listAllWorkspaceIssues(workspace!.id),
    enabled: Boolean(workspace?.id), retry: false,
  });
  const items = (query.data?.issues || []).map(issue => normalizeDispatchIssue(issue)).filter(hasDispatchEvidence);
  const visible = items.filter(item => (!executor || item.executor === executor) && (!search || item.title.toLowerCase().includes(search.toLowerCase())));
  const pageVisible = visible.slice(offset, offset + PAGE_SIZE);
  const inbox = buildPmInboxEntries(items);
  const filteredInbox = buildPmInboxEntries(visible);
  const workload = DISPATCH_EXECUTORS.map(value => {
    const assigned = items.filter(item => item.executor === value);
    const running = assigned.filter(item => item.status === "RUNNING");
    const notStarted = assigned.filter(item => ["TODO", "CREATED", "NEW", "BACKLOG", "PENDING", "ASSIGNED"].includes(nativeTaskStateKey(item)));
    const reviewOrBlocked = assigned.filter(item => ["REVIEW", "BLOCKED", "FAILED", "STALE"].includes(nativeTaskStateKey(item)) || ["BLOCKED", "FAILED", "STALE"].includes(item.status));
    return { value, assigned, running, notStarted, reviewOrBlocked, state: workloadState(assigned) };
  });
  return <main data-testid="taskflow-native-dispatch-center" className="h-full min-w-0 overflow-y-auto p-4 md:p-6">
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">AI 派工中心</h1><p className="text-sm text-muted-foreground">{workspace?.name} · 共用 TaskFlow 原生案件</p></div><button className="min-h-10 rounded-md border px-4" disabled={query.isFetching} onClick={() => void query.refetch()}>重新整理</button></header>
      <p className="rounded-md border p-3 text-sm">正式 Provider 尚未綁定。派工執行、ACK、成本與額度尚未接通。</p>
      <div className="flex flex-wrap gap-3"><label>Executor <select aria-label="Executor" className="min-h-10 rounded border bg-background px-2" value={executor} onChange={e => { setExecutor(e.target.value); setOffset(0); }}><option value="">全部五位 Executor</option>{DISPATCH_EXECUTORS.map(value => <option key={value}>{value}</option>)}</select></label><label>搜尋 Workspace 工作 <input aria-label="搜尋 Workspace 工作" className="min-h-10 max-w-full rounded border bg-background px-2" value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} /></label></div>
      {query.data?.complete && <p className="text-sm text-muted-foreground">本次讀取 Workspace 可見的 {items.length} 件 AI 派工案件（原生 Issue {query.data.total} 件）；觀測時間：{new Date(query.data.observedAt).toLocaleString("zh-TW")}。分頁非原子快照，可能受到讀取期間卡片變動影響，非即時精確總數。展開單一案件才讀取 Runtime。</p>}
      {query.data && !query.data.complete && <p role="status" className="text-sm text-amber-700">工作總覽尚未完成，暫不顯示全 Workspace 統計。</p>}
      {query.isError ? <div role="alert">案件讀取失敗：{query.error.message}。本次資料不完整，無法顯示全量結論。請確認登入與 Workspace 權限後重新整理。<button className="ml-2 min-h-10 rounded border px-3" onClick={() => void query.refetch()}>重試</button></div> : query.isPending ? <p role="status">載入案件…</p> : <>
        {query.data?.complete ? <>
          <WorkloadPanel workload={workload} paths={paths} />
          <section className={panel} aria-label="PM Inbox"><h2 className="font-semibold">PM Inbox · Workspace 總數 {inbox.length} 件</h2><p className="text-sm text-muted-foreground">目前篩選結果 {filteredInbox.length} 件；總數不受 Executor／搜尋篩選改寫。AI 派工待裁示／待驗收清單，與 TF 通知 Inbox 分開。</p>{inbox.length ? <ul>{inbox.map(item => <li key={item.id} className="py-2"><AppLink href={paths.issueDetail(item.id)}>{item.categoryLabel} · {item.title}</AppLink></li>)}</ul> : <p>本 Workspace 沒有待處理 AI 案件。</p>}</section>
        </> : null}
        <section aria-label="AI 任務總覽" className="grid min-w-0 gap-3 md:grid-cols-2">{pageVisible.map(item => <article key={item.id} className={panel}>
          <AppLink className="block break-words font-medium underline-offset-4 hover:underline" href={paths.issueDetail(item.id)}>{item.identifier || item.workCode || item.id} · {item.title}</AppLink>
          <p className="my-2 break-words text-sm">Executor：{item.executor || "未指定"} · TF 原生狀態：{nativeTaskStateLabel(item)} · Provider Runtime：{stateLabels[item.status] || item.status || "未驗證"}</p>
          <GitHubEvidence label="PR" value={item.prUrl} /><GitHubEvidence label="CI" value={item.ciUrl} />{item.sha && <p className="break-all text-xs">SHA（填報證據）：{item.sha}</p>}
          <button className="mt-3 min-h-10 rounded border px-3" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? "" : item.id)}>查看執行證據</button>
          {expanded === item.id && <TaskFlowDispatchRuntime key={workspace?.id + item.id} issueId={item.id} />}
        </article>)}</section>
        {!visible.length && <p>本 Workspace 沒有符合條件的 AI 工作。</p>}
        <nav className="flex gap-3" aria-label="案件分頁"><button className="min-h-10 rounded border px-3" disabled={!offset} onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setExpanded(""); }}>上一頁</button><button className="min-h-10 rounded border px-3" disabled={offset + PAGE_SIZE >= visible.length} onClick={() => { setOffset(offset + PAGE_SIZE); setExpanded(""); }}>下一頁</button><span className="self-center text-sm text-muted-foreground">{visible.length ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, visible.length)}／${visible.length}` : "0／0"}</span></nav>
      </>}
      <button disabled className="min-h-10 rounded border px-4 text-muted-foreground">派工尚未開放</button>
    </div>
  </main>;
}

function WorkloadPanel({ workload, paths }: { workload: Array<{ value: string; assigned: any[]; running: any[]; notStarted: any[]; reviewOrBlocked: any[]; state: string }>; paths: any }) {
  const [expandedExecutor, setExpandedExecutor] = useState("");
  return <section className={`${panel} grid gap-3 md:grid-cols-2`} aria-label="Workspace 工作負載"><h2 className="md:col-span-2 font-semibold">Workspace 工作負載</h2>{workload.map(entry => <article key={entry.value} className="min-w-0 rounded border p-3"><h3 className="break-words font-medium">{entry.value}{entry.value === "GH-HELPER" ? "（GitHub 輔助角色）" : ""}</h3><p className="break-words text-sm">負責工作：{entry.assigned.length} · TF 進行中：{entry.assigned.filter(item => ["IN_PROGRESS", "RUNNING"].includes(nativeTaskStateKey(item))).length} · 尚未開始：{entry.notStarted.length} · 待驗收／阻擋：{entry.reviewOrBlocked.length}</p><p className="break-words text-sm text-muted-foreground">{entry.state}</p><button className="mt-2 min-h-10 rounded border px-3" aria-expanded={expandedExecutor === entry.value} onClick={() => setExpandedExecutor(expandedExecutor === entry.value ? "" : entry.value)}>{expandedExecutor === entry.value ? "收合工作清單" : "查看工作清單"}</button>{expandedExecutor === entry.value && (entry.assigned.length ? <ul className="mt-2 space-y-2 text-sm">{entry.assigned.map(item => <li key={item.id} className="min-w-0 break-words"><AppLink href={paths.issueDetail(item.id)}>{item.identifier || item.id} · {item.title}</AppLink><span className="ml-1 text-muted-foreground">（TF：{nativeTaskStateLabel(item)}）</span></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">目前沒有可列出的 TF 工作。</p>)}</article>)}</section>;
}

function GitHubEvidence({ label, value }: { label: string; value: string }) {
  try { const url = new URL(value); if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password) return null; }
  catch { return null; }
  return <p className="text-sm"><a href={value} target="_blank" rel="noopener noreferrer">GitHub {label}（填報來源，非 Provider 執行證明）</a></p>;
}
