# Taiwan Data Authority Matrix

查證日：2026-10-01。以下是本輪實際 data path，不是未來 roadmap 的完成宣告。

Authority：TWSE → TPEx → MOPS → TDCC → TAIFEX，按商品/資料種類路由；不能用 TWSE 冒充 TPEx。MOPS 是公司揭露來源，本輪 transport 使用 TWSE/TPEx 的官方 MOPS OpenAPI 鏡出資料。

| 能力 | 原始 Authority / 本輪 source | 2330.TW | 0050.TW | 6488.TWO | 頻率 / 實測日期 |
| --- | --- | --- | --- | --- | --- |
| 最新可得收盤 | TWSE `exchangeReport/STOCK_DAY_ALL`；TPEx `tpex_mainboard_daily_close_quotes` | PASS | PASS | PASS | 日；2026-09-30 |
| 漲跌 | 日期對齊的 TWSE 日行情前收；TPEx 官方前收/漲跌欄位 | PASS | PASS | PASS | 相同交易日，不拿成本價代替 |
| OHLCV / recent history | TWSE `exchangeReport/STOCK_DAY`，response=json / date / stockNo | PASS，41 bars | PASS，41 bars | NOT_CONNECTED | 2026-08-03～09-30；本輪三個日曆月查詢 |
| 公司基本資料 | MOPS；TWSE `opendata/t187ap03_L`、TPEx `mopsfin_t187ap03_O` | PASS | PARTIAL ETF basic | PASS | 最新官方出表；產業原欄位保留，不猜代碼名稱 |
| 月營收 | MOPS；`t187ap05_L` / `mopsfin_t187ap05_O` | PASS | NOT_CONNECTED；不適用 | PASS | 月；2026-08，千元 |
| 最新損益 | MOPS；`t187ap06_L_ci` / `mopsfin_t187ap06_O_ci` | PASS | NOT_CONNECTED；不適用 | PASS | 115年第2季；2026-06-30；YTD 非單季 |
| 最新資產負債 | MOPS；`t187ap07_L_ci` / `mopsfin_t187ap07_O_ci` | PASS | NOT_CONNECTED；不適用 | PASS | 相同期末；存量、千元 |
| 股權分散 | TDCC `https://openapi.tdcc.com.tw/v1/opendata/1-5` | PASS | PASS | PASS | 週；2026-09-24，17級 |
| TX / TXO 背景 | TAIFEX `DailyMarketReportFut` / `DailyMarketReportOpt` | TX PASS / TXO PARTIAL | 同一市場背景 | 同一市場背景 | 2026-09-30 一般盤；不是個股衍生商品 |
| ETF 持股/產業曝險 | 0050 官方發行商基金持股揭露 | 不適用 | NOT_CONNECTED | 不適用 | 只提供人工參考頁，不編造持股 |
| 產業 Oil / Copper | World Bank Pink Sheet；不是台股價格來源 | PASS，月頻訊號 | PASS，月頻訊號 | PASS，月頻訊號 | 2026-08 月均價；不能自動推導股票影響 |

## Exact sources

Base URLs：TWSE OpenAPI `https://openapi.twse.com.tw/v1/`；TWSE historical `https://www.twse.com.tw/exchangeReport/STOCK_DAY`；TPEx `https://www.tpex.org.tw/openapi/v1/`；TAIFEX `https://openapi.taifex.com.tw/v1/`。每個 report 附完整 URL，包含 stockNo 與 query 月份。

本輪取用的公開 endpoint 不需要 key/account，已正常無憑證取得；**不能推論官方所有歷史產品或商業即時行情都免費**。公開規格查證保存在 `evidence/provider-audit/`：[TWSE schema](https://openapi.twse.com.tw/v1/swagger.json)、[TPEx schema](https://www.tpex.org.tw/openapi/swagger.json)、[TAIFEX schema](https://openapi.taifex.com.tw/swagger.json)。

TWSE schema 連到政府資料開放授權；其網站使用條款頁本次被網站安全機制擋下，沒有繞過。TPEx、TAIFEX 各有使用條款；商業再散布須按具體資料集授權核對，不能以 API HTTP200 代替法律授權。此 Lab 只做本機研究與 QA，沒有雲端鏡像或對外資料服務。

[TDCC 說明](https://www.tdcc.com.tw/portal/zh/smWeb/qryStock) 指持股級距包含相關專戶口徑，不能稱為法人/大戶身份資料。本輪顯示級距代碼、原人數/股數/比例；第16級差異數、第17級合計均保留，不任意加總。

## Evidence / failure contract

每區塊保留 `status / provider / source[] / dataTimestamp / publishedAt / fetchedAt / stale / delayed / fallback / errorCode / note / data`。日期缺少不使用 retrievedAt 當行情日期；缺數值為 null，不為0。財報必須具期間與必要欄位才可 PASS。

`dataTimestamp` 是行情交易日或財報/營收期間；`publishedAt` 是官方出表日期，不假設等於最初市場公開時間。`fetchedAt` 是這次本機取回時間。這些目前資料不能直接用於 point-in-time backtest。

目前 freshness 是透明的研究日曆日預算：行情/TX/TXO 5日、月營收75日、財報160日、profile90日、TDCC14日；不是交易所 trading-calendar SLA。來源無日期時 stale=null。World Bank 另採月末45日，不與 daily quote 時效混用。

transport 同 URL coalescing、成功 cache；基本 JSON 30秒，MOPS 10分鐘；manual refresh 清 cache。HTTP錯誤與非JSON記錄 code，區塊獨立降級。未接資料不主動呼叫，沒有 simulation fallback。

## Secondary / supplemental

FinMind：NOT_CONNECTED；只作 aggregation/fallback/gap filler，見 `FINMIND_PROVIDER_ROLE.md`。Yahoo：TW 研究窗不呼叫；upstream implementation 仍保留供原有 command，但沒有用它頂替 official evidence。Genspark：REFERENCE_ONLY / NO_CODE_COPY。
