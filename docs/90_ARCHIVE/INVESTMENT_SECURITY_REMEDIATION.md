# Investment Gate 2 — Security Remediation Design

Document Version: 1.0
Decision Status: Proposed for PM Review
Execution Status: Not Authorized
Security Level: ADR-013 Level 3

## 1. Security Objective

Investment 必須在 Database、API、Shared Security Gate 與 UI 四層共同保證：

```text
Authenticated Identity
    ↓
Shared Security Gate
    ↓
Minimum Object Grants
    ↓
RLS Ownership + Assurance
    ↓
Investment Repository
```

前端隱藏按鈕、Module Lock 或 Privacy Mask 都不能取代 Database authorization。

Official references：

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Securing the Data API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase Multi-Factor Authentication](https://supabase.com/docs/guides/auth/auth-mfa)
- [Supabase User Management / Auth FK](https://supabase.com/docs/guides/auth/managing-user-data)

## 2. Current Security Findings

| Area | Current state | Risk |
| --- | --- | --- |
| Main tables | RLS enabled but `USING (true)` / `WITH CHECK (true)` to `public` | Cross-user read/write |
| Supporting tables | `user_settings`, `onboarding_state`, `identity_claim_logs` have no policy | Client access inconsistent/blocked；Security Definer RPC bypasses direct policy |
| Views | 3 views owned by `postgres`, no `security_invoker=on` | Owner privileges may bypass underlying RLS |
| RPC | 3 Identity RPC are Security Definer and executable by anon/authenticated | Excess API surface / privilege escalation risk |
| Grants | anon/authenticated receive broad privileges | RLS failure becomes direct exposure |
| Owner field | legacy `app_users.id` | Cannot use `auth.uid()` directly before migration |

## 3. Security Level Decision

### Option 1 — Step-up MFA when entering Investment

```text
Open Investment
    ↓
Require AAL2
    ↓
Module unlocked
```

| Dimension | Assessment |
| --- | --- |
| UX | High friction；每次進入都可能 challenge |
| Office privacy | Strong；進入前即阻擋肩窺與 unattended session |
| API security | Strong if every table policy requires AAL2 |
| Auto Lock | Simple；lock immediately returns to challenge |
| Session assurance | Uniform AAL2 across all actions |
| Supabase RLS | Straightforward restrictive AAL2 policy |

適用：多人共用裝置、HR/Payroll 或極高敏感資產管理。

### Option 2 — AAL1 read, sensitive actions step-up to AAL2

```text
Open Investment at AAL1
    ↓
Read-only portfolio view
    ↓ sensitive mutation/export
Require AAL2
    ↓
Short Module Unlock
```

| Dimension | Assessment |
| --- | --- |
| UX | Better；日常查看不重複 challenge |
| Office privacy | 需 Privacy Mode、amount masking、Auto Lock 補強 |
| API security | Reads AAL1；writes/export enforced AAL2 in RLS/RPC |
| Auto Lock | AAL2 unlock 必須有獨立短時效，不可只看 JWT expiration |
| Session assurance | Operation-specific；需清楚 reason 與 challenge state |
| Supabase RLS | 可用 restrictive policy 檢查 `(auth.jwt()->>'aal') = 'aal2'` |

### Recommendation

推薦 **Option 2**：

- Read-only portfolio/watchlist/strategy at AAL1。
- 新增、修改、刪除 Portfolio／Position／Transaction 必須 AAL2。
- 完整匯出、批次操作、身份或 owner 變更必須 AAL2。
- 總資產與損益可在 AAL1 顯示，但預設支援 Privacy Mask；離開 Module 或 idle 後重新遮罩。
- AAL2 Module Unlock 建議 10 分鐘，實際時長需 PM 核准。
- Auto Lock 觸發後，UI 清除敏感 DOM/cache；Database 仍依 JWT AAL 保護敏感操作。

原因：目前是 personal productivity application，日常查看頻率高；把 AAL2 放在 mutation/export gate 能兼顧安全與每天使用。

## 4. RLS Baseline

所有 client-facing policy 必須指定 `to authenticated`；`anon` 不得擁有 Investment Table/View/RPC access。

Ownership baseline：

```sql
(select auth.uid()) = user_id
```

Sensitive write assurance baseline：

```sql
(select auth.jwt()->>'aal') = 'aal2'
```

UPDATE 必須同時有：

- SELECT policy（Postgres UPDATE 需要可見 row）。
- `USING` 驗證既有 owner。
- `WITH CHECK` 驗證更新後 owner 仍是 `auth.uid()`。
- AAL2 restrictive policy for sensitive tables/actions。

Service Role 不建立 RLS policy 例外；它本來可 bypass RLS，只允許受控 server process 使用，禁止出現在 Browser、Module config 或 GitHub Pages。

## 5. Table-by-Table RLS Design

### 5.1 `portfolios`

Ownership：direct `portfolios.user_id`。

| Action | Target rule | Assurance |
| --- | --- | --- |
| SELECT | `user_id = auth.uid()` | AAL1 |
| INSERT | `WITH CHECK user_id = auth.uid()` | AAL2 |
| UPDATE | `USING` + `WITH CHECK` owner match | AAL2 |
| DELETE | owner match | AAL2 |

Restrictive policy：Yes，對 INSERT/UPDATE/DELETE 驗證 AAL2。

理由：刪除 Portfolio 可能 cascade positions、transactions、watchlists、strategies、decision logs，屬最高風險 mutation。

### 5.2 `opening_positions`

Ownership：direct owner + portfolio chain。

```text
opening_positions.user_id = auth.uid()
AND portfolios.id = opening_positions.portfolio_id
AND portfolios.user_id = auth.uid()
```

| Action | Target rule | Assurance |
| --- | --- | --- |
| SELECT | direct owner；portfolio when present must match same owner | AAL1 |
| INSERT | owner + referenced portfolio owner | AAL2 |
| UPDATE | old/new owner fixed；portfolio chain fixed | AAL2 |
| DELETE | owner match | AAL2 |

Restrictive policy：Yes for all writes。

### 5.3 `transactions`

Ownership：direct owner + portfolio chain。

| Action | Target rule | Assurance |
| --- | --- | --- |
| SELECT | owner and portfolio owner match | AAL1 |
| INSERT | owner and portfolio owner match | AAL2 |
| UPDATE | old/new owner and portfolio chain match | AAL2 |
| DELETE | owner match | AAL2 |

Restrictive policy：Required。交易是 Financial Source of Truth，所有 writes 必須 AAL2。Bulk import 應走受控 authenticated RPC/Edge boundary，不開放 anon。

### 5.4 `watchlists`

Ownership：direct owner；`portfolio_id` nullable，但存在時必須同 owner。

| Action | Target rule | Assurance |
| --- | --- | --- |
| SELECT | owner match | AAL1 |
| INSERT | owner + optional portfolio owner | AAL1 |
| UPDATE | owner fixed + optional portfolio owner | AAL1 |
| DELETE | owner match | AAL1 |

Restrictive policy：No AAL2 baseline。Watchlist 不改變資產或交易；若未來加入自動下單則必須重新分類。

### 5.5 `strategies`

Ownership：direct owner + optional portfolio owner。

| Action | Target rule | Assurance |
| --- | --- | --- |
| SELECT | owner match | AAL1 |
| INSERT | owner + optional portfolio owner | AAL1 |
| UPDATE | owner fixed + optional portfolio owner | AAL1 |
| DELETE | owner match | AAL1 |

Restrictive policy：No AAL2 baseline；它是使用者研究／策略文字，不是交易執行。

### 5.6 `decision_logs`

Ownership：direct owner + optional portfolio owner。

| Action | Target rule | Assurance |
| --- | --- | --- |
| SELECT | owner match | AAL1 |
| INSERT | owner + optional portfolio owner | AAL1 |
| UPDATE | 建議禁止一般 client update；採 append-only | AAL2 if PM authorizes correction flow |
| DELETE | 建議只透過 audited cleanup/export-delete flow | AAL2 |

Restrictive policy：AAL2 for delete/correction。AI evidence 不應被靜默覆寫。

### 5.7 `app_users`

`app_users` 是 identity bridge，不是 Investment domain owner target。

| Action | Target rule | Assurance |
| --- | --- | --- |
| SELECT | only row where `auth_user_id = auth.uid()`；explicit safe columns | AAL1 |
| INSERT | client denied；Shared identity provisioning only | controlled server/auth trigger |
| UPDATE | client denied except separately designed profile columns | controlled boundary |
| DELETE | client denied；account deletion workflow only | AAL2 + audit |

現有 `user_code` claim 不可繼續作為 Production authorization。

## 6. Supporting Table Policies

| Table | Target |
| --- | --- |
| `user_settings` | canonical `user_id = auth.uid()`；SELECT/UPSERT authenticated；敏感 security settings AAL2 |
| `onboarding_state` | canonical owner only；client read；state transition through controlled service/RPC |
| `identity_claim_logs` | no client SELECT/WRITE；service role/auditor only；remove broad grants |

## 7. View Remediation

### 7.1 `current_positions_view`

- Owner：`postgres`。
- Current：no auth filter；Security Definer Advisor Error。
- Keep：Yes，因為 UI 直接依賴 latest position projection。
- Target：`security_invoker=on`；underlying `opening_positions` RLS complete。
- Direct grants：authenticated SELECT only；anon revoke all。
- Additional filter：Repository 仍傳 `user_id = session UUID`，但 security 不能依賴 client filter。
- RPC replacement：Not required if security-invoker + underlying RLS test PASS。

### 7.2 `holdings_view`

- Owner：`postgres`。
- Current：aggregate transactions without auth filter；Security Definer Advisor Error。
- Keep：Conditional。若仍為 domain calculation contract，可保留 security-invoker view。
- Target：`security_invoker=on`；underlying transactions RLS complete。
- Anonymous：No access。
- RPC replacement：若需要 AAL2-only full portfolio aggregation或額外 audit，再改為 authenticated RPC；日常 read-only aggregate 不必為了 RPC 而增加複雜度。

### 7.3 `my_workspace_view`

- Owner：`postgres`。
- Current：有 `app_users.auth_user_id = auth.uid()`，但仍是 Security Definer。
- Keep：No，建議在 legacy identity cutover 完成後 retire。
- Replacement：Shared Identity/Profile contract；Investment 不應維護 Workspace identity view。
- Anonymous：No access。

## 8. RPC Remediation

### 8.1 `get_my_workspace_summary()`

- Current：Security Definer；body filter auth.uid；anon/authenticated executable。
- Decision：Temporary retain only during migration evidence period。
- Grants：revoke anon；authenticated only if Runtime still needs it。
- Mode：若能用 security-invoker + RLS 完成則切換；否則固定 empty `search_path` 並 fully qualify every relation。
- Retirement：canonical owner cutover後下架，不進 Shared permanent API。

### 8.2 `claim_legacy_workspace(...)`

- Current：Security Definer；default `user_code='001'`；可 claim unclaimed legacy row。
- Risk：authenticated user may claim a known/unclaimed code；privilege escalation/ownership takeover。
- Decision：不進 Production Runtime。Gate 2 mapping 由 DBA/controlled migration 執行，不由 client RPC claim。
- Grants：revoke anon and authenticated before Investment Production exposure。
- Retirement：Migration sign-off 後 drop，definition/export 留在 audit artifact。

### 8.3 `link_workspace_identity(...)`

- Current：Security Definer；依 `user_code` link Auth identity。
- Risk：同樣依賴 legacy code；不符合 One Identity architecture。
- Decision：不進 permanent runtime。
- Grants：revoke anon；migration完成後 revoke authenticated and retire。
- Replacement：Shared IdentityManager 讀現有 Supabase session，不執行 legacy link。

## 9. Constraint Design

### 9.1 Auth foreign key

推薦：

```text
app_users.auth_user_id UNIQUE
app_users.auth_user_id FK → auth.users(id) ON DELETE RESTRICT during migration
```

Supabase 官方建議只 reference `auth.users` primary key。是否使用 CASCADE 必須依 account deletion policy 決定；Financial Data 不建議未經 retention decision 自動 cascade，因此 Gate 2 推薦 `RESTRICT`，由正式 deletion workflow 處理。

最終 Investment Table：

```text
user_id uuid NOT NULL FK → auth.users(id)
```

### 9.2 Cross-owner portfolio constraint

單一 `portfolio_id → portfolios.id` 只能證明 portfolio 存在，不能證明同 owner。推薦評估：

```text
portfolios UNIQUE (id, user_id)
child FOREIGN KEY (portfolio_id, user_id)
      REFERENCES portfolios(id, user_id)
```

此 composite constraint 可在 RLS 之外阻擋 cross-user portfolio linkage。

### 9.3 Unique constraints

- `opening_positions` unique 已包含 `user_id`，保留並轉換 canonical UUID。
- `watchlists` unique 已包含 `user_id`，保留。
- `user_settings` unique 已包含 `user_id`，保留。
- `transactions` 不建立 naive unique；同日同 symbol/price/quantity 可能是真實多筆交易。未來需明確 `source_event_id`/idempotency key。
- `strategies` 與 `decision_logs` 不應用文字欄位推斷 duplicate。

## 10. Index Design

先建立 policy/ownership 所需 index，再依 query evidence 評估 composite index。

| Proposed index | Query purpose | Expected benefit |
| --- | --- | --- |
| every Investment table `(user_id)` | RLS owner predicate | 避免 RLS full scan |
| `portfolios(user_id, is_default)` | current default portfolio | fast identity landing query |
| `opening_positions(user_id, portfolio_id, market, symbol, bootstrap_at desc)` | current positions view | latest snapshot lookup |
| `transactions(user_id, portfolio_id, trade_date desc)` | recent transactions | user/portfolio timeline |
| `watchlists(user_id, created_at desc)` | user watchlist | ordered module list |
| `strategies(user_id, symbol)` | symbol research lookup | already partially present；verify usage |
| `decision_logs(user_id, created_at desc)` | AI decision timeline | avoids missing FK/index warning |

不立即刪除 Advisor 標記 unused 的 index；需取得 production `pg_stat_user_indexes` observation window 與 query plan。

## 11. Grant Policy

Target minimum grants：

- `anon`：no Investment table/view/function privileges。
- `authenticated`：只授權實際使用的 SELECT/INSERT/UPDATE/DELETE；仍受 RLS。
- Identity claim/log：不授權 client roles。
- `service_role`：server only；secret 不得進 browser、GitHub Pages 或 Module config。
- Function EXECUTE：逐 function grant，禁止沿用 public/default execute。

## 12. Security Test Gate

必須建立兩個測試 Auth UUID：User A、User B。

| Test | Expected |
| --- | --- |
| A reads A rows | PASS |
| A reads B rows through table | 0 rows |
| A reads B rows through each view | 0 rows |
| A updates/deletes B row | denied |
| anon accesses table/view/RPC | denied |
| AAL1 writes transaction | denied |
| AAL2 writes own transaction | PASS |
| AAL2 writes another owner | denied |
| service operation | server-only + audit evidence |

## 13. PM Decision Points

1. 核准 Security Option 2：AAL1 read、AAL2 sensitive mutation/export。
2. 核准 AAL2 Module Unlock 建議時效（建議 10 分鐘）。
3. 核准總資產/損益 AAL1 顯示 + Privacy Mask，而非進入 Module 即 AAL2。
4. 核准 `claim_legacy_workspace`、`link_workspace_identity` 在 migration 後下架。
5. 核准 `my_workspace_view` retire；另外兩個 View 採 security-invoker。
6. 核准 `auth.users` FK deletion behavior（推薦 RESTRICT + explicit deletion workflow）。
7. 核准 decision log append-only strategy。
