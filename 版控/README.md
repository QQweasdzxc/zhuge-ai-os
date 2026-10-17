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

## 2026-10-17 PR #60 遠端檢查點（append-only）

| Candidate | 遠端 Source | Build / 驗證 | 永久 FullSource 備份 |
| --- | --- | --- | --- |
| `.9.66` | [324466aa1585af9b1ba9fce1143b9a87b2e7699c](https://github.com/QQweasdzxc/zhuge-ai-os/commit/324466aa1585af9b1ba9fce1143b9a87b2e7699c) | `20261017-0634`；Build Parity Run [38976633305](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38976633305) 後端鏡像測試失敗（repo-relative fixture path），Browser Run [38976637087](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38976637087) PASS | 未上傳 |
| `.9.67` | [82690b9d1a4d11d6d050150d3c527648a8c4606a](https://github.com/QQweasdzxc/zhuge-ai-os/commit/82690b9d1a4d11d6d050150d3c527648a8c4606a) | `20261017-0637`；Backend、隔離 PostgreSQL、Overlay PASS；Web Vitest fixture 預期錯誤；Browser Run [38976971720](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38976971720) PASS | 未上傳 |
| `.9.67` 測試修正檢查點 | [fb22f0def6261b54c2acdb151fb6063ec5d0e731](https://github.com/QQweasdzxc/zhuge-ai-os/commit/fb22f0def6261b54c2acdb151fb6063ec5d0e731) | 只修正 Vitest fixture/assertion，不改應用程式行為；新 SHA CI 待核對 | 未上傳 |
| `.9.68` | 設定持久化測試修正後的 Review Candidate；納入唯一版本／Build 識別，不改派工/執行行為 | Build `20261017-0640`；commit/push 後待精確 SHA 讀回與 CI | **BACKUP NOT SAVED** |

本階段已恢復既有 GitHub push 與遠端讀回，未讀取或輸出任何 Secret。原 `.9.65` commit `02380c1a3226cdd55541cbdc32a1fb91a31ef0df` 及原留言提及的 patch/bundle 在現有工作環境與遠端引用中不可取得，不能宣稱已恢復；`.9.66` 起是從可讀取的 PR #60 `.9.62` source 增量續作，並非原始 `.9.65` 的逐位復原。

目前候選只完成 TaskFlow AI 設定持久化、核准 Run intent/readback 等既有程式的安全續接；`dispatch_enabled=false`。尚無真正 Codex Cloud ACK/Run ID/result callback、無 Production Migration/deploy，無永久 ZIP/manifest/SHA256 Release asset。完整紀錄見[最新 AI 工程交接文件](../docs/00_CURRENT/TASKFLOW_AI_ENGINEERING_STATUS.md)。


## 2026-10-17 PR #60 Codex Cloud handoff candidate（append-only）

| Candidate | 遠端 Source | Build / QA | 永久 FullSource 備份 |
| --- | --- | --- | --- |
| `.9.69` | [PR #60 最新 Review Head](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60)；基線 `.9.68` `abf1dfb18c568438bb6056f0caef3fdfd647a5e5` | Build `20261017-0732`；本機 Overlay/Build parity 23 PASS、Entry/CLI SSO 18 PASS；精確 Head 的 GitHub Actions / Docker / isolated PostgreSQL / Vitest / Browser 以 PR Checks 讀回為準 | **BACKUP NOT SAVED**；正式 GitHub Release binary 尚未上傳及讀回 |

候選把現有「確認並派工」接到 TaskFlow-owned、預設關閉的 GitHub `@codex` PR comment handoff，並加入簽章驗證的 ACK/RESULT/FAILURE 回寫；目前沒有真實 Codex Cloud Run 證據、沒有 Production Migration/deploy，dispatch gates 保持 OFF。固定交接、來源範圍、風險及測試狀態見[TaskFlow AI 工程狀態](../docs/00_CURRENT/TASKFLOW_AI_ENGINEERING_STATUS.md)；精確遠端 SHA/CI 以 [PR #60](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60) 的最新 Head/Checks 為準。


### PR #60 `.9.69` Gate 結果與 `.9.70` 續版（append-only）

| Candidate | Source / Build | Gate 結果 | FullSource 永久封存 |
| --- | --- | --- | --- |
| `.9.69` | `645be0e041d8b352c058e98ffe2bd5624359babb` / `20261017-0732` | Build Parity Run [38982186025](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982186025)：Overlay/isolated PostgreSQL PASS；Backend unused import FAIL；Web Vitest UI-spacing FAIL。Browser Regression Run [38982189789](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982189789) Chromium Desktop/Mobile PASS | 未上傳；14 天 Browser evidence 不等同 FullSource |
| `.9.70` | [PR #60 latest Review Head](https://github.com/QQweasdzxc/zhuge-ai-os/pull/60) / Build `20261017-0737` | 修正 `.9.69` 兩個實際 Gate 缺陷；本機 targeted PASS，精確 SHA 的 GitHub Build Parity/Browser Regression 待完成 | **BACKUP NOT SAVED** |

正式 Codex Cloud Run 尚未真實驗證，dispatch 預設關閉；沒有 Production Migration/Deploy。固定交接與實際證據見[TaskFlow AI 工程狀態](../docs/00_CURRENT/TASKFLOW_AI_ENGINEERING_STATUS.md)。


### PR #60 `.9.70` CI 結果與 `.9.71` 重驗（append-only）

| Candidate | Source / Build | Gate 結果 | 封存 |
| --- | --- | --- | --- |
| `.9.70` | `74c2a7f7952635655806a2c2b11a23fbe3a773fb` / `20261017-0737` | Build Parity Run [38982532178](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982532178)：Overlay、隔離 PostgreSQL PASS；Backend 因測試檔未使用 `os` import FAIL；Web 當時執行中。Browser Regression [38982535645](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982535645) Desktop/Mobile Chromium PASS | 未完成永久 FullSource 封存 |
| `.9.71` | PR #60 Review head / Build `20261017-0741` | 移除未使用測試 import；新精確 SHA 遠端 Build/Browser Gate 待執行 | **BACKUP NOT SAVED** |

真實 Codex Cloud E2E、Production Migration/deploy 未執行；dispatch gates 維持關閉。固定狀態與後續證據見[TaskFlow AI 工程狀態](../docs/00_CURRENT/TASKFLOW_AI_ENGINEERING_STATUS.md)。


### PR #60 `.9.71` 完整候選 QA 證據（append-only）

| Candidate | SHA / Build | 驗證結果 | FullSource 封存 |
| --- | --- | --- | --- |
| `.9.71` | `128b5ab9eaf2ea7a5b1c50ee1a3ee722aeb2f356` / `20261017-0741` | Build Parity [38982825162](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982825162) 四項 PASS；Browser Regression [38982828979](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982828979) Chromium Desktop/Mobile PASS；root Node 回歸 974/974；TaskFlow Python 47/47；Pages Artifact 2/2 | 尚未永久保存 |

Browser artifact [12082240948](https://github.com/QQweasdzxc/zhuge-ai-os/actions/runs/38982828979/artifacts/12082240948) 僅暫存，digest `e308deb2c2fc851aa7456fb716684f2567dc6eb50a4bc53f7b4d10a19a5179be`，不等同永久 FullSource。程式仍只在 Draft PR #60 Review branch，無真實 Codex Cloud Run、Production Migration 或 Deploy。


### PR #60 `.9.72` 最終 Review 候選

| Candidate | Build | 差異 | 狀態 |
| --- | --- | --- | --- |
| `.9.72` | `20261017-0807` | 僅追加 `.9.71` 已完成 QA 證據並同步唯一 Candidate Version/Build/cache identity；TaskFlow 執行邏輯未變 | 精確 Review SHA 與新 Build/Browser CI 以 PR #60 latest Head/Checks 為準 |

`.9.71` 的根目錄 Node 974/974、TaskFlow Python 47/47、Pages Artifact 2/2、遠端 Build Parity 四 Job 與 Browser Regression 證據見上方及[TaskFlow AI 工程狀態](../docs/00_CURRENT/TASKFLOW_AI_ENGINEERING_STATUS.md)。`.9.72` 永久 FullSource ZIP/Manifest/SHA256 尚未封存。
