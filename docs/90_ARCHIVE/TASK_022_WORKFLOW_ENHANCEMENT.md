# TASK-022｜AI Board 正式工作流強化

## Canonical TASK

TASK-017「拖曳更新 Status」已合併至 TASK-022。TASK-017 保留歷史資料與既有 Evidence，不再獨立開發或重複驗收。

## Product rule

QJC 在 Board 上拖曳卡片，就是推進工作。前台不直接修改資料；每一次拖曳都呼叫既有 `board_transition_task()` Controlled Transition，成功後由 Supabase Realtime 與正式 Cloud Read 反映卡片位置。

```text
待辦 / ready
  → 推進 / inprogress / Co
  → 驗證 / qa / GPT
  → 驗證 / qa / QJC
  → 完成 / done / QJC
```

合法退回：

```text
驗證 / qa / GPT 或 QJC
  → 推進 / inprogress / Co
```

## Consistency contract

每次受控交接必須讓下列資訊一致：

- `board_tasks.status`
- `board_tasks.assignee`
- Board 對應工作區
- `engineering_activity_log`
- Realtime 更新
- Refresh 後的正式 Cloud Read

## PM-facing Gate feedback

非法移動不顯示原始工程例外，而以繁體中文說明：目前在哪個階段、為何不能移動、尚缺哪個驗收 Gate、下一步由誰處理。完成欄位只有在必要 Checklist 全部 PASS 且有 Evidence Note 或 Evidence Reference 時才允許進入。

## QA scenarios

1. `ready / Co → inprogress / Co → qa / GPT → qa / QJC → done / QJC`
2. `qa / GPT → inprogress / Co → qa / GPT → qa / QJC → done / QJC`
3. 非法跳轉被阻擋，並顯示可理解的繁中提示。
4. 受控 RPC 成功後，Board Realtime 更新；重新整理仍顯示相同工作區、Status 與 Assignee。

本文件只記錄 TASK-022 的既有需求強化，不建立新的 TASK、Status 或資料寫入架構。
