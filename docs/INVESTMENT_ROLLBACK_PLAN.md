# Investment Gate 2 — Rollback Plan

Document Version: 1.0
Decision Status: Proposed for PM Review
Execution Status: Not Authorized
Applies To: Option B UUID Migration and Security Cutover

## 1. Rollback Principles

1. Financial ownership 錯置一律優先 rollback，不以 UI workaround 繼續。
2. Rollback 不得恢復 `USING (true)` / `WITH CHECK (true)` 的不安全狀態。
3. Schema、Data、Security、Runtime 四層各自有 rollback artifact，但必須由同一 Runbook 協調。
4. 若 rollback 會遺失 cutover 後資料，必須停止並改用 restore/forward recovery，不可直接覆蓋。
5. 每次 rollback 都要產生 incident ID、decision owner、timestamp 與 evidence。

## 2. Recovery Assets

Migration 前必須具備：

- Full database backup / Supabase PITR reference。
- Schema-only dump。
- Investment tables before snapshot。
- Legacy owner mapping manifest。
- View definitions and grants before/target。
- RPC definitions and grants before/target。
- RLS policies and table grants before/target。
- Previous and target Runtime Source/UAT artifact。
- Financial aggregate and checksum snapshot。
- Forward migration and rollback migration checksum。

缺一即 No-Go。

## 3. Rollback Windows

| Window | Time | Allowed recovery |
| --- | --- | --- |
| W0 | Before first committed mutation | Cancel；no rollback needed |
| W1 | Inside migration transaction | SQL transaction rollback |
| W2 | Schema/backfill committed, runtime not cut over | Reverse migration；legacy runtime remains primary |
| W3 | Runtime cutover ≤ 24 hours | Hot runtime rollback + dual-column consistency verification |
| W4 | 24 hours to 7 days | PM/Tech Lead incident decision；reverse cutover only if no ambiguous/new owner data, otherwise PITR/forward fix |
| W5 | After 7-day stabilization sign-off | No routine schema rollback；forward remediation or formal backup restore incident |

建議 legacy owner evidence 保留 30 天，但 retention 不代表 30 天內都能無損熱回滾。

## 4. Rollback by Migration Stage

### Stage 0 — Discovery / Design

- Mutation：None。
- Recovery：刪除未核准 design artifact 或重新 review。
- Database impact：None。

### Stage 1 — Schema preparation transaction

包含 temporary `auth_user_id`、FK/index/shadow contract。

- Before commit：transaction rollback。
- After commit but before backfill：repeatable rollback migration 移除新物件。
- Do not touch legacy `user_id`。

### Stage 2 — Canonical owner backfill

- Backfill 必須在可控 transaction/batch boundary。
- Rollback 清空或移除 temporary canonical column values，不改 legacy owner。
- 若 row count 不符，整個 batch rollback；禁止手工修單筆後繼續。

### Stage 3 — View/RPC/RLS shadow validation

- Shadow objects 使用 versioned name，不覆蓋 Production contract前先驗證。
- Fail 時移除 shadow grants/object；legacy runtime不變。
- 不需要 restore data。

### Stage 4 — Runtime cutover

- 回切前一個正式 Source/UAT build。
- Shared OAuth/Session/Router 不在 migration scope，不應更換。
- 確認舊 runtime 仍可透過安全 legacy compatibility policy 使用 legacy owner。
- 清除 Investment Module cache、unsubscribe Realtime、重新取得 session。

### Stage 5 — Final owner swap

Final transaction 預計：

```text
user_id (legacy) → legacy_user_id
auth_user_id      → user_id
```

- Transaction 未 commit：直接 rollback。
- 已 commit：只有 `legacy_user_id` 完整、dual-column invariant PASS、無 ambiguity 時才允許 reverse swap。
- 有 cutover 後新 rows 時，必須先確認每筆 `user_id` 可反向對應唯一 `app_users.id`。
- 無法唯一反向 mapping 時禁止 reverse SQL，改用 PITR/forward correction。

### Stage 6 — Legacy removal

- 只能在 W5 前 PM Sign-off 後執行。
- 一旦 drop legacy owner 且有新 writes，常規 reverse migration 結束。
- 之後 rollback 需要 backup restore 或 forward migration。

## 5. Restore Legacy `user_id`

Option B 的 rollback key 是保留的 `legacy_user_id` + mapping manifest。

允許 reverse 的必要條件：

- `legacy_user_id` non-null for every row in legacy runtime scope。
- `legacy_user_id → app_users.id` exists。
- Canonical `user_id → app_users.auth_user_id` relationship unique。
- Row count and financial aggregate unchanged。
- New canonical-only row count = 0，或每筆已取得唯一 reverse mapping。

不允許使用：

- `user_code` 猜測 owner。
- Current login user 取代 missing owner。
- Email string 作為唯一 mapping key。
- `LIMIT 1` 消除 duplicate。

## 6. Restore View / RPC

### Views

Rollback artifact 必須保存 exact `pg_get_viewdef` 與 grants。

- 若新 security-invoker view 有 functional regression，可恢復上一版 query definition。
- **不得**恢復成對 anon 可用的 Security Definer View。
- Legacy runtime compatibility 必須透過 security-invoker + secure underlying RLS，或受控 authenticated RPC。

### RPC

- `get_my_workspace_summary` 可在 rollback window 暫時恢復 authenticated EXECUTE。
- `claim_legacy_workspace` 與 `link_workspace_identity` 不因 UI rollback自動恢復。
- 若 migration operator確實需要 legacy RPC，僅由受控 server/DB role 執行，不重新 grant anon。
- Function 必須固定 search path 並保留 auth.uid verification。

## 7. RLS Rollback

### Never do

- Disable RLS on exposed Investment tables。
- Restore Phase 1 `USING (true)` policies。
- Grant anon access as a compatibility shortcut。

### Secure legacy compatibility policy

若舊 runtime仍傳 legacy `app_users.id`，rollback policy 必須驗證：

```text
Investment.user_id
    → app_users.id
    AND app_users.auth_user_id = auth.uid()
```

這是 rollback-only compatibility policy，不是 final target。Final target仍是 direct `user_id = auth.uid()`。

### AAL rollback

- AAL2 mutation enforcement 不應因 UI rollback移除。
- 若舊 runtime不支援 Step-up MFA，Financial mutation應保持disabled，直到安全 runtime回復。
- Read-only rollback比恢復不安全 writes優先。

## 8. Backup Restore Conditions

使用 full backup/PITR，而不是 reverse migration，若：

- Legacy owner column已移除且 mapping無法重建。
- Cutover後資料被錯 owner修改。
- Financial aggregate drift無法定位。
- Partial DDL/DML跨越多個 non-transactional boundary。
- View/RPC exposure造成資料外洩，需要 incident containment。
- Reverse migration本身驗證失敗。

Restore 需在 isolated/staging先驗證，Production restore需要 PM + Technical Lead雙重批准。

## 9. Runtime Rollback

```text
Disable Investment module flag
    ↓
Stop writers / Realtime subscription
    ↓
Deploy previous approved build
    ↓
Verify Shared Session unchanged
    ↓
Run read-only legacy compatibility smoke test
    ↓
Keep financial mutation disabled until DB security confirmed
```

不得回滾 Dashboard、OAuth、Shared Session、Router 或 WorkLog，除非另有獨立 incident evidence；它們不屬 Investment migration。

## 10. Rollback Triggers

### Immediate / automatic stop

- Auth UUID mapping mismatch。
- NULL/orphan/cross-owner row > 0。
- Financial aggregate mismatch。
- A sees B data through Table/View/RPC。
- anon can access Investment object。
- AAL1 transaction write succeeds。
- Runtime error rate/authorization rejection超過核准 threshold。
- Backup/restore evidence invalid。

### PM decision required

- Performance degradation without data/security impact。
- Minor UI regression with safe read-only operation。
- Advisor INFO-only index warning。
- External Supabase service incident unrelated to migration。

## 11. Post-rollback Validation

- Schema fingerprint equals selected rollback target。
- Runtime Version/Build/Commit match rollback artifact。
- All Investment rows use expected owner semantics for that runtime。
- Counts and financial aggregates equal rollback baseline。
- Table/View/RPC isolation matrix PASS。
- OAuth、Session、Dashboard、WorkLog regression PASS。
- No legacy claim endpoint exposed to anon。
- Incident report and PM acceptance complete。

## 12. Evidence

每次 rollback保存：

- Trigger reason and detected timestamp。
- Decision owner。
- Runtime and schema version before/after。
- Executed rollback script SHA。
- Row/financial before-after report。
- Isolation test。
- Monitoring summary。
- Follow-up prevention action。

## 13. PM Decision Points

1. 核准 W3 hot rollback window = 24 hours。
2. 核准 stabilization window = 7 days。
3. 核准 legacy owner evidence retention = 30 days。
4. 核准「rollback不得恢復 permissive RLS/anon grants」。
5. 核准舊 Runtime若不支援 AAL2，rollback時只允許 read-only。
6. 指定 Production restore 的雙重批准人。
