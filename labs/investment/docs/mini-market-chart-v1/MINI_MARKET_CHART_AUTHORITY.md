# Mini Market Chart Authority

Build identity: `20261002-0050`  
Scope: `labs/investment/` stock-card history visualizations only.

## Single renderer

`src/components/mini-market-chart.mjs` exports the only card-level chart renderer, `MiniMarketChart`. The research-card and portfolio-card callers select a mode and pass provider evidence; they do not construct separate chart markup.

| Consumer | Mode | History input | Additional input |
|---|---|---|---|
| Catalog-resolved TW/US Research cards | `research` | Existing market-scoped Lab history evidence; repeated symbols reuse provider results | Currency and market identity |
| My Holdings cards | `portfolio` | Existing history map, reusing research trends and deduplicating missing symbols | Read-only `averageCost` and portfolio currency |

`src/portfolio/view.mjs` keeps only a small mode-binding wrapper. The old portfolio area/sparkline renderer was removed.

## Rendering contract

- Uses only the newest 20 valid close rows supplied by the existing history Provider Contract.
- A candlestick is emitted only when every displayed row contains coherent finite OHLC values (`high >= open/close`, `low <= open/close`). The SVG encodes each actual open/high/low/close; no candle is inferred from close-only input.
- If close values exist but the full OHLC set is incomplete, the chart uses a thin, non-filled close line and reports `PARTIAL_HISTORY`. It does not render candles.
- If history is absent or explicitly `NOT_CONNECTED`, the card reports `NOT_CONNECTED` without an SVG. Provider failure reports `UNAVAILABLE`.
- Volume bars are emitted only for rows with an actual finite volume value. Missing volume is omitted, never zero-filled. When no volume is present, the volume area/key is omitted.
- `research` never renders an average-cost overlay, even if one is accidentally passed.
- `portfolio` renders a dashed average-cost overlay and `平均成本 NT$…` / `平均成本 US$…` label only when the read-only portfolio projection supplies a valid average cost. Missing cost produces no line and no estimated replacement.
- Taiwan convention: rise red, fall green, flat neutral. The mini chart adds no broad area fill and no RSI/KD/MACD.
- Provider, data date, delayed state, freshness, fallback state, and error code remain available as sanitized chart metadata.

## Cache and source boundary

Both card types consume the existing `loadHistory` results. The research overview's `trends` are reused for portfolio history; `loadPortfolioHistoryMap` deduplicates missing symbols and uses the existing provider cache. The chart component performs no network I/O and has no write capability.

The chart is presentation only. It does not change portfolio holdings, cost basis, Investment business logic, Cloud/Product Data, or formal Investment modules.
