# TEST DATA 視覺證據

全部為本地 Playwright fixture，非正式使用者。主畫面採 cutoff 已啟用＋全站暫停 true：新進待審 Off（琥珀框／文字）、既有 On、明確禁止 Off。空／錯誤狀態皆含 TEST DATA 標示。

| 狀態 | 桌面 | 手機 |
|---|---|---|
| 名片、暫停區、On/Off、待審與禁止 | [PNG](TEST-DATA-desktop.png) | [PNG](TEST-DATA-mobile.png) |
| 空狀態 | [PNG](TEST-DATA-empty-desktop.png) | [PNG](TEST-DATA-empty-mobile.png) |
| 網路錯誤、個資清除 | [PNG](TEST-DATA-error-desktop.png) | [PNG](TEST-DATA-error-mobile.png) |

重產指令（所有網路均被 fake RPC 攔截）：

```sh
ZG71_EVIDENCE_DIR=docs/zg71-screenshots node --test tests/zg71-access-cards-browser.test.js
```

政策對照另由 `tests/zg71-effective-ui-matrix.test.cjs` 直接載入一次性 SQL 算出的 48 組結果比對實際 aria-checked。
