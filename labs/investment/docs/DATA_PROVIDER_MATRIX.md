# Data Provider Matrix

> Historical snapshot from 2026-10-01. It predates the current Active Lab and
> provider path; it is not a current Production status report. See
> `GENSPARK_CAPABILITY_MATRIX.md` for current implementation and gates.

> Historical observation from the original Node local runtime on 2026-10-01; not current static-browser availability. For this same-origin static Candidate, use `LAB_INVESTMENT_RUNTIME_EVIDENCE.md`. A server-side observation does not prove browser CORS access.

Observed on 2026-10-01 in local Runtime (`127.0.0.1:4191`). “Available” is specific to the captured request and data date, not a reliability or licensing guarantee. No secret was read. No Yahoo or FinMind fallback was used.

| Capability | Provider / source contract | Runtime observation | Frequency / caveat | Data truth / rights |
|---|---|---|---|---|
| TWSE quote | TWSE OpenAPI `STOCK_DAY_ALL` | 2330 and 0050 AVAILABLE, latest row 2026-09-30 | Daily close, delayed; not intraday | OFFICIAL / DELAYED; exchange dataset terms govern |
| TPEx quote | TPEx OpenAPI `tpex_mainboard_daily_close_quotes` | 6488 AVAILABLE, 2026-10-01; response carried `NETWORK_ERROR`, so evidence must retain same-source fallback/error metadata | Daily close; captured value may be same-source cache fallback | OFFICIAL source, FALLBACK when flagged; never relabeled as fresh |
| TWSE history | TWSE `exchangeReport/STOCK_DAY` by symbol/month, most recent 3 calendar months | 2330 and 0050 each 42 bars, indicator input available | Daily OHLCV; no corporate-action adjustment; not suitable as adjusted-return backtest | OFFICIAL / DELAYED |
| TPEx history | Official TPEx historical OHLCV machine path | Not connected for 6488 | No other source fills the gap | NOT_CONNECTED |
| Issuer profile | TWSE OpenAPI `t187ap03_L`; TPEx OpenAPI `mopsfin_t187ap03_O` | 2330 available; 6488 unavailable; ETF company profile not applicable | Official source schema can change | OFFICIAL when available |
| Monthly revenue | TWSE `t187ap05_L`; TPEx `mopsfin_t187ap05_O` | 2330 / 6488 available; 0050 not applicable | Official monthly disclosure; value unit retained as TWD thousand | OFFICIAL; reporting month retained |
| Income / balance | TWSE `t187ap06_L_ci`, `t187ap07_L_ci`; corresponding TPEx `mopsfin_*` endpoints | 2330 available; 6488 unavailable; 0050 not applicable | Income is year-to-date through quarter; balance is period-end stock | OFFICIAL; no annualization or quarter-flow reinterpretation |
| MOPS material notices | TWSE `t187ap04_L`; TPEx `mopsfin_t187ap04_O` | Partial for tested symbols | Selected company notices only; not general media news | OFFICIAL notices; media news remains NOT_CONNECTED |
| TDCC ownership distribution | TDCC OpenAPI `opendata/1-5` | Available for tested 3 symbols in observed run | Shareholding bands; source date and field meanings retained | OFFICIAL |
| Institutional activity | TWSE `fund/T86`; TPEx `tpex_3insti_daily_trading` | Per-symbol data available in the run; market aggregate from aligned TWSE T86 available 2026-10-01 | T86 values are summed from individual listed securities; ETF inclusion and source schema are explained | OFFICIAL / DELAYED |
| Margin balance | TWSE `MI_MARGN`; TPEx `tpex_mainboard_margin_balance` | Partial or available by symbol; market-wide combined figure NOT_CONNECTED | Unit and venue differ; no cross-venue harmonization claimed | OFFICIAL where returned |
| Futures context | TAIFEX `DailyMarketReportFut` | Night-session/after-hours context AVAILABLE, date 2026-09-30 | Daily report, not a live futures stream or stock signal | OFFICIAL / DELAYED |
| Market index | TWSE `FMTQIK` monthly query | AVAILABLE, date 2026-10-01 | Daily market close stats | OFFICIAL / DELAYED |
| Market breadth | TWSE and TPEx daily quote rows | AVAILABLE, date 2026-10-01 | Counts up/down/flat including ETFs; not market-cap weighted | OFFICIAL / DELAYED |
| Oil / copper radar | World Bank Commodity Price Data (Pink Sheet), monthly XLSX; [download](https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx) | Brent 90.9, WTI 82.7 USD/barrel; Copper 14,326 USD/metric ton; month 2026-08 | Monthly averages, not current-day quotes or individual-stock exposures | Official source; CC BY 4.0 dataset [record](https://datacatalog.worldbank.org/search/dataset/0038238/commodity-prices-history-and-projections); attribution included |
| DRAM / NAND | TrendForce / DRAMeXchange reference only | Not requested; `PROVIDER_REVIEW_REQUIRED` | No scraping or inferred value | Automation/reuse authorization not cleared |
| SOX | Nasdaq index reference only | Not requested; `PROVIDER_REVIEW_REQUIRED` | No substitute ETF/sector proxy | Automation/display rights not cleared |
| SCFI | Shanghai Shipping Exchange reference only | Not requested; `PROVIDER_REVIEW_REQUIRED` | No substitution with another shipping index | Automation/reuse rights not cleared |
| US indices / ADR / FX | No selected provider | Not requested; `PROVIDER_REVIEW_REQUIRED` | No Yahoo or simulated fallback | NOT_CONNECTED pending source/rights review |
| 0050 holdings / constituents / NAV | No selected provider | NOT_CONNECTED | ETF is not treated as the underlying index or its constituents | NOT_CONNECTED |

## Primary official endpoints in code

All provider URL definitions live in `src/providers/official-taiwan.mjs`; endpoint changes are version-controlled and cached by exact source URL. The app surfaces provider and data date and marks official closing data as delayed.
