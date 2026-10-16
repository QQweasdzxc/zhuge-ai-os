# TaskFlow AI 工程執行｜Cloud Dispatch v1 — 工程 Authority 與上線 Gate

## PM 核定的使用體驗
- **唯一產品網站：** https://zhuge-taskflow-web.onrender.com 。不設第二個網站、不要求使用者前往其他入口。任何工程 CI 與原始碼分支都不是另一個產品環境。
- TaskFlow 原生 Issue 是任務、權限、Project、真人負責人的 SSOT。Co 首席、Gem 第二工程師，先手動安全派工及交接，再談額度自動分流。
- 當前正式版本 .9.54 已顯示 AI 工程執行面板，**只提供介面**，選擇/勾選未持久化，**派工按鈕已鎖定**，Co/Gem 均未從此面板啟動。

## 本次 Source 增量
從既有 Draft PR #52 分離移入 `labs/cloud-handoff`：
- 身分綁定 TaskFlow workspace / project / issue UUID / issue revision；讀取原生 TaskFlow 已授權的 API，不直接修改正式 taskflow DB。
- GitHub code branch 的 exact SHA、單一 Writer CAS 與可驗證 stop receipt；舊工程師額度用盡、存在未提交檔時阻擋換人。
- `@codex` 官方 GitHub PR comment 發送器**預設關閉**，僅有經驗證 PM 一次性任務授權及服務端憑證才有可能開啟。201 comment 只能認列「等待 provider ACK」，絕不宣稱 RUNNING。
- Codex 官方 bot GitHub 回報只能成為帶 nonce/SHA 的觀察證據，尚非 TaskFlow Run 權威；只有經認證的實際 TaskFlow Run + Provider status 才能顯示 RUNNING。
- 單元／協定驗證全部使用替身回應；不發送任何真人任務、不修改正式資料、不執行付費 API。

## 真正開啟派工前缺少的權限與技術
1. **TaskFlow 正式服務身分**：需伺服器端、可稽核、專案／成員身分最小權限的 native API 與 PM 核准，不能使用瀏覽器寫入假資料。
2. **原生 Run/Dispatch Authority**：後端持久 Run ID、idempotency、lease / CAS、stop receipts、TASK/Issue cross-reference；不得用 UI 的 preview map 或 GitHub PR comment 取代。
3. **GitHub App/Co 執行身分**：僅服務端安全憑證，官方 API/受允許的運行方式，須確實確認 bot 回覆與 Cloud task 的一對一關係。
4. **Gem 身分和成本**：由 PM 明確同意授權與成本上限後再建置；不得共用 Co Token 或暗中建立新的付費服務。
5. **正式安全驗收與明確 Production GO**：先完成授權、stop/resume、競態、回報與故障測試，才允許從正式網站按下真實派工；當前任何程式碼新增均不是自動發布授權。

## 對目前使用者畫面的唯一正確陳述
當前不存在已驗證的 cloud runner/TaskFlow Run，就顯示「尚未啟用／待接通」；不得把 PR、GitHub comment、mock CI 或本地暫時勾選推論為 Co 已接單。正式 ZG-6 任務不得作為未經單獨核准的真實 Co 任務測試目標。

## 可重跑工程證據
```
node --test tests/cloud-handoff-*.test.mjs
node labs/cloud-handoff/cli.mjs validate labs/cloud-handoff/examples/issue45-quota-blocked.json
node labs/cloud-handoff/cli.mjs gate labs/cloud-handoff/examples/issue45-quota-blocked.json
```
全部失敗即停止交付，不產生 provider 請求。
