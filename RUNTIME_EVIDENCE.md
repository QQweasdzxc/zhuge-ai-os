# Phase 1 Runtime / Developer QA Evidence

驗證日期：2026-10-01，Asia/Taipei。以下都是本機 Lab，不是 Zhuge AI OS Runtime、Cloud/PM QA 或投資建議。

## 真實官方資料 → 同一研究 projection

`tools/capture-runtime.ts` 與 `tools/cli-acceptance.ts` 使用既有 TaiwanDataProvider / taiwanOfficialApi，再交給 `loadTaiwanResearch` → `projectResearch` → 原始 pane/headless。Runtime 不載入測試 fixture；fixture 只在 `research.test.ts` 做 deterministic parser/規則 QA。

官方資料擷取：`evidence/runtime-summary.json`、`evidence/{symbol}-runtime.json`；CLI 的再次查詢與時間在 `evidence/cli/{symbol}.json`。數字只是當次公開回應，不是固定 UI 值。

| 標的 | 最新可取得收盤（2026-09-30） | 原始 history | 營運 | 籌碼 | 合法缺口 |
| --- | --- | --- | --- | --- | --- |
| 2330.TW | TWSE 2,480 TWD；+5；+0.2020%；34,282,491股 | 41日；2026-08-03至09-30；未還原 | MOPS公司基本資料、2026-08營收、2026Q2累計損益及期末資產負債 | TDCC 2026-09-24，17級距 | 法人/融資融券/歷史財報等未接；公司商品曝險未知 |
| 0050.TW | TWSE 112.05 TWD；+0.75；+0.6739%；60,951,975股 | 同期間41日；未還原 | PARTIAL：官方名稱與ETF種類；公司營收/損益/資產負債不適用、NOT_CONNECTED | 同日期17級距 | 成分/權重/淨值/產業曝險未接，不假裝已知 |
| 6488.TWO | TPEx 1,035 TWD；+90；+9.5238%；18,827,804股 | NOT_CONNECTED；TPEX_HISTORY_NOT_CONNECTED | 環球晶；公司/MOPS營收/最新財報可讀 | 同日期17級距 | 上櫃歷史未接，不用Yahoo冒充官方 |

營收金額為TWD千元，不是元：2330八月514,805,337、MoM10.0998%、YoY53.3200%；6488八月4,764,363、MoM−4.2870%、YoY7.6055%。最新損益為**年初至2026Q2累計**，不是單季；2330營收2,404,483,690千元/EPS49.33元，6488營收29,199,108千元/EPS11.87元。出表日/期間/讀取時間分開，不假裝 point-in-time 歷史可得性。

TX一般盤2026-09-30，202610契約最後成交與結算48,330；TXO同日報表共3,222列，報告只保留最活躍60列，UI顯示12列。TX PASS、TXO PARTIAL；缺IV/Delta/價差/PCR，不填0，也不當作這3檔的個股期權。

## Native Runtime / command acceptance

`tools/tui-evidence.ts` 實際啟動 Bun/OpenTUI，使用 Lab 專屬 tmux 3.5a socket、144×70終端與獨立QA profile；沒有另一個應用程式的登入。記錄：`evidence/tui-runtime.json`、`evidence/tui/*.txt`。包含：啟動2330、實際切至TDCC表、切至Radar並看到Oil價格，再輸入TW0050/TW6488。測完關閉自己的session/server。

`tools/cli-acceptance.ts` 實際執行原CLI，不是手動構造結果；確認TW以及原GP/FA/HDS/OMON仍註冊。3份真實官方report都有source/dataTimestamp/fetchedAt，且合法 `complete=false`。Catalog共有109個command；只驗註冊保留，不宣稱舊pane全部台股已接通。

短時smoke沒有發現MaxListeners/Maximum update depth/Hook警告；**不以短測試證明長時間memory leak不存在**。

## Price Radar / Impact

固定5組，不能增加。Native Bun真實World Bank XLSX：2026-08 Brent90.9、WTI82.7 USD/barrel，Copper14,326 USD/metric ton。對前月變化為+8.9928%/+4.1562%/+5.7816%。是月均價，不是即時價；CC BY4.0 attribution在每組UI、原檔與source matrix。

DRAM/NAND、SOX、SCFI：PROVIDER_REVIEW_REQUIRED / REFERENCE_ONLY；沒有抓取、模擬或替代成分資料。3檔的直接商品曝險沒有來源，所以IndustryImpact的direction維持Unknown、confidence未評估，不給買賣建議。

**Desktop Radar = UNAVAILABLE，Native Radar = PASS。** frozen上游的 `toResponseEnvelope()` 使用 `response.text()`，Desktop bridge不能攜帶XLSX bytes；這不是World Bank無資料。TW adapter依原transport能力fail closed，回 `BINARY_HTTP_TRANSPORT_UNAVAILABLE`，未請求時fetchedAt=null，不從fixture取價格、不改Shared transport。這是明確保留的下一階段compatibility gap。

## Chromium screenshots / 可見內容驗證

`tools/browser-evidence.ts` 使用原始Desktop renderer + 真實Chromium + 本機Bun HTTP bridge；1280×1008 viewport，2×PNG。不是fixture或UI mockup。清單與逐項結果在 `evidence/browser-runtime.json`。

- 2330：overview、operations、history、ownership、radar、derivatives。
- 0050：overview，明示ETF不適用與缺漏。
- 6488：overview；history明示NOT_CONNECTED。

History/TDCC/TX表必須真的有可見data row，不再以標題存在當PASS。Desktop Radar只驗UNAVAILABLE/error code/原因/恢復入口；其gate是 `explicit-transport-gap-ui`、`dataUsable=false`，不是Radar資料可用。6488 history也是 `explicit-gap-ui`、`dataUsable=false`。

長頁需捲動；shot可能 `truncated=true`，不能說一張PNG含完整所有data。完整report在JSON、實際原始窗可捲動。本輪沒有Mobile或正式Desktop application打包/Cloud驗收。

## Developer QA / 可重跑性

```bash
.bun/bin/bun tools/developer-qa.ts
.bun/bin/bun tools/cli-acceptance.ts
.bun/bin/bun tools/browser-evidence.ts
.bun/bin/bun tools/tui-evidence.ts
.bun/bin/bun tools/isolation-audit.ts
git diff --check
```

最終**實際計數**以 `evidence/developer-qa.json`、`browser-runtime.json`、`cli-acceptance.json`、`tui-runtime.json`、`isolation-audit.json` 與本機artifact manifest為準，不把未跑完的預期數字寫成PASS。

最終Developer結果：Targeted **31 PASS / 0 FAIL**；Full **5,317 PASS / 0 FAIL**，833 files、1 snapshot；4組typecheck與manifest check PASS。Chromium **9/9**，其中7項live data UI與2項明確gap UI；native TUI **5/5**，CLI **4/4**；protected source **15,353/15,353、0差異**。這些數字不是GPT/PM acceptance，也不能消除下面記錄的上游timing flake。

Targeted驗日期/月/季、null不是0、實際MOPS欄位/單位、schema loss、ETF不適用、OTC缺漏、HTTP503/malformed JSON/coalescing、實際XLSX parser、text-only bridge不得取得偽值、5組授權分流、Impact傳導/未知曝險/資料stale。除了純分類規則vector及錯誤response，不提供synthetic市場/財務資料給Runtime。

Full suite保留原833個test files；targeted/runtime用Asia/Taipei，full用原UTC fixture；沒有disable/skip測試。初期QA wrapper曾覆蓋上游HOME fixture，且時區不同，造成11個failure；已修wrapper，不改product。後續全套曾出現原ShortInterest pane「legend少最後M」的渲染timing failure；該Shared元件不在本輪scope，未改元件或放鬆assertion。已保留失敗attempt於 `evidence/qa-history/`，最終結果與這個既有flake須一起讀。

一次Desktop 6488公開TPEx request timeout已保留在 `evidence/browser-history/`；UI當時為UNAVAILABLE、真實error，不放fake資料。再測仍重新向official provider取資料；成功不代表來源永遠可用。

## Source preservation / Gate

開工前15,353筆protected source fingerprint；完工audit只比對source、不涵蓋Git internals/cache。沒有push/PR/merge/deploy/publish；Lab無remote。FinMind/Yahoo/券商Token不讀、不注入；Genspark REFERENCE_ONLY / NO_CODE_COPY。

Co完成Developer交付後STOP：GPT Review、PM Experience Review仍未執行。Phase2的AIOS整合/Shared transport/官方歷史/授權與曝險等，僅由PM下一Gate決定，不由本輪自行啟動。
