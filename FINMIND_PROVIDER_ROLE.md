# FinMind Provider Role

結論：**NOT_CONNECTED**。FinMind 是 Aggregation / Fallback / Gap Filler，不是 TWSE / TPEx / MOPS / TDCC / TAIFEX 的替代 Authority。本輪未讀取 Token、未登入、未付費、未呼叫 API，也未使用 simulation。

## 取得與方案邊界

查證日2026-10-01；以[官方方案頁](https://finmind.github.io/Pricing/)所列呼叫額度與權限為準，供未來選用評估，非採購建議。

| 方案 | 當時價格 TWD / 月；年 | 呼叫上限 / 小時 | 商用 |
| --- | --- | --- | --- |
| Free | 0 | 匿名300；註冊600 | 否 |
| Backer | 699；5,499 | 1,600 | 否 |
| Sponsor | 999；8,888 | 6,000 | 否 |
| Sponsor Pro | 3,330；29,620 | 20,000 | 依方案允許 |

官方區分 dataset entitlement：最新股價/財報/營收等與還原價、持股級距、即時資料不一定同一方案。註冊與 Token 才能使用相應身份額度；不能把「註冊免費」解讀為所有 dataset 或商業用途免費。實際資料集權限須當次核對；不以舊教學額度覆蓋最新方案。

官方限制原始資料再散布/鏡像，直接把即時資料放到對外 web/App 也不是一般方案授權。本 Lab 沒有商業 Cloud 啟用。對外產品另核原機關授權，不能因 FinMind 整理了資料就假設其可代授權。[免責聲明與資料授權](https://finmind.github.io/Disclaimer/)

## 未來接入 contract（尚未施工）

Token 只在本機受控 env 或 server-side；不能放 Source、pane、URL screenshot 或 evidence。HTTP429保留錯誤、backoff；cache/coalescing按資料頻率；quota未知不高頻poll，不為過QA購買方案。

Evidence 應同時保留 `provider=FinMind`、實際endpoint、FinMind fetchedAt、原資料機關、資料期間、授權及 fallbackReason。FinMind回200不等於官方來源即時、完整或 point-in-time。若官方失敗而改FinMind，UI須顯示fallback，不能改寫成 TWSE / TDCC Provider。

## 本輪可評估用途

| 缺口 | 評估價值 | 本輪處置 |
| --- | --- | --- |
| TPEx history / revenue history | 統一歷史查詢 | 官方surface先做proof；保持NOT_CONNECTED |
| 年度財報 / institutions / margin | 降低欄位整理工時 | 官方來源優先，不以aggregation覆蓋口徑 |
| ETF constituent / TDCC | dataset方案與原始授權需核對 | 不假設免費或完整 |
| Oil / Copper | 非必要fallback | 本輪已選World Bank官方CC BY月資料，沒有再接第二份 |

FinMind程式庫的source license與其資料服務使用條款是兩個問題。將來導入服務仍需PM決定使用情境、credential與授權，不是本輪默認啟用。
