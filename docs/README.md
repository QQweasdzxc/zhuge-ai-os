# Zhuge AI OS Documentation Library

This index is the entry point for current Zhuge AI OS documentation. Current
architecture and contracts are authoritative only when they agree with the
current Source and Cloud Contract.

## Current map

- [`00_CURRENT/`](00_CURRENT/) — current architecture, foundation, module, naming, and UI contracts.
- [`10_GOVERNANCE/`](10_GOVERNANCE/) — coding/release rules, ADRs, and engineering principles.
- [`20_MODULES/`](20_MODULES/) — current shared Module C capability documentation and module contracts.
- [`30_QA/`](30_QA/) — current QA methodology, regression evidence, and cleanup inventory/report.
- [`40_RELEASES/`](40_RELEASES/) — historical release, candidate, and handoff records.
- [`90_ARCHIVE/`](90_ARCHIVE/) — superseded documents retained for historical reference only.

## Contract boundaries

- Current Source is the implementation authority.
- Cloud is the data and Cloud Contract source of truth.
- `docs/supabase/` is intentionally retained at its existing path because SQL migration and rollback files are release/Cloud dependencies, not disposable documentation copies.
- Nested module and test README files remain with their source boundary.

## Historical material

Archived documents are useful for provenance and audit context only. They do
not define current Architecture, Runtime behavior, Cloud Contract, or
workflow authority.
