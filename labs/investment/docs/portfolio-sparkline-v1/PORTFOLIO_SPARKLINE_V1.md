# Lab_投資｜我的持股卡 Mini Sparkline v1

## Scope

- Build: `20261002-0015` (Lab candidate identity)
- Base: local `main` HEAD `014d3f8ca8e644e4bf4cf6048fed66c9af8ddf3d`
- Only `labs/investment/` application source and Lab-specific tests changed.
- `modules/investment/`, formal Portfolio data, Cloud, GitHub remote, and Production were not changed.

## Behavior

- Holding cards render up to the latest 20 valid close observations from the existing Lab history contract.
- The latest point and a dashed average-cost reference are shown. The reference is rendered only when the authenticated, canonical Portfolio projection supplies a finite `averageCost`; there is no estimated or zero-filled cost.
- Existing official-Taiwan history data already loaded for the Research cards is reused. Missing supported-symbol histories use the same history loader and provider cache; repeated aliases/symbols are de-duplicated and concurrent reads are bounded to four.
- Unsupported history providers remain `NOT_CONNECTED`; a failed provider remains unavailable. Neither condition creates a chart from placeholder data.
- Provider, data date, delayed/stale state, and same-provider fallback status remain visible below the chart.
- Currency labels explicitly distinguish NT$ and US$ instead of relying on browser locale symbols.
- Positive values use Taiwan-market red, negative values green, and flat values neutral; the card surface remains neutral.
- Holdings remain read-only. The Lab portfolio adapter and canonical SELECT boundary are unchanged; no insert/update/delete path was introduced.

## Current Runtime Boundary

The browser proof was run without an authenticated Zhuge session. The existing session gate returned `SESSION_REQUIRED` before any Portfolio REST read (0 observed Portfolio read requests). Therefore the new renderer and data reuse are tested, but real authenticated holding values have not been observed in this QA run. Screenshots named `my-holdings-*`, `0050-card-*`, `average-cost-reference-card-*`, and `no-history-card-*` are explicitly watermarked synthetic visual fixtures, not actual PM holdings or market evidence.

## Evidence

- Desktop/mobile browser run and screenshot index: [RUNTIME_EVIDENCE.md](./RUNTIME_EVIDENCE.md)
- QA totals and remaining gate: [QA_SUMMARY.md](./QA_SUMMARY.md)
