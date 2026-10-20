# CO-03 DM-00～DM-04 Evidence QA

## Result

`SOURCE_TEST_PASS` — 13/13 local contract tests pass.

`PROVIDER_RUNTIME_UNVERIFIED` — only the local Codex runner is visible. No official Provider Registry binding, remote Provider ACK, quota readback, heartbeat channel, or Gate 2 approval is available in this session.

`PRODUCTION_NOT_DEPLOYED` — no real dispatch, TaskFlow write, database, storage, secret, Render, or deployment operation was performed.

## Covered fixtures

| Check | Result |
| --- | --- |
| Missing heartbeat / expired TTL | `STALE` |
| Missing Provider Run ID | `UNKNOWN` |
| Task ID and Provider Run ID mismatch | rejected |
| Duplicate active runs / double dispatch | rejected |
| Invalid GitHub SHA | rejected |
| Executor allowlist | `CO-01`, `CO-02`, `GEM-01`, `GH-HELPER` |
| API auth failure paths | fail closed in native transport tests |

Gate 2 remains `BLOCKED`; a controlled E2E dispatch must wait for an approved official Provider channel and an independently verifiable ACK/Run/Event readback.
