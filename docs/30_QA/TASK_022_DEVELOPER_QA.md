# TASK-022｜Developer QA Evidence

## Scope

TASK-017 的「拖曳更新 Status」已在正式資料中標記為 `merged → TASK-022`；本次只強化 TASK-022，不重複開發或驗收 TASK-017。

本次完成：

- QJC 拖曳使用既有 `board_transition_task()` 受控路徑。
- ready → inprogress / Co → qa / GPT → qa / QJC → done / QJC。
- qa 可依 Gate 退回 inprogress / Co。
- 前端只提供 UX transition plan；Supabase RPC 仍是唯一寫入與權限裁決者。
- 非法工作區移動顯示繁體中文原因與下一步，不顯示原始 RPC 工程錯誤。
- 完成前要求必要 Checklist 全部 PASS 且具 Evidence Note 或 Evidence Reference。
- Realtime / 正式 Cloud Read / Refresh 後以同一 Status、Assignee 與工作區呈現。
- 已完成 TASK 不可再拖曳，仍可閱讀其歷史 Checklist / Evidence。

## Automated QA

執行環境：Chrome headless、`BROWSER_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`、`--window-size=1600,1000`。

```text
node --test tests/*.test.js
49 passed / 0 failed / 0 skipped
```

涵蓋：

- TASK-022 transition planning 與合法／非法路徑。
- Board Cloud Read、Shared Gateway、Controlled Transition、Checklist Evidence、Realtime adapter。
- AI Board browser fixture：Checklist、Evidence、搜尋、建立 TASK、交接、Shared Navigation、Responsive desktop viewport、歷史完成提示。
- JavaScript syntax 與 `git diff --check`。

## Security Boundary

```text
Database Migration: NO
Schema Change: NO
RLS Change: NO
OAuth / Session Change: NO
Service Role in Browser / Source: NO
Direct DML: NO
```

## Known Scope Boundary

實際 Supabase E2E 拖曳仍須由已登入的 QJC 瀏覽器與既有受控 RPC 執行；本候選版本未新增第二套 Transition API，也未改動 TASK-021 的 Server-side Controlled Engineering Architecture。
