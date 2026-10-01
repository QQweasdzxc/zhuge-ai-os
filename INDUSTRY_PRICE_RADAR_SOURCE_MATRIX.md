# Industry Price Radar — 固定5組 Source Audit

查證日2026-10-01。**僅有5組**：DRAM/NAND、Semiconductor/SOX、WTI/Brent、Copper、SCFI。不得由本輪擴充成其他指標。來源審查通過才取資料，public page不等於免費機器抓取授權。

## Access / frequency / history

| Group | Provider / Authority / URL | Access | Key / Account | Free / paid | 更新 / History | Rate limit |
| --- | --- | --- | --- | --- | --- | --- |
| DRAM / NAND | TrendForce / DRAMeXchange；產業第三方；[報價頁](https://www.dramexchange.com/) | 公開摘要頁＋會員資訊；未確認可用API，不抓頁 | 摘要可能無；完整歷史/contract需會員，機器API要求未知 | 公開摘要與付費內容不同；機器商用報價未知 | Spot/contract不同頻率；不能視為同一日價。歷史範圍/機器下載待核 | 未確認，**不呼叫** |
| SOX | Nasdaq 指數管理者；[官方SOX](https://indexes.nasdaqomx.com/Index/Overview/SOX) | Index page與licensed feed；沒有本輪核准免費API | 網頁無；feed產品另議 | 非默認free feed，費用未查得 | 指數交易日/即時或延遲依feed；歷史產品另議 | 未確認，**不呼叫** |
| WTI / Brent | World Bank Pink Sheet；國際機構發布的commodity參考資料，不是交易所tick；[下載來源頁](https://www.worldbank.org/en/research/commodity-markets) | 官方XLSX download，不是scrape/API | 無 / 無 | 免費資料集 | 月均價；次月第二工作日；workbook含長期歷史，本輪只取最近兩個可用月 | 公開文件無量化quota；本機6小時cache、1 in-flight，不當作unlimited |
| Copper | 同上，World Bank官方發布參考資料 | 與Oil共用一次XLSX | 無 / 無 | 免費資料集 | 同上；USD/metric ton，**不是期貨合約價格** | 與Oil共用coalescing/cache |
| SCFI | Shanghai Shipping Exchange 指數發布者；[SCFI頁](https://en.sse.net.cn/indices/scfinew.jsp) | 公開指數頁/資料服務；未確認自動化API | 摘要頁可讀；機器/歷史授權未知 | 公開摘要不代表資料產品免費 | 官方週頻spot運價指數；歷史機器授權未知；不是SCFIS | 未確認，**不呼叫** |

## License / commercial / operational suitability

| Group | Terms / redistribution concern | 非商用 / 商用 | Automation / Cloud | Cache | Freshness semantics | Production suitability / 本輪狀態 |
| --- | --- | --- | --- | --- | --- | --- |
| DRAM/NAND | [Terms §6](https://www.dramexchange.com/About/TermsOfUse)：內容再利用與對外呈現有權利限制，需明確許可 | 個人看網頁不等於可自動複製；商用/再散布未核 | 本輪不scrape、不破解會員；Cloud未核 | 未取得可儲存/再散布授權 | 不同產品有不同報價期間，未知不標fresh | REFERENCE_ONLY / PROVIDER_REVIEW_REQUIRED |
| SOX | [Nasdaq licensing](https://www.nasdaq.com/products/global-indexes/licensing-and-etps)、[Index data policy](https://www.nasdaqtrader.com/content/technicalsupport/dataproducts/indexdatapolicy.pdf)；自動取得/展示須對應產品權利 | 不能用公開頁推論免費commercial redistribution | 不抓未核准endpoint，不拿ETF冒充SOX | 未核 | feed的as-of/delay須有正式contract | REFERENCE_ONLY / PROVIDER_REVIEW_REQUIRED |
| Oil | [World Bank dataset](https://datacatalog.worldbank.org/search/dataset/0038238/commodity-prices-history-and-projections)明示CC BY4.0 | 可依dataset license再用，包括商用；保留來源/變更說明，不暗示背書 | 本機download可行；Cloud技術可行但**本輪不部署**；browser CORS未作Production驗證 | memory6h；真實workbook作本機parser fixture並附attribution | 月份≠今日。stale採月末後45日透明研究預算 | PASS，限月頻研究。不是即時Oil Provider production approval |
| Copper | 同一dataset license | 同上 | 同上 | 同一次download/cache，不重打第二provider | 同上，USD/metric ton | PASS，限月頻研究 |
| SCFI | 官方頁copyright；[FAQ](https://en.sse.net.cn/indices/fqaen.jsp)可查方法，未找到足以核准automation/redistribution的授權 | 摘要閱讀≠Cloud重發布 | 本輪不呼叫，不另找未審鏡像 | 未核 | 需正式週別/as-of，不混SCFI/SCFIS | REFERENCE_ONLY / PROVIDER_REVIEW_REQUIRED |

## 本輪已接入的 exact revision

`https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx`

這是 audit時的官方download revision，不是永遠有效的API。改版/失效時回UNAVAILABLE，不自動換到未審來源。檔案與parser限制：HTTP timeout25秒、上限16MB、限定XLSX工作表/路徑/欄位、malformed fail-closed。來源失敗cache60秒，不把fixtures載入UI救綠。

實測最新月2026-08：Brent90.9 USD/barrel、WTI82.7 USD/barrel、Copper14,326 USD/metric ton。月對月變化由本Lab計算並明示；只有source/raw workbook本身是Provider data。原始檔、擷取時間及attribution在 `evidence/fixtures/`。本輪不下載forecast或其他commodity，不取每日報價。

Source status與stock impact分開：取得銅價不表示2330/0050/6488的收入成本曝險已知；沒有可驗證StockExposure，UI明示暫不判定利多/利空。

Runtime boundary：上述 Oil/Copper PASS 指本輪 Bun 終端入口與 native CLI 真實下載。原始 Desktop renderer 的 HTTP bridge 是 text-only；XLSX bytes 經過 `response.text()` 後不再完整，Desktop 產業頁為 `UNAVAILABLE / BINARY_HTTP_TRANSPORT_UNAVAILABLE`。本輪不改 Shared transport；fixture 不作 live fallback。這是 transport compatibility gap，不是來源授權問題，未宣告 Desktop Radar PASS。

## Genspark reference audit

[dvorak0727/Genspark-Stock-AI](https://github.com/dvorak0727/Genspark-Stock-AI) 只研究 Price Radar/更新排程/sector mapping/pressure/US lead 的產品概念。GitHub官方 `/license` 本次404，root listing沒有明確LICENSE；`license-worker`目錄不是對整repo授權。證據在 `evidence/provider-audit/genspark-license.txt`、`genspark-root.txt`、`receipts.json`。

判定 **REFERENCE_ONLY / NO_CODE_COPY**。未抓取/複製其application code，未套用其分數或simulation。公開GitHub與README的FinMind fallback示範都不構成本Lab的source/data authority。
