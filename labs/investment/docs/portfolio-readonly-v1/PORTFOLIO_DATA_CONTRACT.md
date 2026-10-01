# Portfolio Read Contract

## Authority

`Zhuge Investment Portfolio` remains the sole canonical holdings source. The Lab may display a browser-memory snapshot for the current view only; it must not persist a second editable portfolio.

## Authorization sequence

Before the first portfolio data read:

1. `context.session.getSnapshot().isAuthenticated === true`
2. `ZhugeAppAccess.getCurrent()` succeeds and `ZhugeAppAccessGate.isApproved(access)` is true
3. Existing creator and Investment security/MFA policy load successfully
4. `context.security.evaluate("view").allowed === true`
5. Authenticated user ID resolves; otherwise stop with a sanitized status code

No access failure falls back to public, demo, cached, or fixture holdings.

## Read contract

Primary SELECT sequence:

1. `app_users`: owner-ID mapping by `auth_user_id`
2. `portfolios`: owner-scoped default/recent portfolio selection
3. `investment_current_positions_view`: owner- and portfolio-scoped current positions

Compatibility fallback, only if the primary view returns zero rows:

1. `broker_position_snapshots`: latest `pm_confirmed` header for that owner and portfolio
2. `current_broker_positions_view`: rows for the confirmed snapshot
3. Exact item count must equal the snapshot header count. Mismatch returns `SNAPSHOT_INCOMPLETE`; no partial or guessed list is shown.

Only allowlisted display fields are selected: symbol, name, market, asset type, quantity, average/invested cost, last price, market value, unrealized P/L and percentage, currency, effective timestamp, valuation-source label, and current-position status. Internal account identifiers, raw broker payloads, and unrelated portfolio data are excluded.

The Shared ModuleContext read boundary is used with authenticated database access. The canonical position view is security-invoker and relies on the database’s authenticated RLS grants/policies; the Lab adds explicit owner/portfolio filters and never elevates role. See [Supabase Row Level Security](https://supabase.com/docs/guides/database/row-level-security) and [Supabase Views](https://supabase.com/docs/guides/database/views).

## Normalized card shape

| Field | Meaning | Missing/malformed value |
|---|---|---|
| `symbol`, `name` | Canonical instrument identity | No fabricated instrument; incomplete row is partial |
| `market` | `TW`, `US`, or unknown | `市場未提供` |
| `quantity` | Canonical current units | `—`; never zero-filled |
| `averageCost`, `investedCost` | Canonical costs | `—` |
| `lastPrice`, `marketValue` | Formal portfolio valuation fields | `—`; explicitly not live quote |
| `unrealizedPnl`, `unrealizedPct` | Formal portfolio unrealized values | `—` |
| `asOf` | Effective/snapshot timestamp | `尚無資料時間` |
| `portfolioSource` | `Zhuge Investment Portfolio` | Fixed authority label |
| `marketValueSource` | Sanitized source label | `來源未提供` |
| `status` | `AVAILABLE` / `PARTIAL` | Missing required fields remain visible as dashes |

Research-provider evidence is separate from portfolio evidence. Supported Taiwan symbols continue through the Lab’s existing provider pipeline; symbols without a verified provider (including US symbols in this version) report `NOT_CONNECTED`, null data, and no invented quote.

## Prohibited capability

This adapter has no portfolio create/update/delete/import/transaction path, no broker operation, and no direct SQL. Local watchlist/notes are existing Lab-only preferences and are not portfolio state.
