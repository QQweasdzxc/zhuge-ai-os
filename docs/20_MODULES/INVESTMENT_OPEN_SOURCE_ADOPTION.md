# Investment Open Source Adoption — daily_stock_analysis

Status: IMPLEMENTATION FOUNDATION
Source: ZhuLinsen/daily_stock_analysis (MIT License)

## Product boundary

Zhuge AI OS keeps its own Investment UI, Portfolio/Transaction canonical data, Global Floating Hub, authentication, authorization and deployment model. The external project is a technical learning/material source only.

## Adopt / adapt

- Provider adapter + fallback pattern for market/news/fundamental/FX/social evidence.
- Evidence normalization, source/as-of/quality/limitations metadata and deduplication.
- Context Pack pattern before AI synthesis.
- Strategy Skill pattern; Zhuge keeps a portfolio-aware strategy library and can add custom strategies later.
- Market phase / data quality concepts.
- Scheduling patterns as reference; Zhuge cadence remains user-defined.

## Do not migrate

- External Web UI.
- External holdings/portfolio database.
- External deployment topology.
- External notification UI; Zhuge uses Global Floating Hub.

## Phase plan

1. Intelligence foundation: provider-neutral contracts, fallback, Evidence/Context Pack, Strategy Library.
2. Provider activation: TW/US quote + news/search + FX, after provider choice and credential/licensing review.
3. Research synthesis: ETF/component/industry/event evidence and portfolio-aware plain-language analysis.
4. Scheduling/alerts: user-defined research cadence and Global Floating Hub delivery.

## Attribution

Strategy names and architecture ideas were studied from ZhuLinsen/daily_stock_analysis under MIT. If source code is copied or substantially adapted later, preserve the upstream copyright/permission notice in THIRD_PARTY_NOTICES.
