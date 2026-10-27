"use client";

import { useMemo, useState } from "react";
import { ListTodo } from "lucide-react";
import type {
  Issue,
  IssueTableFacetSpec,
  IssueTableFacetsResponse,
  WorkingAgentSummary,
} from "@multica/core/types";
import { useViewStore } from "@multica/core/issues/stores/view-store-context";
import { getIssueSurfaceViewStore } from "@multica/core/issues/stores/surface-view-store";
import { baselineFromQuery } from "@multica/core/issue-views/baseline";
import { PageHeader } from "../layout/page-header";
import { RefreshablePageIcon } from "../layout/refreshable-page-icon";
import { IssueSurfaceWithStore } from "../issues/surface/issue-surface";
import { IssuesHeader } from "../issues/components/issues-header";

/**
 * AI 任務中心（任務總覽形式）：原生 TaskFlow 任務模組，scope 固定為
 * actorKind "agents"（assignee_types = agent/squad，原生唯一翻譯通道）。
 * 與 AI 派工中心看同一份原生 Issue，不是複製的任務庫。
 * IssueSurfaceWithStore 是原生提供的 caller-owned store 形式：
 * 不採用已存視圖（saved views），本頁檢視狀態獨立保存於 "taskflow-ai-tasks"。
 */
function AiTasksSurfaceHeader({
  issues,
  workingAgents,
  isRefreshing,
  facetCountsExact,
  tableFacetCounts,
  onTableFacetChange,
}: {
  issues: Issue[];
  workingAgents: WorkingAgentSummary[] | undefined;
  isRefreshing: boolean;
  facetCountsExact: boolean;
  tableFacetCounts?: IssueTableFacetsResponse;
  onTableFacetChange: (facet: IssueTableFacetSpec | null) => void;
}) {
  const dateFilter = useViewStore((s) => s.dateFilter);
  const setDateFilter = useViewStore((s) => s.setDateFilter);

  return (
    <>
      <PageHeader>
        <RefreshablePageIcon refreshing={isRefreshing}>
          <ListTodo className="size-4" />
        </RefreshablePageIcon>
        <h1 className="text-body font-medium">AI 任務中心</h1>
      </PageHeader>
      <IssuesHeader
        scopedIssues={issues}
        workingAgents={workingAgents}
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        facetCountsExact={facetCountsExact}
        tableFacetCounts={tableFacetCounts}
        onTableFacetChange={onTableFacetChange}
        saveViewScope={null}
      />
    </>
  );
}

export function TaskFlowAiTasksPage() {
  const [store] = useState(() => getIssueSurfaceViewStore("taskflow-ai-tasks"));
  const baseline = useMemo(() => baselineFromQuery({}), []);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <IssueSurfaceWithStore
        store={store}
        baseline={baseline}
        scope={{ type: "workspace", actorKind: "agents" }}
        modes={["board", "list", "table", "swimlane"]}
        batchToolbar="list"
        renderHeader={({ controller }) => (
          <AiTasksSurfaceHeader
            issues={controller.surfaceIssues}
            workingAgents={controller.workingAgents}
            isRefreshing={controller.isRefreshing}
            facetCountsExact={controller.facetCountsExact}
            tableFacetCounts={controller.tableFacetCounts}
            onTableFacetChange={controller.setActiveTableFacet}
          />
        )}
        renderEmpty={() => (
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-2 text-muted-foreground">
            <ListTodo className="h-10 w-10 text-faint-foreground" />
            <p className="text-body">尚無 AI 工作卡</p>
          </div>
        )}
      />
    </div>
  );
}
