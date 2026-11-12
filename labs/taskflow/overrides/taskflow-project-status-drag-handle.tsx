"use client";

import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { toast } from "sonner";
import { useWorkspaceId } from "@multica/core/hooks";
import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";
import { moveTaskFlowStatus, useTaskFlowProjectStatusSettings } from "@multica/core/issue-statuses/taskflow-project-status-scope";
import { useStatusLabel } from "../utils/status-label";
import { useT } from "../../i18n";

/** Header-only pointer capture keeps column moves out of the card DndContext.
 * Writes only this user's Project view preference, never status/category/issue rows.
 */
export function TaskFlowProjectStatusDragHandle({ status }: { status: string }) {
  const settings = useTaskFlowProjectStatusSettings();
  const wsId = useWorkspaceId();
  const catalog = useIssueStatuses(wsId);
  const labelOf = useStatusLabel(wsId);
  const { t } = useT("issues");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const keys = catalog.activeStatuses.map((entry) => entry.key);
  const save = async (target: string) => {
    if (!settings.projectId || settings.isLoading || busy || !keys.includes(target) || target === status) return;
    setBusy(true);
    try {
      await settings.saveStatusOrder(moveTaskFlowStatus(keys, status, target));
      toast.success(t(($) => $.taskflow_project_status.order_saved));
    } catch {
      toast.error(t(($) => $.taskflow_project_status.save_failed));
    } finally {
      setBusy(false);
    }
  };
  if (!settings.projectId || !keys.includes(status)) return null;
  return <button
    type="button"
    className={`flex h-8 w-5 shrink-0 touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary ${dragging ? "bg-primary/20 text-primary cursor-grabbing" : "cursor-grab"}`}
    data-taskflow-column-handle={status}
    aria-label={t(($) => $.taskflow_project_status.drag_order, { name: labelOf(status) })}
    title={t(($) => $.taskflow_project_status.drag_help)}
    disabled={busy || settings.isLoading || !catalog.isLoaded || catalog.isError}
    onPointerDown={(event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      event.preventDefault();
      event.currentTarget.focus();
      start.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      const origin = start.current;
      if (!origin || origin.pointerId !== event.pointerId) return;
      event.stopPropagation();
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 6) {
        origin.moved = true;
        setDragging(true);
        const scroller = event.currentTarget.closest("[data-board-scroller]");
        if (scroller instanceof HTMLElement) {
          const rect = scroller.getBoundingClientRect();
          if (event.clientX < rect.left + 35) scroller.scrollLeft -= 24;
          else if (event.clientX > rect.right - 35) scroller.scrollLeft += 24;
        }
      }
    }}
    onPointerUp={(event) => {
      const origin = start.current;
      if (!origin || origin.pointerId !== event.pointerId) return;
      event.stopPropagation();
      start.current = null;
      setDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
      if (!origin.moved) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-taskflow-column]");
      // The nearest board must be the same board as the source. No cross-project drag.
      if (target?.closest("[data-board-scroller]") !== event.currentTarget.closest("[data-board-scroller]")) return;
      const targetKey = target?.getAttribute("data-taskflow-column");
      if (targetKey) void save(targetKey);
    }}
    onPointerCancel={() => { start.current = null; setDragging(false); }}
    onLostPointerCapture={() => { start.current = null; setDragging(false); }}
    onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      const target = keys[keys.indexOf(status) + (event.key === "ArrowLeft" ? -1 : 1)];
      if (target) void save(target);
    }}
  ><GripVertical className="size-3.5" /></button>;
}
