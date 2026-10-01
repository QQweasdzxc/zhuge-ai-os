# Developer QA Summary — Build 20261001-0917

| Gate | 實際結果 | Evidence |
| --- | --- | --- |
| Taiwan targeted | 31 PASS / 0 FAIL | `evidence/qa/targeted.txt` |
| Full regression | 5,317 PASS / 0 FAIL；833 files / 1 snapshot | `evidence/qa/full-regression.txt` |
| Typecheck | 4組PASS | `evidence/qa/typecheck.txt` |
| Plugin manifest | PASS | `evidence/qa/manifest.txt` |
| Root tool syntax | 9檔PASS | `tools/*.ts` 逐檔Bun.Transpiler檢查 |
| CLI | 4/4 PASS：舊command保留＋3標的真實資料 | `evidence/cli-acceptance.json` |
| Chromium | 9/9 QA PASS：7 live-data UI＋2 explicit-gap UI | `evidence/browser-runtime.json`、`screenshots/` |
| Native TUI | 5/5 PASS；警告0，自己的session/server已停 | `evidence/tui-runtime.json` |
| Protected source | 15,353筆 / 0差異 | `evidence/isolation-audit.json` |
| Shared UI preservation | 上游 components/renderers/theme/ui 無diff | baseline Git diff |
| diff-check | PASS | commit前 `git diff --check` |

Core coverage與QA結果不可混用：6488歷史NOT_CONNECTED；0050公司財報不適用、ETF constituents未接；Desktop Oil/Copper UNAVAILABLE、native Bun月均價PASS；DRAM/NAND/SOX/SCFI PROVIDER_REVIEW_REQUIRED。None是假資料或自動買賣建議。

已保留Full regression的上游ShortInterest render timing flake，以及一次TPEx timeout；詳見 `RUNTIME_EVIDENCE.md`、`evidence/qa-history/`、`evidence/browser-history/`。最終通過不表示以前沒有失敗，也不是來源availability保證。

依Phase1停止：Developer交付 → GPT Review → PM Experience Review → PM Phase2決策。GPT/PM尚未驗收。沒有push/PR/merge/deploy/publish；沒有AIOS/Spike/Original修改、Cloud/Product Data mutation。
