# TASK-033｜Engineering Data Health Readiness

## 已完成的可執行 Slice

- AI Board 新增「檢查資料健康度」入口。
- 透過 Shared Supabase Gateway 讀取正式 `board_tasks`、`engineering_knowledge`、`engineering_checklist_items`。
- 唯讀檢查：缺少 TASK Code／必要欄位、重複 Code、編號缺口、高度相似標題、System Map stale、Done／Checklist 不一致。
- Finding 以 PM 可理解的繁體中文顯示，保留涉及紀錄與原因。
- 明確標示 Co／GPT 不會自動 Merge、Cancel、Link、Ignore 或刪除資料；QJC 可從受控治理入口做最終決策。

## Governance Metadata / Controlled Action（已完成最小承載）

已套用 `docs/supabase/20260810_task_033_governance_metadata.sql`：

- `board_tasks` 增加 `resolution_action`、`merged_into`、`linked_to`、`resolution_reason`、`resolved_at`、`resolved_by`。
- 欄位以 FK／CHECK 保持 Merge／Link 目標與治理狀態一致，並保留歷史資料。
- `board_governance_action()` 是唯一治理寫入入口；只接受已登入且 `engineering_members.role = owner` 的 QJC，使用既有 `engineering_activity_log` 留下 before／after、actor、reason 與時間。
- Governance update 與 Audit insert 在同一個 PostgreSQL function transaction 內；Audit 寫入失敗時整個治理更新會回滾，不會留下半套狀態。
- Co／GPT 仍只能 Detect／Analyze／Recommend；Browser 不取得 Service Role，也沒有直接 DML 或 RLS 例外。
- `docs/supabase/ROLLBACK_20260810_task_033_governance_metadata.sql` 僅供 PM 明確核准時使用，不會自動執行。

## Readiness / Remaining Scope

正式欄位與受控入口已具備；仍需在 QJC／GPT Review 中以真實登入帳號驗證每一種治理動作、目標 TASK、Realtime 與歷史查詢呈現。Co／GPT 不得自行做最終 Merge／Cancel／Link／Ignore 決策。

## Security Baseline

本次只新增 TASK-033 核准的治理欄位與 `board_governance_action()`；未修改既有 Transition RPC、RLS、Auth、OAuth 或 Security Advisor 既有 Finding。Supabase Security Advisor 仍維持 review baseline；不因警告自行 remediation。
