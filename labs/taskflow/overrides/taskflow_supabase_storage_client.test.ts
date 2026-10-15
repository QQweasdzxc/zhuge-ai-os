/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "@multica/core/api/client";
import { MAX_FILE_SIZE } from "@multica/core/constants/upload";

afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

describe("TaskFlow private Supabase attachment bridge", () => {
  it("uses the verified Zhuge storage token only on attachment requests", async () => {
    window.sessionStorage.setItem("zhuge_storage_access_token", "supabase.user.jwt");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ id: "att-1" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient("https://api.example.test");
    client.setToken("taskflow.api.jwt");

    await client.getAttachment("att-1");
    await client.getMe();

    const attachmentHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const ordinaryHeaders = fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>;
    expect(attachmentHeaders.Authorization).toBe("Bearer taskflow.api.jwt");
    expect(attachmentHeaders["X-Zhuge-Storage-Token"]).toBe("supabase.user.jwt");
    expect(ordinaryHeaders["X-Zhuge-Storage-Token"]).toBeUndefined();
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain("supabase.user.jwt");
  });

  it("accepts 13.5 MiB files while respecting the Supabase Free 50 MB cap", () => {
    expect(MAX_FILE_SIZE).toBe(50_000_000);
    expect((13 * 1024 * 1024) + (512 * 1024)).toBeLessThan(MAX_FILE_SIZE);
  });

  it("clears the Storage credential on TaskFlow logout", async () => {
    window.sessionStorage.setItem("zhuge_storage_access_token", "supabase.user.jwt");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const client = new ApiClient("https://api.example.test");
    await client.logout();
    expect(window.sessionStorage.getItem("zhuge_storage_access_token")).toBeNull();
  });
});
