# Lab Investment × My Holdings — Read-only Integration v1

## Scope and release identity

- Candidate Build: `20261001-2324`
- Canonical repository: `zhuge-ai-os`, local branch `main`
- Formal Investment remains the only portfolio authority.
- Lab is a research workbench and consumes a minimal authenticated read projection.
- No brokerage connection, trade operation, Cloud/Product Data write, or formal Investment business-flow change is included.

## Runtime path

1. The Lab reuses the existing Zhuge Runtime Session Provider and Investment ModuleContext.
2. Before any portfolio SELECT, the adapter requires an authenticated session, approved App Access, resolved creator/security policy, and permission for `view` (including the existing Investment MFA policy).
3. The authenticated identity is mapped through `app_users.auth_user_id` to the canonical owner ID.
4. The adapter reads the owner’s selected portfolio and `investment_current_positions_view` through Shared ModuleContext `data.select`.
5. Only when the primary projection returns no rows, the adapter may read the latest `pm_confirmed` snapshot and `current_broker_positions_view`; the row count must match the canonical snapshot header or the read fails closed.
6. The UI renders a read-only holding card. “查看研究” routes with the symbol only; quantities, costs, P/L, owner IDs, and account details are not placed in URL, Lab storage, logs, or analytics.
7. A held instrument with no approved research provider remains viewable as a holding, while its research page reports `NOT_CONNECTED` with null evidence.

## Read / write boundary

The Lab adapter exposes only `load()`. Its contract declares an empty write capability list. It captures only Shared ModuleContext `data.select`; it does not call RPC, insert, update, delete, or upsert methods. It does not import the formal Investment repository, whose broader transaction/snapshot responsibilities are outside this Lab boundary.

The formal Investment source changes in this Candidate are limited to the required Candidate Build/cache-buster identity. No Investment CRUD, storage, repository, API, or portfolio business logic changed.

## Candidate Runtime result

Local static Browser QA verified the Lab entry, research journeys, and anonymous fail-closed behavior. This local origin has no authenticated Zhuge session, so the real portfolio SELECT, actual holding cards, and click-from-real-holding journey remain **AUTHENTICATED_RUNTIME_REQUIRED**. No mock portfolio was substituted. See `PORTFOLIO_RUNTIME_EVIDENCE.md`.

## Out of scope

Portfolio write-back, broker synchronization, Fubon, automatic trading, investment recommendations, Investment graduation, Cloud deployment, and production cutover.
