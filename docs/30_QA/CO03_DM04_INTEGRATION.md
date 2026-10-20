# CO-03 DM-04 TaskFlow Dispatch Workbench

This review branch adds a TaskFlow-owned, read-only dispatch workbench to the existing Pages client. It does not add a second task database or claim provider execution.

## Evidence contract

- Native source: `/api/issues`, `/api/issues/{id}/task-runs`, `/api/issues/{id}/pull-requests`.
- Metadata keys are `zhuge_work_code`, `zhuge_dispatch_status`, `zhuge_provider_run_id`, `zhuge_provider_heartbeat_at`, and `zhuge_observed_at`.
- `RUNNING` requires a provider run ID and a heartbeat observed within 15 minutes; missing or expired evidence is `UNKNOWN` or `STALE`.
- `POST /rerun` is not used by this workbench and a TaskFlow task ID is never treated as a provider run ID.
- Executor filtering is limited to `CO-01`, `CO-02`, `GEM-01`, and `GH-HELPER` (including `GH-HELPER-*`).
- Empty, authentication, authorization, network, and API errors remain visible; no fixture data is rendered. DAILY is explicitly shown as disconnected until a real native source is available.

## Verification labels

- `SOURCE_TEST_PASS`: module contract tests and static Pages build pass locally.
- `PROVIDER_RUNTIME_UNVERIFIED`: this review has no provider credentials or remote ACK.
- `PRODUCTION_NOT_DEPLOYED`: no production API, storage, database, secrets, Render, or deployment operation was performed.
