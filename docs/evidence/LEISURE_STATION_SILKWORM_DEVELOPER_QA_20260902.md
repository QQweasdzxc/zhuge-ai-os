# 休閒小站／天蠶變 Developer QA Evidence

日期：2026-09-02（Asia/Taipei）
範圍：Zhuge AI OS 同一 Product / 同一 Shared Shell 內新增「休閒小站」，第一款遊戲為「天蠶變」。

## Scope and boundaries

- 沿用既有 `ZhugeSharedNavigation`、`ZhugeSharedShell`、Appearance runtime 與 root Dashboard entry；沒有建立第二個 App、Navigation、Identity、Session、Repository 或 Runtime。
- 遊戲是 asset-free、local-only Web Mini Game：不使用 Supabase、Cloud Save、schema/RLS、leaderboard、multiplayer、OAuth、外部遊戲資產或第三方遊戲依賴。
- Investment、WorkLog、AI Board、Identity/MFA、task lifecycle 與既有 release/governance 流程沒有業務邏輯變更；工作樹中原有 dirty changes 已保留。
- 五子棋與數獨只存在 disabled registry metadata，沒有載入或實作 runtime。

## Architecture and files

```text
existing Zhuge AI OS Shell / Shared Navigation
├── root Dashboard card + existing router/config registry entry
└── modules/leisure/
    ├── index.html                         # same-product entry
    ├── leisure-runtime.js                 # station container and game lifecycle bridge
    ├── leisure.css                        # module content and responsive game styles
    ├── config/game-registry.js             # silkworm active; gomoku/sudoku disabled
    └── games/silkworm/silkworm-game.js     # rules, Canvas, input and cleanup
```

Tracked entry-point wiring:

- `app/dashboard/index.html`
- `app/dashboard/zhuge-dashboard.js`
- `app/router/index.js`
- `shared/app-config.js`
- `shared/components/zhuge-navigation.js`

New module/test files:

- `modules/leisure/index.html`
- `modules/leisure/leisure.css`
- `modules/leisure/leisure-runtime.js`
- `modules/leisure/config/game-registry.js`
- `modules/leisure/games/silkworm/silkworm-game.js`
- `modules/leisure/README.md`
- `tests/leisure-module.test.js`

## Gameplay contract

- Board: 18 × 24 logical cells, 24px logical cell size, 432 × 576 Canvas; CSS preserves a 3:4 responsive ratio.
- Start: the worm begins in the ready state at the lower lane, moving upward after the player presses `開始遊戲`.
- Progress: collect 8 leaves; each leaf grows the worm and adds 10 points.
- Obstacles: four fixed thorns plus the outer boundary and the worm's own body.
- Win: 8 leaves collected; result state is `won` and the board shows the success overlay.
- Lose: boundary collision, thorn collision, self-collision, or 90-second timeout; result state is `lost` with a reason.
- Restart: `重新開始` stops the current loop, creates a fresh state, and starts a new round. `再玩一局` also restarts after a result.
- Return: `返回休閒小站` stops the loop, removes listeners, destroys the active game, and re-renders the registry screen. Re-entry creates exactly one new runtime.

## Controls

- Desktop: Arrow keys or W / A / S / D. Immediate reverse input is rejected while the worm has a body.
- Mobile: four touch direction buttons. Buttons use `touch-action: none` and a minimum 64 × 64px hit area in the tested 390px layout.
- Lifecycle: `requestAnimationFrame` is cancelled and all keyboard/pointer/click listeners are removed on destroy.

## Automated verification

Commands run from the formal worktree:

```text
/opt/homebrew/bin/node --check modules/leisure/config/game-registry.js
/opt/homebrew/bin/node --check modules/leisure/games/silkworm/silkworm-game.js
/opt/homebrew/bin/node --check modules/leisure/leisure-runtime.js
/opt/homebrew/bin/node --check shared/components/zhuge-navigation.js
/opt/homebrew/bin/node --check shared/app-config.js
/opt/homebrew/bin/node --check app/router/index.js
/opt/homebrew/bin/node --check app/dashboard/zhuge-dashboard.js
git diff --check
/opt/homebrew/bin/node --test tests/leisure-module.test.js
BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' /opt/homebrew/bin/node --test tests/*.test.js
```

Results:

- Syntax checks: all passed.
- Diff check: passed.
- Focused leisure suite: 6 passed, 0 failed.
- Full regression: 126 passed, 0 failed.
- Focused coverage includes entry wiring, registry gating, desktop key mapping/reverse prevention, movement/growth/win, all lose reasons, local-only boundary, and lifecycle cleanup hooks.

## Local browser runtime verification

The page was served from the formal worktree with:

```text
python3 -m http.server 8765 --bind 127.0.0.1
```

Desktop page: `http://127.0.0.1:8765/modules/leisure/`

- Clean page loaded the shared rail and station registry with one active game and two disabled future-game cards.
- Start → ArrowRight: runtime reported `playing`, direction/queued direction `right`.
- A final keypress check kept `scrollY` unchanged at `63` before and after ArrowRight; the keyboard route does not scroll the page.
- Boundary path: runtime reported `lost`, result `撞到邊界了。 再試一次吧。`.
- Restart: runtime returned to `playing` with score `0`.
- Return: `runtimeCount=0`, registry card returned.
- Re-entry: `runtimeCount=1`, state `ready`.
- Browser console logs: `[]`.

Mobile page was tested at 390 × 844:

- `documentElement.scrollWidth=390`, `clientWidth=390`; no horizontal overflow.
- Canvas rendered at 326 × 435 CSS pixels.
- Four direction controls rendered at 64 × 64px each.
- Start → tap right: runtime reported `playing`, queued direction `right`.
- Return/re-entry: `runtimeCount=0` then `runtimeCount=1`, state `ready`.
- Browser console logs: `[]`.

This is developer/runtime QA evidence only. No Candidate ZIP, PM Accepted Baseline claim, deployment, or Cloud registration was performed.
