# CO-03 AI 派工證據 QA

## 身分確認（2026-10-20）

CO-03 的本地執行身分已確認為本工作階段的 Codex runner，Node.js `v24.19.0`、npm `11.9.0`。Git remote 指向 `QQweasdzxc/zhuge-ai-os`，目前可讀取本地 checkout 並以既有 Review branch 推送；本輪沒有進行 GitHub 寫入。

目前沒有可驗證的 CO-03 專用 Provider ACK、Runner run ID、Token／Quota API 或受保護 Provider runtime。環境只觀察到 `GH_TOKEN` 與 `OPENAI_CLUSTER` 名稱，沒有讀取任何值；GitHub CLI 身分驗證失效。因此身分狀態為 `PROVIDER_BINDING_PENDING`，不是假造 ACK，也沒有啟動付費資源。

## DM-00～DM-04 矩陣

| 案例 | 必要證據 | 無證據狀態 | 通過規則 |
| --- | --- | --- | --- |
| DM-00 Registry | executor、provider、runner、enabled | UNKNOWN／BLOCKED | 只能選已註冊且 enabled 的 executor，初始為 ACK_PENDING |
| DM-01 指派 | task、assignment、executor | UNKNOWN | 指派不等於接案 |
| DM-02 ACK | provider ack、task、executor、ack id | ACK_PENDING／UNKNOWN | ACK 必須 accepted 且和指派完全相符 |
| DM-03 執行 | ACK 加 run id、startedAt、heartbeat | ASSIGNED／STALE | 沒有真正 run 證據不得顯示 RUNNING |
| DM-04 配額 | provider quota／token 結果 | BLOCKED | 耗盡時阻擋，不重試製造假 run |
| 改派 | immutable history、new assignment id | 保留原紀錄 | 相同 task+executor 去重，不覆寫舊 executor |
| 追溯 | PR、SHA、CI run | incomplete | 缺任一欄位即不可宣稱完成 |

## 證據語義

`ACK_PENDING` 表示已建立候選指派但尚未收到 Provider ACK；`ASSIGNED` 表示收到與 task／executor 完全相符的 ACK，但沒有 run 證據；`RUNNING` 必須同時有 ACK、run ID、開始時間及未過期 heartbeat；`BLOCKED` 表示明確的 quota／token／disabled 結果；`STALE` 表示 run heartbeat 超過期限；`UNKNOWN` 表示欄位缺失或不一致。

測試使用 `tools/ai-dispatch-evidence.mjs`，只分類已提供的證據，不呼叫 Provider、GitHub API、Supabase 或任何寫入路徑。它是 CO-03 的獨立 QA fixture，不取代 CO-02 Backend／Provider API 或 GEM-01 UI。

## 執行結果

`node --test tests/co03-dispatch-evidence.test.js`：預期 8/8 PASS。這些案例覆蓋 Registry、ACK_PENDING、UNKNOWN、真正 ACK、RUNNING、BLOCKED、改派去重、STALE，以及 PR／SHA／CI 追溯完整性。

目前結論：`CO-03｜QA_READY／PROVIDER_BINDING_PENDING`。可交 CO-01 整合 Gate 與 CTO 審查；正式發布／PM 審測仍需受控 Provider ACK、Run 證據和既有 CI／PR 證據。
