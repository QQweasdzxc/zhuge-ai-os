"use client";
import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@multica/core/hooks";
import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";
import { useTaskFlowProjectStatusSettings } from "@multica/core/issue-statuses/taskflow-project-status-scope";
import { useStatusLabel } from "../utils/status-label";
import { useT } from "../../i18n";

/** A pointer-only header handle, separate from the card's dnd-kit sensors. */
export function TaskFlowStatusDragHandle({ status }: { status: string }) {
  const settings = useTaskFlowProjectStatusSettings();
  const catalog = useIssueStatuses(useWorkspaceId());
  const labelOf = useStatusLabel(useWorkspaceId());
  const { t } = useT("issues");
  const start = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  return <button type="button" data-taskflow-column-handle={status}
    aria-label={t(($) => $.taskflow_project_status.drag_status, { name: labelOf(status) })}
    title={t(($) => $.taskflow_project_status.drag_status, { name: labelOf(status) })}
    disabled={settings.isLoading} aria-pressed={dragging}
    className="shrink-0 touch-none cursor-grab rounded p-1 text-muted-foreground hover:bg-muted focus-visible:ring-2 active:cursor-grabbing"
    onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); start.current = { x: event.clientX, y: event.clientY }; event.currentTarget.setPointerCapture?.(event.pointerId); setDragging(true); }}
    onPointerMove={event => {
      if (!start.current) return;
      event.stopPropagation();
      // Keep the target under the pointer visible on narrow boards.
      const board = event.currentTarget.closest("[data-taskflow-status-header]")?.parentElement?.parentElement;
      if (board && board.scrollWidth > board.clientWidth) {
        const rect = board.getBoundingClientRect();
        if (event.clientX > rect.right - 36) board.scrollLeft += 20;
        if (event.clientX < rect.left + 36) board.scrollLeft -= 20;
      }
    }}
    onPointerCancel={() => { start.current = null; setDragging(false); }}
    onPointerUp={event => {
      event.stopPropagation();
      const origin = start.current; start.current = null; setDragging(false);
      if (!origin || Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 8) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-taskflow-status-header]")?.dataset.taskflowStatusHeader;
      if (!target || target === status) return;
      const keys = catalog.activeStatuses.map(entry => entry.key);
      const from = keys.indexOf(status), to = keys.indexOf(target);
      if (from < 0 || to < 0) return;
      keys.splice(to, 0, ...keys.splice(from, 1));
      void settings.setStatusOrder(keys).catch(() => toast.error(t(($) => $.taskflow_project_status.save_failed)));
    }}><GripVertical className="size-4" /></button>;
}
