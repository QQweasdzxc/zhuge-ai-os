# Lab_投資 — Active Product Baseline

> Replaces the historical “Investment Sandbox v1” scope. The former three-symbol
> sandbox restrictions are not the current Product target.

## Product boundary

- Official Investment / IVTK / Board presentation is parked. Its records remain
  canonical and are not modified by the Lab.
- `Lab_投資` is the active Investment product-development surface under the
  AIOS global shell. Its local navigation is content navigation, not a second
  global sidebar.
- The current Genspark reference is inspected at commit
  `7f9cfc5de61227faacd27d3baafa82bb41cba6ab`. Source and assets are not copied;
  no standard upstream license file was present at that revision.
- The intended capability coverage and current gates are recorded in
  `GENSPARK_CAPABILITY_MATRIX.md`.

## Current source authorities

| Data | Authority | Access contract |
|---|---|---|
| Current holdings | `investment_current_positions_view` | Authenticated user + owner + portfolio scoped; current positions with quantity > 0; read-only |
| Watchlist | `watchlists` | Authenticated owner-scoped SELECT; the browser's temporary list is separately labeled `本機暫存觀察` |
| Closed positions | `investment_current_positions_view` | Authenticated owner + portfolio scoped history rows; transactions are read-only detail only |
| Taiwan research | Existing Zhuge Investment Intelligence and bounded official-source adapters | Explicit TW market and, where required, exact TWSE/TPEx listing identity |
| US company identity | SEC company ticker catalog | Market must be explicitly US |
| US quote/history compatibility | Existing Zhuge-owned Edge/provider path | External provider terms and live Production behavior remain a release gate |

Portfolio valuation is not a live quote. The UI labels portfolio values with
`effective_at` and `market_value_source`; research prices retain their provider,
observation time, freshness, and delay semantics. Research data never writes
back into a portfolio position.

## Current Lab entry points

The Lab exposes: 總覽、選股雷達、市場、我的持股、觀察名單、個股研究、籌碼、技術分析、平倉歷史.
Formal and local temporary watchlists are visibly separate. This list of entry
points is not evidence that every provider-dependent capability is complete;
consult the capability matrix for status and gates.

## Runtime and security boundary

- Lab personal data uses the existing AIOS session, App Access, MFA, user-to-owner
  mapping, and Shared Data Gateway.
- Personal data adapters expose only SELECT operations and fail closed if
  session, authorization, MFA, or owner mapping is unresolved.
- The Lab does not include Genspark's license login, author account, Worker,
  author-owned identity, or plan gates.
- Provider values are never synthesized from portfolio values. Missing source
  data remains missing, and simulation is not mixed with real personal data.
- The Lab has no trade execution path.

## Release and acceptance boundary

Local unit/browser evidence is not authenticated Production Runtime evidence.
The current candidate still requires a logged-in PM session to verify actual
holdings, watchlist, closed history, TW/US provider behavior, and release
identity. Edge Function source changes also require their own verified
deployment/readback; GitHub Pages status alone does not prove an Edge Function
is deployed.
