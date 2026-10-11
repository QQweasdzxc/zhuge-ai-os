import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, ApiNetworkError } from "../api/client";
import { setApiInstance } from "../api";
import {
  issueTableRowPageOptions,
  issueTableRowsErrorDiagnostic,
  shouldRetryIssueTableRows,
} from "./queries";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("TaskFlow paginated issue row reliability contract", () => {
  it("forwards query cancellation and keeps Project A/B row query keys isolated", async () => {
    const listIssueTableRows = vi.fn().mockResolvedValue({ rows: [], next_cursor: null });
    setApiInstance({ listIssueTableRows } as unknown as ApiClient);
    const requestForProject = (projectId: string) => ({
      query: {
        scope: { kind: "project", project_id: projectId },
        filters: {},
        sort: { field: "position", direction: "asc" },
      },
      group: { kind: "none" } as never,
      group_key: null,
      hierarchy: { enabled: false },
      parent_id: null,
      page: { cursor: null },
    }) as never;
    const request = requestForProject("project-a");
    const first = issueTableRowPageOptions("workspace-a", request);
    const second = issueTableRowPageOptions("workspace-a", requestForProject("project-b"));
    const controller = new AbortController();

    await (first.queryFn as (context: unknown) => Promise<unknown>)({ signal: controller.signal });

    expect(listIssueTableRows).toHaveBeenCalledWith(request, { signal: controller.signal });
    expect(first.queryKey).not.toEqual(second.queryKey);
  });

  it("classifies only network, 429, and 5xx errors as bounded retries", () => {
    expect(shouldRetryIssueTableRows(0, new ApiNetworkError("ab12CD34", new TypeError("offline")))).toBe(true);
    expect(shouldRetryIssueTableRows(0, new ApiError("busy", 429, "Too Many Requests"))).toBe(true);
    expect(shouldRetryIssueTableRows(1, new ApiError("server", 503, "Service Unavailable"))).toBe(true);
    expect(shouldRetryIssueTableRows(2, new ApiError("server", 503, "Service Unavailable"))).toBe(false);
    expect(shouldRetryIssueTableRows(0, new ApiError("missing", 404, "Not Found"))).toBe(false);
    expect(shouldRetryIssueTableRows(0, new ApiError("denied", 403, "Forbidden"))).toBe(false);
    expect(shouldRetryIssueTableRows(0, new TypeError("not tagged as a transport failure"))).toBe(false);
    expect(shouldRetryIssueTableRows(0, new DOMException("cancelled", "AbortError"))).toBe(false);
  });

  it("does not expose response bodies or unsafe request identifiers in diagnostics", () => {
    expect(issueTableRowsErrorDiagnostic(new ApiError("failure", 503, "Unavailable", { token: "secret" }, "a1b2C3d4")))
      .toEqual({ status: 503, requestId: "a1b2C3d4" });
    expect(issueTableRowsErrorDiagnostic(new ApiError("failure", 503, "Unavailable", {}, "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature")))
      .toEqual({ status: 503, requestId: undefined });
    expect(issueTableRowsErrorDiagnostic(new Error("opaque"))).toEqual({});
  });

  it("tags fetch transport failures but leaves aborts and HTTP errors distinct", async () => {
    const client = new ApiClient("https://api.example.test");
    const request = {} as never;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(client.listIssueTableRows(request)).rejects.toBeInstanceOf(ApiNetworkError);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError")));
    await expect(client.listIssueTableRows(request)).rejects.toMatchObject({ name: "AbortError" });
    await expect(client.listIssueTableRows(request)).rejects.not.toBeInstanceOf(ApiNetworkError);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "missing" }), { status: 404 })));
    await expect(client.listIssueTableRows(request)).rejects.toBeInstanceOf(ApiError);
  });

  it("captures only a safe X-Request-ID response header for row diagnostics", async () => {
    const client = new ApiClient("https://api.example.test");
    const request = {} as never;
    const sentHeaders: Array<Record<string, string>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentHeaders.push(init?.headers as Record<string, string>);
      return new Response(JSON.stringify({ error: "unavailable" }), {
        status: 503,
        headers: { "X-Request-ID": "server_1234" },
      });
    }));

    await expect(client.listIssueTableRows(request)).rejects.toMatchObject({
      requestId: "server_1234",
    });
    expect(sentHeaders[0]?.["X-Request-ID"]).toMatch(/^[A-Za-z0-9_-]{8,32}$/);

    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentHeaders.push(init?.headers as Record<string, string>);
      return new Response(JSON.stringify({ error: "unavailable" }), {
        status: 503,
        headers: { "X-Request-ID": "eyJhbGciOiJIUzI1NiJ9.signature" },
      });
    }));
    await expect(client.listIssueTableRows(request)).rejects.toMatchObject({
      requestId: sentHeaders[1]?.["X-Request-ID"],
    });
  });
});
