# Zhuge AI OS｜像素辦公室官方首頁｜PR #61 發布計畫

**PM 決議：2026-10-18 指定 Habblaud Pixel Office 為官方根首頁。** 本文件屬 PR #61 Review／發版驗收計畫，不是正式部署證明。

## 正式版本與來源
- P0 唯一來源：[PR #61](https://github.com/QQweasdzxc/zhuge-ai-os/pull/61)，原版 Habblaud MIT pinned commit `faa1a012b5fbf632c66dc6801c5383e53a542406`。
- Review 新版本：`0.9.0-alpha.9.74`；正式 Build 由 `release-governance.js new-build-id` 按 Asia/Taipei 即時生成、`sync-build` 全模組同步後提交。
- Product main 仍以正式運行版本為權威。**PR #60 Co TaskFlow DB/派工未包含在此首頁發布。** 不改 frozen vendor，不做 Migration、不開啟 GitHub App/Provider 新權限。

## 發布順序（依條件，不臆造固定時段）
| 階段 | 負責 | 放行條件 | 狀態 |
| --- | --- | --- | --- |
| R1 正式 Version/Build Source | GPT-CTO | 遠端 Git SHA、正式 preflight、無違反 Published C 身分 | PENDING |
| R2 QA / 桌機及行動版 | GPT-CTO／Gem | Habblaud Canvas、JSON 15s、點擊阻塞抽屜、語系、經典 TaskFlow、OAuth 回跳、手機 390px 等測試 PASS | PENDING |
| R3 封裝 / 私人備份 | GPT-CTO | 正規 `release-governance.js package` ZIP、Manifest、SHA256 與最新 SHA 一致，三件組存入 **PM 私人 Google Drive** 並讀回校驗 | PENDING |
| R4 來源/安全最終審查 | GPT-CTO／Co | `main` 未被另人改動、Pages 工作流程確實能將已編譯 Habblaud 場景和相對資產放進正式 Artifact；無機密及授權問題 | PENDING |
| R5 官方上線 | PM 簽定 exact-SHA → 受控 main Merge/Push | R1–R4 PASS 後方可推送正式 main，GitHub Pages 自動發布，取得實際部署 SHA | HOLD |
| R6 實機驗收 | PM／GPT／Gem | iPhone Safari 實際首次開啟，桌機 Chrome、Pixel HUD、經典報表入口、返回 TF、功能回復 | NOT_STARTED |

**時程規則：** R1→R4 連續完成時提出同一 SHA 的放行案；R5 正式變更需 exact-SHA 安全門檻，R6 由 PM 在真正網站上驗收，不保證未確定日期，也不能把 Review CI 當作已部署。

## 不可混淆的事實
- `project-status.json` 是**已標記時間的靜態快照**。超過 5 分鐘標示 stale；靜態房間動作不代表 Codex/Gem 真正在工作。真正 CLI Server SSE 需要另作同源實機 E2E。
- 舊 TaskFlow Dashboard 已保留 `status-classic.html`／`docs/status-classic.html`；OAuth `?code`／`?error` 與 `?app=1` 導向功能須單獨驗收。
- 全站繁體中文化尚未完整；主要 HUD zh-TW 已具備，不可誤稱 100%。
- `ops/handoff` 為每日記錄，不替代正式 PM 授權、GitHub 源碼或 QA。
- 公開 CI Artifact 不可保存私人 FullSource；不以 14 日/30 日暫存 Artifact 冒稱已完成永久備份。

## 發布失敗立即處置
1. 停止推送、開關及任何二次部署；保留舊版 Pages 認證/回復入口可用。
2. 若像素首頁失敗，須保留 `status-classic.html` 與 `labs/taskflow/` 不受影響。調查 JS/CSS、JSON 和 OAuth 錯誤，將結果回報 PR #61／Issue #51。
3. 若 GitHub Pages 對外已切換且不能原站修復，依 PM 授權建立**新的**修復 Version/Build、驗證及封裝後回復。不得未授權 force-push 或直接回推舊 Source 而重用舊版號。

**定義：只有 R1–R4 PASS 才具備上線資格；只有 R5 真實讀回才能標 DEPLOYED；只有 R6 完成才能標 PM ACCEPTED。**
