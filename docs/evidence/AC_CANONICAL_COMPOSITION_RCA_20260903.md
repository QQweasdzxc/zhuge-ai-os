# A/C Canonical Composition RCA

## Scope

本次修復只處理正式模組 A／C 的 Runtime Composition、Consumer Capability
註冊與交付治理。Investment Snapshot Write、Screenshot Recognition、WorkLog
資料、Identity、OAuth、Supabase Schema／RLS 與正式金融資料均不在本次變更範圍。

## Root cause

### Module A

`shared/components/zhuge-navigation.js` 已是唯一正式 Navigation Source，但
`shared/services/template-adoption-policy.js` 的 page registry 沒有完整表達
管理功能與庶務行政的必要採用關係。結果是頁面存在既有內容，卻可能因 adoption
狀態而卸載正式 A；庶務行政也沒有被登記為 A／C Consumer。

### Module C

Investment adapter 已呼叫 Golden Master，但在共享 C 尚未載入時仍有
Investment-specific board/card/toolbar fallback。這會讓 Consumer 在錯誤載入鏈下
長出另一套呈現，而不是如實暴露 C 尚未載入。修復後 fallback 只顯示能力未載入
狀態，不再渲染第二套 Board／Card／Toolbar。

### Retired capability

「資料健康檢查（唯讀）」在 canonical C、C runtime 與 WorkTodo source 均不存在；
本次保留測試以防止 Consumer、Legacy Runtime 或 Adopt 流程使已移除 Capability
復活。

## Canonical composition map

| Consumer | Module A | Module C | Data / ownership |
| --- | --- | --- | --- |
| 管理功能 | `shared/components/zhuge-navigation.js` | 不使用 | `modules/worklog/worklog-app.js` 的既有管理內容 |
| 庶務行政 / GAS | `shared/components/zhuge-navigation.js` | `shared/components/golden-master-runtime.js` → `shared/components/golden-master.js` → `task-board.js` / `task-card.js` / `task-drawer.js` | PM-created C Consumer through `board_resolve_consumer_instance`; WorkLog / 庶務行政 |
| Investment / 投資組合 | `shared/components/zhuge-navigation.js` | `shared/components/golden-master.js` → `task-board.js` / `task-card.js` / `task-drawer.js` | `modules/investment/services/ivtk-board-adapter.js`；Investment / 投資組合 |

Consumer-specific code supplies only route mounting, data adapter, ownership and
business data slots. It does not own a Navigation／Board／Workspace／Card／Drawer
copy or a CSS imitation.

## Implemented safeguards

- Required A／C Consumers are represented in the canonical adoption registry and
  cannot be disabled through the adoption setter.
- `worklog-procurement` is included in the C publication/identity consumer set.
- Investment missing-capability paths are truthful unavailable states, never a
  consumer-specific presentation fallback.
- EP-039 now records the doctrine 「一個模組、各自資料」 and the rule that removed
  Module Capability cannot return through a Consumer.
- QAT-001 remains historical QAT data and is not projected into Investment.

## Verification boundary

Focused tests cover A/C registry composition, GAS/Investment source wiring,
retired-capability absence, Investment source identity, template publication and
machine parity. Final release identity, Candidate checksum and PM QA status are
recorded in the delivery response after the final build/package step.
