# Third-party notices

## Gloomberb

Upstream `gloom-sh/gloomberb@62317c477c1ef9b8394a12eac971c5546441b76e`，Copyright (c) 2026 Gloomberb Contributors，MIT。完整原授權保存在 `upstream/LICENSE`，隨本Lab source一併交付。保留原pane、command、renderer與dependency attribution。

## fflate 0.8.2

新增dependency只用於官方World Bank XLSX parser；MIT。

```text
MIT License

Copyright (c) 2023 Arjun Barrett

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Data fixtures

World Bank Commodity Price Data (Pink Sheet)：[dataset CC BY4.0](https://datacatalog.worldbank.org/search/dataset/0038238/commodity-prices-history-and-projections)。`evidence/fixtures/world-bank-monthly.xlsx` 是真實下載原檔。Lab解析與月變化計算是修改/衍生處理，不暗示World Bank認可研究結論。

TWSE / TPEx / MOPS / TDCC / TAIFEX：保留完整公開source URL、資料期間、retrieval receipt；依各公開資料集與官方條款使用。沒有對外鏡像或commercial Cloud服務；未將第三方新聞、付費指數/報價或FinMind raw資料打包。

## Test tooling only

本機測試使用tmux3.5a與libevent2.1.12-stable的官方release，在Lab `.cache/tool-source/` 本機編譯，不改系統安裝。它們與Bun/Chrome/node_modules都不是本Lab FullSource中的vendored binary。各自授權見[tmux source](https://github.com/tmux/tmux/tree/3.5a)、[libevent release](https://github.com/libevent/libevent/tree/release-2.1.12-stable)。產品不依賴tmux；只用來保存實際TUI smoke evidence。

## No code copied

Genspark-Stock-AI：REFERENCE_ONLY / NO_CODE_COPY。DRAMeXchange、Nasdaq SOX、Shanghai Shipping Exchange：授權待確認，沒有資料fixture或scraper。
