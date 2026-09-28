# Investment Intelligence Adoption Matrix — TASK-099 / TASK-100

This is a clean-room adoption decision, not a fork and not a second Investment product. Zhuge keeps its own UI, authentication, canonical positions/transactions/P&L, Evidence contracts, Context Pack, Analysis service, Strategy Library, and deployment boundary.

## Adopt / reject

| Capability pattern | Decision | Zhuge landing point | Boundary |
|---|---|---|---|
| Provider-neutral adapters with fallback | ADOPT | `InvestmentIntelligenceProviders` and read-only Edge adapter | Provider responses must be normalized with source, as-of, freshness, quality, and limitations |
| Quote separated from historical OHLC | ADOPT | market Evidence vs technical Evidence in Context Pack | Latest quote never masquerades as history or indicators |
| Evidence normalization/deduplication | ADOPT | `zhuge-investment-context-pack-v1` | no raw provider payload in UI or Product Data |
| Fundamental facts from official filings | ADOPT | existing Fundamental section in `zhuge-investment-analysis-v1` | SEC/TWSE source and rate limits remain explicit |
| ETF constituent and industry relationships | ADOPT | `relationships` Evidence section | no guessed constituents; insufficient data stays insufficient |
| Strategy catalog / skill composition | ADAPT | `InvestmentStrategyLibrary` + `InvestmentStrategyScanner` | scanner is a read-only readiness projection, not a score engine |
| Homework / research checklist | ADAPT | `InvestmentHomeworkPack` and existing Analysis UI | no automatic task creation or trading recommendation |
| External rankings, proprietary score formulas, portfolio database | REJECT | none | external score is not Canonical Truth and external holdings are never imported |
| External Web UI / deployment topology / notification system | REJECT | none | Zhuge Shared Shell and Global Floating Hub remain authoritative |

## Integration boundary

`Provider → normalized Evidence → Context Pack → Analysis → Scanner/Homework projections → existing Investment surfaces`.

The scanner may report `READY`, `PARTIAL`, `INSUFFICIENT_EVIDENCE`, or `NOT_SELECTED`. It does not select a strategy automatically, invent a price zone, mutate holdings, or write a Strategy Decision Record. The homework pack keeps “發生什麼／對我有什麼影響／接下來觀察什麼” and traceability metadata in the existing Analysis consumer.

## License boundary

The external project is reference material under MIT. Current Zhuge code uses contract ideas and clean-room implementations, not copied UI, holdings code, or deployment code. If any upstream source code is later copied or substantially adapted, preserve the upstream copyright/permission notice in `THIRD_PARTY_NOTICES` before packaging. No new third-party source is introduced by this matrix.

## Acceptance status

- TASK-097: developer-usable scanner path proven by deterministic `2330.TW`, `0050.TW`, and `AAPL.US` vectors.
- TASK-098: developer-usable read-only homework path proven by the same vectors.
- TASK-099/100: adoption decisions, integration boundary, reject boundary, and license boundary are recorded here.
- Live provider activation, production deployment, and human Runtime QA remain explicit gates rather than being represented as Developer PASS.
