# Investment Module

Investment 是 Zhuge AI OS Module 02。目前版本透過 Shared Platform 取得 Identity、Session、Permission、Security、ModuleContext 與 Data Gateway，並以 Supabase Auth UUID 對應 Legacy Investment owner 後讀取真實雲端資料。

## Runtime pages

- 投資首頁
- 投資組合／C Board 投影
- 交易紀錄
- 投資策略
- 偏好設定
- 截圖匯入

## Current data mode

`Supabase Investment Repository` with an append-only transaction ledger.

目前持股以既有 `opening_positions` 作為 Opening Baseline；啟用後的新買入／賣出追加至 `transactions`，由唯一的 `investment_current_positions_view` 計算移動加權平均成本、目前持股、未實現損益與已實現損益。既有 Baseline 以前的 3 筆交易不會被回溯疊加。

交易寫入只經過受控 `investment_record_transaction` RPC，具登入、AAL2、Portfolio ownership、賣出數量檢查與 idempotency；瀏覽器不直接寫入 `transactions`。

持股數量大於 0 時投影到台股／美股；持股歸零但曾持有時投影到「📚 投資紀錄」；從未持有的標的仍屬「觀察名單」。

## Boundary

Investment 不維護 OAuth、Google Login、Supabase Auth、Session Storage、LocalStorage Identity 或固定使用者。模組只能透過 `ModuleContext` 取得目前 Shared Identity UUID。

Investment 的交易、持倉、歷史歸類與損益是 Investment Domain-owned；不修改 Module C 或其他 Consumer 的 Shared Runtime。C Board 只承載 Investment projection/card identity，不保存財務欄位。
