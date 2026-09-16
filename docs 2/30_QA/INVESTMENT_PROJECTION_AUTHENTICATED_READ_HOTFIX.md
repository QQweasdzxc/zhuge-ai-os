# Investment Projection Authenticated Read Hotfix

## Status

Implemented only for the Investment projection read failure. No AAPL
transaction was entered and no active Investment position/card was rebuilt.

## Runtime RED evidence

The authenticated Investment Board rendered the existing IVTK cards, but each
card retained the generic projection title instead of its Investment financial
slot. The browser console reported:

`permission denied for table investment_transaction_lifecycle_contract`

The error originated while `investment-cloud-bridge.js` loaded
`investment_current_positions_view`; the bridge therefore never reached its
card decoration step. WorkTodo and AI Board showed the same symptom because
both use the same Investment projection read path.

## Root cause

`public.investment_current_positions_view` is a security-invoker view and calls
`public.investment_calculated_positions()`. The calculation function was also
an invoker function, while the lifecycle contract table was intentionally
closed to `authenticated`. The authenticated runtime could read neither the
policy metadata nor the view result, even though the baseline rows and links
were intact.

## Minimal fix

Migration `investment_projection_authenticated_read_hotfix_v1` changes the
existing canonical calculation function to fixed-search-path `SECURITY
DEFINER`. It does not grant direct access to the private table. The function
continues to require `auth.uid()`, resolve the mapped Investment owner, and
filter all baseline/transaction reads by that owner. Anonymous execution
remains revoked.

No second calculation engine, projection writer, or authority was added.

## Safety boundary

- Existing `opening_positions`, `transactions`, board cards, links, and
  workspaces are not rewritten.
- `transactions` remains read-only to authenticated table DML; transaction
  writes remain behind the existing controlled RPC.
- No AAPL transaction was created.
- No Module C or other Consumer data was changed.

## Verification

After the migration, the authenticated Investment Board was reloaded. The
bridge and projection both reported `ready`; all 11 existing IVTK cards again
showed their source symbol/name, quantity, cost, market value, and P&L. Cloud
read-back remained 11 opening/current positions, 0 history positions, 3
existing transactions, and 11 existing IVTK links. The only captured console
error is the pre-hotfix permission error; no new error was emitted after the
reload.
