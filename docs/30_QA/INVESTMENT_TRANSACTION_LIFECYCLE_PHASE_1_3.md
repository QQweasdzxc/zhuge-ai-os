# Investment Domain Feature — Phase 1–3 Implementation Evidence

## Scope

Implemented only the three approved Investment features:

1. `💰 交易紀錄`
2. `📈 我的持有損益` / current unrealized P&L presentation
3. `📚 投資紀錄` for positions whose calculated quantity reaches zero after having been held

Module C, Shared Runtime, other Consumers, and the Investment `今日漲跌` feature were not changed.

## Canonical data contract

- Existing `public.opening_positions` remain the Opening Baseline.
- Existing pre-activation `public.transactions` are retained and are not added again to the Opening Baseline.
- New buy/sell records append to `public.transactions` through `public.investment_record_transaction(...)` only.
- `public.investment_calculated_positions()` is the single calculation authority.
- `public.investment_current_positions_view` exposes that result to the Investment runtime and projection.
- Cost method: moving weighted average; buy cost includes fee/tax; sell realized P&L uses net proceeds minus the average cost of sold quantity.
- `quantity > 0` is `current`; zero quantity after holding is `history`; never-held watchlist data remains separate.

## Activation boundary

Migration `investment_transaction_lifecycle_v1` records one immutable activation row in `private.investment_transaction_lifecycle_contract`:

`investment-transaction-lifecycle-v1`

Calculation method:

`opening_baseline_plus_post_activation_transactions_moving_weighted_average_v1`

The live activation boundary was `2026-09-15T14:20:28.49077+00:00`. The three existing transactions were created at `2026-06-30T05:17:09.789313+00:00`, before activation, and remain excluded from the new calculation.

## Additive Cloud changes

- Added `transactions.idempotency_key` and a partial unique owner/portfolio index.
- Revoked direct `public`, `anon`, and `authenticated` table DML on `transactions`; authenticated reads remain owner/RLS scoped.
- Added authenticated/AAL2-controlled `investment_record_transaction`.
- Added the canonical calculation function and enriched current-position view.
- Added the existing IVTK board's domain workspace `ivtk-history` / `投資紀錄` using the existing board instance identity; no hard-coded UUID was inserted.
- Extended Investment projection link kinds for `transaction_position` and `history`.
- Updated the existing Investment projection function to move the same projection card between current and history workspaces; no second C engine was introduced.

No existing Investment card, workspace, opening position, transaction, or other Product Data row was rewritten. No Module C/shared schema or data was changed.

## Live read-back

- Opening positions: `11`
- Current calculated positions: `11`
- Current positions: `11`
- Historical positions: `0`
- Ever-held positions: `11`
- Total calculated quantity: `10261`
- Existing transactions: `3`
- Existing transaction idempotency keys: `0`
- IVTK active history workspace: `1`
- Existing IVTK source links: `11` opening-position links
- Existing baseline quantities/costs/market values remain represented by the same opening-position source IDs.

ACL read-back confirmed:

- `anon`: no transactions select/insert/update/delete and no transaction/calculation RPC execute
- `authenticated`: transactions select only and controlled transaction/calculation RPC execute

## Developer QA

`node --test tests/investment/*.test.js`

- Total: `57`
- Pass: `55`
- Fail: `0`
- Skip: `2` — existing desktop/mobile IVTK browser checks; no Chrome executable was configured.

Syntax checks for changed JavaScript files and `git diff --check` passed.

Live write RPC smoke execution was intentionally not performed against Product Data. The write boundary is covered by contract tests and ACL/schema read-back; no test transaction was inserted.
