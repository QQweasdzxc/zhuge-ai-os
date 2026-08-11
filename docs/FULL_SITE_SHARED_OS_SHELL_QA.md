# Zhuge AI OS｜Full Site Shared OS Shell QA

## Candidate baseline

- Product Version: `v0.9.0-alpha.9.12`
- Runtime Build: `20260811-1331`
- Scope: Shared OS Shell / Navigation / Theme / Responsive presentation only
- Golden Master: AI Board Shared OS Shell geometry

## Unified runtime surface

The following formal workspace entry points use the same `ZhugeSharedNavigation` source, `ZhugeSharedShell` header adapter, Shared Shell geometry tokens, and Shared Appearance tokens:

- Dashboard
- WorkLog
- 工作待辦
- Investment (including protected unlock/access states)
- Knowledge
- 控制台
- 設定
- AI Board：工作看板、工程準則、系統藍圖

Disabled / coming-soon workspaces remain hidden by the canonical `enabled && visible` registry filter.

## Shared geometry

Canonical tokens are defined in `shared/theme/zhuge-shell.css` and consumed by the shared navigation/workspace styles:

`--shell-sidebar-width`, `--shell-main-gap`, `--shell-page-padding-x`, `--shell-page-padding-y`, `--shell-header-height`, `--shell-header-content-gap`, `--shell-section-gap`, `--shell-radius`.

Dashboard and Investment now use the same outer page inset as AI Board and WorkLog. Tablet view defaults to the shared icon rail (the existing collapse control restores the expanded rail); mobile uses the shared drawer.

## Browser visual evidence

All screenshots were captured from the local runtime with Chrome and are stored under `docs/evidence/full-site-shell/`:

- `dashboard-dark.png`
- `dashboard-light.png`
- `worklog-dark.png`
- `worklog-light.png`
- `ai-board-dark.png`
- `ai-board-light.png`
- `investment-unlock.png`
- `knowledge-dark.png`
- `knowledge-light.png`
- `settings-dark.png`
- `dashboard-mobile.png`
- `worklog-mobile.png`
- `dashboard-tablet.png`
- `ai-board-vs-worklog-dark-side-by-side.png`

Validated viewports: 1600×900, 1440×900, 1280×800, 1024×800 tablet, and 390×844 mobile. The 1600×900 shell geometry matches across Dashboard, WorkLog, and AI Board: sidebar x=18/w=260, main gutter=14, header x=316/y=42/w=1242/h=94.

## Regression

- JavaScript / module tests: 66 passed, 0 failed, 0 skipped
- Shared Shell consistency tests: PASS
- AI Board browser tests with `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`: PASS, 0 skipped
- `git diff --check`: PASS
- Console/page errors in captured routes: 0
- Horizontal overflow at tested viewports: none detected
- Auth, Supabase, RLS, Schema, OAuth, Controlled Transition, and business logic: unchanged by this sweep

## Known boundary

The standalone WorkLog assistant route (`modules/worklog/chat/`) remains a deliberate full-screen assistant surface, not a Workspace route. Its existing chat behavior was not changed.
