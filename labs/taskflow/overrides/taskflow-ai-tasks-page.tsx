"use client";

import { ListTodo } from "lucide-react";
import type {
  Issue,
  IssueTableFacetSpec,
  IssueTableFacetsResponse,
  WorkingAgentSummary,
} from "@multica/core/types";
import { useViewStore } from "@multica/core/issues/stores/view-store-context";
import { PageHeader } from "../layout/page-header";
import { RefreshablePageIcon } from "../layout/refreshable-page-icon";
import { IssueSurface } from "../issues/surface/issue-surface";
import { useT } from "../i18n";
import { IssuesHeader } from "../issues/components/issues-header";

/**
 * AI 任務中心（任務總覽形式）：原生 TaskFlow 任務模組，依專案歸屬分組：
 * 只收 lead 為 AI Agent 的專案內的任務（含尚未指派的規劃卡），不依 assignee 判斷。
 * 與 AI 派工中心看同一份原生 Issue，不是複製的任務庫。
 * 使用完整原生 IssueSurface（非 caller-owned store 變體）：本頁採用原生
 * saved views，viewVariant="agents" 讓視圖清單、使用中視圖 key、內建頁籤
 * 全部隔離在本變體——人用的 /issues 頁完全不受影響，反之亦然
 * （原生預設行為零改動；隔離只在傳入 viewVariant 時生效）。
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
  const { t } = useT("layout");
  const dateFilter = useViewStore((s) => s.dateFilter);
  const setDateFilter = useViewStore((s) => s.setDateFilter);

  return (
    <>
      <PageHeader>
        <RefreshablePageIcon refreshing={isRefreshing}>
          <ListTodo className="size-4" />
        </RefreshablePageIcon>
        <h1 className="text-body font-medium">{t(($) => $.sidebar.ai_task_center)}</h1>
      </PageHeader>
      <IssuesHeader
        scopedIssues={issues}
        workingAgents={workingAgents}
        dateFilter={dateFilter}
        onDateFilterChange={setDateFilter}
        facetCountsExact={facetCountsExact}
        tableFacetCounts={tableFacetCounts}
        onTableFacetChange={onTableFacetChange}
        saveViewScope={{ kind: "workspace" }}
        viewVariant="agents"
        projectPartition="ai"
      />
    </>
  );
}

export function TaskFlowAiTasksPage() {
  const { t } = useT("layout");
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <IssueSurface
        scope={{ type: "workspace", projectPartition: "ai" }}
        viewVariant="agents"
        surfaceKey="taskflow-ai-tasks"
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
            <p className="text-body">{t(($) => $.sidebar.ai_tasks_empty)}</p>
          </div>
        )}
      />
    </div>
  );
}
