#!/usr/bin/env python3
"""Apply fail-closed TaskFlow reliability overlays to the frozen build copy."""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
from pathlib import Path


EXPECTED_SHA256 = {
    "server/cmd/server/dbstats.go": "c4c5957e4bb765de96e2d3a38b9c8fdae66b6951cdc812d7be7ea310f1835eb5",
    "server/internal/handler/webhook_delivery_worker.go": "102ad929235cde4dfe367af1ddc15aea968da0c60a019fef0fa4883b2e12f155",
    "packages/core/api/client.ts": "e2c78d79f8d4151139cd03ee22e9c5232bc84aad8da0dd6058560547517474bc",
    "packages/core/api/index.ts": "ed94059912b3c353bc25c5f33057f9faef5917eed342f5c86c4437516313beae",
    "packages/core/issues/queries.ts": "5079821fb22bb18cf63af4f7cddf03e900edb694da4e4a4b57260c0701ecb317",
    "packages/views/issues/surface/use-issue-status-branches.ts": "b833ac32064e023914c308deb43eca83fcdac005fbef347eb01df5cb9e0fd8b7",
    "packages/views/issues/surface/use-issue-status-branches.test.tsx": "e65a4a582b3ddec94a87276da98f3d48da11b2a8d174957cb0a7d3243f8254d8",
    "packages/views/issues/surface/use-issue-group-branches.ts": "a287ff40cf5b5c0c7d79e3bd70a265b32a22cef64072c52745635da36d69d128",
    "packages/views/issues/components/list-load-more-footer.tsx": "62d969334d50c03c19bd8eb6faa01d0869dee1acec54665ce63a4360598d7749",
    "packages/views/issues/components/board-view.tsx": "4c9194ed3cdea1c2b755521dbe0d1a7eec2fcdd814f6048bcabe6e1837d63949",
    "packages/views/issues/components/list-view.tsx": "f594f910278dca7ebda20ef279d194582abc6ec380f89dbc1bd80d3a7fc17180",
    "packages/views/issues/components/swimlane-view.tsx": "5036f077923ec4c13fdbbcc1bca282b2d7b44adf31e74567371f6c69ab794489",
}


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f"{label}: expected one upstream marker, found {count}")
    return source.replace(old, new, 1)


def patch_db_stats(source: str) -> str:
    source = replace_once(
        source,
        "\tapplyPoolSizing(cfg, dbURL, sizing)\n\treturn pgxpool.NewWithConfig(ctx, cfg)",
        "\tapplyPoolSizing(cfg, dbURL, sizing)\n"
        "\tif err := validateTaskFlowPoolBudget(cfg, sizing); err != nil {\n"
        "\t\treturn nil, err\n"
        "\t}\n"
        "\treturn pgxpool.NewWithConfig(ctx, cfg)",
        "TaskFlow pool budget call site",
    )
    source = replace_once(
        source,
        "\tif cfg.MinConns > cfg.MaxConns {\n\t\tcfg.MinConns = cfg.MaxConns\n\t}\n",
        "",
        "silent min/max pool clamp",
    )
    return source


def patch_webhook_worker(source: str) -> str:
    start = "func (w *WebhookDeliveryWorker) runLoop(ctx context.Context) {"
    end = "\nfunc (w *WebhookDeliveryWorker) WaitWithTimeout(timeout time.Duration) bool {"
    if source.count(start) != 1 or source.count(end) != 1:
        raise ValueError("webhook worker loop marker missing or ambiguous")
    before, rest = source.split(start, 1)
    _, after = rest.split(end, 1)
    replacement = '''func (w *WebhookDeliveryWorker) runLoop(ctx context.Context) {
	delay := taskFlowWebhookIdleMinDelay
	for {
		worked, err := w.ProcessNext(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			slog.Error("webhook worker: process delivery", "error", err)
		}
		if worked && err == nil {
			// Drain available durable work without adding queue latency.
			delay = taskFlowWebhookIdleMinDelay
			continue
		}
		delay = taskFlowWebhookNextPollDelay(delay)
		switch waitForTaskFlowWebhookWake(ctx, w.notify, delay) {
		case taskFlowWebhookCancelled:
			return
		case taskFlowWebhookNotified:
			// New durable work still wakes a worker immediately.
			delay = taskFlowWebhookIdleMinDelay
		}
	}
}'''
    return before + replacement + end + after


def patch_api_client(source: str) -> str:
    source = replace_once(
        source,
        "  readonly body?: unknown;\n\n  constructor(message: string, status: number, statusText: string, body?: unknown) {\n"
        "    super(message);\n    this.name = \"ApiError\";\n    this.status = status;\n    this.statusText = statusText;\n    this.body = body;\n  }",
        "  readonly body?: unknown;\n  readonly requestId: string | null;\n\n"
        "  constructor(message: string, status: number, statusText: string, body?: unknown, requestId: string | null = null) {\n"
        "    super(message);\n    this.name = \"ApiError\";\n    this.status = status;\n    this.statusText = statusText;\n    this.body = body;\n    this.requestId = requestId;\n  }",
        "ApiError request identifier",
    )
    source = replace_once(
        source,
        "export class ApiError extends Error {",
        "export class ApiNetworkError extends Error {\n"
        "  readonly requestId: string;\n"
        "  readonly originalError: unknown;\n\n"
        "  constructor(requestId: string, originalError: unknown) {\n"
        "    super(originalError instanceof Error ? originalError.message : \"Network request failed\");\n"
        "    this.name = \"ApiNetworkError\";\n"
        "    this.requestId = requestId;\n"
        "    this.originalError = originalError;\n"
        "  }\n"
        "}\n\n"
        "export class ApiError extends Error {",
        "network transport error type",
    )
    source = replace_once(
        source,
        "    const send = () =>\n      fetch(`${this.baseUrl}${path}`, {\n        ...init,\n        headers: buildHeaders(),\n        credentials: \"include\",\n      });\n\n    let res = await send();",
        "    const send = async (): Promise<Response> => {\n"
        "      try {\n"
        "        return await fetch(`${this.baseUrl}${path}`, {\n"
        "          ...init,\n"
        "          headers: buildHeaders(),\n"
        "          credentials: \"include\",\n"
        "        });\n"
        "      } catch (error) {\n"
        "        if (typeof DOMException !== \"undefined\" && error instanceof DOMException && error.name === \"AbortError\") throw error;\n"
        "        if (error instanceof TypeError) throw new ApiNetworkError(rid, error);\n"
        "        throw error;\n"
        "      }\n"
        "    };\n\n"
        "    let res = await send();",
        "network fetch classification",
    )
    source = replace_once(
        source,
        "      const logLevel = res.status === 404 ? \"warn\" : \"error\";\n"
        "      this.logger[logLevel](`← ${res.status} ${path}`, { rid, duration: `${Date.now() - start}ms`, error: message });\n"
        "      throw new ApiError(message, res.status, res.statusText, body);",
        "      const logLevel = res.status === 404 ? \"warn\" : \"error\";\n"
        "      const serverRequestId = res.headers.get(\"X-Request-ID\");\n"
        "      const responseRequestId = serverRequestId && /^[A-Za-z0-9_-]{8,32}$/.test(serverRequestId)\n"
        "        ? serverRequestId\n"
        "        : rid;\n"
        "      const duration = `${Date.now() - start}ms`;\n"
        "      if (path === \"/api/issues/table/rows\") {\n"
        "        // Keep row-query diagnostics correlatable without logging response bodies.\n"
        "        this.logger[logLevel](`← ${res.status} ${path}`, { rid, request_id: responseRequestId, status: res.status, duration });\n"
        "      } else {\n"
        "        this.logger[logLevel](`← ${res.status} ${path}`, { rid, duration, error: message });\n"
        "      }\n"
        "      throw new ApiError(message, res.status, res.statusText, body, responseRequestId);",
        "row request safe diagnostics",
    )
    source = replace_once(
        source,
        "  async listIssueTableRows(params: IssueTableRowsRequest): Promise<IssueTableRowsResponse> {\n"
        "    const raw = await this.fetch<unknown>(\"/api/issues/table/rows\", {\n"
        "      method: \"POST\",\n      body: JSON.stringify(params),\n    });",
        "  async listIssueTableRows(\n"
        "    params: IssueTableRowsRequest,\n"
        "    options: { signal?: AbortSignal } = {},\n"
        "  ): Promise<IssueTableRowsResponse> {\n"
        "    const raw = await this.fetch<unknown>(\"/api/issues/table/rows\", {\n"
        "      method: \"POST\",\n      body: JSON.stringify(params),\n      signal: options.signal,\n    });",
        "row request abort signal",
    )
    source = replace_once(
        source,
        "  return new ApiError(message, err.status, err.statusText, err.body);",
        "  return new ApiError(message, err.status, err.statusText, err.body, err.requestId);",
        "ApiError remapping request identifier",
    )
    return source


def patch_core_queries(source: str) -> str:
    source = replace_once(
        source,
        'import { api, ApiError } from "../api";',
        'import { api, ApiError, ApiNetworkError } from "../api";',
        "row network error import",
    )
    anchor = 'import { issueColumnCategory } from "./status-category";\n'
    helper = '''

/** Retry transient row-query transport/server failures only. Permanent 4xx and
 * cancellation remain visible without automatic reissue. Two retries bound the
 * load placed on the shared session pool. */
export function shouldRetryIssueTableRows(failureCount: number, error: unknown): boolean {
  if (failureCount >= 2) return false;
  if (error instanceof ApiError) {
    return error.status === 429 || (error.status >= 500 && error.status < 600);
  }
  return error instanceof ApiNetworkError;
}

export function issueTableRowsErrorDiagnostic(error: unknown): { status?: number; requestId?: string } {
  if (!(error instanceof ApiError) && !(error instanceof ApiNetworkError)) return {};
  const requestId = error.requestId;
  const safeRequestId = requestId && /^[A-Za-z0-9_-]{8,32}$/.test(requestId)
    ? requestId
    : undefined;
  return { status: error instanceof ApiError ? error.status : undefined, requestId: safeRequestId };
}
'''
    source = replace_once(source, anchor, anchor + helper, "row retry/diagnostic helper insertion")
    source = replace_once(
        source,
        "    queryFn: () => api.listIssueTableRows(request),\n"
        "    placeholderData: keepPreviousData,\n"
        "    retry: false,",
        "    queryFn: ({ signal }) => api.listIssueTableRows(request, { signal }),\n"
        "    placeholderData: keepPreviousData,\n"
        "    retry: shouldRetryIssueTableRows,",
        "row page cancellation and bounded retry",
    )
    return source


def patch_core_api_exports(source: str) -> str:
    return replace_once(
        source,
        "  ApiClient,\n  ApiError,\n",
        "  ApiClient,\n  ApiError,\n  ApiNetworkError,\n",
        "ApiNetworkError public export",
    )


def patch_status_branches(source: str) -> str:
    source = replace_once(
        source,
        "  isError: boolean;\n  loadMore: () => void;\n  retry: () => void;\n}",
        "  isError: boolean;\n  isInitialError?: boolean;\n  isTailError?: boolean;\n  errorStatus?: number;\n  errorRequestId?: string;\n  loadMore: () => void;\n  retry: () => void;\n}",
        "status page error stage fields",
    )
    source = replace_once(
        source,
        "import {\n  issueKeys,\n  issueTableRowPageOptions,\n} from \"@multica/core/issues/queries\";",
        "import {\n  issueKeys,\n  issueTableRowPageOptions,\n  issueTableRowsErrorDiagnostic,\n} from \"@multica/core/issues/queries\";",
        "status branch safe diagnostic import",
    )
    source = replace_once(
        source,
        "  isError: boolean;\n  headUpdatedAt: number;",
        "  isError: boolean;\n  isInitialError: boolean;\n  isTailError: boolean;\n  errorStatus?: number;\n  errorRequestId?: string;\n  headUpdatedAt: number;",
        "status branch error state",
    )
    source = replace_once(
        source,
        "        isError: false,\n        headUpdatedAt: 0,",
        "        isError: false,\n        isInitialError: false,\n        isTailError: false,\n        headUpdatedAt: 0,",
        "status branch error defaults",
    )
    source = replace_once(
        source,
        "      current.isError ||= queryResult.isError;\n      if (target.cursor === null) {",
        "      current.isError ||= queryResult.isError;\n"
        "      if (queryResult.isError) {\n"
        "        if (target.cursor === null) current.isInitialError = true;\n"
        "        else current.isTailError = true;\n"
        "        const diagnostic = issueTableRowsErrorDiagnostic(queryResult.error);\n"
        "        current.errorStatus ??= diagnostic.status;\n"
        "        current.errorRequestId ??= diagnostic.requestId;\n"
        "      }\n"
        "      if (target.cursor === null) {",
        "status branch page error classification",
    )
    source = replace_once(
        source,
        "            isError: enabled && (branch?.isError ?? false),\n            loadMore: () => loadMore(status),",
        "            isError: enabled && (branch?.isError ?? false),\n"
        "            isInitialError: enabled && (branch?.isInitialError ?? false),\n"
        "            isTailError: enabled && (branch?.isTailError ?? false),\n"
        "            errorStatus: branch?.errorStatus,\n"
        "            errorRequestId: branch?.errorRequestId,\n"
        "            loadMore: () => loadMore(status),",
        "status pagination error output",
    )
    source = patch_failed_row_page_retry(source, "status")
    return source


def patch_group_branches(source: str) -> str:
    source = replace_once(
        source,
        "  isError: boolean;\n  loadMore: () => void;\n  retry: () => void;\n}",
        "  isError: boolean;\n  isInitialError?: boolean;\n  isTailError?: boolean;\n  errorStatus?: number;\n  errorRequestId?: string;\n  loadMore: () => void;\n  retry: () => void;\n}",
        "group page error stage fields",
    )
    source = replace_once(
        source,
        "  isError: boolean;\n  hasMoreGroups: boolean;",
        "  isError: boolean;\n  errorStatus?: number;\n  errorRequestId?: string;\n  hasMoreGroups: boolean;",
        "group catalog error diagnostics",
    )
    source = replace_once(
        source,
        "import {\n  issueKeys,\n  issueTableGroupsOptions,\n  issueTableRowPageOptions,\n} from \"@multica/core/issues/queries\";",
        "import {\n  issueKeys,\n  issueTableGroupsOptions,\n  issueTableRowPageOptions,\n  issueTableRowsErrorDiagnostic,\n} from \"@multica/core/issues/queries\";",
        "group branch safe diagnostic import",
    )
    source = replace_once(
        source,
        "  isError: boolean;\n  headUpdatedAt: number;",
        "  isError: boolean;\n  isInitialError: boolean;\n  isTailError: boolean;\n  errorStatus?: number;\n  errorRequestId?: string;\n  headUpdatedAt: number;",
        "group branch error state",
    )
    source = replace_once(
        source,
        "        isError: false,\n        headUpdatedAt: 0,",
        "        isError: false,\n        isInitialError: false,\n        isTailError: false,\n        headUpdatedAt: 0,",
        "group branch error defaults",
    )
    source = replace_once(
        source,
        "      current.isError ||= pageResult.isError;\n      if (target.cursor === null) {",
        "      current.isError ||= pageResult.isError;\n"
        "      if (pageResult.isError) {\n"
        "        if (target.cursor === null) current.isInitialError = true;\n"
        "        else current.isTailError = true;\n"
        "        const diagnostic = issueTableRowsErrorDiagnostic(pageResult.error);\n"
        "        current.errorStatus ??= diagnostic.status;\n"
        "        current.errorRequestId ??= diagnostic.requestId;\n"
        "      }\n"
        "      if (target.cursor === null) {",
        "group branch page error classification",
    )
    source = replace_once(
        source,
        "              isError: enabled && (branch?.isError ?? false),\n              loadMore: () => loadMore(descriptor.key),",
        "              isError: enabled && (branch?.isError ?? false),\n"
        "              isInitialError: enabled && (branch?.isInitialError ?? false),\n"
        "              isTailError: enabled && (branch?.isTailError ?? false),\n"
        "              errorStatus: branch?.errorStatus,\n"
        "              errorRequestId: branch?.errorRequestId,\n"
        "              loadMore: () => loadMore(descriptor.key),",
        "group pagination error output",
    )
    source = replace_once(
        source,
        "  const retryGroups = useCallback(() => {\n    void refetchGroups();\n  }, [refetchGroups]);\n\n  return {",
        "  const retryGroups = useCallback(() => {\n    void refetchGroups();\n  }, [refetchGroups]);\n"
        "  const groupErrorDiagnostic = issueTableRowsErrorDiagnostic(groupsQuery.error);\n\n"
        "  return {",
        "group query diagnostic capture",
    )
    source = replace_once(
        source,
        "    isError:\n      enabled &&\n      (groupsQuery.isError ||\n        branchKeys.some((key) => branchData.get(key)?.isError)),\n    hasMoreGroups:",
        "    isError:\n      enabled &&\n      (groupsQuery.isError ||\n        branchKeys.some((key) => branchData.get(key)?.isError)),\n"
        "    errorStatus: groupsQuery.isError ? groupErrorDiagnostic.status : undefined,\n"
        "    errorRequestId: groupsQuery.isError ? groupErrorDiagnostic.requestId : undefined,\n"
        "    hasMoreGroups:",
        "group catalog error output",
    )
    source = patch_failed_row_page_retry(source, "group")
    return source


def patch_status_branches_test(source: str) -> str:
    return replace_once(
        source,
        '    expect(listIssueTableRows).toHaveBeenNthCalledWith(\n'
        '      2,\n'
        '      expect.objectContaining({\n'
        '        group_key: "status:todo",\n'
        '        page: { limit: 50, cursor: "cursor-2" },\n'
        '      }),\n'
        '    );',
        '    expect(listIssueTableRows).toHaveBeenNthCalledWith(\n'
        '      2,\n'
        '      expect.objectContaining({\n'
        '        group_key: "status:todo",\n'
        '        page: { limit: 50, cursor: "cursor-2" },\n'
        '      }),\n'
        '      expect.objectContaining({ signal: expect.any(AbortSignal) }),\n'
        '    );',
        "status branch test expects cancellation options",
    )


def patch_failed_row_page_retry(source: str, label: str) -> str:
    return replace_once(
        source,
        '        exact: false,\n        type: "active",\n      });\n    },\n    [group, query, queryClient, wsId],',
        '        exact: false,\n'
        '        // Retry only failed pages; refetching a successful head detaches its cursor chain.\n'
        '        predicate: (candidate) => candidate.state.status === "error",\n'
        '        type: "active",\n      });\n    },\n    [group, query, queryClient, wsId],',
        f"{label} retry preserves successful pages",
    )


def patch_footer(source: str) -> str:
    source = replace_once(
        source,
        "  isError = false,\n  onRetry,\n}: {",
        "  isError = false,\n  isInitialError = false,\n  isTailError = false,\n  errorStatus,\n  errorRequestId,\n  onRetry,\n}: {",
        "footer error stage props",
    )
    source = replace_once(
        source,
        "  isError?: boolean;\n  onRetry?: () => void;",
        "  isError?: boolean;\n  isInitialError?: boolean;\n  isTailError?: boolean;\n  errorStatus?: number;\n  errorRequestId?: string;\n  onRetry?: () => void;",
        "footer error stage types",
    )
    source = replace_once(
        source,
        "  if (isError && onRetry) {\n    return (\n      <button\n        type=\"button\"\n        className=\"w-full py-2 text-caption text-destructive hover:underline\"\n        onClick={onRetry}\n      >\n        {t(($) => $.table.load_more_failed_retry)}\n      </button>\n    );\n  }",
        "  if (isError && onRetry) {\n"
        "    const safeRequestId = errorRequestId && /^[A-Za-z0-9_-]{8,32}$/.test(errorRequestId)\n"
        "      ? errorRequestId\n"
        "      : undefined;\n"
        "    const diagnostics = {\n"
        "      \"data-error-kind\": isInitialError ? \"initial\" : isTailError ? \"tail\" : \"unknown\",\n"
        "      \"data-http-status\": Number.isInteger(errorStatus) ? String(errorStatus) : undefined,\n"
        "      \"data-request-id\": safeRequestId,\n"
        "    };\n"
        "    return (\n"
        "      <div\n"
        "        role=\"alert\"\n"
        "        {...diagnostics}\n"
        "        className=\"flex w-full items-center justify-center gap-2 py-2 text-caption text-destructive\"\n"
        "      >\n"
        "        {isInitialError && <span>{t(($) => $.table.load_failed)}</span>}\n"
        "        <button type=\"button\" className=\"hover:underline\" onClick={onRetry}>\n"
        "          {isInitialError\n"
        "            ? t(($) => $.table.load_failed_retry)\n"
        "            : t(($) => $.table.load_more_failed_retry)}\n"
        "        </button>\n"
        "      </div>\n"
        "    );\n"
        "  }",
        "footer first-page vs tail error UI",
    )
    return source


def patch_footer_call(source: str, label: str) -> str:
    pattern = re.compile(r"^(?P<indent>[ \t]*)isError=\{page\.isError\}\n(?P=indent)onRetry=\{page\.retry\}$", re.MULTILINE)
    replacement_count = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal replacement_count
        replacement_count += 1
        indent = match.group("indent")
        return "\n".join((
            f"{indent}isError={{page.isError}}",
            f"{indent}isInitialError={{page.isInitialError}}",
            f"{indent}isTailError={{page.isTailError}}",
            f"{indent}errorStatus={{page.errorStatus}}",
            f"{indent}errorRequestId={{page.errorRequestId}}",
            f"{indent}onRetry={{page.retry}}",
        ))

    patched = pattern.sub(replace, source)
    if replacement_count != 1:
        raise ValueError(f"{label} footer error metadata: expected one upstream marker, found {replacement_count}")
    return patched


def patch_empty_group_error(source: str, label: str) -> str:
    pattern = re.compile(
        r'<button\s+type="button"\s+className="(?P<className>[^"]*text-destructive[^"]*)"\s+'
        r'onClick=\{groupBranches\.retryGroups\}\s*>\s*'
        r'\{t\(\(\$\) => \$\.table\.load_more_failed_retry\)\}\s*</button>'
    )
    count = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal count
        count += 1
        preserved = [
            token for token in match.group("className").split()
            if token not in {"flex", "flex-1", "items-center", "justify-center", "hover:underline"}
        ]
        class_name = " ".join(preserved + ["flex", "flex-col", "items-center", "justify-center", "gap-2"])
        return f'''<div
              role="alert"
              data-error-kind="initial"
              data-http-status={{groupBranches.errorStatus}}
              data-request-id={{groupBranches.errorRequestId}}
              className="{class_name}"
            >
              <span>{{t(($) => $.table.load_failed)}}</span>
              <button type="button" className="hover:underline" onClick={{groupBranches.retryGroups}}>
                {{t(($) => $.table.load_failed_retry)}}
              </button>
            </div>'''

    patched = pattern.sub(replace, source)
    if count != 1:
        raise ValueError(f"{label} empty-group first-page error: expected one upstream marker, found {count}")
    return patched


def verify_and_patch(root: Path, relative: str, patcher) -> None:
    path = root / relative
    original = path.read_bytes()
    actual = hashlib.sha256(original).hexdigest()
    expected = EXPECTED_SHA256[relative]
    if actual != expected:
        raise ValueError(f"{relative}: frozen-source SHA mismatch ({actual})")
    patched = patcher(original.decode("utf-8"))
    path.write_text(patched, encoding="utf-8")


def install_overlay_files(overlays: Path, root: Path, files: dict[str, str]) -> None:
    for overlay_name, target_name in files.items():
        source = overlays / overlay_name
        target = root / target_name
        if not source.is_file():
            raise ValueError(f"required TaskFlow overlay file missing: {overlay_name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)


def patch_backend(root: Path, overlays: Path) -> None:
    verify_and_patch(root, "server/cmd/server/dbstats.go", patch_db_stats)
    verify_and_patch(root, "server/internal/handler/webhook_delivery_worker.go", patch_webhook_worker)
    install_overlay_files(overlays, root, {
        "taskflow_pool_budget.go": "server/cmd/server/taskflow_pool_budget.go",
        "taskflow_pool_budget_test.go": "server/cmd/server/taskflow_pool_budget_test.go",
        "taskflow_webhook_backoff.go": "server/internal/handler/taskflow_webhook_backoff.go",
        "taskflow_webhook_backoff_test.go": "server/internal/handler/taskflow_webhook_backoff_test.go",
    })
    print("TASKFLOW_STABILITY_BACKEND_OVERLAY=PASS; vendor source remains unchanged")


def patch_web(root: Path, overlays: Path) -> None:
    targets = [
        ("packages/core/api/client.ts", patch_api_client),
        ("packages/core/api/index.ts", patch_core_api_exports),
        ("packages/core/issues/queries.ts", patch_core_queries),
        ("packages/views/issues/surface/use-issue-status-branches.ts", patch_status_branches),
        ("packages/views/issues/surface/use-issue-status-branches.test.tsx", patch_status_branches_test),
        ("packages/views/issues/surface/use-issue-group-branches.ts", patch_group_branches),
        ("packages/views/issues/components/list-load-more-footer.tsx", patch_footer),
        ("packages/views/issues/components/board-view.tsx", lambda s: patch_empty_group_error(patch_footer_call(s, "Board"), "Board")),
        ("packages/views/issues/components/list-view.tsx", lambda s: patch_footer_call(s, "List")),
        ("packages/views/issues/components/swimlane-view.tsx", lambda s: patch_empty_group_error(patch_footer_call(s, "Swimlane"), "Swimlane")),
    ]
    for relative, patcher in targets:
        verify_and_patch(root, relative, patcher)
    install_overlay_files(overlays, root, {
        "taskflow-row-query.test.ts": "packages/core/issues/taskflow-row-query.test.ts",
        "taskflow-list-load-more-footer.test.tsx": "packages/views/issues/components/taskflow-list-load-more-footer.test.tsx",
        "taskflow-pagination-recovery.test.tsx": "packages/views/issues/surface/taskflow-pagination-recovery.test.tsx",
    })
    print("TASKFLOW_STABILITY_WEB_OVERLAY=PASS; vendor source remains unchanged")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=("backend", "web"), required=True)
    parser.add_argument("--root", type=Path, default=Path("/src"))
    parser.add_argument("--overlays", type=Path, default=Path("/taskflow-stability-overlays"))
    args = parser.parse_args()
    try:
        if args.target == "backend":
            patch_backend(args.root, args.overlays)
        else:
            patch_web(args.root, args.overlays)
    except (OSError, UnicodeError, ValueError, KeyError) as exc:
        raise SystemExit(f"TASKFLOW_STABILITY_OVERLAY=FAIL {exc}") from exc


if __name__ == "__main__":
    main()
