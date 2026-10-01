# Shared UX / AI Board Backlog Batch — Developer QA

## Scope

本批依既有 Active TASK 的已批准 Slice 實作，不建立新 TASK，也不修改 OAuth、RLS、Auth、WorkLog／Investment 業務邏輯。

- TASK-024：Shared Navigation 的 `enabled && visible` 過濾、移除未啟用的三個「施工中」Placeholder、Shared Shell 標記與 Responsive 版型。
- TASK-014：WorkLog、工作待辦、AI Board、Investment 的 Workspace Header／Sub Navigation／Container 使用同一組 Shared Shell class。
- TASK-015：AI Board PM 操作層改用繁體中文且以「我要驗證什麼／需要什麼證據／下一步」說明。
- TASK-023：保留「📘 最高原則」固定工程準則 View，來源仍為 `engineering_knowledge`，不進 Kanban。
- TASK-032：Checklist 與 Evidence 只讓 QJC 操作 QJC stage；Co／GPT stage 以唯讀結果與證據說明呈現，避免 PM 誤以為可以代填工程驗證。
- TASK-022：保留 1655 受控拖曳／Realtime 工作流實作，作為本批 Regression 基準。

## Implementation Evidence

- Shared navigation registry marks unavailable workspaces `enabled: false, visible: false`; renderer filters both flags before emitting a section or item.
- WorkLog, AI Board and Investment use the canonical `ZhugeSharedNavigation` component. Shared Workspace class names now identify header, sub-navigation and content container without replacing module business UI.
- Task detail reading order remains：需求內容 → 使用情境 → 開發契約與驗收清單 → 下一步。
- Checklist stage labels are PM-readable：Co 開發驗證、GPT 工程審查、QJC PM 驗收。
- Evidence guidance is stage-specific and explicitly states the expected proof. Existing `evidence_note`、`evidence_ref`、`checked_by`、`checked_at` are displayed without manufacturing missing evidence.
- Historical Done cards remain explicitly marked as historical when Checklist data is absent; no PASS／checked_by／checked_at is fabricated.

## Automated QA

Executed with the available browser executable:

```text
BROWSER_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome node --test tests/*.test.js
```

Result: **49 passed, 0 failed, 0 skipped**.

Also passed:

- `node --check app/Board/ai/board-runtime.js`
- `node --check shared/components/zhuge-navigation.js`
- `git diff --check`

The browser fixture executes at a 1600×1000 viewport and covers Shared Navigation, expand／collapse, cross-workspace links, TASK detail, usage scenario, checklist/evidence rendering, history handling and controlled handoff labels.

## Security / Data Boundary

- No direct `board_tasks` DML was introduced.
- No schema, RLS, Auth, OAuth or Service Role change was introduced.
- Existing controlled transition and checklist RPC boundaries remain the only mutation paths.
- No new task status was invented and no historical TASK was reopened.

## Known Limitations

Live Supabase Realtime and PM QA require an authenticated browser session and remain a downstream GPT／QJC acceptance gate. This document records Developer QA only; it does not declare GPT Review or QJC PM QA complete.
