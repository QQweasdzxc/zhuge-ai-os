# Zhuge AI OS Architecture

Status: Current architecture reference. Historical release, migration, and QA
records remain in their original locations and do not override this document.

The detailed Foundation contracts are documented in `FOUNDATION.md` and
the companion module, naming, UI, coding, and release specifications.

## Repository and Foundation decision

`zhuge-ai-os` is the only active development repository. The existing
`worklog-workspace` repository is now a read-only historical archive whose
root redirects to the new AI OS entry point.

## Current runtime and sitemap shape

```text
Root / public landing (`app/dashboard/`)
  ↓
Authenticated WorkLog shell (`modules/worklog/?app=1`)
  ├─ 工作空間
  │   ├─ WorkLog (`modules/worklog/?app=1&workspace=worklog`)
  │   ├─ 工作待辦 (`app/Board/worktodo/`)
  │   ├─ AI Board (`app/Board/ai/`)
  │   ├─ 庶務行政 / GAS (`app/Board/procurement/`)
  │   └─ Investment domain (`modules/investment/`); C Board (`app/Board/investment/`)
  ├─ Knowledge (`modules/worklog/?app=1&workspace=library`)
  ├─ 控制台 (`modules/worklog/?app=1&workspace=sync`)
  ├─ 管理功能 / Management Center (`modules/worklog/?app=1&workspace=management`)
  └─ 設定 (`modules/worklog/?app=1&workspace=settings`)

C Mother / Golden Master (`app/Board/template-preview/`)
  └─ canonical Template C source and shared board capability reference

HR and Travel are registered development-only, disabled entries. They are not
current production workspaces and must not be represented as active Runtime
Consumers.
```

## Boundaries

```text
app/       Root shell, layout, Dashboard, and router boundary
shared/    Single implementations of platform contracts
modules/   Independent product modules
assets/    Public static assets
config/    Repository-level configuration boundary
docs/      Architecture and migration decisions
public/    Public/static supporting assets
tests/     Regression and migration tests
```

## Module and Shared Runtime layers

```text
Module A = Navigation / Shell
Module B = Workspace / Composition
Module C = Board / Golden Master / shared board capabilities

Module C shared runtime
  ├─ `shared/components/golden-master-runtime.js`
  ├─ `shared/board/board-read-service.js`
  ├─ `shared/components/task-action-contract.js`
  ├─ `shared/components/task-action-adapters.js`
  └─ `shared/components/{task-board,task-card,task-drawer,workspaces}.js`
```

Module C is the shared capability and authority layer. The current C Runtime
set is C Mother, AI Board, WorkTodo, GAS, and Investment. C Mother is the
canonical source/reference; the four product Consumers retain their own data,
domain configuration, and permitted capability boundaries.

## Shared Foundation

```text
shared/
├── identity/       Canonical immutable Auth UUID / public identity contract
├── auth/           Validated OAuth runtime + redacted Shared Session adapter
├── security/       Capability and ADR-013 Security Gate contracts
├── core/           Compatibility facades + workspace/navigation managers
├── board/          Canonical Board read/runtime contract
├── services/       ModuleContext, release/adoption, and platform composition
├── ai/index.js     Mr. KM capability boundary
├── config/         Environment, OAuth, Supabase, version, feature flags
├── assets/logo/    Shared Zhuge AI OS brand mark
├── app-config.js   Validated WorkLog compatibility config
├── app-state.js
├── app-router.js
├── auth/auth-service.js
├── google/google-drive-service.js
├── api/{data-service,knowledge-api,repositories,realtime-service,services}.js
├── components/{golden-master-runtime,task-action-contract,task-action-adapters,
│               task-board,task-card,task-drawer,workspaces}.js
├── theme/          Runtime styles and Foundation tokens
├── i18n/zh-TW.js
└── utils/{shared-utils,render-engine,priority-engine}.js
```

All current Board Consumers load the validated C implementations from
`shared/*`; a Consumer may supply data, domain configuration, and callbacks but
does not own a second Board, Movement, Completion, Archive, or persistence
engine. WorkLog-specific compatibility storage remains a historical/domain
boundary and is not the formal WorkTodo Board data source.

## Module shape

```text
modules/<module>/
├── pages/
├── components/
├── services/
├── models/
├── config/
├── assets/
└── index.html
```

The WorkLog entry remains in `modules/worklog/index.html` as the WorkLog domain
and shell entry. Board Consumers use their explicit `app/Board/*` entries.
Modules may depend on `shared/*` only and must not import or reach into another
module.

## Module C current contract

The C contract is capability-shared and data-independent:

| Concern | Canonical authority | Consumer boundary |
|---|---|---|
| Board/card/workspace operations | Shared C Board Runtime and controlled Board RPCs | Consumer data and context only |
| Movement / completion decision | `board_c_reconcile_workspace_decision_v2` | Consumer workflow definition and designation |
| Completion/archive lifecycle | C lifecycle contract `module-c-lifecycle-acceptance-v2` | Consumer may have Completion/Archive capability or N/A |
| Current archive policy | `private.module_c_completion_archive_policies` | No consumer-local interval or due calculation |
| Task deletion | `board_instance_delete_task` | Immutable deletion manifest and `task_deleted` evidence are storage only |
| Release identity | Published `module_releases` source identity | Adoption stores server-derived Published identity |
| Runtime health | `public.board_c_authority_conformance_check(uuid)` | Management Center reads and displays; it does not re-score |

Workflow is an optional capability. `NOT_CONFIGURED` / `N/A` is legal; a
configured Consumer Workflow remains Consumer-owned and does not replace the
shared C engines or authority contracts.

The current formal C Completion policy is 24 hours (`86400` seconds), starting
at the actual Completion entry event. It is not based on creation time or last
edit time. Existing lifecycle timestamps retain their historical meaning.

## Release identity boundary

Development Source identity and Published Runtime identity are separate. The
root `version.json.build` is the current Source Build Identity; the Published C
identity is read from Cloud `module_releases` (`published_version`,
`published_build`, `source_commit`, and `source_fingerprint`). A Development
Source may be ahead of Published C and must not be presented as Published.

Consumer adoption source identity is server-derived from the Published Release;
Version/Build alone is not a complete identity. Legacy adoption records without
persisted source fields may be read-resolved from an exact Published Release,
but are not silently backfilled.

## Historical boundary

The original Foundation v1 release (`0.9.0-alpha.8.4` /
`20260731-0905`) is historical provenance only. It is not the current Product,
Runtime, or Published C identity. Current release rules and identity sources
are defined in [`RELEASE.md`](../10_GOVERNANCE/RELEASE.md).

## Architecture Decision Records

The following records are part of the Architecture Bible and are binding for
all current and future modules:

- [`ADR-011 — Module Independence Principle`](../10_GOVERNANCE/adr/ADR-011-module-independence.md)
- [`ADR-012 — Shared First Principle`](../10_GOVERNANCE/adr/ADR-012-shared-first.md)
- [`ADR-013 — Security Level Policy`](../10_GOVERNANCE/adr/ADR-013-security-level-policy.md)

Investment Gate 1 database evidence is recorded in
[`DATABASE_DISCOVERY.md`](../90_ARCHIVE/DATABASE_DISCOVERY.md). No Module may bypass an ADR
through a local implementation or a compatibility copy.

Investment Gate 2 design contracts are recorded in:

- [`UUID_MIGRATION_STRATEGY.md`](../90_ARCHIVE/UUID_MIGRATION_STRATEGY.md)
- [`INVESTMENT_SECURITY_REMEDIATION.md`](../90_ARCHIVE/INVESTMENT_SECURITY_REMEDIATION.md)
- [`INVESTMENT_MIGRATION_RUNBOOK.md`](../90_ARCHIVE/INVESTMENT_MIGRATION_RUNBOOK.md)
- [`INVESTMENT_ROLLBACK_PLAN.md`](../90_ARCHIVE/INVESTMENT_ROLLBACK_PLAN.md)
- [`INVESTMENT_DATA_HEALTH_CHECK.md`](../30_QA/INVESTMENT_DATA_HEALTH_CHECK.md)

These documents are design-only until PM explicitly authorizes Database
Migration and Coding.

Investment Gate 3 Shared Platform evidence is recorded in
[`SHARED_PLATFORM_ARCHITECTURE_REVIEW.md`](../90_ARCHIVE/SHARED_PLATFORM_ARCHITECTURE_REVIEW.md).
It introduces no WorkLog load-path, OAuth, Router, or database change.
