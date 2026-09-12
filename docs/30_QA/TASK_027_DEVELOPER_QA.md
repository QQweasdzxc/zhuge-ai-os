# TASK-027｜帳號註冊與多登入身份綁定 — Developer QA

## 本次實作

- Shared Auth 保留既有 Google PKCE 登入，新增 Supabase Email/Password 註冊與登入。
- 新增 Email 驗證導向、忘記密碼信件請求，以及登入後在同一個 Supabase Auth UUID 設定密碼。
- Shared Session 與 Cloud Repository 以 provider-neutral authenticated session 判斷；既有 WorkLog、Investment、AI Board 不建立第二套身份。
- 密碼只送往 Supabase Auth REST API，不建立自有密碼資料表，也不把密碼寫入 LocalStorage。

## QA Evidence

- `node --check shared/auth/auth-service.js`：PASS
- `node --check modules/worklog/worklog-app.js`：PASS
- `BROWSER_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome node --test tests/*.test.js`：55 passed / 0 failed / 0 skipped
- `git diff --check`：PASS

## PM 操作說明（待實際帳號驗證）

1. 在登入頁輸入 Email 與至少 8 字元密碼，選「建立帳號」。
2. 依收到的 Email 完成驗證，再使用「Email 登入」。
3. 選「忘記密碼」會寄出 Supabase Auth 重設信件。
4. Google 登入者可在設定中為同一個帳號設定密碼；不會建立第二個 User UUID。
5. Email 登入者可在設定中選「連結 Google 登入」；OAuth 回呼會交換同一個 Supabase Auth session，不建立第二個 User UUID。

## 尚待外部／人工驗證

- 真實 Supabase Email confirmation、SMTP 與 redirect URL 需在 QJC 測試帳號完成一次端到端驗證。
- 真實 Email confirmation、SMTP、redirect URL 與 Google identity linking 仍需由 QJC 以測試帳號完成一次瀏覽器端到端驗證；自動化測試已確認 Shared Auth 的 linking callback、session exchange 與 duplicate UUID 防護路徑。

## 安全邊界

- 不修改 OAuth Client、RLS、Database Schema。
- Service Role 不在 Browser、Source 或 Artifact。
- Google Drive 權限仍只由 Google OAuth provider token 提供。
