# Lab_投資 Data Truth Contract

## Canonical personal data

- Holdings: `investment_current_positions_view`, scoped to the authenticated
  mapped owner, current portfolio, `position_status=current`, and quantity > 0.
- Watchlist: `watchlists`, scoped to the authenticated mapped owner. Browser
  `localStorage` is only `本機暫存觀察` and never substitutes for the formal list.
- Closed positions: `investment_current_positions_view` history rows. Detailed
  transactions are read-only, owner/portfolio scoped, and market-filtered.
- Missing values remain null and render as a dash. No Lab code writes Portfolio,
  Watchlist, transaction, or history rows.

## Market data versus portfolio valuation

`investment_current_positions_view.last_price` is a stored valuation input, not
an assertion of an intraday or real-time quote. Portfolio cards label it as
`持股估值／非即時` and retain `effective_at` and `market_value_source`.
Research quotes and OHLCV histories come from a separate provider result and
retain that provider's observation time and freshness. Research output is never
written back to the Portfolio.

## Evidence fields

Provider evidence should retain:

`status`, `dataTruth`, `provider`, `source[]`, `dataTimestamp`, `publishedAt`,
`fetchedAt`, `stale`, `delayed`, `fallback`, `attribution`, `license`, `note`,
`errorCode`, and normalized `data` or `null`.

These timestamps mean different things: `dataTimestamp` is the source
observation/report time; `fetchedAt` is retrieval time. A source response date
must not be replaced by the browser's current time.

## Status and interpretation

- `AVAILABLE`: the provider returned normalized data for this request.
- `PARTIAL`: some expected fields/rows are absent; absent values remain null.
- `NOT_APPLICABLE`: the field does not apply to this market/instrument.
- `NOT_CONNECTED`: no verified provider response path is available at runtime.
- `PROVIDER_REVIEW_REQUIRED`: the source or its use rights are gated; no value
  is presented.
- `UNAVAILABLE`: a provider could not return usable evidence.

Test-only simulated rows stay under isolated test fixtures and cannot produce a
Production evidence state. Same-source cached data is marked as fallback; a
different source is never silently substituted.

## Market and instrument identity

- Requests require an explicit `TW` or `US` market.
- Taiwan venue-specific reads require `TWSE` or `TPEX` from the official catalog
  or an explicit exchange-qualified symbol. Ambiguous listing identity fails
  closed.
- Same-code TW/US assets are isolated by `market + symbol` in portfolio history
  and transaction detail reads.
- Taiwan-only fields (T86 institutional reports, TDCC ownership, Taiwan margin
  format) return not-applicable for US securities; they are never projected as
  an error or a zero.

## Prices, indicators, and derived values

- Daily official closes and delayed provider prices are not labeled real time.
- Indicators are calculated only from the returned OHLCV bars for the same
  market/symbol. Insufficient history leaves the indicator unavailable.
- Portfolio P/L remains the canonical projection; the Lab does not rebuild a
  second cost-basis ledger.
- Any ranking or signal must disclose its contributing evidence and missing
  inputs. No unexplained score is a source of truth.
- Macro, global indices, commodities, and FX are context, not direct trade
  instructions.

## Provider rights and Production evidence

Public endpoint reachability is not itself permission to republish or cache.
Confirm source terms, attribution, rate limits, and any subscription requirement
before enabling a provider in Production. The current Yahoo compatibility route
and other external sources remain gated pending that review. This document does
not claim that an authenticated Production runtime has been verified.
