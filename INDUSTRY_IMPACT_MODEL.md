# Industry Impact Model v1

Implementation：`upstream/src/plugins/builtin/taiwan/impact.ts`。模型是證據傳導分類，不是價格預測、AI評分、股票排名或買賣建議。

## Contract

`IndustrySignal → StockExposure → ImpactType → Direction → Confidence → Explanation`

| 欄位 | 必須保留 |
| --- | --- |
| IndustrySignal | id、up/down/flat/unknown、source、dataTimestamp、stale、status |
| StockExposure | symbol、direct-revenue/direct-cost/demand-proxy/cycle-proxy/macro-proxy/mixed/unknown、source、verified、explanation |
| ImpactType | Revenue Tailwind / Revenue Headwind / Cost Tailwind / Cost Headwind / Demand Proxy / Industry Cycle Proxy / Macro Proxy / Mixed / Neutral |
| Direction | Positive / Negative / Mixed / Neutral / Unknown |
| Confidence | 未評估/低/中，basis[]，固定meaning：證據支持程度，不是報酬機率 |
| Explanation | 為何有此傳導、仍缺什麼；不輸出下單/必漲/必跌 |

## 可解釋規則

方向判定前須同時有：訊號PASS/PARTIAL、非空來源、有效資料期間、stale=false，以及可查核曝險source、verified=true、kind非unknown。僅有價格漲跌、產業名稱、ticker印象，不足。

| 已驗證曝險 | 訊號上升 | 訊號下降 | 限制 |
| --- | --- | --- | --- |
| 直接售價/收入 | Revenue Tailwind / Positive | Revenue Headwind / Negative | 只是可能的收入方向；銷量、contract、匯率仍需核對 |
| 直接原料成本 | Cost Headwind / Negative | Cost Tailwind / Positive | 仍要看轉嫁能力、庫存與hedge，不是毛利必然變化 |
| demand proxy | Demand Proxy / Mixed | Demand Proxy / Mixed | 不知實際公司傳導方向 |
| industry cycle proxy | Industry Cycle Proxy / Mixed | 同左 | 不能把景氣proxy當直接ASP |
| macro proxy | Macro Proxy / Mixed | 同左 | 宏觀訊號不等於每檔個股結論 |
| mixed | Mixed / Mixed | 同左 | 支持與反對可能同時存在 |
| unknown / 未驗證 / 來源舊或缺日期 | Neutral / Unknown | 同左 | 白話：資料／公司曝險還不夠，暫不判定有利或不利 |

有效flat為Neutral；資料未知的Neutral type必須配Unknown direction，不假裝已驗證無影響。直接曝險且完整source信心最多「中」；PARTIAL或proxy降為「低」。不創造百分比或High confidence。

## 本輪3symbol實際落點

Oil/Copper確實有官方月資料，但2330/0050/6488對油銅的收入/成本曝險尚未有本輪可驗證公司文件。因此全部`StockExposure.kind=unknown / verified=false`，不填入推估曝險。0050缺constituents，不從基金名稱推導產業權重；6488不因代號猜業務。DRAM/SOX/SCFI尚待provider review，不產生signal。

模型完成與公司impact coverage是兩回事：模型/negative tests完成；個股曝險仍PARTIAL。日後可在PM核准後以公司年報、產品營收比重、原料/避險政策等具期間的證據升級，不能由LLM自行補猜。

## Test vectors

`research.test.ts` 中 MODEL_RULE_ONLY 是純分類規則輸入，不是第四個研究股票、不提供任何模擬價格/財務數字、不進Runtime。

覆蓋：價格上升對成本是反向、價格下降對收入是反向、proxy為Mixed、flat為Neutral、缺日期/來源/曝險、stale、provider unavailable、未驗證公司均Unknown。測試不以外部「命中率」驗證模型，也沒有買賣引擎。
