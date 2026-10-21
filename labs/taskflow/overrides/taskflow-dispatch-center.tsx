"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { useCurrentWorkspace, useWorkspacePaths, useWorkspaceSlug } from "@multica/core/paths";
import { AppLink } from "../navigation";
import { DISPATCH_EXECUTORS, normalizeDispatchIssue, hasDispatchEvidence, buildPmInboxEntries } from "./taskflow-dispatch-logic.mjs";

const PAGE_SIZE = 20;
const stateLabels: Record<string, string> = { UNKNOWN: "未驗證", STALE: "觀測已過期", BLOCKED: "工程阻擋", FAILED: "失敗", DONE: "完成", ACK_PENDING: "等待 Provider 接單", RUNNING: "正在執行", CANCELLED: "已取消", REVIEW: "待驗收" };
const panel = "min-w-0 rounded-lg border bg-card p-4 text-card-foreground";

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
    queryKey: ["taskflow-dispatch-issues", workspace?.id, offset],
    queryFn: async () => {
      const response = await api.listIssues({ workspace_id: workspace!.id, limit: PAGE_SIZE, offset });
      if (response.issues.some(issue => issue.workspace_id !== workspace!.id)) throw new Error("案件工作空間不一致");
      return response;
    },
    enabled: Boolean(workspace?.id), retry: false,
  });
  const items = (query.data?.issues || []).map(issue => normalizeDispatchIssue(issue)).filter(hasDispatchEvidence);
  const visible = items.filter(item => (!executor || item.executor === executor) && (!search || item.title.toLowerCase().includes(search.toLowerCase())));
  const inbox = buildPmInboxEntries(visible);
  return <main data-testid="taskflow-native-dispatch-center" className="h-full min-w-0 overflow-y-auto p-4 md:p-6">
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">AI 派工中心</h1><p className="text-sm text-muted-foreground">{workspace?.name} · 共用 TaskFlow 原生案件</p></div><button className="min-h-10 rounded-md border px-4" disabled={query.isFetching} onClick={() => void query.refetch()}>重新整理</button></header>
      <p className="rounded-md border p-3 text-sm">正式 Provider 尚未綁定。派工執行、ACK、成本與額度尚未接通。</p>
      <div className="flex flex-wrap gap-3"><label>Executor <select aria-label="Executor" className="min-h-10 rounded border bg-background px-2" value={executor} onChange={e => setExecutor(e.target.value)}><option value="">全部五位 Executor</option>{DISPATCH_EXECUTORS.map(value => <option key={value}>{value}</option>)}</select></label><label>搜尋本頁 <input aria-label="搜尋本頁" className="min-h-10 max-w-full rounded border bg-background px-2" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
      <p className="text-sm text-muted-foreground">僅顯示目前原生案件分頁中的 AI 工作；篩選與 PM Inbox 數量限本頁，並非全 Workspace 總計。展開單一案件才讀取 Runtime，避免逐卡背景請求。</p>
      {query.isError ? <div role="alert">案件讀取失敗：{query.error.message}。請確認登入與 Workspace 權限後重新整理。</div> : query.isPending ? <p role="status">載入案件…</p> : <>
        <section className={panel} aria-label="PM Inbox"><h2 className="font-semibold">PM Inbox · 本頁 {inbox.length} 件</h2><p className="text-sm text-muted-foreground">AI 派工待裁示／待驗收清單，與 TF 通知 Inbox 分開。填報狀態尚待受保護證據核實。</p>{inbox.length ? <ul>{inbox.map(item => <li key={item.id} className="py-2"><AppLink href={paths.issueDetail(item.id)}>{item.categoryLabel} · {item.title}</AppLink></li>)}</ul> : <p>本頁沒有待處理 AI 案件。</p>}</section>
        <section aria-label="AI 任務總覽" className="grid min-w-0 gap-3 md:grid-cols-2">{visible.map(item => <article key={item.id} className={panel}>
          <AppLink className="block break-words font-medium underline-offset-4 hover:underline" href={paths.issueDetail(item.id)}>{item.identifier || item.workCode || item.id} · {item.title}</AppLink>
          <p className="my-2 text-sm">Executor：{item.executor || "未指定"} · 狀態：未驗證</p>
          <GitHubEvidence label="PR" value={item.prUrl} /><GitHubEvidence label="CI" value={item.ciUrl} />{item.sha && <p className="break-all text-xs">SHA（填報證據）：{item.sha}</p>}
          <button className="mt-3 min-h-10 rounded border px-3" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? "" : item.id)}>查看執行證據</button>
          {expanded === item.id && <TaskFlowDispatchRuntime key={workspace?.id + item.id} issueId={item.id} />}
        </article>)}</section>
        {!visible.length && <p>本頁沒有符合條件的 AI 工作。</p>}
        <nav className="flex gap-3" aria-label="案件分頁"><button className="min-h-10 rounded border px-3" disabled={!offset} onClick={() => { setOffset(Math.max(0, offset - PAGE_SIZE)); setExpanded(""); }}>上一頁</button><button className="min-h-10 rounded border px-3" disabled={(query.data?.issues.length || 0) < PAGE_SIZE} onClick={() => { setOffset(offset + PAGE_SIZE); setExpanded(""); }}>下一頁</button></nav>
      </>}
      <button disabled className="min-h-10 rounded border px-4 text-muted-foreground">派工尚未開放</button>
    </div>
  </main>;
}

function GitHubEvidence({ label, value }: { label: string; value: string }) {
  try { const url = new URL(value); if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password) return null; }
  catch { return null; }
  return <p className="text-sm"><a href={value} target="_blank" rel="noopener noreferrer">GitHub {label}（填報來源，非 Provider 執行證明）</a></p>;
}
