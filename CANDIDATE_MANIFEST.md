# Zhuge AI OS Candidate Handoff

- Candidate: `20260812_0019_Candidate.zip`
- Product Version: `v0.9.0-alpha.9.12`
- Runtime Build: `20260812-0019`
- Package Time: `2026-08-12 00:19 Asia/Taipei`
- Source Commit: `5ad440358fb1d111ca04e28169dc87ceadd77f04`
- Scope: Canonical Shared Navigation geometry across WorkLog, 工作待辦, Dashboard, Investment, Knowledge, 控制台、設定 and AI Board.
- QA: 76 automated tests passed; 0 failed; 0 skipped; JavaScript syntax check passed; `git diff --check` passed.
- Database / Schema / RLS / Auth / OAuth / Business Logic: unchanged.
- Deployment: not deployed; `main` not merged; no release.

## Visual parity evidence

At a 1600×1000 browser viewport, the 工作待辦 and WorkLog navigation render with the same computed geometry: 260px sidebar width, 14px outer padding, 40px primary item height, 36px child item height, 6px × 8px item padding, 14.08px item font, and 17.6px line height. Only the active item changes.
