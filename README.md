# Zhuge Investment Intelligence Lab

Phase 1 Taiwan Research Workbench；獨立本機實驗場，不是 Zhuge AI OS Production，也不是下單或買賣建議系統。

Local Candidate Build：`20261001-0917`。Source commit、ZIP/Manifest/SHA256在 `artifacts/` 本機交付，不上傳、不部署。

## 啟動與研究

```bash
cd "/Users/qq/Documents/Zhuge Investment Intelligence Lab"
.bun/bin/bun tools/run-lab.ts
```

在工作台按 `Ctrl+P`，輸入 `TW 2330.TW`、`TW 0050.TW` 或 `TW 6488.TWO`。用 `← / →` 切換分頁，聚焦後 `r` 重新讀取。完整操作見 [TAIWAN_RESEARCH_WORKFLOW.md](TAIWAN_RESEARCH_WORKFLOW.md)。

目前主入口是 Bun 終端。資料來自官方公開來源，無須 Token；需網路。新電腦未附 `.bun` 執行器：先自行安裝 Bun；本輪實測1.4.2，然後在 `upstream/` 執行 `bun install --frozen-lockfile`，回 Lab 根目錄用 `bun tools/run-lab.ts`。不使用原實驗場的 profile、Cloud/FinMind/Broker credential。

## Review 文件

- [Baseline / Source truth](INVESTMENT_INTELLIGENCE_LAB_BASELINE.md)
- [Data Authority](TAIWAN_DATA_AUTHORITY_MATRIX.md)
- [官方能力 Gap Map](TAIWAN_PROVIDER_GAP_MAP_V2.md)
- [FinMind 邊界](FINMIND_PROVIDER_ROLE.md)
- [固定5組 Price Radar 審查](INDUSTRY_PRICE_RADAR_SOURCE_MATRIX.md)
- [Industry Impact Model](INDUSTRY_IMPACT_MODEL.md)
- [Runtime / Developer QA / 已知限制](RUNTIME_EVIDENCE.md)
- [License / Attribution](THIRD_PARTY_NOTICES.md)

`evidence/` 保存真實官方資料、錄製的 parser 測試資料與 QA；`screenshots/` 是 Chromium 真實 renderer 擷取，非 mockup。原始桌面 bridge 不支援 XLSX，因此 Desktop Oil/Copper 保持 UNAVAILABLE；終端與 native CLI 可用。沒有改 Shared UI，也沒有用 fixture 補 Runtime。

本輪結束停在 Developer QA → GPT Review → PM Experience Review。沒有 Git remote / push / PR / merge / deploy / publish。
