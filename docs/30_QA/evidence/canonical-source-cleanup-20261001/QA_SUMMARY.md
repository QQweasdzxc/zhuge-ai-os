# QA Summary — Canonical Source Cleanup — 2026-10-01

## Candidate identity

- Local branch: `codex/canonical-source-cleanup-20261001`
- Starting HEAD: `248b1f78e043886976e135681ed9d8f149eb078b`
- Official checkout `/Users/qq/Documents/GitHub/zhuge-ai-os`: unchanged, clean `main` at `6553f21e1daeb97f76795066505f23cf7137b0e9`, equal to its local `origin/main` read-back.
- GitHub Remote: read-only; no remote mutation.
- Build/version: `version.json` remains `20260929-1358`; it was not changed. No new Build/package was created.

## Changed scope

- Relocated 1,620 tracked Lab files after copy verification: `skyeye-next/` (1,605 files), Fubon adapter and its manual proof workflow (15 files).
- The nine-file `tools 2/` legacy set had already been removed from the formal candidate in earlier local Repo Hygiene work; this pass verified each archived file against its Git blob ID.
- `contact 2/` and `google-data 2/` had already been removed in the candidate lineage after identical blob comparison; no additional duplicate directory was deleted in this pass.
- Added the five audit artifacts in this directory and recorded this cleanup through Backlog CLI.
- No Product code, Investment behavior, Provider contract, Cloud, migration, Product Data, or Secret source changed.

## QA evidence

| Check | Result |
|---|---|
| SkyEye Lab copy vs source | PASS; `diff -qr` reports no differences; 1,605 tracked files. |
| Fubon Lab copy vs source | PASS; adapter tree and workflow each match exactly; 15 tracked files total. |
| `tools 2` archive vs Git objects | PASS; all nine files match Git blob IDs from `7c49182f4f260bd87edc94362378a25859a1df2a`. |
| Duplicate blob comparison | PASS; both known duplicate HTML files match canonical blob IDs. |
| Lab architecture tests | PASS, 3/3; `node --test tests/lab-architecture.test.js`. |
| SkyEye browser responsive regression | PASS, 1/1 across 375×812, 500×900, 1024×900, 1440×900, and 1920×1080; `node --test tests/skyeye-mobile-browser.test.js` with installed Chrome and Playwright. |
| Full Node + browser-eligible regression | PARTIAL: 848 total, 847 passed, 1 failed, 0 skipped. The single failure is `tests/ai-board-batch-2-browser.test.js`: expected delayed `nav-collapse-audit` output is absent from the captured Chrome `--dump-dom` output. No cleanup-touched module is used by that fixture. A test-only wait experiment hung because the spawned Chrome does not naturally exit; it was stopped and the test source restored exactly. |
| `npm ci --ignore-scripts` | PASS for locked developer dependencies; `package-lock.json` and `package.json` unchanged. npm reported one high-severity development-dependency advisory; dependency versions were not altered. |
| Production Runtime | NOT RE-VERIFIED; no deploy or authenticated runtime action. |
| GitHub / Cloud / Data mutations | 0. |

## Final gate

This is a local cleanup review candidate, not a Production-ready or Runtime-accepted release. One full-regression browser test remains failed as described above. No new Build identity or ZIP was created because no package/deployment gate was authorized or specified; the source candidate is available on the local branch for GPT/PM review.
