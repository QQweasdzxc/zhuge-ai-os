# Taiwan Provider Gap Map V2

本輪要求是 inventory，不是全部接通。表內所有缺口的 Runtime status 均為 `NOT_CONNECTED`；「可接」是 endpoint/schema 可行性，**不是 Runtime PASS**。調查日：2026-10-01。

代碼：T=`https://openapi.twse.com.tw/v1/`；O=`https://www.tpex.org.tw/openapi/v1/`；F=`https://openapi.taifex.com.tw/v1/`。規格原始 JSON 在 `evidence/provider-audit/`。公開 OpenAPI 無 key/account；history 規格、可回溯期間與單位仍須逐項再測，不假稱已批次驗證。

## 官方資料與 access / history

| Gap | 官方 provider / endpoint 或正式 surface | Key / Account | History / Frequency | 已確認與未確認邊界 |
| --- | --- | --- | --- | --- |
| 三大法人 | TWSE [T86](https://www.twse.com.tw/fund/T86?response=json&date=20260930&selectType=ALLBUT0999)；O `tpex_3insti_daily_trading` | 公開查詢無；非私有帳戶 | 日；官方歷史查詢存在，範圍待逐項實測 | 個股買/賣/淨量，區分外資/投信/自營商。TWT53U 是零股行情，不可誤用 |
| 融資融券 | T `exchangeReport/MI_MARGN`；O `tpex_mainboard_margin_balance` | 無 / 無 | 日；OpenAPI 最新，歷史另查 | TWSE表的個股/市場總計形狀須核對；融資金額/股數不可混用 |
| 借券 / SBL | O `tpex_margin_sbl`；T `SBL/TWT96U`；TWSE 借券資訊正式查詢 | 無 / 無（公開表） | 日；歷史 surface 待測 | TWT96U 是「可借券賣出股數」，不是借券未平倉；TPEx 融券/借券賣出餘額也不等於全部借券交易 |
| 股利 | T `opendata/t187ap45_L` / `exchangeReport/TWT48U_ALL`；O `mopsfin_t187ap39_O` | 無 / 無 | 公告/除權息事件；跨年歷史待查 | 董事會通過、最終分派、除息日期需分別標示，不假設已發放 |
| 估值 | T `exchangeReport/BWIBBU_ALL` / `BWIBBU_d`；O `tpex_mainboard_peratio_analysis` | 無 / 無 | 日；historical query surface 待測 | 本益比/殖利率/PB 的官方口徑；虧損缺PE不能補0 |
| ETF constituents | [0050 官方發行商](https://www.yuantaetfs.com/product/detail/0050/Basic_information) 的基金持股明細/下載 | 公開參考頁無；機器下載權利待確認 | 依基金揭露；歷史可下載性未知 | 指數50檔不代表當日基金一定恰好50列，不能以排行或成分推估權重 |
| 台股新聞 / 公告 | TWSE、TPEx新聞稿/公告正式網站；MOPS重大訊息；第三方新聞另審 | 公開頁無；第三方依供應商 | 事件頻率；新聞 archive 不等於全部機器授權 | 官方公告與媒體新聞不同，需分類/去重/來源連結；不拼接全文冒充授權 |
| Put / Call Ratio | F `PutCallRatio` | 無 / 無 | 日；最新 OpenAPI、歷史另查 | 成交量PCR與未平倉PCR分開；不可用只保留60列TXO推估全市場PCR |
| 期貨法人部位 | F `MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate` / `...BytheWeek` | 無 / 無 | 日/週；歷史另查 | TX 契約需篩選；交易口數/未沖銷口數、長短部位分清，不能當股票持有量 |
| Annual financial history | [MOPS](https://mops.twse.com.tw/) 財務報告/IFRS XBRL/年度季別查詢 | 公開查詢；Bulk/歷史下載要求未定 | 年/季；歷史公開報表可人工查 | 最新 OpenAPI snapshot 不是 annual history。需處理修訂版、累計轉單季與可得時間 |
| Monthly revenue history | MOPS 月營收歷史查詢/下載；目前 T `t187ap05_L`、O `mopsfin_t187ap05_O` 只是最新 | 公開查詢；機器歷史入口待實測 | 月；年月歷史報表 surface | 更正/累計/千元口徑；不能把最新月份複製成時間序列 |
| Material information / filings | T `opendata/t187ap04_L`；O `mopsfin_t187ap04_O`；MOPS重大訊息詳細頁 | 無 / 無；詳細頁可能有網站防護 | 事件；archive 另查 | 結構化標題可先接，PDF/XBRL與詳細全文另處理；發布時刻不可用出表日期冒充 |
| 6488 recent history | [TPEx 官方交易資訊](https://www.tpex.org.tw/)；目前 OpenAPI 收盤 snapshot 已確認，歷史專用機器入口未確認 | 公開頁；API/防護/歷史範圍待測 | 日；可回溯範圍待核，本輪未接 | 現有 adapter 明確只支援 TWSE history，不改用Yahoo後宣稱official；未驗證 URL 不作已確認端點 |

## Adapter readiness / Gloomberb pane fit

複雜度是本 Lab 對工程工作量的判斷，不是供應商保證。

| Gap | Adapter complexity | Ready to connect? | Existing pane compatible? | Taiwan-specific pane? |
| --- | --- | --- | --- | --- |
| 法人 | 中：股數/法人分類/日期 | Schema確認；先單symbol實測 | 持股分布呈現概念可借用，但既有HDS名單不能直接代換 | 是，日買賣超而非機構持有名單 |
| 融資融券 | 中：餘額/增減/單位 | Schema確認；TWSE明細待核 | DataTable/series可以；不能塞進short interest百分比 | 是 |
| SBL | 中高：多個不同表 | PARTIAL feasibility；需辨識完整權威表 | 不能用可借股數當SI現有報表 | 是 |
| 股利 | 中：event revision | Schema確認，未呼叫 | DVD/event概念可接，date/status需擴充 | 小型台灣事件projection |
| 估值 | 低中 | Schema確認，未呼叫 | VAL/table可，資料口徑需標示 | 不一定；TW view可先用 |
| ETF成分 | 中高：下載/持股日/權重/授權 | PROVIDER_REVIEW_REQUIRED | ETF exposure可展示；目前不能產生預估分析 | 是或ETF detail；本輪不建 |
| News/公告 | 中高：授權/去重/內容 | 官方標題可設計；全面新聞待審 | NI/news skeleton可；official filing不等同news | 台灣公告分類 |
| PCR | 低中 | Schema確認，未呼叫 | OMON背景可展示，不從截斷chain推估 | 台灣市場背景小區塊 |
| Futures institutions | 中 | Schema確認，未呼叫 | FUT背景可；不能當COT同一口徑 | 是 |
| Annual history | 高 | 需historical/XBRL proof | FA能承載，但需正確point-in-time normalization | Source projection，非第二套engine |
| Revenue history | 中高 | 月份下載端點/terms待測 | financial series可，需月頻dataset | 是，月營收獨立量綱 |
| Filings | 中高 | 最新schema確認；詳細檔案待測 | SEC filings不是台灣issuer source | 是或官方detail adapter |
| 6488 history | 中 | 官方歷史機器入口待確認與compatibility proof | GP/OHLCV shape可重用 | 不必新UI；補原adapter即可 |

本輪沒有因 inventory 接入這些 endpoint。下一輪若要施工，先固定3symbol單項 Compatibility Proof → source/time/unit → projection → UI/CLI evidence，不增第二套 provider/SSOT。FinMind history/aggregation只能作清楚標示的 fallback；成本/授權/credential 由PM決定。
