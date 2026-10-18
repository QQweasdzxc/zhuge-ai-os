# Zhuge AI OS｜Multi-Agent 獨立審查派工佇列 v1

**資料來源／真相鏈：** PM 指令 → GitHub 原始 Issues/Comments → 真實 ACK/Session/CI → Co整合 → PM驗收。此登記只是 **Handoff 協作層**，不是 TaskFlow 真實 Provider 派工 API，也不替代 GitHub 的工作證據。

正式 main P2 `0.9.0-alpha.9.76` 不變；P3 [PR #64](https://github.com/QQweasdzxc/zhuge-ai-os/pull/64)／[PR #65](https://github.com/QQweasdzxc/zhuge-ai-os/pull/65) 均保持 Draft，不合併。

## 已建立的三項獨立派工

| Issue | 預定工作者 | AI Worker 真實 ACK | 已完成的 GPT 首輪審查 | 待完成 |
| --- | --- | --- | --- | --- |
| [#66 四版型 QA](https://github.com/QQweasdzxc/zhuge-ai-os/issues/66) | QJC/UX 審查 | **無** | [QA 證據與尺寸實查](https://github.com/QQweasdzxc/zhuge-ai-os/issues/66#issuecomment-6256441343) | 真 iPhone Safari / PM 美術驗收 |
| [#67 PR 路線整併](https://github.com/QQweasdzxc/zhuge-ai-os/issues/67) | Architecture Reviewer | **無** | [逐功能整併矩陣](https://github.com/QQweasdzxc/zhuge-ai-os/issues/67#issuecomment-6256441676) | Co 選定原生 Scene Authority |
| [#68 真實狀態、金幣、隱私](https://github.com/QQweasdzxc/zhuge-ai-os/issues/68) | Security/Data QA | **無** | [原始碼風險矩陣](https://github.com/QQweasdzxc/zhuge-ai-os/issues/68#issuecomment-6256442073) | 來源驗證與虛擬資產定義 |

**不可誤報：** GPT 首輪審查的 Issue Comment 不等於 QJC/Gem/Codex 或其他 Agent 自行接單。三張 Issue 當前無受指派 GitHub 帳號；`agentAcknowledged=false`，`agentStarted=false`。目前可用工具沒有直接建立三個獨立 AI Worker Session 的安全派工接口。TaskFlow Gate1 未完整通過，禁止以其他途徑繞過。

## 對 Co / Gem 的交接

Co 繼續處理七位角色 + A/B + 狀態來源 P3 主線；Gem 處理前端與四版型。上述 Issues 為**獨立、唯讀的 QA/架構/資料安全審查**，不得要求重新開發 Co 正在做的部分。Co 可以直接引用 #67 的 KEEP / REWRITE / DROP 決策、#68 安全 Gate、#66 QA 未完成清單來規劃下一階段，不等同新增任務召喚。

本註冊不改正式 Source、不觸 Render、DB、GitHub App/Secret、不開付費服務。機器可讀的佇列請見 [AGENT_TASK_QUEUE.json](./AGENT_TASK_QUEUE.json)；每次更新需證據和 GitHub 讀回。
