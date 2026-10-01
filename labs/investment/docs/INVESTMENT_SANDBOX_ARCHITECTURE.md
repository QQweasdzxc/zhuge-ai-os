# Investment Sandbox v1 — Architecture and Authority Boundaries

```text
AIOS → Lab 實驗室 → labs/investment/ (same-origin static)
                             │
                  browser-safe Provider adapters
                             │
             ┌───────────────┴────────────────┐
             ▼                                ▼
   CORS-allowed official endpoints      SERVER_PROXY_REQUIRED
   (e.g. TWSE web / TDCC)                (no proxy is created here)
```

## Authority

- **Lab registry:** `labs/registry.json` owns the single same-origin entry under `labs/`.
- **Runtime:** static HTML/CSS/ES modules only. There is no `server.mjs`, runtime API route, `.app`, or local server dependency in this Candidate.
- **Provider adapters:** official source adapters remain under `src/providers/`; `browser-taiwan.mjs` reads the TWSE public CSV where browser CORS allows it. Sources blocked by CORS are explicitly marked `SERVER_PROXY_REQUIRED` and are not called through a proxy.
- **Evidence:** `src/lib/contract.mjs` defines status/data-truth metadata; `normalize.mjs` refuses to coerce absent markers to zero; `http-cache.mjs` coalesces requests, bounds timeout, caches by exact source URL, and marks same-source stale fallback.
- **Analysis:** `src/domain/indicators.mjs` computes deterministic indicators solely from the history supplied by the same stock provider. Short history remains partial/not connected; there is no AI score or recommendation.
- **User-only state:** watchlist and notes are localStorage in the browser profile. They do not write AIOS, Supabase, or another cloud database.

## Request/read boundary

- Only the three allowlisted symbols are accepted by symbol endpoints.
- No credential, third-party key, account ID, or secret is read or returned.
- Provider calls are browser GETs only; there is no write adapter.
- Evidence contains sanitized status/error categories and normalized fields, not raw provider response payloads.
- World Bank XLSX is bounded to 16 MiB, parsed in memory, and not saved as a downloaded artifact.
- No CORS proxy or arbitrary-origin policy is introduced. Browser access follows each provider's own CORS response.

## Production separation

No Lab module is imported by the formal AIOS Investment surface. The Lab Center reads one registry entry and links to the same-origin `/labs/investment/` path. Genspark stays an external feature reference; no Genspark code/assets are imported. Existing Zhuge Investment Intelligence is reference context only; this Lab does not create or migrate a second production Holdings/P&L model.

## Runtime limitation

Static browser validation is performed from a temporary file-only preview and does not add a server to the shipped Lab. A CORS-allowed endpoint in that preview is not a Production deployment claim; the exact current provider reachability is recorded in `LAB_INVESTMENT_RUNTIME_EVIDENCE.md`.
