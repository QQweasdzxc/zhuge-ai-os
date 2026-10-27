"use client";

import { ProjectsPage } from "../projects/components/projects-page";

/**
 * AI 派工中心（專案形式）：原生 TaskFlow 專案模組，僅收 lead 為 AI Agent 的專案。
 * 每位 AI 工程師一個專案入口；點進去就是原生專案看板（/projects/[id] 不變）。
 * pageKey 讓此頁的檢視偏好（排序/篩選/欄位）與人用「專案」頁各自保存。
 */
export function TaskFlowAiDispatchPage() {
  return <ProjectsPage pageKey="ai-dispatch" leadKind="agent" />;
}
