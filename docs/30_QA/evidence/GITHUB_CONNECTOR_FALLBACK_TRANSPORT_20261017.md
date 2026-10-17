# GitHub Connector Backup Transport | 2026-10-17

**Scope:** P0 GitHub network 403 recovery; pre-production transport checkpoint.

## Verified baseline and transport boundary

- Origin: PR #60 Review branch, immutable Source SHA `9c84531f30a2dcff9f1c9e703facb244e654ecac`, product `0.9.0-alpha.9.72 / 20261017-0807`.
- The original .9.72 FullSource Review ZIP was retrieved from the existing restricted Google Drive `版控` folder. Its local SHA256 re-hash equals the accompanying Manifest: `241f7478fe72ad2730d5b194e21f8a7119bec0840ca1cfdf195a7a5e678438c1` (7,807 files in original formal manifest).
- Codex Cloud's `git remote` missing and HTTPS proxy CONNECT HTTP 403 are restrictions **in that execution environment**. They are not proof of absent GitHub repository permissions or TaskFlow GitHub App installation permissions.
- A prior GitHub connector **Git Data API blob** write and exact readback succeeded (diagnostic blob `4ad90271d6980782493b9648823fe0846309f615`). A blob alone is not a commit, branch update, CI, or deploy.

## This formal cycle

- New Candidate source version: `0.9.0-alpha.9.73` (does not replace or rewrite the historical `.9.72`).
- Formal Build: `20261017-1603` (Asia/Taipei).
- Source change: one auditable transport/recovery runbook plus the existing authorized release-governance Build/Version identity projections. No TaskFlow application or database runtime behavior changes.
- GitHub transport method: create blob(s) -> construct tree from exact Review baseline -> create single-parent commit -> update the **existing Review ref** non-force, compare the known expected baseline -> GitHub remote exact-SHA readback -> associated Actions QA.
- No new provider dispatch, GitHub App permission changes, production migration, Render deploy, public FullSource Release, or PM final acceptance is authorized by this checkpoint.

## Required final verification (do not infer success)

- [ ] Actual GitHub Review-branch commit and exact remote SHA readback.
- [ ] Build Parity and Browser Regression on the exact final SHA.
- [ ] Formal P0 FullSource ZIP, Manifest, SHA256 generated from a clean checkout with real Git history and origin/main; permanently backed up and retrieved.
- [ ] Only after explicit PM release authorization: main promotion, official Render deployment, any Migration 598 and protected runtime gates.

An incomplete box is not a PASS. The text in this file intentionally contains no unverified new commit SHA or CI claim.
