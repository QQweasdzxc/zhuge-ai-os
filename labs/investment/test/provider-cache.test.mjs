import test from "node:test";
import assert from "node:assert/strict";
import { clearProviderCache, fetchCached, ProviderError } from "../src/lib/http-cache.mjs";

test("provider reads coalesce, cache, and preserve retrieval time", async () => {
  clearProviderCache();
  let calls = 0;
  const fetchImpl = async () => { calls += 1; await new Promise((resolve) => setTimeout(resolve, 8)); return Response.json([{ value: 7 }]); };
  const url = "https://example.invalid/test-only-coalesce";
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => fetchCached(url, { fetchImpl, ttlMs: 1_000 })));
  assert.equal(calls, 1);
  assert.deepEqual(a.value, [{ value: 7 }]);
  assert.equal(typeof b.fetchedAt, "string");
  assert.equal(c.cacheHit, false);
  assert.equal((await fetchCached(url, { fetchImpl, ttlMs: 1_000 })).cacheHit, true);
  clearProviderCache();
});

test("provider errors fail closed and same-source stale value is marked fallback", async () => {
  clearProviderCache();
  let fail = false;
  const fetchImpl = async () => fail ? new Response("down", { status: 503 }) : Response.json({ close: 100 });
  const url = "https://example.invalid/test-only-stale";
  const first = await fetchCached(url, { fetchImpl, ttlMs: 0, failureCooldownMs: 0 });
  fail = true;
  const next = await fetchCached(url, { fetchImpl, ttlMs: 0, failureCooldownMs: 0 });
  assert.equal(next.fallback, true);
  assert.equal(next.errorCode, "HTTP_503");
  assert.deepEqual(next.value, { close: 100 });
  clearProviderCache();
});

test("invalid JSON and HTTP errors retain sanitized categories", async () => {
  clearProviderCache();
  await assert.rejects(fetchCached("https://example.invalid/malformed-test", { fetchImpl: async () => new Response("<html>no</html>") }), (error) => error instanceof ProviderError && error.code === "INVALID_JSON");
  await assert.rejects(fetchCached("https://example.invalid/http-test", { fetchImpl: async () => new Response("not available", { status: 429 }) }), (error) => error.code === "HTTP_429");
  clearProviderCache();
});
