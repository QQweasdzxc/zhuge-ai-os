# Fubon Compatibility Proof — TASK-043 Phase 1.3

This function is a controlled Hosted Supabase Edge compatibility proof. It
is not the Investment integration and must not be used as a product data
adapter.

The project-level credentials used by this proof are a PM/Creator-controlled
test boundary only. They must not become the data source for another user's
Investment. The later formal Integration contract is user-scoped:

`authenticated user -> own broker connection -> own broker accounts -> own
broker-derived data`

Owner/Creator authority does not grant default access to another user's
Investment or broker data. A future formal adapter must therefore resolve the
authenticated user's own connection and accounts, and must not reuse these
proof secrets as a global production connection.

## Scope

The only provider operations are:

1. SDK load (`fubon-neo@2.3.0`)
2. API Key login with certificate
3. Read authorized securities accounts
4. `accounting.inventories` for each returned account
5. REST latest quote for the fixed Taiwan symbol `2330`

It does not call order, modify-order, cancel-order, Investment snapshot,
transaction, or any Zhuge product-data write operation. It does not create a
WebSocket subscription. If the SDK requires `initRealtime()` to construct
its REST client, the function calls it only for that request and reports
`stream_subscriptions: 0`.

## Required Edge Secrets

Create these names only in the Supabase server-side Secret Manager. Never put
their values in Chat, Browser code, Source, Git, ZIP, Database, or logs.

- `FUBON_API_PERSONAL_ID`
- `FUBON_API_KEY`
- `FUBON_CERT_PASSWORD`
- `FUBON_CERT_FILE_BASE64`

`FUBON_CERT_FILE_BASE64` is the exact exported certificate binary encoded as
standard RFC 4648 Base64. Do not include a `data:` prefix. The function
decodes it in memory, writes it to an invocation-local `/tmp` path, passes
that path to the SDK, and removes the file in `finally`.

The certificate must fit within the platform's Edge Secret size limit. If it
does not, stop and request a PM decision; do not move it to Storage or a
Product Data table.

## Authorization and invocation

Keep Supabase JWT verification enabled; do not deploy this function with
`--no-verify-jwt`. The function additionally requires the existing
authenticated Creator/Owner resolver and approved app-access resolver.

The request body must be empty (`{}` is accepted). Credentials, account IDs,
symbols, certificate paths, and provider options are not request parameters.

After PM has injected the four Secret values through the Supabase server-side
Secret Manager, invoke the function with a normal authenticated PM/Creator
session. The function returns only sanitized metadata. A successful result
must include `result: "PASS"`, SDK `2.3.0`, successful login/inventory/quote
stages, `transport: "REST"`, and `stream_subscriptions: 0`.

Errors return a stable sanitized `error_code` and `stage`; raw SDK errors,
tokens, credentials, account numbers, certificate paths, and provider
responses are never returned.

## Explicit stop conditions

- SDK/native addon cannot load in Hosted Edge: compatibility is `FAIL` or
  `BLOCKED`; do not add a Node server or workaround.
- Certificate cannot be represented within the Edge Secret boundary: stop.
- A provider test would require a live order, modify, or cancel call: do not
  run it; the function intentionally reports `order_permission_probe:
  "NOT_CALLED"`.
- This proof must not call `create_broker_position_snapshot`, append a
  transaction, or modify `opening_positions`.
