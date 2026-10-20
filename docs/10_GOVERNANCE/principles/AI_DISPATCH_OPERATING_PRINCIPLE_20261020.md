# AI 派工管理與單一 Production 發布原則｜2026-10-20

Status: PM APPROVED — governance decision; Source adoption pending formal review/release process
Decision Authority: PM Jackal
Record: [Issue #51 最新 PM 授權](https://github.com/QQweasdzxc/zhuge-ai-os/issues/51#issuecomment-6285091395)
Scope: Zhuge AI OS／原生 TaskFlow／多工程師協作／正式發布

> 此原則自 PM 明確授權時生效。文件合入正式 Source 須遵守 `docs/10_GOVERNANCE/RELEASE.md` 的實質 Source 變更 → 新 Version／Build／CI／FullSource。尚未合併前，以 Issue #51 最新 PM 決議為權責來源；本文件不以待審狀態恢復舊的逐版 PM GO。

## 1. 角色與權責

| 對象 | 唯一職責或能力 |
| --- | --- |
| PM Jackal | 提需求、產品取捨；正式網站**上線後**做最終實機審測；例外 Gate 決策 |
| CTO-01（GPT） | **唯一 AI 工程派工總管**：拆工、指派與改派、真實 ACK／Run 確認、進度接收、審查、整合與上線統籌 |
| CO-01／CO-02／GEM-01／GH-HELPER-* | 同一工程執行層，獨立接單、回報阻礙、交付程式／PR／SHA／CI／Provider 證據，彼此無上下級 |
| 當次發布操作者 | 由 CTO 指定的 CO-01，或有實際工具／權限的 CTO；不得競寫正式 main |

CO-03 如被 PM 指定為額外接案者，**先核實其與 GEM-01 的身分映射與實際可用 Provider**，不擅自視為同一人、不把「接案指令」誤認為真實 ACK。工程接案者和發布操作者是工作角色，不產生新的工程上下級。

## 2. 唯一派工與交付閉環

PM → CTO-01 建立原生 TaskFlow issue、work_code 與驗收條件 → 指派 CO／GEM／GH → Provider 真實 ACK／Run → 工程師回報 PR、SHA、CI、阻擋與下一步 → CTO 驗證及去重整合 → 由指定操作者受控正式發布 → PM 在 Production 審測 → 問題回 CTO 記錄後修正。

- GitHub issue／comment、PR、TaskFlow issue ID、rerun HTTP 202 都**不等於**官方 Provider 真實 ACK。未驗證須顯示 UNKNOWN／STALE／ACK_PENDING，不能冒充 RUNNING。
- Token／Quota 耗盡、失聯、超時或能力不足時，CTO 可自主改派，保留來源、舊 Run 與避免重複工作的憑證，無須 PM 逐件准許。
- 發佈前仍須核對 exact SHA、Version／Build、CI、安全邊界、FullSource／可回復證據；禁止以 Mock 狀態冒充實際成功。
- 交接／回報由 CTO 作唯一整合窗口，工程師只更新自己任務的真實進度；不得因其中一人回報就向全隊重發派工。

## 3. 單一正式環境與自主發布

- Zhuge AI OS **只有一個 Production**；不建立新 Staging／Test Site／第二 Production，PR 分支與 CI 僅作工程檢查。
- CTO 驗證發布 Gate 後，可安排自己（具備工具和權限時）或 CO-01 合併／部署，不需每版再次請 PM 核准 exact SHA。此前逐版 PM GO 要求由 PM 新決議取代。
- **PM 的功能審測發生在 Production 正式發布之後**。有 Bug → CTO 登記 → 派工修正 → 新版本直接受控部署。
- 必須向 PM 額外申請者**僅**：新增付費／paid Provider 成本、重大權限或 Secrets／正式 DB ACL 變更、不可逆資料操作。此等事項不可因日常部署自主權被略過。
- 無真實 Session、沒有部署成功／runtime readback，就如實寫 PENDING／BLOCKED，不以文字宣稱已完成。

## 4. P0 開發順序與溝通

P0：**AI 派工管理核心**。復用既有原生 TaskFlow；CO-02 DM-00～DM-03 核心及 GEM-01 DM-04 工作台須契約對齊、CI 完成、由 CTO 收斂至一個可用的正式入口。其他非必要主線 HOLD，既有候選不重作。

- PM 請 CTO「提供指令」時：各接案工程師**一人一份、可獨立複製**；未要求指令時不主動產出，需先詢問。
- 實際工具寫入、派送、合併與部署要有真實行為證據；原則文本不代表 Provider 已接案。
- `ops/handoff` 只保存公開、經來源核對的交接投影，不是產品正式 Source／資料庫／任務執行權威。

## 5. 證據及衝突處理

- PM 授權 SSOT：[Issue #51 決議](https://github.com/QQweasdzxc/zhuge-ai-os/issues/51#issuecomment-6285091395)。
- Source：遠端 GitHub main／精確 PR head；CI：相同 SHA workflow；Runtime：正式 Pages 與 Render 自己的部署 commit／功能證據。
- 新原則取代舊 Handoff 逐版 PM GO、Co 高於 Gem 的層級寫法，**不**取代現有私密資料保護、Formal Build、可逆安全防護和付款／重大權限例外 Gate。
