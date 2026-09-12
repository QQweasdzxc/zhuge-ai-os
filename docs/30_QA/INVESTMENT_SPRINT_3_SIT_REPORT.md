# Sprint 3 — PM SIT Checklist

## Developer QA Result

**PASS — 20/20 automated tests + Browser regression PASS**

- JavaScript syntax：PASS
- Shared Platform / Identity / Session regression：PASS
- Investment Legacy Mapping + owner-scoped query：PASS
- AAL1 denied / AAL2 allowed：PASS
- TOTP enrollment/challenge contract：PASS
- 10-minute Investment unlock expiration：PASS
- Dashboard name/email/account menu：PASS
- Traditional Chinese Investment UI：PASS
- Mock/engineering labels absent：PASS
- WorkLog 50-character validation/counter：PASS
- Browser console error：0

Browser evidence：`tests/evidence/investment-sprint-3-overview.png`

## PM SIT Flow

1. 登入 Zhuge AI OS，確認 Dashboard 右上顯示姓名與 Email，未顯示 UUID。
2. 點開帳號區，確認可見「Google 帳號／設定／登出」。
3. 從 Dashboard 開啟 Investment。
4. 第一次使用按「設定 Google Authenticator」，掃描 QR Code 並輸入 6 位數驗證碼。
5. 確認投資模組解鎖，並看到真實 Portfolio、8 筆 Position、3 筆 Transaction。
6. 依序切換投資首頁、投資組合、觀察清單、投資策略、偏好設定。
7. 確認 Watchlist／Strategy 無資料時顯示友善空白狀態。
8. 返回 Dashboard 與 WorkLog，確認不需要再次登入或二次驗證。
9. WorkLog 新增工時，確認工作描述顯示 `0/50`、輸入即時更新、超過 50 字不可儲存。
10. Investment 解鎖滿 10 分鐘後重新進入，確認需再次輸入 Google Authenticator 驗證碼。

預估驗收時間：15–20 分鐘。
