# EP-039 — ONE Golden Master — Single Presentation Source of Truth

Status: Mandatory Architecture Principle  
Decision Authority: PM / CTO  
Decision Date: 2026-08-21  
Canonical Runtime Source: `public.engineering_knowledge`  

This file is the reviewed governance payload and provenance reference for
EP-039. The canonical runtime Principle remains the approved record in
`public.engineering_knowledge`; this file is not a second runtime registry.

## Mandatory Rule

Zhuge AI OS 全系統只允許存在 ONE Golden Master。

Golden Master 是 Board-based Product 唯一的 Presentation / Interaction
Source of Truth。AI Board、WorkTodo，以及未來任何使用 Board Architecture
的 Consumer，皆不得擁有自己的 Presentation Template。

正式架構只有：

```text
                  ONE GOLDEN MASTER
                         │
             ┌───────────┴───────────┐
             │                       │
         AI Board                WorkTodo
             │                       │
           Data                    Data
           Domain                  Domain
           Permission              Permission
           Capability              Capability
           Callback                Callback
```

Consumer 僅能注入：

- Data
- Domain configuration
- Permission
- Capability
- Callback / Action Handler
- Consumer identity / label

Consumer 不得自行持有、複製、Override 或 Fork：

- Layout、DOM Structure、CSS、Typography、Dimensions、Spacing
- Toolbar、Workspace / Column Presentation、Card、Drawer、Properties
- Checklist、Attachment、Timeline / Progress、Buttons、Icons
- Empty State、Loading State、Modal
- Responsive Rules、Interaction Rules、Default Interaction State

## One Module, Separate Data

Zhuge AI OS 的組合原則是「一個模組、各自資料」：

```text
Module A (Navigation) = one canonical source
Module C (Board)      = one canonical source

Management       = A + management data
GAS              = A + C + GAS data + WorkLog ownership
Investment IVTK  = A + C + Investment data + Investment ownership
```

Consumer 直接 mount／compose 正式 Module Source；Consumer 只提供自己的
Data、Ownership、Identity、Permission、Capability 與 Business Data Slots。
Data Content 可以不同，但不得建立 Consumer-specific Navigation、Board、
Workspace、Card、Drawer 或以複製 CSS 取得的相似實作。若 PM 修改 A 或 C，
所有正式 Consumer 應透過同一份 Source 自然取得變更。

已從 A／C 正式移除的 Capability，不得透過 Consumer、Legacy Runtime、
Adopt／Merge 或 Deployment 再次出現。Machine Parity 用來偵測 Source
Identity 與 Drift，不能作為維護多份 Module Copy 的替代方案。

## Zero Consumer Presentation Rule

```text
Golden Master Source                 = 1
Presentation Source                  = 1
AI Board Presentation Implementation = 0
WorkTodo Presentation Implementation = 0
Consumer CSS Override                = 0
Consumer Layout Override             = 0
Consumer Card Implementation         = 0
Consumer Drawer Implementation       = 0
Consumer Toolbar Implementation      = 0
Consumer Responsive Implementation  = 0
```

Consumer 可以有不同資料與 Domain Behavior，但不能有不同 Presentation。

## Change Rule

任何共用 UI / UX / Interaction 修改只能修改 Golden Master。修改後，所有
Consumer 必須自然同步生效。若仍需另外修改 AI Board 或 WorkTodo 才能使
Presentation 一致，即違反 EP-039。

## Forbidden Pattern

不允許以「Golden Master、AI Board、WorkTodo 三套畫面看起來一樣」作為
驗收標準。正確模型是：

```text
AI Board UI = Golden Master Runtime
WorkTodo UI = Golden Master Runtime
```

Presentation 實際上只有一個；Consumer 只注入各自的 Data、Domain、
Permission、Capability、Callback 與 Identity。
