# TaskFlow AI 工程執行｜正式身份與 Run 回報（.9.57，2026-10-16）

## 產品 Authority
- **唯一網站**：https://zhuge-taskflow-web.onrender.com；沒有獨立的使用者可進入之測試站。
- **TaskFlow**：正式 `taskflow.issue`、`workspace`、`member`、`project` 是任務及授權 SSOT。TaskFlow 原生登入中介層解析使用者身份；HTTP 的 `X-User-ID` 必須是既有 Auth Middleware 覆寫後的值，不能直接信任瀏覽器。
- **GitHub**：原始碼與唯一可審核的 branch / PR / exact Commit SHA；獨立工作權與 handoff manifest 仍由 PR #55 的 `labs/cloud-handoff` 負責。
- **Provider**：Co = Codex Cloud，Gem = Gemini。未經可信正式啟動與 TaskFlow Run 收據，不得從 UI 顯示 RUNNING。
- **GPT/CTO**：審查結果，不能由留言取代單一 Writer 或 PM release approval。

## 本階段 Native API (候選，未部署)
1. `GET /api/issues/{id}/zhuge-ai/runs?workspace_id=...`：既有 TaskFlow 原生登入／會員才可讀 20 筆 Run，包含狀態、PR、SHA 與已驗證的 provider thread ID；無資料回傳空陣列，資料庫沒配置則 503，不假裝成功。瀏覽器側欄新增可手動更新的 Readback，只允許 GET。
2. `POST /api/issues/{id}/zhuge-ai/approve?workspace_id=...`：只有登入的真人 `owner/admin` 才可批准指定 Co 任務。要求 Native Issue revision、GitHub PR、40 字節十六進位 SHA、128-bit 隨機一次性 idempotency key，僅允許可處理的原生 Issue 狀態與已綁定 Project。利用 DB Transaction 單一 commit 寫入 PM 批准與不可變首筆 audit event，revision 在 SQL 再驗證；不能繞過 RBAC 或寫入原生 Issue。
3. 狀態初始為 **approved ≠ Co Running**。API 明確回報 `launch_performed:false`；此路由預設由 `ZHUGE_TASKFLOW_AI_APPROVALS_ENABLED` 保持關閉。
4. 候選 migration `591_zhuge_ai_engineering_run` 僅新增 `taskflow` 自有的 `zhuge_ai_engineering_run` 和 append-only `zhuge_ai_engineering_event`，唯一 Active Run 條件限制同任務多工程師競爭。其版本化 SQL 檔案只 staged，**沒有使用 Supabase connector 套用正式 DDL**。

## Release / Security Gate
- API / Web 都必須由**同一個正式 main SHA** 构建；不能先單獨部署缺 schema 的 API 或沒有 API 的 UI。
- Native 應用程式 Runtime DB 權限由現有 `taskflow_migrator` default privileges 維持，禁止在 `public` 開啟寫入權限。下線 migration 檢查有資料就拒絕 DROP。
- 源碼 / Python patch / Go native handler / Docker backend+web / Go regression / Browser Desktop/Mobile / FullSource 統統需要 PASS，且使用者 PM Production GO 確認後才可套 migration 和部署。
- 在正式 Dispatch Gateway 真正接通前，寫入 PM approval 也**不代表進行了 Github bot 呼叫**。需補 GitHub App token 的合規服務端持有者、對應 native TaskFlow issue/Revision/PM approval/zero-cost 實時核實、Git SHA Live Head、CAS claim、Old Writer STOP、Co 官方回覆與 Run receipt 的真實驗證。
- TaskFlow 現存 `agent=0`、`agent_runtime=0`、`agent_task_queue=0`、`github_installation=0`；不能聲稱已註冊 Co 或可由原生 Agent Queue 執行。
- 依照 PM「零新增 AI API 費用」政策，未知訂閱剩餘額度、Pay-as-you-go、Gem headless 身分未核實都**阻擋真實派工**。也禁止從使用者瀏覽器複製 Session Cookie 或私密 OAuth cache 到 Render/CI。
- 未有具體單張 TaskFlow 任務的批准前，不擅自以 ZG-6 或其他正式任務觸發 @codex。UI 僅顯示真實持久的 Run 記錄，不把本次 Draft Source/CI 當成 Co 真實工作。

## 下一關要達成的真實功能
信任域：正式任務 owner/admin PM approval → GH App 身分/成本前置驗證 → 原生 Run + durable single-writer CAS → Github @codex 調用 → Bot ACK 與 Thread ID 經真實授權驗證 → 原生 Run 狀態更新 → TaskFlow 既有側欄可讀回（含中止與故障和審查）。待證據齊備才申請最後正式發布。
