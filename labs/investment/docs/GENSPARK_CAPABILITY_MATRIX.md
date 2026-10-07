# Genspark Stock AI → Lab_投資 Capability Matrix

## Audit baseline

- Genspark repository: `dvorak0727/Genspark-Stock-AI`
- Inspected immutable source baseline:
  `7f9cfc5de61227faacd27d3baafa82bb41cba6ab`
- Zhuge source baseline at task start:
  `07b6e57d85e2fb34619d88065fda7ad71c8070d4`
- Product identity at task start: `0.9.0-alpha.9.25` / `20261007-2011`
- Upstream inspection covered its README, the 80k+ line single-page `index.html`,
  `license-worker/src/index.js`, repository data files, and all 20 GitHub Actions
  workflow definitions. The exact inspected revision has no standard
  `LICENSE`/`COPYING` file. No upstream source or assets were copied.
- The upstream `main` observed during the audit was not the requested reference
  SHA; all comparisons below use the specified `7f9cfc5...` commit.

## Status meanings

- `PASS`: the stated Zhuge source contract has a targeted automated or local
  browser check. This does not imply Production deployment or authenticated
  Production readback.
- `HUMAN_GATE`: a signed-in Production readback, human authorization, or
  externally provisioned secret/configuration is required before claiming live
  capability.
- `EXTERNAL_PROVIDER_BLOCKED`: a paid provider, provider terms, or a legally
  approved source path is not available for verified Zhuge Production use.

## Current closure count

- Total inventoried capability groups: `32`
- `PASS`: `4`
- `HUMAN_GATE`: `24`
- `EXTERNAL_PROVIDER_BLOCKED`: `4`

These are honest current states, not a 100% migration claim. The `PASS` entries
cover the shared shell, author/license removal, no-trading boundary, and removal
of original-author runtime dependencies. Other groups remain gated by
authenticated Production/provider readback or a provider-rights decision.
Unauthenticated local browser and automated QA results are recorded in
`QA_SUMMARY.md`; they do not promote a gated capability to Production `PASS`.

`TW STATUS` and `US STATUS` describe market-specific source coverage, not a
Production PASS. Gaps are called out in the implementation/evidence columns;
there is no claim that the full target is complete.

| ORIGINAL FEATURE | ORIGINAL DATA SOURCE | ORIGINAL RUNTIME DEPENDENCY | ZHUGE IMPLEMENTATION | ZHUGE DATA AUTHORITY | TW STATUS | US STATUS | RUNTIME STATUS |
|---|---|---|---|---|---|---|---|
| Single-page dashboard and product navigation | Genspark `index.html` plus embedded JS/CSS | GitHub Pages and original page shell | Lab uses AIOS Shared Shell and nine local content views; no upstream sidebar is bundled | AIOS shell + `labs/investment/index.html` | Local navigation present | Local market switch present | PASS |
| Original author identity, license, account, and plan gating | `/verify`, Cloudflare `LICENSE_KV`, license key, user/email, plan/expiry | `license-worker.dvorak0727.workers.dev`, original UUID/account, standard/VIP/premium/admin | Removed from shipped Lab runtime; boundary regression scans the Lab source tree | AIOS Session, App Access, MFA, `auth_user_id` → `app_users.id` mapping | Shared AIOS gate | Shared AIOS gate | PASS |
| Stock symbol/name search | TWSE/TPEx lists, FinMind and page-side symbol maps | Author Worker and static ticker mappings | Search calls bounded catalog contract; exact Taiwan venue is required; US catalog uses SEC company ticker file | Existing Investment Intelligence Edge catalog; TWSE/TPEx catalogs; SEC | Catalog contract present; authenticated live readback pending | SEC identity catalog in source; AAPL/NVDA Production readback pending | HUMAN_GATE |
| Quote and price changes | TWSE market quote, FinMind tick snapshot, Yahoo Chart | Author `/finmind`, `/snapshot`, `/yahoo`; FinMind token for full-market ticks | Existing Zhuge provider and Edge route accept explicit `market + symbol`; unknown market fails closed | TWSE official quote; existing Yahoo compatibility adapter for US | TWSE source path present; live acceptance pending | Yahoo terms/source approval and live acceptance pending | EXTERNAL_PROVIDER_BLOCKED |
| Historical price / OHLCV | FinMind, Yahoo Chart, repository snapshots | Author Worker, FinMind token, scheduled/static data | Existing Zhuge Investment Intelligence exposes history; Lab renders source bars and keeps history keys market-scoped | TWSE daily trading data for supported TWSE history; Yahoo compatibility path for fallback/US | TWSE history path present; TPEx-specific official history coverage incomplete | External quote/history approval pending | EXTERNAL_PROVIDER_BLOCKED |
| Technical analysis: MA, RSI, KD, MACD, Bollinger, volume, trend | Genspark embedded indicator and signal code | Historical OHLCV from Worker/static data | Existing deterministic indicator engine consumes actual supplied OHLCV; insufficient bars stay partial | `labs/investment/src/domain/indicators.mjs` + provider history | Indicator calculations tested; live bars gate remains | Requires approved US history source | HUMAN_GATE |
| Signal matrix / price patterns | Genspark embedded indicator, trend, and candle-pattern logic | Mixed official, FinMind, Yahoo, and cached data | Existing Strategy Scanner and analysis projection are reused; it is not yet a full port of every Genspark pattern matrix | Shared Investment Strategy Scanner + provider evidence | Explainable subset available; complete parity not established | Market-data dependent | HUMAN_GATE |
| Company profile and fundamental data | TWSE/MOPS, FinMind | Author Worker and official endpoint access | Existing provider returns TWSE financial/profile evidence; Lab renders source/period labels | TWSE Open Data, MOPS, existing provider contract | Source path present; full authenticated runtime validation pending | SEC company facts/submissions provider code exists; runtime verification pending | HUMAN_GATE |
| Company news and material events | FinMind Taiwan news, Google/Bing news feeds, page classifiers | Author Worker, news endpoints, optional token | Shared provider/Edge has bounded news evidence; UI shows source and observation time | Existing Investment Intelligence news providers; official announcement route for TW | Announcement path present; provider evidence validation pending | News source/terms and runtime acceptance pending | HUMAN_GATE |
| Three institutional investor flows | FinMind datasets and exchange disclosures | FinMind token / author `/finmind` | Existing Edge contract reads official Taiwan institutional evidence when source returns fields | TWSE/TPEx official institutional disclosures | Official source path present; authenticated runtime readback pending | Taiwan categories do not apply | HUMAN_GATE |
| Institutional 5D/10D streak and cumulative summaries | Genspark derived FinMind/exchange rows | Sufficient daily institutional history | Lab currently renders returned evidence; a shared, date-complete streak projection is not verified | Existing provider evidence; no second ledger | Partial source inputs; projection parity pending | Not applicable | HUMAN_GATE |
| TDCC ownership tiers / large-holder concentration | FinMind `TaiwanStockHoldingSharesPer`, scheduled pyramid history | FinMind token and scheduled archives | Existing Edge has official ownership evidence adapter; full tier history and long-span concentration are not established | TDCC official files where available | Partial official evidence path; history-depth gate remains | Not applicable | HUMAN_GATE |
| Broker/branch flows and branch ranking | FinMind trading-daily-report datasets | FinMind Sponsor token, author proxy, nightly Actions | No approved Zhuge provider is established | No canonical Zhuge broker/branch authority | Paid dataset access unresolved | Not applicable | EXTERNAL_PROVIDER_BLOCKED |
| Margin purchase / short sale | FinMind and Taiwan exchange disclosures | Author Worker; some datasets use token | Existing bounded Taiwan evidence adapter exposes margin contract; live source validation pending | TWSE/TPEx official disclosures via the existing Edge | Source path present; readback pending | Taiwan margin format is not applicable | HUMAN_GATE |
| Wyckoff / accumulation-distribution / chip-cycle classification | Genspark derived price, volume, institutional, and ownership series | Multiple datasets with fallback paths | Zhuge has explainable Strategy Scanner evidence, but equivalent reviewed Wyckoff phase output is not established | Existing Strategy Scanner and provider inputs | Evidence subset only | Not applicable as Taiwan-specific form | HUMAN_GATE |
| Scanner / scoring / ranking / filters | Genspark embedded ranking and score rules | Full/large ticker data, FinMind, page-side calculations | Lab has a full Taiwan daily close scan over TWSE/TPEx quote feeds, source industry filters, price/change/turnover filters, pagination, and a displayed percentile formula; the separate personal-symbol strategy scan remains explainable; no live intraday ranking | Authenticated investment-intelligence-read + TWSE/TPEx daily quote and issuer company catalogs; personal mode uses canonical owner-scoped portfolio/watchlist | Full official daily-close scanner path implemented; authenticated Production response pending | Personal-symbol scan and SEC search exist; no approved full-market US quote batch provider | HUMAN_GATE |
| Card/table result modes and explainable score drilldown | Genspark scanner UI and score breakdown | Ranking result payloads | Lab uses evidence cards and strategy match explanations; no full Genspark ranking parity yet | Shared Strategy Scanner | Partial presentation | Partial presentation | HUMAN_GATE |
| Sector heatmap and sector peers | Static sector mapping, exchange data, FinMind/quotes | Static repository data, Worker, scheduled refresh | Market view derives venue/date-separated, equally weighted industry breadth from official daily quotes joined to company industry metadata; coverage count is exposed and missing classifications are omitted | Authenticated investment-intelligence-read + TWSE/TPEx daily quotes and official company catalogs; no private sector registry | Official industry breadth path implemented; authenticated Production response pending | SEC company industry is available per symbol; US market-wide quote breadth/heatmap has no approved source | HUMAN_GATE |
| Taiwan index and market breadth | TWSE index and listed-market rows | TWSE public endpoints / Worker | Existing Taiwan market overview provider returns index/breadth evidence contract | TWSE/TPEx official market endpoints | Source code and provider tests present; Production readback pending | Not applicable | HUMAN_GATE |
| ETF constituents, NAV and ETF flow | Active ETF FinMind dataset, Yuanta/issuer sources, static records | FinMind token and scheduled Actions | Existing provider has issuer ETF relationship/PCF adapter; unavailable PCF stays missing; full NAV/flow parity is not verified | Issuer source / TWSE relationship provider | Partial, per-issuer source | US ETF data source coverage not verified | HUMAN_GATE |
| Opening-pressure dashboard | TWSE close, US indices, SOX, ADR, Japan/Korea, futures, FX | Worker `/yahoo`, FinMind, static data Actions | Lab contains context-oriented market views; full Genspark opening-pressure factor set is not verified, and no factor is a trade signal | Existing TW/US provider and official TAIFEX sources where available | TW index/futures subset | US/global inputs gated | HUMAN_GATE |
| US lead stocks and Taiwan correlation | Yahoo US symbols, static sector mappings, price history/Pearson calculations | Author `/yahoo`, worker cache, sector mapping | No complete, validated US-lead correlation projection in Lab | Existing provider history; no canonical peer-correlation authority | Relationship links partial | Requires approved US history and relationship coverage | EXTERNAL_PROVIDER_BLOCKED |
| Global indices, macro, FX, commodities | Yahoo indices, FX endpoints, World Bank/static price data and scheduled JSON | Author Worker and GitHub Actions | Lab overview has bounded context slots and attributed World Bank monthly data; source coverage varies by factor | Existing Investment provider, World Bank monthly reference adapter, official source evidence | TW context subset | US/global provider coverage gated | HUMAN_GATE |
| Scheduled after-market/weekly datasets | 20 upstream GitHub Actions and `data/*.json` snapshots | Upstream repo secrets, FinMind token, Genspark Actions | No full Zhuge-owned schedule/data publication equivalent is established in this change set | No second data registry; future feeds must use existing release/provider authorities | Some public official requests are on-demand | Schedule and source credentials unverified | HUMAN_GATE |
| Watchlist identity and persistence | License-key owner record / Genspark `pyramid_watchlist` Worker KV and local page list | Original license account, Worker KV, author identity | Formal watchlist is owner-scoped read-only from `watchlists`; localStorage is visibly `本機暫存觀察` only | `watchlists` + AIOS owner mapping | Adapter contract tests pass; Production identity readback pending | Adapter supports `market=US`; actual user rows pending | HUMAN_GATE |
| Watchlist news notifications | FinMind events, Genspark notification email in license record | Worker, author license email, scheduled/trigger logic, email secret | Lab binds bounded provider news-only reads to exact canonical market/symbol watchlist identity and displays candidate results; delivery is not enabled | `watchlists` + authenticated read-only `investment-intelligence-read`; no email write/delivery authority | Candidate matching source code and tests present; original notice evidence and human relevance review still required | Candidate search path supports US identity; SEC or issuer notice coverage is not a general news source | HUMAN_GATE |
| Current holdings and P/L | Genspark page-side watchlist/position features; separate from Zhuge portfolio | Genspark local/account state | Reuses owner-scoped read-only adapter and canonical projection; no duplicated financial state or write methods | `investment_current_positions_view` current rows, authenticated owner + portfolio | Source tests pass; authenticated Production readback pending | Same projection accepts US market identities if present | HUMAN_GATE |
| Closed-position history and transaction details | Genspark local history/simulation; not Zhuge canonical records | Page/Worker data | Lab reads history rows from canonical view; transaction detail is a market-scoped read-only query | `investment_current_positions_view` history + owner-scoped `transactions` detail | Adapter query tests pass; Production readback pending | Market-scoped query path present | HUMAN_GATE |
| Stock simulation / historical backtest | Separate `stock-sim.html`, Python scripts and static/FinMind inputs | Genspark static files and local browser logic | Existing Zhuge Strategy Backtest contract is present in shared Investment; Lab end-user flow is not yet verified as equivalent | Shared Investment Strategy Backtest contract; no order execution | Source contract exists | Data-source coverage differs by market | HUMAN_GATE |
| AI advice / teaching / premium knowledge panels | Genspark embedded scoring/advice, premium modules | Original plan gate and any model/provider secrets | No upstream plan restriction is carried over; any AI narrative requires an AIOS-approved provider and secret | AIOS access authority; no trading authority | No accepted AI narrative runtime | Same | HUMAN_GATE |
| Trading/order execution | Genspark includes simulated/teaching order recommendations; Zhuge scope prohibits execution | Genspark UI simulation | No broker order path; no trading execution | None | No order path | No order path | PASS |
| Original author admin / Worker / notification identity | `admin*.html`, Cloudflare KV/Worker routes, original account identifiers | Genspark author infrastructure | Not imported or called by the Zhuge runtime | AIOS shared authorities only | Source boundary test passes | Source boundary test passes | PASS |

## Current verification boundary

Local Lab unit/provider tests and the anonymous desktop/mobile browser journey
verify code contracts and fail-closed access. The browser run does not contain a
signed-in Production user and cannot prove real holdings, watchlist, history,
TWSE/TPEx/SEC results, or US quote availability. The changed Edge Function
source has not been deployed or read back in Production. Therefore this matrix
is an implementation/readiness inventory, not a declaration of 100% capability
parity or Production release acceptance.
