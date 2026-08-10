# AI Board Batch #2 — Shared Shell / IA Developer QA

## Candidate identity

- Product Version: `v0.9.0-alpha.9.12`
- Runtime / Source Build: `20260810-0845`
- Candidate type: GPT Review Candidate (not a release)
- Branch: `review/ai-board-batch1-20260809`
- Scope: Shared App Shell, Navigation IA, AI Board views, Checklist/Evidence UX, responsive Kanban, Investment Shell reuse

## Implemented scope

The candidate keeps one `ZhugeSharedNavigation` component for WorkLog, Investment and AI Board. Its hierarchy is:

- `⛺ 營帳`: WorkLog → 工作待辦; Investment
- `🤖 AI Board`: 工作看板; 工程準則; 系統藍圖
- `🚧 施工中`: unnamed future workspaces
- `⚙️ 系統`: Knowledge; 控制台; 設定

The AI Board opens directly on 工作看板. Engineering Principles and System Map are separate read views, not Kanban cards and not TASK statuses. The shared shell collapses to major-group icons and gives the released width to the content area.

The AI Board Workspace heading is the single 🤖 AI Board navigation entry. It opens the default 工作看板 view; the only child entries are 工作看板, 工程準則 and 系統藍圖. No duplicate AI Board menu item is rendered. The three unfinished Workspace placeholders are separate 🚧 施工中 sections; no unfinished Workspace name is exposed.

Task detail presents `需求內容 → 使用情境 → Development Contract / Checklist / Evidence → 下一步`. Checklist rows identify validation content, responsible stage, required evidence, evidence location/note, state, and next action. A completed TASK without a checklist is shown as `歷史完成` and explicitly says that evidence is not fabricated. New TASK completion still requires required checklist PASS plus evidence.

## QJC persona browser walkthrough

Executed with the configurable browser executable (`CHROME_PATH`) and a desktop viewport (`--window-size=1600,1000`) against `tests/ai-board-batch-2-browser.html`:

1. Open AI Board and verify the canonical shared navigation, including WorkLog, 工作待辦, Investment, Knowledge, 控制台 and 設定.
2. Open TASK-026 and read requirements, usage scenario, the Co/GPT/QJC checklist stages, evidence guidance, and the explicit handoff labels (`退回 Co`, `GPT Review 通過 → 交 QJC`).
3. Refresh and exercise search for `TASK-026`; verify success feedback.
4. Open the add-task flow, enter requirement content and 使用情境, and verify the create success feedback.
5. Switch 工作看板 → 工程準則 → 系統藍圖; verify each view has its own content and principles do not enter the Kanban.
6. Collapse and expand the shared navigation; verify the shell class changes and the content layout remains available.
7. Verify the cross-workspace navigation destinations are present for WorkLog, 工作待辦, Investment, AI Board and system entries.
8. Open a historical done TASK fixture; verify `歷史完成` and the no-fabricated-evidence explanation.
9. Verify the AI Board navigation IA audit reports `heading=1;duplicateMenu=0;children=3`.

The browser regression passed with all UI assertions. A 1600×1000 production-shell screenshot is included at `docs/evidence/ai-board-shared-shell-desktop.png`.

## Automated evidence

```text
AI Board Browser UI ...                         PASS
Existing unit/integration tests                 30 passed / 0 failed
JavaScript syntax / inline scripts              PASS
git diff --check                                PASS
```

The real AI Board DOM also shows Version `v0.9.0-alpha.9.12` and Build `20260810-0845` from `shared/config/version.js`. The browser test accepts `CHROME_PATH`, `CHROMIUM_PATH`, or `BROWSER_EXECUTABLE`; it does not contain a machine-specific executable path.

## Regression and safety boundary

```text
OAuth / PKCE / Supabase Auth flow               NO CHANGE
WorkLog business logic                           NO CHANGE
Investment business logic                        NO CHANGE
Database migration / schema                      NO
RLS migration                                    NO
Production deploy / GitHub Pages                NO
TASK final status changes                        NO
```

The existing Shared Identity, Supabase Gateway, controlled transition and Realtime adapters remain the integration boundary. This candidate does not authorize or perform production write-policy changes.

## Known issues / next gate

- Candidate has not been merged to `main`, released, or deployed.
- Authenticated Cloud Read and QJC PM QA must be run against the deployable candidate artifact in the next gate; the included browser fixture uses injected Cloud adapters to exercise the UI contract deterministically.
- `TASK-026` remains `qa / GPT` and is not marked done.
