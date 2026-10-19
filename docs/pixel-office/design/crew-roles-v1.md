# Zhuge AI OS｜P2 核心人物外觀與 HUD 設計契約 v1.1

- 關聯 Issue：[ #76／P2-H02 ](https://github.com/QQweasdzxc/zhuge-ai-os/issues/76)
- 設計來源：Gem 第二工程師提交予 PM／CTO 的 v1.1 全文，經 CTO 修正與 Co PR #82 的身份契約差異後代為登錄
- 協作：Co [#70](https://github.com/QQweasdzxc/zhuge-ai-os/issues/70)／[Draft PR #82](https://github.com/QQweasdzxc/zhuge-ai-os/pull/82) 持有 Native role authority；CTO 審查；PM Jackal 最終驗收
- 正式基準：`main` 0.9.0-alpha.9.76，SHA `a9db9b2fe3051e22d59e52ad083c8d54d12dba62`
- Co 參照候選：Draft PR #82 HEAD `6136841e9a3f1e51b0cfc18b0a2dd87b15f31c6d`，**未合併，可能變動**
- 狀態：**DESIGN_PROPOSAL / ASSET_PENDING / NO_DEPLOY**。

---

## 1. 四位核心技術角色：沿用 Co 的 Native ID

> **身份一致性修正**：Gem 原 v1.1 誤稱 `jackal/gpt/codex/gemini` 已對齊 Co PR #82。實際 #82 的 `ZHUGE_CAST` stable ID 是 `zhuge-crew-pm`、`zhuge-crew-gpt`、`zhuge-crew-codex`、`zhuge-crew-gem`。本文件以後者為候選 runtime Authority；前者只可當作人類可讀代號，不得成為第二套 Agent ID。正式 ID 隨 Co/CTO 對 #82 的最終審查確定。

| Native stable ID（PR #82 候選） | 顯示名稱 | 角色 | 職責／資料邊界 | 提案色票 |
| --- | --- | --- | --- | --- |
| `zhuge-crew-pm` | Jackal | PM | 產品負責人、裁示、最終驗收與 Release 決策；人物位置非真人位置證據 | 暖琥珀 `#f59e0b` |
| `zhuge-crew-gpt` | GPT | CTO | 需求規劃、架構、統整、審查／交接；固定像素人物非背景任務或 Provider Session | 科技藍 `#3b82f6` |
| `zhuge-crew-codex` | Codex（Co） | 首席工程師 | 開發、GitHub 整合、Developer QA；固定人物不證明 Cloud Run 存在 | 翡翠綠 `#10b981` |
| `zhuge-crew-gem` | Gemini（Gem） | 第二工程師 | 獨立工程、前端美術、UI／設計契約與 QA；固定人物不證明 Gemini Provider 已連線 | 紫水晶 `#8b5cf6` |

家庭角色「背地裡、安安、卡卡」與黑灰色小貓由 #78 處理；六名 GitHub Helper 屬**臨時角色**，必須由可信 Agent ACK／Run 驗證後才進入辦公室，結案移出。不可用 PR／Issue 模擬正在工作的人。

## 2. 視覺提案與可獨立素材（`ASSET_PENDING`）

**全部是美術提案而非既有 Habblaud Sprite 規格，也不是 PM 已批准服裝。** 須先查上游可接受的人物 Look、材質、frame、視角與授權條件，再決定能否落地。

- **Jackal**：短髮、休閒西裝、金框名牌；可以有咖啡杯待機動作。
- **GPT**：深藍毛衣、細框眼鏡、電子審查夾板。
- **Codex**：黑色工程連帽衫，帶綠色終端標誌及耳機。
- **Gemini**：紫藍夾克，搭配調色盤／放大鏡。
- 色票、16-bit 類型、人物比例、光源與動畫影格數均先列作 `OPTIONAL_ART_PROPOSAL`，不能替換原生視覺風格。

### 2.1 視覺動畫與真實任務完全分開

| 視覺行為 | 意義 | 可否作為真實工作證據 |
| --- | --- | --- |
| `IDLE` | 日常站姿、放空 | 不可 |
| `WALK` | 依合法通道自由漫遊 | 不可 |
| `SIT_AMBIENT` | 坐在工位、模擬打字／整理資料的生活動畫 | 不可 |
| `SIT_LOUNGE` | Lounge 休息、聊天、咖啡 | 不可 |
| `TASK_WORK`（候選） | 可信任務事件驅動的工作呈現 | **必須**由 Co #74 接入可信 Run／Provider 事件後才可用 |

固定人物可自由漫遊，但不因此推論實際工作狀態。無合法路徑不可穿牆、穿家具。

## 3. 原生 HUD Inspector 合約提案（非生產程式）

既有點擊功能由 Co `showZhugeRole`／Native `OfficeSnapshot` 管理。以下為**展示層可選 Inspector schema 草案**，不能寫入第二套 Runtime／Identity Authority；須與 Co PR #82、CTO #80 的真正工作事件契約對齊。

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "AgentInspectorDataContract_v1_1_PROPOSAL",
  "type": "object",
  "additionalProperties": false,
  "required": ["agentId", "displayName", "roleTitle", "visualActivity", "liveWorkStatus"],
  "properties": {
    "agentId": {
      "type": "string",
      "enum": [
        "zhuge-crew-pm",
        "zhuge-crew-gpt",
        "zhuge-crew-codex",
        "zhuge-crew-gem"
      ],
      "description": "唯一 Native stable ID；源自 Co PR #82 的 ZHUGE_CAST 候選"
    },
    "displayName": { "type": "string" },
    "roleTitle": { "type": "string" },
    "visualActivity": {
      "type": "string",
      "description": "純場景動畫文案，例如：[氛圍動態] 在座位喝咖啡"
    },
    "liveWorkStatus": {
      "type": "object",
      "additionalProperties": false,
      "required": ["state", "evidenceSource", "lastUpdated"],
      "properties": {
        "state": {
          "type": "string",
          "enum": ["UNKNOWN", "IDLE_STANDBY", "RUNNING_TASK", "STALE"],
          "description": "未知不等於待命；真實工作必須有可驗證 Provider/Run 事件"
        },
        "activeTaskTitle": { "type": ["string", "null"] },
        "evidenceSource": {
          "type": ["string", "null"],
          "description": "可信 runtime event / session / run provenance；GitHub Issue/PR 本身不可單獨證明執行中"
        },
        "lastUpdated": {
          "type": ["string", "null"],
          "format": "date-time",
          "description": "UNKNOWN 且無權威事件時允許 null；有事件時須提供權威時間"
        }
      }
    }
  }
}
```

### 3.1 真偽與證據規則

1. **無事件、無權威讀取或授權失敗 ⇒ `UNKNOWN`**，不能自動當成 `IDLE_STANDBY`。
2. **只有權威來源明確提供近期 idle ⇒ `IDLE_STANDBY`**；資料超過 TTL 或斷線後應按契約轉為 `STALE`／`UNKNOWN`。
3. **`RUNNING_TASK` 須有可信且新鮮的 Actor/Task/Run/Provider ACK、event ID、時間與來源綁定**，不得從「坐在電腦前」、PR 存在、Issue 指派或靜態 `project-status.json` 推測。
4. **`evidenceSource=null`、`lastUpdated=null`** 是無證據時的合法狀態；等 CTO #80 schema 定稿後，Co #74 實作更嚴格的狀態交叉約束與來源時效檢查。
5. **Jackal 是真人 PM**，固定人物的動作不能用來推論 PM 的真實位置或工作。
6. 現有 Native Habblaud 的 `AgentInfo.status='idle'` 可是純場景預設；不得因為這個展示狀態就對外宣稱已證實 Provider `IDLE_STANDBY`。

## 4. 交接、驗收與剩餘阻塞

- **Gem**：交付角色造型、概念動畫、HUD Schema 文件；人物 Sprite 尚未完成，應維持 `ASSET_PENDING`。
- **Co #70／PR #82**：統一 Native role ID 與 `ZHUGE_CAST`、保留現有點擊選取與 HUD；Gem 不碰核心 adapter。
- **Co #74／#75**：有可信 Provider 來源且 Gate PASS 後才將真正工作與臨時 Helper 動畫接線，不能偽造子助手。
- **CTO #80**：審核權威事件契約、`UNKNOWN/STALE/IDLE/RUNNING` 的轉換規則及安全界線。
- **CTO／PM**：Draft 文檔審查 ≠ 已交付 Sprite、已可操作、CI PASS 或 PM 最終驗收。

### 尚待證據

- `ASSET_PENDING`：人物 Spritesheet、表情、動作及原生尺寸尚未製作／驗證。
- `AUTHORITY_PENDING`：Co #82 仍是 Draft 候選；Provider 事件與 #80 權威資料契約尚未閉環。
- `NO_DEPLOY`：本文件不是發版成果；主線 Production 維持 .9.76，舊 P3 #64/#65/#69 HOLD。
