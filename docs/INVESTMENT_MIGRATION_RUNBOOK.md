# Investment Gate 2 — Migration Runbook

Document Version: 1.0
Decision Status: Proposed for PM Review
Execution Status: Not Authorized
Selected Strategy: Option B candidate（Dual-column validation）

## 1. Purpose

本 Runbook 定義 Investment owner UUID、View、RPC、RLS 與 Runtime cutover 的正式執行順序。它是操作規格，不是本 Gate 的執行授權。

任何 Production 執行都需要：

- PM Gate 2 Design Approval。
- DBA/Technical Lead execution owner。
- Approved Migration SHA 與 rollback artifact。
- Scheduled maintenance window。
- Full backup verified restorable。
- UAT identity A/B accounts ready。

## 2. Roles

| Role | Responsibility |
| --- | --- |
| PM / Product Owner | Gate decision、identity attestation、financial acceptance、go/no-go |
| Technical Lead | Migration owner、dependency order、stop decision |
| Database Operator | Backup、migration execution、catalog evidence、restore |
| QA | two-user isolation、financial comparison、runtime regression |
| Security Reviewer | RLS/View/RPC/grant/AAL verification |

同一人可以兼任角色，但 execution、evidence review 與 PM acceptance 不得被單一未覆核結果取代。

## 3. Required Inputs

- Gate 1 [`DATABASE_DISCOVERY.md`](DATABASE_DISCOVERY.md)。
- Approved [`UUID_MIGRATION_STRATEGY.md`](UUID_MIGRATION_STRATEGY.md)。
- Approved [`INVESTMENT_SECURITY_REMEDIATION.md`](INVESTMENT_SECURITY_REMEDIATION.md)。
- [`INVESTMENT_DATA_HEALTH_CHECK.md`](INVESTMENT_DATA_HEALTH_CHECK.md) query set。
- [`INVESTMENT_ROLLBACK_PLAN.md`](INVESTMENT_ROLLBACK_PLAN.md)。
- Schema-only dump、full database backup、migration scripts、rollback scripts。
- Source/UAT artifacts with one Release Identity。

## 4. Global Stop Rules

任一條件成立，立即停止且不得「先做完再看」：

- Backup 未完成 restore test。
- Mapping B/C/D/E 未清零或未有 PM override。
- Read/write freeze 無法確認。
- Before financial evidence 不完整。
- Migration SQL hash 與核准版本不同。
- Row count、owner mapping、currency、market 或 financial aggregate drift。
- 任一 anon access、cross-user access 或 AAL bypass 測試成功。
- Runtime build、schema version、migration version 不一致。

## 5. Execution Sequence

### Step 1 — Maintenance / Freeze

| Field | Definition |
| --- | --- |
| Input | Approved window、current runtime build、active session report |
| Action | 顯示 maintenance；停止 Investment writes/import；記錄 freeze timestamp；WorkLog 不停機 |
| Expected Result | Freeze 後 Investment mutation count = 0；existing reads 可依計畫維持或停止 |
| Blocking Condition | 仍有 client/cron/realtime writer；無法識別 writer source |
| Rollback Trigger | Freeze 影響非 Investment module；maintenance routing 異常 |
| Evidence Required | PM 截圖、request log、active writer list、freeze timestamp |

### Step 2 — Full Backup

| Field | Definition |
| --- | --- |
| Input | Production DB ref、backup destination、retention policy |
| Action | 建立 Supabase/PITR可用 backup + schema-only dump + relevant table export |
| Expected Result | Backup ID、size、checksum、timestamp 完整；restore rehearsal PASS |
| Blocking Condition | 無可驗證 backup、restore credentials/space 不足、checksum mismatch |
| Rollback Trigger | Backup process alters availability or fails integrity check |
| Evidence Required | Backup ID、checksum、restore rehearsal log、storage location owner |

### Step 3 — Pre-migration Health Check

| Field | Definition |
| --- | --- |
| Input | Approved read-only health-check SQL |
| Action | 產生 schema、mapping、FK、duplicate、row count、financial before snapshot |
| Expected Result | 所有 query 成功；blocking count = 0；snapshot signed off |
| Blocking Condition | NULL/orphan/duplicate owner、financial formula unavailable、query error |
| Rollback Trigger | None；尚未 mutation。Fail = cancel migration |
| Evidence Required | Timestamped CSV/JSON、query hash、operator、PM acknowledgment |

### Step 4 — Legacy Mapping Validation

| Field | Definition |
| --- | --- |
| Input | `app_users.id ↔ auth_user_id` report、PM identity attestation |
| Action | 將每個 owner 分類 A/B/C/D/E；只允許 A 進入 mapping manifest |
| Expected Result | A rows cover 100% migration scope；B/C/D/E = 0 |
| Blocking Condition | identity disputed、Auth UUID missing、multi-map、unknown legacy code |
| Rollback Trigger | None；尚未 mutation |
| Evidence Required | Mapping manifest hash；不在一般 artifact 暴露 Email/UUID明文 |

### Step 5 — Schema Preparation

| Field | Definition |
| --- | --- |
| Input | Approved repeatable migration；Option B target schema |
| Action | 在 transaction-aware migration 中新增 nullable canonical owner column、FK/index/shadow contracts；不移除 legacy owner |
| Expected Result | Migration 可重跑；legacy runtime 尚可運作；new column initially nullable |
| Blocking Condition | lock time超標、DDL error、constraint validation failure、unexpected dependency |
| Rollback Trigger | transaction error、lock contention、schema fingerprint mismatch |
| Evidence Required | Migration version、SQL checksum、before/after catalog、lock duration |

### Step 6 — Data Migration

| Field | Definition |
| --- | --- |
| Input | Approved A mapping manifest、frozen rows |
| Action | 依 legacy owner → app_users.auth_user_id backfill canonical owner；不得以 current session取代 unknown owner |
| Expected Result | Every scoped row canonical owner non-null and valid Auth UUID |
| Blocking Condition | affected row count不等於 manifest、mapping changed、conflict/timeout |
| Rollback Trigger | partial backfill、unexpected row mutation、owner mismatch |
| Evidence Required | Per-table expected/affected counts、transaction ID、mapping hash |

### Step 7 — Row-count Validation

| Field | Definition |
| --- | --- |
| Input | Before snapshot、post-backfill tables |
| Action | 比對 total、per owner、per portfolio、NULL/orphan/duplicate counts |
| Expected Result | Counts exact match；owner null/orphan/duplicate = 0 |
| Blocking Condition | 任一 count drift 或 row missing/additional |
| Rollback Trigger | Count mismatch not explained by approved transformation |
| Evidence Required | Before/after diff report、zero-drift sign-off |

### Step 8 — Financial Aggregate Validation

| Field | Definition |
| --- | --- |
| Input | Before financial snapshot、same formula/query version after migration |
| Action | 比對 invested cost、market value、unrealized P&L、currency、market、transaction cashflow；realized P&L 使用已核准 engine |
| Expected Result | Exact decimal equality or approved rounding tolerance only |
| Blocking Condition | Formula未定、currency/market drift、任何 unexplained amount drift |
| Rollback Trigger | Financial mismatch |
| Evidence Required | Per owner/portfolio/currency/market diff、formula version、tolerance decision |

### Step 9 — Foreign Key Validation

| Field | Definition |
| --- | --- |
| Input | Canonical owner data、target Auth/portfolio constraints |
| Action | Validate Auth FK、portfolio FK、composite owner chain、constraint status |
| Expected Result | All constraints validated；cross-owner references = 0 |
| Blocking Condition | orphan Auth/portfolio、unvalidated constraint、cross-owner link |
| Rollback Trigger | Constraint cannot validate without altering financial data |
| Evidence Required | Constraint catalog、validation output、orphan query result |

### Step 10 — View / RPC Remediation

| Field | Definition |
| --- | --- |
| Input | Security remediation decisions、dependency inventory |
| Action | Views改 security-invoker或retire；legacy RPC restrict/retire；function search_path/grants最小化 |
| Expected Result | No Security Definer View；no anon Investment RPC；legacy claim path disabled as scheduled |
| Blocking Condition | Runtime仍依賴 retired object、Advisor error仍存在、function privilege過寬 |
| Rollback Trigger | Required read contract unavailable、dependency regression |
| Evidence Required | View/function definitions、grants、Advisor result、dependency test |

### Step 11 — RLS Enablement

| Field | Definition |
| --- | --- |
| Input | Canonical owner column、approved per-table policies、minimum grants |
| Action | Replace always-true policies；apply owner policies and AAL2 restrictive policies；revoke anon |
| Expected Result | authenticated own-row access only；sensitive writes require AAL2 |
| Blocking Condition | policy compile error、UPDATE lacks SELECT、owner query unindexed |
| Rollback Trigger | Own-row access unavailable or unauthorized access possible |
| Evidence Required | Policy catalog、grant catalog、Advisor output、query plans for owner predicate |

### Step 12 — Multi-user Isolation Test

| Field | Definition |
| --- | --- |
| Input | Test User A/B、AAL1/AAL2 sessions、known isolated fixtures |
| Action | Table/View/RPC CRUD positive/negative matrix；anon tests；cross-owner portfolio attempt |
| Expected Result | Own operations follow policy；all cross-user/anon attempts denied or return zero rows |
| Blocking Condition | Any unauthorized row visible/mutable；AAL1 transaction write succeeds |
| Rollback Trigger | Security isolation failure |
| Evidence Required | Sanitized request/response matrix、JWT AAL label、zero sensitive payload exposure |

### Step 13 — Runtime Cutover

| Field | Definition |
| --- | --- |
| Input | Approved UAT build、schema version、Shared Gateway contract |
| Action | Deploy Investment module/repository that uses canonical owner；enable only after session/security gate |
| Expected Result | New runtime reads/writes canonical UUID；Dashboard/WorkLog unchanged |
| Blocking Condition | Build/schema mismatch、OAuth/Session regression、legacy direct REST still present |
| Rollback Trigger | Error rate、403 spike、financial mismatch、navigation/session regression |
| Evidence Required | Release identity、commit、deployment log、smoke/regression results |

### Step 14 — Legacy Path Disablement

| Field | Definition |
| --- | --- |
| Input | Stable canonical runtime、dependency proof、rollback retention policy |
| Action | Disable claim/link RPC and legacy entry；remove client grants；keep rollback-only owner evidence inaccessible to client |
| Expected Result | No Production client can call legacy identity path |
| Blocking Condition | Any current dependency or active legacy writer |
| Rollback Trigger | Canonical runtime requires missing bridge during approved rollback window |
| Evidence Required | Route/RPC/grant inventory、negative endpoint tests |

### Step 15 — Post-migration Monitoring

| Field | Definition |
| --- | --- |
| Input | Monitoring thresholds、rollback window、baseline metrics |
| Action | Monitor auth/RLS errors、mutation counts、aggregate drift、latency、Advisor/security logs |
| Expected Result | No owner drift、no unauthorized attempts succeeding、performance within threshold |
| Blocking Condition | Financial/security alert unresolved；evidence incomplete |
| Rollback Trigger | Defined thresholds in Rollback Plan exceeded |
| Evidence Required | 1h/24h/7d reports、PM acceptance、incident log if any |

## 6. Transaction Boundaries

### Must be one transaction

- Each table backfill batch when size permits。
- Final owner-column swap and dependent FK/index rename。
- Policy replacement for a single table where partial policy state would expose data。
- View definition + grants when old view would otherwise remain exposed。

### Cannot rely only on transaction rollback

- External backup/restore。
- Runtime/GitHub Pages deployment。
- Supabase Auth session/MFA enrollment state。
- Monitoring after real post-cutover writes。
- Any client-side cached data already delivered。

## 7. Evidence Package

```text
Investment_Migration_Evidence_<Build>/
├── 01-release-identity.md
├── 02-backup-restore-proof.md
├── 03-schema-before-after.json
├── 04-mapping-summary.json
├── 05-row-count-diff.csv
├── 06-financial-diff.csv
├── 07-fk-index-policy-catalog.json
├── 08-isolation-test.md
├── 09-runtime-regression.md
├── 10-advisor-results.md
└── 11-pm-signoff.md
```

Evidence 不得包含 access token、service role secret、完整 Email 或不必要的金融明細。

## 8. Cutover Go/No-Go

### GO only when

- Mapping 100% A。
- Backup restore PASS。
- Health check zero blocker。
- Financial snapshot可重算。
- View/RPC/RLS design已核准。
- Runtime UAT與兩使用者 isolation PASS。
- Rollback owner與時間窗已確認。

### NO-GO when

任一 input、expected result、evidence 或 rollback mechanism 不完整。

## 9. PM Decision Points

1. 核准 Option B 作為 Runbook baseline。
2. 核准 maintenance window 與最大 write freeze。
3. 核准 financial tolerance（推薦 decimal exact；只有 display rounding 可容忍）。
4. 指定 realized P&L 的正式 calculation engine/version。
5. 核准 stabilization/rollback window。
6. 指定 migration operator、security reviewer、PM sign-off owner。
