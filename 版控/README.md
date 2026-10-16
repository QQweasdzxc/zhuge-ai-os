# Zhuge AI OS｜版控與備份（固定入口）

> **最高級別 P0：「沒有真正上傳與驗證，就不算交付。」**
>
> 本資料夾是給 PM 一眼找到 GitHub 程式版本、完整 ZIP 備份、開發紀錄及回復方法的**固定索引**。GitHub Commit/PR 仍是程式碼唯一權威；`docs/10_GOVERNANCE/RELEASE.md` 和 `tools/release-governance.js` 仍是唯一正式版本／打包規則。此處不得另做一套版控引擎。

## 每次 Co 的必交品

1. **開發中檢查點**：每完成一段重要修改就 Commit→Push 原 Review 分支→透過 GitHub 讀回完整 SHA/檔案→在交接文件與 Issue 留進度。只有本機 commit、聊天回報、雲端工作樹，不算保存成功。若遠端無法寫入，停止再累積大量未交付修改。
2. **正式版本交付**：Version/Build、完整遠端 Git SHA、PR 與 CI 證據、功能異動、測試結果、是否部署／是否 PM 驗收，**以及從已提交且驗證來源打包的 FullSource ZIP、manifest 與 sha256**。版本不一致或來源/ZIP 不吻合即不得宣稱完成。
3. **永久封存**：ZIP/manifest/sha256 優先附在同 GitHub Repository 對應的 GitHub Release，並將**可讀回的永久連結**填入下方版本紀錄。不要把每份巨大 ZIP 直接塞進 Git Source 歷史，也不以會過期的 Actions 暫存附件作唯一備份。公開 repo 不得發佈私密任務內容、密鑰、Token/.env/個資。
4. **不中斷交接**：在 `docs/00_CURRENT/TASKFLOW_AI_ENGINEERING_STATUS.md` 維護最新狀態，在 Issue #51 保留歷程，清楚區分「只在本地、GitHub 已保存、CI 通過、正式站已部署、PM 已驗收」。保留過往版本，不覆蓋歷史紀錄。

**優先級**：P0，不得以趕工為理由取消保存／驗證。產出 ZIP 並且 GitHub Release 可真正取回之前，請明確標示 **完整備份未完成**，不要宣稱已備份。

## 目前程式與版控現況

| 身分 | GitHub 來源 | CI／部署狀態 | FullSource ZIP 封存 |
| --- | --- | --- | --- |
| 正式 main（本索引建檔時 .9.59） | [main 固定歷史 SHA](https://github.com/QQweasdzxc/zhuge-ai-os/commit/e053cba43327083649641bd29cfb363ab1e42e80) | 目前原 TF Render 服務版本仍需另行核對，不能直接等同 .9.59 | 本索引**尚未驗證**對應 ZIP/Release 附件 |
| TF AI 工程整合 .9.62 | [PR #60 原始受測 SHA](https://github.com/QQweasdzxc/zhuge-ai-os/commit/997cc34e9fb993662183b801ae8ff067efe69dd1) | 原 SHA 的 CI PASS，但 PR 仍 Draft、未正式部署 | **未確認**永久 ZIP/Release；不能將舊 CI 套用新 SHA |
| Co 回報 .9.63／.9.64／.9.65 的本地修改 | 無對應已讀回的遠端 Source SHA | **未交付，不是可復原的 GitHub 版本** | **未交付** |

> 注意：本索引所在 Review 分支可能已因文件提交產生新的 SHA。它是**文件檢查點**，還不是新 Formal Build／完整 QA／正式程式交付。Co 必須依當前 GitHub HEAD 重新同步正式版本識別、執行檢查並打包，不得以舊的 .9.62 CI 冒充新 commit 通過。

## 尋找開發進度、備份與回復

- [最新開發交接文件（同一 Review 分支）](../docs/00_CURRENT/TASKFLOW_AI_ENGINEERING_STATUS.md)
- [Issue #51：PM 最新決定與交接歷史](https://github.com/QQweasdzxc/zhuge-ai-os/issues/51)
- [PR #60：TaskFlow AI 工程整合原本程式及測試歷史](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60)
- [專案既有的正式版本／FullSource ZIP 打包規則](../docs/10_GOVERNANCE/RELEASE.md)
- [GitHub Releases（正式長期備份附件入口）](https://github.com/QQweasdzxc/zhuge-ai-os/releases)

**回復原則：** 找到指定版本與其完整 SHA，確認其 Release ZIP、manifest、sha256 可下載且內容相符後，再依既有正式 Release/DB/PM 權限流程進行回復；**絕不直接 force-push、清空 Production、覆寫其他工作或繞過權限**。

下一個工作：Co 先讓最新「最小補缺」程式與正式 Version/Build **成功上傳 GitHub**，再在此補齊最新版 ZIP/manifest/sha256 和實際發布／驗收連結，始可列「備份完成」。
