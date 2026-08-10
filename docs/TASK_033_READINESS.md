# TASK-033｜Engineering Data Health Readiness

## 已完成的可執行 Slice

- AI Board 新增「檢查資料健康度」入口。
- 透過 Shared Supabase Gateway 讀取正式 `board_tasks`、`engineering_knowledge`、`engineering_checklist_items`。
- 唯讀檢查：缺少 TASK Code／必要欄位、重複 Code、編號缺口、高度相似標題、System Map stale、Done／Checklist 不一致。
- Finding 以 PM 可理解的繁體中文顯示，保留涉及紀錄與原因。
- 明確標示目前不會自動 Merge、Cancel、Link、Ignore 或刪除資料。

## Readiness / Remaining Scope

目前 `public.board_tasks` 僅有原始 TASK 欄位，沒有 `merged_into`、`merge_reason`、`cancellation_reason`、決策時間等正式承載欄位。`engineering_activity_log` 可記錄活動，但尚未形成 TASK 整理操作的最小資料契約。

因此 Merge／Cancel／Link／Ignore 的正式寫入與 Audit 尚未授權，不能以 Browser 直接 DML 或暫時繞過 RLS。這不是前端缺少按鈕，而是 TASK-033 acceptance 的 Schema／Controlled Operation boundary，需由 QJC／GPT 核准最小資料模型與受控寫入方式後才能完成。

## Security Baseline

本次未修改 Database、RLS、Function 或 Security Policy。Supabase Security Advisor 維持既有 review baseline；不因警告自行 remediation。
