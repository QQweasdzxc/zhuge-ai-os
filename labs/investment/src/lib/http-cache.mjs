const cache = new Map();
const inFlight = new Map();
const failureUntil = new Map();

export class ProviderError extends Error {
  constructor(code, status = null) {
    super(code);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
  }
}

function classify(error) {
  if (error instanceof ProviderError) return error.code;
  if (error?.name === "TimeoutError" || error?.name === "AbortError") return "TIMEOUT";
  return "NETWORK_ERROR";
}

async function request(url, kind, timeoutMs, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: kind === "json"
        ? { accept: "application/json" }
        : kind === "text"
          ? { accept: "text/csv, text/plain;q=0.9" }
          : { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream" },
    });
  } catch (error) {
    throw new ProviderError(classify(error));
  }
  if (!response.ok) throw new ProviderError(`HTTP_${response.status}`, response.status);
  const fetchedAt = new Date().toISOString();
  if (kind === "bytes") {
    const length = Number(response.headers.get("content-length") ?? 0);
    if (length > 16 * 1024 * 1024) throw new ProviderError("WORKBOOK_TOO_LARGE");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 16 * 1024 * 1024) throw new ProviderError("WORKBOOK_TOO_LARGE");
    return { value: bytes, fetchedAt };
  }

  const text = await response.text();
  if (text.length > 24 * 1024 * 1024) throw new ProviderError("INVALID_RESPONSE");
  if (kind === "text") return { value: text, fetchedAt };
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ProviderError("INVALID_JSON");
  }
  if (value == null || (typeof value !== "object" && !Array.isArray(value))) {
    throw new ProviderError("INVALID_RESPONSE");
  }
  return { value, fetchedAt };
}

export async function fetchCached(url, {
  kind = "json",
  ttlMs = 30_000,
  timeoutMs = 12_000,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  failureCooldownMs = 30_000,
} = {}) {
  const key = `${kind}:${url}`;
  const saved = cache.get(key);
  if (saved && saved.expiresAt > now) return { ...saved, cacheHit: true, fallback: false };
  if (inFlight.has(key)) return inFlight.get(key);
  if ((failureUntil.get(key) ?? 0) > now) {
    if (saved) return { ...saved, cacheHit: true, fallback: true, errorCode: "NETWORK_ERROR" };
    throw new ProviderError("NETWORK_ERROR");
  }

  const promise = request(url, kind, timeoutMs, fetchImpl)
    .then(({ value, fetchedAt }) => {
      const result = { value, fetchedAt, expiresAt: Date.now() + ttlMs };
      cache.set(key, result);
      failureUntil.delete(key);
      return { ...result, cacheHit: false, fallback: false };
    })
    .catch((error) => {
      failureUntil.set(key, Date.now() + failureCooldownMs);
      if (saved) return { ...saved, cacheHit: true, fallback: true, errorCode: classify(error) };
      throw error instanceof ProviderError ? error : new ProviderError(classify(error));
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export function clearProviderCache() {
  cache.clear();
  failureUntil.clear();
}

export function providerCacheSize() {
  return cache.size;
}
