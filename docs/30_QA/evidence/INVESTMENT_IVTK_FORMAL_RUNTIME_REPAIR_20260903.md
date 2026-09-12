# Investment IVTK Formal Runtime Repair

## Release scope

- Product: `Investment Workspace`
- Product version: `0.9.0-alpha.9.13`
- Runtime build: `20260903-0853`
- Scope: `Investment #portfolio` as the formal IVTK C Consumer, C Mother Template parity, and formal delivery identity.
- Excluded: Snapshot Write, Screenshot Recognition, Price Engine, Advisor, WorkLog, OAuth, Identity, and unrelated AI Board behavior.

## Root-cause finding

The Investment data projection and stable IVTK linkage were already in place. The parity failure was in the presentation layer: the Investment adapter wrapped the shared card renderer with its own board heading, board/column geometry, card metrics, and drawer presentation. That made IVTK a visually separate Investment board instead of a C Consumer with Investment data slots.

## Root fix

IVTK now mounts the existing shared C Board/Card/Drawer contract directly. Investment owns only the adapter semantics: source identity, financial fields, read-only status, and the approved red/green performance indicator. Shared board geometry, card identity, workspace layout, drawer ownership, keyboard interaction, and lifecycle binding remain C-owned. The `#watchlist` route renders the same IVTK runtime restricted to the `觀察名單` workspace; it does not create a second watchlist UI.

## Data integrity boundary

The formal projection remains read-only for Investment financial data. The verified baseline is preserved: current positions `8`, opening positions `8`, transactions `3`, watchlist `0`, broker snapshots `0`, and active IVTK links `8`. QAT-001 remains its original QAT identity in the archived QAT workspace and is not projected into IVTK. No transaction, opening-position, portfolio, or watchlist mutation is part of this repair.

## Release identity

`version.json` is the single Runtime Build source. Runtime cache-busters, module metadata, shared version metadata, dashboard fallback metadata, template publication metadata, and the Candidate manifest must all resolve to this build. The Candidate ZIP and sidecar manifest are the formal delivery evidence; PM QA remains separate from deployment and is required before acceptance.

## Verification record

The final handoff records the exact commit, GitHub Pages deployment, package timestamp, Candidate filename, SHA-256, machine parity result, desktop/mobile runtime result, Cloud read-back, and regression counts. This document is a release note and evidence record, not a PM acceptance record.
