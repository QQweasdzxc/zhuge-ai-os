# Pixel Office 家庭生活角色契約 v1

## 範圍

本契約定義辦公室中的三位家庭生活角色與一隻黑灰色小貓。角色由 Habblaud 原生 `AgentInfo`、Sim、WalkGrid 與 Renderer 顯示；本契約不建立第二套場景或移動引擎。

| ID | 顯示名稱 | 類型 | 展示定位 |
| --- | --- | --- | --- |
| `zhuge-family-beidili` | 背地裡 | `family` | 固定家庭生活角色，明亮長髮與粉色上衣 |
| `zhuge-family-anan` | 安安 | `family` | 陽光、活潑、愛打扮，馬尾與黃色上衣 |
| `zhuge-family-kaka` | 卡卡 | `family` | 活潑、調皮、喜歡跑步，雙馬尾與綠色上衣 |
| `zhuge-pet-blackgray-cat` | 黑灰色小貓 | `pet` | 黑灰像素貓，使用原生 Sprite 合約繪製 |

## 身分與資料邊界

- `zhugeResident` 只接受 `family` 或 `pet`，與 AI Provider、TaskFlow Run、GitHub 事件分離。
- 四個角色的 `provider` 未設定、`status` 固定為原生 `idle`、工作清單為空；生活活動文字明確標示為非工程工作狀態。
- `account` 使用 `zhuge-family-cast`，不代表真人帳號，也不保存家庭成員個資、位置或活動追蹤資料。
- 角色名稱、外觀、種子與角色介紹是產品展示資料，不可推論真人資訊。

## 移動與渲染

- 角色交給原生 Habblaud `Sim` 建立，沿用同一份 WalkGrid、家具碰撞、門洞與座位規則。
- Idle 漫遊只能在合法路徑上進行；找不到路徑時角色留在原地，禁止瞬移到不可達格。
- 家庭角色沿用原生角色 Sprite；小貓只替換外觀 Sprite，動畫時序、方向、深度、碰撞和活動仍由原生 Renderer/Sim 管理。
- `zhugeResident` 不會改變原生狀態機，也不會把靜態事件渲染成 AI 工作狀態。

## 驗收與限制

- 必須在桌機、手機直式／橫式與平板尺寸確認四個角色可見、可選取且不穿牆或家具。
- 日夜與房間切換沿用原生 Habblaud；角色資料不因畫面尺寸或時間切換而改寫。
- 真實家庭資料、AI 派工、Provider ACK 與人員位置追蹤不在本功能範圍；沒有可信事件時，畫面只能呈現非工程生活角色。
