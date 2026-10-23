"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import { useCurrentWorkspace, useWorkspacePaths, useWorkspaceSlug } from "@multica/core/paths";
import { AppLink } from "../navigation";
import { DISPATCH_EXECUTORS, normalizeDispatchIssue, nativeTaskStateKey, nativeTaskStateLabel } from "./taskflow-dispatch-logic.mjs";

const PAGE_SIZE = 20;
const DISPLAY_SIZE = 20;
const MAP_SCHEMA = "taskflow-native-executor-project-mapping-v1";
const MAP_SOURCE = "TASKFLOW_NATIVE_EXECUTOR_REGISTRY";
const TASK_SCHEMA = "taskflow-native-ai-task-readback-v1";
const TASK_SOURCE = "TASKFLOW_NATIVE_ISSUE_AGENT_QUEUE";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stateLabels: Record<string, string> = { UNKNOWN: "未驗證", UNVERIFIED: "未驗證", STALE: "觀測已過期", BLOCKED: "工程阻擋", FAILED: "失敗", DONE: "完成", ACK_PENDING: "等待 Provider 接單", RUNNING: "正在執行", CANCELLED: "已取消", REVIEW: "待驗收" };
const panel = "min-w-0 rounded-lg border bg-card p-4 text-card-foreground";

type NativeProjectMapping = {
  executor_id: string;
  state: "VERIFIED" | "GAP";
  reason: string;
  project_id: string;
  project_title: string;
  workspace_id: string;
  workspace_access: string;
  project_access: string;
  source: string;
};
type NativeAITask = {
  issue_id: string;
  workspace_id: string;
  project_id: string;
  project_title: string;
  title: string;
  issue_status: string;
  executor_id: string;
  taskflow_task_id: string;
  taskflow_task_status: string;
  provider_runtime_state: "UNVERIFIED";
  provider_ack: "UNVERIFIED";
  updated_at: string;
};
type Readback = { mappings: NativeProjectMapping[]; tasks: NativeAITask[]; total: number; observedAt: string };

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function verifyMappings(envelope: any, workspaceId: string): NativeProjectMapping[] {
  if (!envelope || envelope.schema !== MAP_SCHEMA || envelope.source !== MAP_SOURCE || envelope.workspace_id !== workspaceId || !Array.isArray(envelope.mappings)) {
    throw new Error("TaskFlow 原生 Executor／Project 權威資料格式或 Workspace 不一致");
  }
  if (envelope.mappings.length !== DISPATCH_EXECUTORS.length) throw new Error("TaskFlow 原生 Executor 對應數量不完整");
  const checkedAt = Date.parse(envelope.checked_at || "");
  if (!Number.isFinite(checkedAt) || checkedAt > Date.now() || Date.now() - checkedAt > 5 * 60 * 1000) {
    throw new Error("TaskFlow 原生 Project 對應資料已過期，請重新整理");
  }
  const counts = new Map<string, number>();
  for (const row of envelope.mappings) {
    if (row && typeof row.executor_id === "string") counts.set(row.executor_id, (counts.get(row.executor_id) || 0) + 1);
  }
  const mappings = DISPATCH_EXECUTORS.map(executorId => {
    const matches = envelope.mappings.filter((row: any) => row?.executor_id === executorId);
    if (matches.length !== 1 || counts.get(executorId) !== 1) {
      return { executor_id: executorId, state: "GAP", reason: "DUPLICATE_OR_MISSING_EXECUTOR_MAPPING", project_id: "", project_title: "", workspace_id: workspaceId, workspace_access: "UNVERIFIED", project_access: "UNVERIFIED", source: MAP_SOURCE } as NativeProjectMapping;
    }
    const row = matches[0] as NativeProjectMapping;
    if (row.state !== "VERIFIED") return { ...row, state: "GAP" as const, project_id: "" };
    if (row.source !== MAP_SOURCE || row.workspace_id !== workspaceId || row.workspace_access !== "ALLOW" || row.project_access !== "ALLOW" || !isUuid(row.project_id) || typeof row.project_title !== "string" || !row.project_title.trim()) {
      return { ...row, state: "GAP" as const, reason: "NATIVE_PROJECT_OR_ACL_UNVERIFIED", project_id: "" };
    }
    return row;
  });
  const verifiedProjectCounts = new Map<string, number>();
  for (const row of mappings) if (row.state === "VERIFIED") verifiedProjectCounts.set(row.project_id.toLowerCase(), (verifiedProjectCounts.get(row.project_id.toLowerCase()) || 0) + 1);
  return mappings.map(row => row.state === "VERIFIED" && verifiedProjectCounts.get(row.project_id.toLowerCase()) !== 1
    ? { ...row, state: "GAP", reason: "DUPLICATE_PROJECT_BINDING", project_id: "" }
    : row);
}

async function readAllNativeAITasks(workspaceSlug: string, workspaceId: string, mappings: NativeProjectMapping[]) {
  const tasks: NativeAITask[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let offset = 0;
  while (true) {
    const response = await api.listZhugeAITasks(workspaceSlug, { limit: PAGE_SIZE, offset }) as any;
    if (!response || response.schema !== TASK_SCHEMA || response.source !== TASK_SOURCE || response.workspace_id !== workspaceId || response.consistency !== "NON_ATOMIC_OFFSET") {
      throw new Error("TaskFlow 原生 AI Tasks 回應不完整或權威來源不符");
    }
    const page = response.tasks;
    if (!Array.isArray(page) || page.length > PAGE_SIZE || !Number.isSafeInteger(response.total) || response.total < 0 || response.limit !== PAGE_SIZE || response.offset !== offset) {
      throw new Error("TaskFlow 原生 AI Tasks 分頁資料不一致");
    }
    if (total !== null && total !== response.total) throw new Error("AI Tasks 總數於讀取期間變動，請重新整理");
    total = response.total;
    if (page.length > total - offset || page.length < Math.min(PAGE_SIZE, total - offset)) throw new Error("AI Tasks 分頁提早結束或超出總數");
    for (const task of page as NativeAITask[]) {
      const mapping = mappings.find(row => row.executor_id === task.executor_id && row.state === "VERIFIED");
      if (!isUuid(task.issue_id) || !isUuid(task.project_id) || !isUuid(task.taskflow_task_id) || task.workspace_id !== workspaceId || !mapping || mapping.project_id.toLowerCase() !== task.project_id.toLowerCase() || !task.title?.trim() || !task.issue_status?.trim() || !task.taskflow_task_status?.trim() || !Number.isFinite(Date.parse(task.updated_at)) || task.provider_runtime_state !== "UNVERIFIED" || task.provider_ack !== "UNVERIFIED") {
        throw new Error("AI Task 與原生 Issue／Project／Workspace／Provider 狀態不一致");
      }
      if (seen.has(task.issue_id.toLowerCase())) throw new Error("TaskFlow 原生 Issue 重複，AI Tasks 統計停止顯示");
      seen.add(task.issue_id.toLowerCase());
      tasks.push(task);
    }
    offset += page.length;
    if (offset === total) break;
    if (offset >= 10000) throw new Error("原生 AI Tasks 超出目前安全分頁範圍，統計尚未完成");
  }
  return { tasks, total: total || 0 };
}

async function readNativeAI(workspaceId: string, workspaceSlug: string): Promise<Readback> {
  const envelope = await api.getZhugeAIProjectMappings(workspaceSlug);
  const mappings = verifyMappings(envelope, workspaceId);
  const result = await readAllNativeAITasks(workspaceSlug, workspaceId, mappings);
  return { mappings, tasks: result.tasks, total: result.total, observedAt: new Date().toISOString() };
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
  const slug = useWorkspaceSlug();
  const paths = useWorkspacePaths();
  const [offset, setOffset] = useState(0);
  const [executor, setExecutor] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState("");
  const [expandedExecutor, setExpandedExecutor] = useState("");
  const query = useQuery({
    queryKey: ["taskflow-native-ai-readback", workspace?.id, slug],
    queryFn: () => readNativeAI(workspace!.id, slug!),
    enabled: Boolean(workspace?.id && slug), retry: false,
  });
  const mappings = query.data?.mappings || [];
  const tasks = query.data?.tasks || [];
  const visible = tasks.filter(item => (!executor || item.executor_id === executor) && (!search || item.title.toLowerCase().includes(search.toLowerCase())));
  const pageVisible = visible.slice(offset, offset + DISPLAY_SIZE);
  const workload = DISPATCH_EXECUTORS.map(executorId => {
    const mapping = mappings.find(row => row.executor_id === executorId);
    const assigned = tasks.filter(item => item.executor_id === executorId);
    const notStarted = assigned.filter(item => ["TODO", "CREATED", "NEW", "BACKLOG", "PENDING", "ASSIGNED"].includes(nativeTaskStateKey({ status: item.issue_status })));
    const reviewOrBlocked = assigned.filter(item => ["REVIEW", "BLOCKED", "FAILED"].includes(nativeTaskStateKey({ status: item.issue_status })));
    return { executorId, mapping, assigned, notStarted, reviewOrBlocked };
  });
  return <main data-testid="taskflow-native-dispatch-center" className="h-full min-w-0 overflow-y-auto p-4 md:p-6">
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-xl font-semibold">AI 派工中心</h1><p className="text-sm text-muted-foreground">{workspace?.name} · TaskFlow 原生 Project／Issue 讀回</p></div><button className="min-h-10 rounded-md border px-4" disabled={query.isFetching} onClick={() => void query.refetch()}>重新整理</button></header>
      <p className="rounded-md border p-3 text-sm">正式 Provider Route、ACK、Run 與成本尚未接通。所有 Provider 狀態維持 UNKNOWN／UNVERIFIED。</p>
      <div className="flex flex-wrap gap-3"><label>Executor <select aria-label="Executor" className="min-h-10 rounded border bg-background px-2" value={executor} onChange={e => { setExecutor(e.target.value); setOffset(0); }}><option value="">全部五位 Executor</option>{DISPATCH_EXECUTORS.map(value => <option key={value}>{value}</option>)}</select></label><label>搜尋原生 AI 工作 <input aria-label="搜尋原生 AI 工作" className="min-h-10 max-w-full rounded border bg-background px-2" value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} /></label></div>
      {query.isError ? <div role="alert">TaskFlow 原生 AI 資料讀取失敗：{query.error.message}。資料錯誤不會當成空清單。<button className="ml-2 min-h-10 rounded border px-3" onClick={() => void query.refetch()}>重試</button></div> : query.isPending ? <p role="status">讀取 TaskFlow 原生 Project／Issue…</p> : <>
        <p className="text-sm text-muted-foreground">完整讀回 {query.data?.total || 0} 張符合原生 Agent、Project、Issue 與 Task Queue 關聯條件的 TaskFlow Issue；分頁為非原子讀取，觀測時間：{new Date(query.data!.observedAt).toLocaleString("zh-TW")}。不代表 Provider 已接單或執行。</p>
        <section className={`${panel} grid min-w-0 gap-3 md:grid-cols-2`} aria-label="AI 原生專案"> <h2 className="md:col-span-2 font-semibold">AI 原生專案</h2>{workload.map(entry => <article key={entry.executorId} className="min-w-0 rounded border p-3"><h3 className="break-words font-medium">{entry.executorId}{entry.executorId === "GH-HELPER" ? "（GitHub 輔助角色）" : ""}</h3>{entry.mapping?.state === "VERIFIED" ? <><AppLink className="block break-words underline" href={paths.projectDetail(entry.mapping.project_id)}>{entry.mapping.project_title}</AppLink><p className="break-all text-xs text-muted-foreground">Native Project ID：{entry.mapping.project_id}</p><p className="break-words text-sm">原生 Issue：{entry.assigned.length} · 待處理：{entry.notStarted.length} · 待驗收／阻擋：{entry.reviewOrBlocked.length} · Provider 未驗證</p><button className="mt-2 min-h-10 rounded border px-3" aria-expanded={expandedExecutor === entry.executorId} onClick={() => setExpandedExecutor(expandedExecutor === entry.executorId ? "" : entry.executorId)}>{expandedExecutor === entry.executorId ? "收合 Issue" : "查看原生 Issue"}</button>{expandedExecutor === entry.executorId && (entry.assigned.length ? <ul className="mt-2 space-y-2 text-sm">{entry.assigned.map(item => <li key={item.issue_id} className="min-w-0 break-words"><AppLink href={paths.issueDetail(item.issue_id)}>{item.issue_id} · {item.title}</AppLink><span className="ml-1 text-muted-foreground">（TaskFlow：{nativeTaskStateLabel({ status: item.issue_status })}）</span></li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">尚無符合原生 AI Agent／Issue Queue 關聯的案件；不能推定 Executor 閒置或 Provider 可接單。</p>)}</> : <p className="break-words text-sm text-amber-700">GAP：原生 Agent／Project／Workspace／ACL 尚未完整驗證（{entry.mapping?.reason || "MAPPING_NOT_VERIFIED"}）。不建立假連結。</p>}</article>)}</section>
        <section className={panel} aria-label="PM Inbox"><h2 className="font-semibold">PM Inbox</h2><p className="text-sm text-muted-foreground">尚未接通可驗證的 PM 裁示／驗收事件來源；不以一般 Issue metadata 推論待辦。</p></section>
        <section aria-label="AI 任務總覽" className="grid min-w-0 gap-3 md:grid-cols-2">{pageVisible.map(item => <article key={item.issue_id} className={panel}><AppLink className="block break-words font-medium underline-offset-4 hover:underline" href={paths.issueDetail(item.issue_id)}>{item.issue_id} · {item.title}</AppLink><p className="my-2 break-words text-sm">Executor：{item.executor_id} · Project：{item.project_title} · TF 狀態：{nativeTaskStateLabel({ status: item.issue_status })}</p><p className="break-words text-sm">TaskFlow Queue：{item.taskflow_task_status} · Provider Runtime：{stateLabels[item.provider_runtime_state] || item.provider_runtime_state}</p><button className="mt-3 min-h-10 rounded border px-3" aria-expanded={expanded === item.issue_id} onClick={() => setExpanded(expanded === item.issue_id ? "" : item.issue_id)}>查看受保護執行證據</button>{expanded === item.issue_id && <TaskFlowDispatchRuntime key={workspace?.id + item.issue_id} issueId={item.issue_id} />}</article>)}</section>
        {!visible.length && <p>目前沒有符合原生 AI Agent／Project／Task Queue 條件的 TaskFlow Issue。</p>}
        <nav className="flex gap-3" aria-label="原生 AI Issue 分頁"><button className="min-h-10 rounded border px-3" disabled={!offset} onClick={() => { setOffset(Math.max(0, offset - DISPLAY_SIZE)); setExpanded(""); }}>上一頁</button><button className="min-h-10 rounded border px-3" disabled={offset + DISPLAY_SIZE >= visible.length} onClick={() => { setOffset(offset + DISPLAY_SIZE); setExpanded(""); }}>下一頁</button><span className="self-center text-sm text-muted-foreground">{visible.length ? `${offset + 1}–${Math.min(offset + DISPLAY_SIZE, visible.length)}／${visible.length}` : "0／0"}</span></nav>
      </>}
      <button disabled className="min-h-10 rounded border px-4 text-muted-foreground">派工尚未開放</button>
    </div>
  </main>;
}
