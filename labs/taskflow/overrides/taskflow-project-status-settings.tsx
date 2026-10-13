"use client";

import { useMemo, useState } from "react";
import { Check, Pencil, Settings2, X } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@multica/ui/components/ui/button";
import { Input } from "@multica/ui/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@multica/ui/components/ui/select";
import { useWorkspaceId } from "@multica/core/hooks";
import { useAuthStore } from "@multica/core/auth";
import { memberListOptions } from "@multica/core/workspace/queries";
import { useIssueStatuses } from "@multica/core/issue-statuses/hooks";
import { useCreateIssueStatus } from "@multica/core/issue-statuses/mutations";
import {
  createTaskFlowProjectStatusKey,
  taskFlowInternalProjectStatusName,
  taskFlowProjectIdFromStatusKey,
  useTaskFlowProjectStatusSettings,
} from "@multica/core/issue-statuses/taskflow-project-status-scope";
import type { IssueStatusCategory } from "@multica/core/types";
import { useT } from "../../i18n";

const CATEGORIES: IssueStatusCategory[] = ["unstarted", "started", "done", "closed"];

export function TaskFlowProjectStatusSettings({ projectId }: { projectId: string }) {
  const { t } = useT("issues");
  const workspaceId = useWorkspaceId();
  const user = useAuthStore((state) => state.user);
  const { data: members = [] } = useQuery(memberListOptions(workspaceId));
  const role = members.find((member) => member.user_id === user?.id)?.role;
  const canManageStatuses = role === "owner" || role === "admin";
  const catalog = useIssueStatuses(workspaceId);
  const settings = useTaskFlowProjectStatusSettings();
  const createStatus = useCreateIssueStatus();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState<IssueStatusCategory>("started");
  const categoryItems = useMemo(
    () => CATEGORIES.map((value) => ({ value, label: t(($) => $.taskflow_project_status.categories[value]) })),
    [t],
  );
  const statusKeys = useMemo(() => new Set(catalog.statuses.map((status) => status.key)), [catalog.statuses]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  if (settings.projectId !== projectId) return null;

  const saveVisibility = async (key: string, visible: boolean) => {
    try {
      await settings.setStatusVisible(key, visible);
    } catch {
      toast.error(t(($) => $.taskflow_project_status.save_failed));
    }
  };

  const addStatus = async () => {
    const normalizedName = name.trim();
    if (!normalizedName || !canManageStatuses || createStatus.isPending) return;
    try {
      const key = createTaskFlowProjectStatusKey(projectId, statusKeys);
      await createStatus.mutateAsync({
        key,
        name: taskFlowInternalProjectStatusName(key),
        description: "",
        category,
        color: "#64748b",
      });
      await settings.setStatusLabel(key, normalizedName);
      setName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.taskflow_project_status.save_failed));
    }
  };

  const saveStatusName = async (statusKey: string) => {
    const normalizedName = editingName.trim();
    if (!normalizedName || normalizedName.length > 64 || settings.isLoading) return;
    try {
      await settings.setStatusLabel(statusKey, normalizedName);
      setEditingKey(null);
      setEditingName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t(($) => $.taskflow_project_status.save_failed));
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 shrink-0 gap-1.5 text-muted-foreground md:h-7"
        data-testid="taskflow-project-status-settings"
        onClick={() => setOpen(true)}
      >
        <Settings2 className="size-3.5" />
        <span className="hidden sm:inline">{t(($) => $.taskflow_project_status.button)}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85dvh] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t(($) => $.taskflow_project_status.title)}</DialogTitle>
            <DialogDescription>{t(($) => $.taskflow_project_status.description)}</DialogDescription>
          </DialogHeader>

          <div className="space-y-1" aria-label={t(($) => $.taskflow_project_status.fields)}>
            {catalog.activeStatuses.map((status) => {
              const visible = !settings.hiddenStatusKeys.includes(status.key);
              const projectOwned = taskFlowProjectIdFromStatusKey(status.key) === projectId.toLowerCase();
              const checkboxId = `taskflow-status-${status.id}`;
              return (
                <div key={status.key} className="flex min-h-10 items-center gap-2 rounded-md px-2 hover:bg-muted/50">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={visible}
                    disabled={settings.isLoading}
                    onChange={(event) => void saveVisibility(status.key, event.currentTarget.checked)}
                    aria-label={t(($) => $.taskflow_project_status.visibility, {
                      name: settings.statusLabels[status.key] ?? status.name,
                    })}
                    className="size-4 shrink-0 accent-primary"
                  />
                  {editingKey === status.key ? (
                    <div className="min-w-0 flex-1">
                      <Input
                        value={editingName}
                        onChange={(event) => setEditingName(event.currentTarget.value)}
                        aria-label={t(($) => $.taskflow_project_status.edit_status)}
                        maxLength={64}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void saveStatusName(status.key);
                          }
                          if (event.key === "Escape") setEditingKey(null);
                        }}
                      />
                    </div>
                  ) : (
                    <label htmlFor={checkboxId} className="min-w-0 flex-1 truncate py-1 text-body">
                      {settings.statusLabels[status.key] ?? status.name}
                    </label>
                  )}
                  {status.is_system && (
                    <span className="shrink-0 text-caption text-muted-foreground">{t(($) => $.taskflow_project_status.built_in)}</span>
                  )}
                  {!status.is_system && projectOwned && canManageStatuses && (
                    editingKey === status.key ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t(($) => $.taskflow_project_status.save_status)}
                          disabled={!editingName.trim() || settings.isLoading}
                          onClick={() => void saveStatusName(status.key)}
                        >
                          <Check className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t(($) => $.taskflow_project_status.cancel_edit)}
                          onClick={() => setEditingKey(null)}
                        >
                          <X className="size-4" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t(($) => $.taskflow_project_status.edit_status)}
                        onClick={() => {
                          setEditingKey(status.key);
                          setEditingName(settings.statusLabels[status.key] ?? status.name);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                    )
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row">
            <Input
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder={t(($) => $.taskflow_project_status.new_status)}
              aria-label={t(($) => $.taskflow_project_status.new_status)}
              maxLength={64}
              disabled={!canManageStatuses || createStatus.isPending}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addStatus();
                }
              }}
            />
            <Select
              items={categoryItems}
              value={category}
              onValueChange={(value) => value && setCategory(value as IssueStatusCategory)}
            >
              <SelectTrigger className="w-full sm:w-36" aria-label={t(($) => $.taskflow_project_status.category)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categoryItems.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" onClick={() => void addStatus()} disabled={!canManageStatuses || !name.trim() || createStatus.isPending}>
              {t(($) => $.taskflow_project_status.add)}
            </Button>
          </div>
          {!canManageStatuses && (
            <p className="text-caption text-muted-foreground">{t(($) => $.taskflow_project_status.admin_required)}</p>
          )}
          <DialogFooter className="flex-row justify-between sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              disabled={settings.isLoading}
              onClick={() => void settings.saveHiddenStatusKeys(null).catch(() => toast.error(t(($) => $.taskflow_project_status.save_failed)))}
            >
              {t(($) => $.taskflow_project_status.restore_defaults)}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              {t(($) => $.taskflow_project_status.done)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
