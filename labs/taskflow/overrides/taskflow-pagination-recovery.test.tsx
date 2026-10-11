/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { setApiInstance } from "@multica/core/api";
import { ApiError } from "@multica/core/api/client";
import type { ApiClient } from "@multica/core/api/client";
import type {
  Issue,
  IssueStatus,
  IssueTableQuerySpec,
  IssueTableRowsRequest,
} from "@multica/core/types";
import { useIssueStatusBranches } from "./use-issue-status-branches";

function makeIssue(id: string, projectId: string | null = null): Issue {
  return {
    id,
    workspace_id: "ws-1",
    number: 1,
    identifier: `TF-${id}`,
    title: id,
    description: null,
    status: "todo",
    priority: "none",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "user-1",
    parent_issue_id: null,
    project_id: projectId,
    position: 1,
    stage: null,
    start_date: null,
    due_date: null,
    metadata: {},
    properties: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
}

const query: IssueTableQuerySpec = {
  scope: { kind: "workspace" },
  filters: { include_sub_issues: true },
  sort: { field: "position", direction: "asc" },
};

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderStatusBranches() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0, staleTime: Infinity } },
  });
  const hook = renderHook(
    ({ wsId }: { wsId: string }) =>
      useIssueStatusBranches({
        wsId,
        query,
        statuses: ["todo"] as IssueStatus[],
        facets: {
          query_fingerprint: "test",
          total: 0,
          facets: [{ kind: "status", values: [{ key: "todo", count: 0 }] }],
        },
        facetsPending: false,
        facetsFetching: false,
        enabled: true,
      }),
    { initialProps: { wsId: "ws-1" }, wrapper: wrapper(queryClient) },
  );
  return { ...hook, queryClient };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TaskFlow Board pagination recovery", () => {
  it("labels an empty first-page failure and clears it after a successful retry", async () => {
    let unavailable = true;
    const listIssueTableRows = vi.fn(async () => {
      if (unavailable) throw new ApiError("temporary", 503, "Unavailable", undefined, "srv_123456");
      return {
        query_fingerprint: "test",
        group_key: "status:todo",
        parent_id: null,
        total: 0,
        rows: [],
        branch_total: 0,
        next_cursor: null,
      };
    });
    setApiInstance({
      listIssueTableRows,
      listIssueStatuses: async () => ({ statuses: [], categories: [], total: 0 }),
    } as unknown as ApiClient);
    const { result, queryClient } = renderStatusBranches();

    await waitFor(() => expect(result.current.pagination.todo?.isInitialError).toBe(true));
    expect(result.current.pagination.todo?.isTailError).toBe(false);
    expect(result.current.issues).toEqual([]);
    expect(listIssueTableRows).toHaveBeenCalledTimes(3);

    unavailable = false;
    act(() => result.current.pagination.todo?.retry());
    await waitFor(() => expect(result.current.pagination.todo?.isError).toBe(false));
    expect(result.current.pagination.todo?.isInitialError).toBe(false);
    queryClient.clear();
  });

  it("keeps loaded cards during a tail failure, distinguishes it, and recovers without duplicates", async () => {
    let tailFailuresRemaining = 3;
    const listIssueTableRows = vi.fn(async (request: IssueTableRowsRequest, options?: { signal?: AbortSignal }) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      if (request.page?.cursor === "cursor-2") {
        if (tailFailuresRemaining > 0) {
          tailFailuresRemaining -= 1;
          throw new ApiError("temporary", 503, "Unavailable", undefined, "srv_987654");
        }
        return {
          query_fingerprint: "test",
          group_key: "status:todo",
          parent_id: null,
          total: 2,
          rows: [{ issue: makeIssue("issue-2"), direct_child_count: 0 }],
          branch_total: 2,
          next_cursor: null,
        };
      }
      return {
        query_fingerprint: "test",
        group_key: "status:todo",
        parent_id: null,
        total: 2,
        rows: [{ issue: makeIssue("issue-1"), direct_child_count: 0 }],
        branch_total: 2,
        next_cursor: "cursor-2",
      };
    });
    setApiInstance({
      listIssueTableRows,
      listIssueStatuses: async () => ({ statuses: [], categories: [], total: 0 }),
    } as unknown as ApiClient);
    const { result, queryClient } = renderStatusBranches();

    await waitFor(() => expect(result.current.pagination.todo?.hasMore).toBe(true));
    act(() => result.current.pagination.todo?.loadMore());
    await waitFor(() => expect(result.current.pagination.todo?.isTailError).toBe(true));
    expect(result.current.pagination.todo?.isInitialError).toBe(false);
    expect(result.current.issues.map((issue) => issue.id)).toEqual(["issue-1"]);
    expect(result.current.pagination.todo?.isLoading).toBe(false);

    act(() => result.current.pagination.todo?.retry());
    await waitFor(() => expect(result.current.issues.map((issue) => issue.id)).toEqual(["issue-1", "issue-2"]));
    expect(result.current.pagination.todo?.isError).toBe(false);
    expect(new Set(result.current.issues.map((issue) => issue.id)).size).toBe(2);
    queryClient.clear();
  });

  it("does not let a late Project A response replace Project B after a rapid switch", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    const signals = new Map<string, AbortSignal>();
    const listIssueTableRows = vi.fn((request: IssueTableRowsRequest, options?: { signal?: AbortSignal }) => {
      const projectId = request.query.scope.kind === "project" ? request.query.scope.project_id : "unknown";
      if (options?.signal) signals.set(projectId, options.signal);
      return new Promise((resolve) => pending.set(projectId, resolve));
    });
    setApiInstance({
      listIssueTableRows,
      listIssueStatuses: async () => ({ statuses: [], categories: [], total: 0 }),
    } as unknown as ApiClient);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0, staleTime: Infinity } },
    });
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) => useIssueStatusBranches({
        wsId: "ws-1",
        query: {
          ...query,
          scope: { kind: "project", project_id: projectId },
        },
        statuses: ["todo"] as IssueStatus[],
        facets: undefined,
        facetsPending: false,
        facetsFetching: false,
        enabled: true,
      }),
      { initialProps: { projectId: "project-a" }, wrapper: wrapper(queryClient) },
    );

    await waitFor(() => expect(listIssueTableRows).toHaveBeenCalledTimes(1));
    rerender({ projectId: "project-b" });
    await waitFor(() => expect(listIssueTableRows).toHaveBeenCalledTimes(2));
    expect(signals.get("project-a")?.aborted).toBe(true);

    const response = (projectId: string) => ({
      query_fingerprint: "test",
      group_key: "status:todo",
      parent_id: null,
      total: 1,
      rows: [{ issue: makeIssue(`issue-${projectId}`, projectId), direct_child_count: 0 }],
      branch_total: 1,
      next_cursor: null,
    });
    await act(async () => pending.get("project-b")?.(response("project-b")));
    await waitFor(() => expect(result.current.issues.map((issue) => issue.id)).toEqual(["issue-project-b"]));
    await act(async () => pending.get("project-a")?.(response("project-a")));
    expect(result.current.issues.map((issue) => issue.id)).toEqual(["issue-project-b"]);
    queryClient.clear();
  });
});
