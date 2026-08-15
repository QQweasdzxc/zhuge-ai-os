# Shared Sidebar Spacing — PM QA Evidence

## Scope

This adjustment applies the more comfortable 工作待辦 navigation rhythm to the
canonical Zhuge AI OS Sidebar for every Workspace. It does not add a second
navigation implementation or change Auth, Database, RLS, or business logic.

## Shared geometry

- Sidebar width: `260px`
- Main navigation item: `46px` minimum height, `10px 9px` padding
- Child navigation item: `42px` minimum height, `8px 9px` padding
- Navigation text: `15px`, `20.25px` line height
- Child text: `14px`
- Section gap: `12px`
- Section radius: `18px`
- Brand bottom spacing: `12px`

Only the active item changes between WorkLog, 工作待辦, AI Board, Knowledge,
控制台 and 設定; geometry remains shared.

## Verification

- Shared Navigation automated suite: PASS
- Full automated suite: 76 passed, 0 failed, 0 skipped
- Chrome browser geometry fixture at `1600×1000`: PASS
- WorkLog / 工作待辦 Sidebar metrics: identical
- JavaScript syntax: PASS
- `git diff --check`: PASS
- Database / Schema / RLS / Auth / OAuth: NOT MODIFIED

The candidate manifest records the final package timestamp, source commit and
ZIP digest for the delivered artifact.
