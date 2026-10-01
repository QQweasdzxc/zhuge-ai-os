# 台灣研究 Workbench 使用方式

## PM 啟動

在 macOS Terminal 執行：

```bash
cd "/Users/qq/Documents/Zhuge Investment Intelligence Lab"
.bun/bin/bun tools/run-lab.ts
```

預設進入 2330.TW 的研究窗。只使用 Lab profile，無須 Gloom Cloud、FinMind 或券商帳號。需要網路取得官方公開資料；斷線時顯示缺漏，不播放測試 fixture。

按 `Ctrl+P` 開啟 Gloomberb 原有 command bar，輸入後按 Enter：

```text
TW 2330.TW
TW 0050.TW
TW 6488.TWO
```

`TW 2330` / `TW 0050` / `TW 6488` 會轉成上述 canonical symbol。其他標的 fail closed，不自動擴展本輪研究 universe。每個窗固定綁定自己的 symbol；換標的時不把前一檔的資料顯示成新一檔。

## 日常閱讀順序

| 分頁 | 回答什麼 | 限制 |
| --- | --- | --- |
| 總覽 | 最新收盤、漲跌、成交量、公司/ETF、最新營運摘要 | 不是盤中即時；必看資料日期 |
| 日行情 | TWSE 原始日 OHLCV | 三個日曆月查詢；未還原除權息/分割；6488 尚未接歷史 |
| 營運 | 月營收 MoM/YoY、最新財報、資產負債 | 損益為年初至本季累計，**不是單季**；金額千元、EPS 元 |
| 籌碼 | TDCC 股權分散 | 是持股級距，不是法人名單；第16/17級不能當大戶相加 |
| 產業 | 固定5組 Radar、來源/授權、證據支持程度 | Oil/Copper 為月均價；其餘待審；沒有公司曝險證據不下結論 |
| 衍生 | TX 一般盤、TXO 活躍合約 | 是市場背景，不是此股票期權；IV/Delta/價差/PCR 仍缺 |
| 來源與缺口 | 每個區塊的來源、資料/讀取時間、錯誤與未接能力 | FinMind/Yahoo 不冒充官方 |

點分頁或用原有 `← / →`（`h / l`）切換；滾輪/捲動閱讀長內容。聚焦窗後 `r` 重新讀取，沿用原 footer action，沒有新增第二套 toolbar。TW command 延續上游開窗行為，可能開啟浮動研究窗；可用原本窗控制收合/關閉，不另造視窗管理。

## 狀態閱讀

`PASS`：該區塊已取得可用、帶日期的資料；**不是標的好壞或 PM acceptance**。`PARTIAL`：有部分資料，但欄位或 coverage 不完整。`NOT_CONNECTED`：尚未接入，包含明確不適用的 ETF 公司財報。`UNAVAILABLE`：已嘗試來源但無可用資料。`PROVIDER_REVIEW_REQUIRED`：自動化/授權仍需審查，本輪不呼叫。

`stale` 與上述狀態分開；日期未知顯示「未知」，不標 fresh。`delayed` 表示官方定期/收盤資料，不代表恰好15分鐘延遲。`fallback` 只有改用有日期的官方歷史收盤時才為 true；本輪沒有偷偷以 Yahoo / FinMind 補空。

0050 ETF 不用公司營收/EPS 分析補猜；基金成分、權重、淨值、industry exposure 仍為缺口。6488 是環球晶，不用 symbol 印象猜產業或供應鏈曝險。

## 一次性研究報表與 screenshot

```bash
.bun/bin/bun tools/run-lab.ts fn TW 2330.TW --view all --json
.bun/bin/bun tools/run-lab.ts fn TW 0050.TW --view overview --json
.bun/bin/bun tools/run-lab.ts fn TW 6488.TWO --view operations --json
.bun/bin/bun tools/run-lab.ts catalog --all --json
```

可用 view：`overview / history / operations / ownership / radar / derivatives / sources / all`。`complete=false` 是本輪合法 partial/gap，不代表要捏造完整資料。

`shot TW ...` 沿用 Gloomberb 原始 Desktop renderer，由本機 Chromium 與只在 loopback 的官方 HTTP bridge 真正讀取資料。現有 screenshot 在 `screenshots/`；完整 source/data 在 `evidence/`，不是雲端部署。原有 `GP / FA / HDS / OMON` 等 command registration 保留，但各原功能有自己的資料限制，不能宣稱全部台股已接通。

**已知 Desktop transport 限制：**原始 HTTP bridge 以文字 envelope 傳 response，不能保留 World Bank XLSX bytes。Oil/Copper 在本輪主要入口（Bun 終端）可用；Desktop screenshot 的產業頁明確顯示 `UNAVAILABLE / BINARY_HTTP_TRANSPORT_UNAVAILABLE`。沒有改上游 Shared transport，沒有拿錄製 fixture 填 Runtime。這個 gap 的 UI 驗證 PASS，不是 Desktop Radar 資料 PASS。

## Review Gate

Co / Developer QA → GPT Review → PM Experience Review → PM 決定 Phase 2。PM review 請確認：資料是否看得懂、每日研究是否順、缺漏是否清楚；本輪不自動開始正式 Investment integration。
