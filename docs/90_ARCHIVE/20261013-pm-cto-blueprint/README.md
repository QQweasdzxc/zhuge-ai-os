# Zhuge AI OS Documentation Library

This index is the entry point for current Zhuge AI OS documentation. Current
architecture and contracts are authoritative only when they agree with the
current Source and Cloud Contract.

## PM × CTO product communication (review candidate; 2026-10-13)

These documents distinguish **PM-approved target behavior** from **currently
implemented Source/Cloud/Production behavior**. They are visual planning and
change-governance aids, not replacements for existing runtime authorities.

1. [Product Blueprint / impact map](00_CURRENT/PM_CTO_PRODUCT_BLUEPRINT.md) — TaskFlow-front / AI OS Apps target architecture, phases A→B, and cross-feature change impact.
2. [User Flow Maps](00_CURRENT/PM_CTO_USER_FLOWS.md) — Google sign-in + Owner approval, CTO SB→TF cards, unified Calendar and Google sync.
3. [PM Decision Log](10_GOVERNANCE/PM_PRODUCT_DECISIONS.md) — approved decisions, discussion-only ideas, decisions superseded, and collaboration protocol.
4. [Current State Snapshot](00_CURRENT/PM_CTO_PROJECT_STATUS.md) — verified evidence, open issues, candidate vs Production and QA gates.

**Before any new planning or Co instructions:** consult all four, check the
latest Source/Cloud/Issues, identify changed dependencies, then update the
affected diagram, decision log and delivery status. Treat these as a candidate until PM approves their integration into main.
The PM subsequently approved the home-screen prototype and authorized **candidate
coding only** under [Issue #49](https://github.com/QQweasdzxc/zhuge-ai-os/issues/49).
This does not authorize a production deploy, database change or main merge.

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
