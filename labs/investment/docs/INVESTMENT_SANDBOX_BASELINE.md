# Zhuge Investment Sandbox v1 — Baseline

## Purpose and boundary

This is a Zhuge-owned, same-origin static research Lab. It is not a copy, fork, or source-derived redistribution of Genspark Stock AI, and it does not replace or modify AIOS Investment. Genspark is a feature-reference input only; no Genspark source or asset is present in this Lab.

- Genspark reference commit: `35182db578b0b8c693d34f52f3988534d4c52f83`
- Reference role: behavioral/feature inspiration only; no upstream source/assets imported.
- Original Sandbox branch: `lab/investment-sandbox-v1`
- Candidate runtime: static files under `labs/investment/`; no app launcher, standalone API server, localhost URL, or user Terminal step.
- Browser provider access: direct official endpoints only where CORS permits. CORS-blocked sources stay `SERVER_PROXY_REQUIRED` / `NOT_CONNECTED`; no Product Data or substitute values are written.
- No Cloud write, Product Data write, transaction, order, or production integration.
- AIOS Lab Center reads the single `labs/registry.json` authority. Formal Investment code remains unchanged; Lab source is not imported by formal modules.

## Implemented v1 surfaces

1. Research overview with official closing prices, compact price histories, available monthly revenue evidence, Taiwan market pulse, and reviewed commodity references.
2. Per-symbol research for `2330.TW`, `0050.TW`, and `6488.TWO`.
3. Opening-pressure evidence page; unavailable overseas factors remain explicit, not inferred.
4. Taiwan market pulse: index, advancing/declining/flat counts, and listed-market institutional totals where the official feeds return usable fields.
5. Technical indicators calculated from the same-source official daily OHLCV actually loaded by the page.
6. Industry price radar: World Bank Pink Sheet monthly Brent/WTI/Copper only; DRAM/NAND, SOX, and SCFI remain source-review gated.
7. Watchlist and research notes stored only in the current browser's localStorage.

## Exclusions

No AI buy/sell score, no external score as truth, no media-news feed, no AAPL runtime provider, no ETF constituents/NAV, no TPEx historical OHLCV, no account link, no trade capability, and no false completion for missing data. UI availability is not proof that a provider is connected.

## Reference and data truth

Provider evidence carries status, provider, source URL, source data date, retrieval time, stale/delayed/fallback flags, attribution/license when applicable, note, and sanitized error code. All prices here are delayed/latest available source observations, not real-time execution quotes.

## Use

Open AIOS → **Lab 實驗室** → **Lab_投資** → **進入 Lab**. The browser loads the Lab from the same AIOS origin. No separate app, server, localhost URL, or terminal action is part of the user flow. Provider availability is independent and shown with source evidence.

## Review gate

Developer QA is complete only for the source/runtime checks enumerated in `LAB_INVESTMENT_RUNTIME_EVIDENCE.md` and `QA_SUMMARY.md`. Local candidate browser checks do not imply production deployment or PM acceptance.
