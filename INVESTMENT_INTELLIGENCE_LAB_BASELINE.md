# Zhuge Investment Intelligence Lab — Phase 1 Baseline

本輪只建立獨立台股研究工作台。Developer QA 與可用資料不代表 GPT Review、PM Experience Review 或正式 Investment 整合完成。

## Source truth

| 項目 | Current State |
| --- | --- |
| 唯一可修改目錄 | `/Users/qq/Documents/Zhuge Investment Intelligence Lab/` |
| 上游 | `gloom-sh/gloomberb`；MIT；版本 `0.15.2` |
| Frozen upstream | `62317c477c1ef9b8394a12eac971c5546441b76e` |
| Lab branch | `lab/phase-1-taiwan-20261001`；沒有 Git remote |
| Local baseline commit | `4dac027d2d5b0ac11f3cc8a7df767335efe87d91` |
| Taiwan adapter 來源 | Frozen Taiwan Provider Spike 的實際 working tree；見 `baseline/README.md` |
| Baseline 差異 | Spike 的 `catalog.ts` 修改與 Taiwan plugin/provider 當時未 commit。本 Lab 將其保存在自己的 baseline，不修改 Spike |
| 實測 Runtime | Mac arm64；Bun `1.4.2`，只放在 Lab `.bun/bin/` |
| 原 package manager 宣告 | `bun@1.3.11`；與實測執行器不同，明確保留，不假稱完全相同 |
| 既有 UI/runtime | Bun + React 19.2.7 + OpenTUI 0.3.2；沿用 pane/command/headless/desktop renderer |
| 新 dependency | 僅 `fflate@0.8.2`，固定版本解析官方 XLSX；既有 fast-xml-parser；lockfile 已更新 |
| 新入口 | `TW 2330.TW` / `TW 0050.TW` / `TW 6488.TWO` |

## 保護區

Original Runtime Evaluation、Taiwan Provider Spike、Zhuge AI OS（包含正式 Investment / Shared UI / worktrees）只讀。

開工前保存 `baseline/protected-source-before.json`。結束執行 `tools/isolation-audit.ts`，逐檔比對內容 SHA256、檔案大小與 symlink。涵蓋 15,353 筆：Original 2,700、Spike 2,706、Zhuge AI OS 9,947。明確排除 Git internals、dependency、runtime cache、release archives 等，這是 source preservation proof，不宣稱對每個 runtime cache 作全磁碟快照。

Lab 從 frozen upstream archive 建立，沒有帶入原本 `.git`、帳號、profile、token、private key。所有新 runtime 設定在 `runtime-home/research-v1/`；Telemetry 關閉。沿用上游正式 fresh-install marker，避免把全新 Lab 當成舊版升級而自動恢復 Broker / AI plugins。第一次 TUI smoke 發現 bootstrap 會拖延啟動，已修正 Lab launcher；沒有建立或登入 Broker 帳號。

## 沿用與最小差異

沿用 TaiwanDataProvider，將其原本 transport/cache 暴露為同一 `taiwanOfficialApi`；新增 retrieval receipt、HTTP/JSON failure evidence、in-flight coalescing。不是另一套 provider。新增 TW pane、繁體研究 projection、headless bundle、5 組 Radar 與可解釋 Impact Model。共享元件只使用，不修改。

TWSE 收盤／日行情、TPEx 收盤、MOPS 公司資料／月營收／最新財報、TDCC 股權分散、TAIFEX TX/TXO 延續既有 Spike。沒有悄悄補入 TPEx history、ETF constituents、法人、融資融券或 FinMind。

兩個上游測試檔只修正 URL pathname 的空白路徑解碼，改用 `fileURLToPath`；不改測試目的或 product runtime。Full suite 使用上游 UTC fixtures，Taiwan targeted / real runtime 使用 Asia/Taipei。QA child profile 與 temp 全部在 Lab，不讀真實 `~/.gloomberb`。

## 不在本輪

不連 Zhuge AI OS，不取代 Current Investment，不改 Shared Design System，不做全市場、Cloud、Broker/Fubon、持倉/P&L、下單、買賣建議、Mobile 或大型 Price Radar。沒有 push / PR / merge / deploy / publish。

實際 source diff 以 `git diff 4dac027d2d5b0ac11f3cc8a7df767335efe87d91 HEAD -- upstream` 為準。最終 local commit 由 handoff manifest / `git rev-parse HEAD` 對帳；不把未來 commit SHA 寫成假常數。
