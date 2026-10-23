# Protected Detail Store: production integration boundary

`server-protected-detail-store-reference.mjs` is a Node-only, in-memory AES-256-GCM reference used by isolated tests. It is not a production persistence layer, is not a browser module, and must remain outside the web bundle. Reporting remains `DETAIL_STORE_UNWIRED` until this boundary is connected.

## Minimal server interface

Inject the implementation behind the existing `AgentProtectedDetailStore` seam:

```ts
put(input: {
  scope: VerifiedReportingScope;
  label: string;
  value: string;
  classification: "sensitive" | "restricted";
  idempotency_key: string;
}): Promise<{stored: true; protected_ref: string; key_version: string} | Blocked>

get(input: {
  scope: VerifiedReportingScope;
  protected_ref: string;
}): Promise<{found: true; value: string; key_version: string} | Blocked>
```

`VerifiedReportingScope` must be produced by the server-side TaskFlow Authority. It includes the authenticated principal, Workspace and Issue identity, current executor, event ID, Dispatch/Run/Session correlation, lease/fencing epoch, and authority decision. Client metadata, comments, or `scope.verified` flags cannot create this scope.

## Persistence and security requirements

- Persist encrypted detail in an approved managed encrypted store. Do not create a second Task database; the native Issue stores only the protected reference and audit correlation.
- Enforce Workspace and Issue ACL, executor binding, and CTO review scope on every `put` and `get`. Denials are fail-closed and auditable.
- Use a KMS/HSM-backed envelope key. Store only ciphertext, nonce, authentication tag, key ID/version, classification, and correlation metadata. Secrets never enter comments, browser payloads, or logs.
- Bind authenticated encryption associated data to Workspace, Issue, Event, and protected reference. Key rotation reads the recorded key version and re-encrypts through an audited path.
- Make `idempotency_key` unique within the native Authority transaction. Retries return the same reference; conflicting payloads are rejected. Reference creation and the native Issue event claim commit atomically or both fail.
- Recovery includes encrypted backup/restore, key availability checks, retention/expiry, audit replay, and missing/revoked-key handling. Recovery cannot recreate a writer or bypass fencing.

## Current status

The in-memory reference and browser-boundary test are review evidence only. Until an approved persistent service, KMS binding, ACL resolver, and Native Atomic Write Adapter are connected and isolated-tested, report:

`DETAIL_STORE_UNWIRED / NATIVE_WRITE_UNWIRED / PROVIDER_ACK_UNVERIFIED`
