# Lab_投資 Runtime Evidence

> This file records local evidence for the `.9.27` release preparation. It is
> not a Production Runtime acceptance report. The Lab remains distinct from
> Official Investment.

## Current release preparation — 2026-10-08

- Local HEAD: `256ee4c4d086edbab6ab25da194394b1e3b197f6`; source is not committed.
- Product identity: `0.9.0-alpha.9.27` / `20261008-1337`.
- Lab/provider/adapter targeted tests: `204 PASS / 0 FAIL / 0 SKIP`.
- Release governance/consistency tests: `51 PASS / 0 FAIL / 0 SKIP`.
- Local anonymous Chromium journey: `16 PASS / 0 FAIL`; no page or console errors.
- Browser Regression: `PASS`, `0 FAIL / 0 SKIP` (19 browser suites and 5 standalone checks).
- Full Regression: `935 PASS / 0 FAIL / 0 SKIP`.
- `git diff --check`: PASS.
- Initial TDCC history asset: PENDING first main push. The new path-scoped push trigger bootstraps the canonical publisher, which uploads a separate GitHub Release asset without committing application Source.
- Investment Intelligence Edge deployment: NOT DEPLOYED.
- Production runtime: NOT DEPLOYED / NOT VERIFIED.

The local browser journey is anonymous and verifies fail-closed personal-data
gates, navigation, layouts, public-source unavailable handling, and that the
Lab does not invent protected personal data. Explicit fixtures remain marked as
QA-only and are not claimed as live market values. Local browser screenshots
are stored under `/tmp/zhuge-lab-investment-browser-evidence/`.

The `.9.27` release's first push bootstraps TDCC publication. The artifact must
carry the official source date, fetch/publish time, schema, and non-empty
observations where supported; no such publication or readback has yet been
claimed.

## Scope and environment

- Candidate Build: `20261001-1801`
- Browser: Google Chrome headless, local installed binary.
- Viewports: Desktop `1440×900`; Mobile `375×812` with touch enabled.
- Runtime under test: static AIOS/Lab files. The QA harness used a temporary ephemeral static-file preview listener; it provided no application API and is not required by the user-facing runtime.
- Cloud / authenticated Production runtime: not tested; no deploy was authorized.

## Navigation and surface evidence

The browser opened the Lab Center at same-origin `/labs/`, observed the registry-driven `Lab_投資` entry, clicked `進入 Lab`, and reached `/labs/investment/` without opening a new window or launching a separate service. Desktop document width remained `1440px`. Mobile document width remained `375px`; measured mobile navigation controls were at least `44px` high.

Browser routes exercised:

- Research overview
- `2330.TW` TSMC
- `0050.TW` Taiwan 50 ETF
- `6488.TWO` GlobalWafers
- Opening pressure
- Taiwan market pulse
- Industry price radar

Screenshots are in the Candidate `screenshots/` directory: Lab Center and Investment overview at `1440px`, all three research symbols at `1440px`, plus overview and 2330 research at `375px`.

## Provider truth observed in this static-browser runtime

| Source / capability | Observed state | Evidence and UI handling |
|---|---|---|
| TWSE `STOCK_DAY_ALL?response=open_data` quote CSV | `OFFICIAL` / `DELAYED`, browser-readable in this run | Actual response was parsed for listed equities/ETF; quote date and source are retained. The tested overview rendered 2330 and 0050 values with source/date, not mock data. |
| TPEx OpenAPI, including 6488 quote | `NOT_CONNECTED` / `SERVER_PROXY_REQUIRED` | Browser CORS blocked `www.tpex.org.tw/openapi/`; 6488 shows that a controlled Zhuge proxy is required. No Yahoo or other quote fallback was substituted. |
| TPEx historical OHLCV source | `SOURCE_IMPLEMENTED_NOT_PRODUCTION_VERIFIED` | Current local Edge source uses the fixed official `www/zh-tw/afterTrading/tradingStock` monthly route; unit/parser tests cover dated bars and lot-to-share normalization. This static-browser evidence predates that server-side route and does not prove Production availability. |
| TWSE OpenAPI endpoints | `NOT_CONNECTED` / `SERVER_PROXY_REQUIRED` | Browser CORS blocked `openapi.twse.com.tw`; affected fundamentals/market evidence remain unavailable rather than filled. |
| TAIFEX OpenAPI | `NOT_CONNECTED` / `SERVER_PROXY_REQUIRED` | Browser CORS blocked `openapi.taifex.com.tw`; no fabricated futures context. |
| World Bank Pink Sheet XLSX | `NOT_CONNECTED` / `SERVER_PROXY_REQUIRED` | Cross-origin browser read was blocked for `thedocs.worldbank.org`; no cached/mock commodity values were presented as current. |
| MOPS OpenAPI | `NOT_CONNECTED` in this browser path | Observed cross-origin access failure; company notices remain unavailable through this static path. |
| TDCC `opendata/1-5` | Browser-readable during source preflight | Source boundary is retained; symbol-specific result availability still depends on response/date and is not generalized from the single accessibility check. |
| Yahoo Finance / FinMind | Not used | No credentials, keys, or substitute feeds were used. |
| Local JSON / simulation | Not used for runtime values | Fixtures exist only in tests and are not wired into the browser runtime. |

The final Lab browser E2E reported `9 PASS / 0 FAIL`, `0` uncaught page errors, and `0` unexpected console errors. It recorded 56 provider CORS/network failures across the exercised pages; these are provider-boundary evidence, not product JavaScript failures, and corresponding evidence remains unavailable/server-proxy-required.

## State and safety checks

- No Demo/VIP/License-key/expiry gate appeared in the exercised UI.
- No `.app`, localhost, or separate service link was present in Lab Center or Lab UI.
- No fake/mock values were used to turn a provider gap green.
- No provider credential, account, secret, token, or raw credential material was read or emitted.
- No Cloud, Product Data, formal Investment, or Production mutation occurred.
- Browser QA does not establish authenticated Production Runtime PASS.
