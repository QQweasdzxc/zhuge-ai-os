# Module Specification

## Required module shape

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

## Rules

- A module owns only its business logic and presentation.
- A module can depend on `shared/*` only.
- A module must not import another module.
- A module must read the shared identity/session and never start OAuth itself.
- A module must use shared services for persistence and integrations.
- A disabled module is represented by a launcher state, not a fake feature.

## Current modules

| Module | State | Purpose |
| --- | --- | --- |
| WorkLog | Available | 工作、工時與待辦事項 |
| Investment | 開發中 | 市場資訊與投資分析 |
| Travel | 開發中 | 旅遊規劃與景點資訊 |
| HR | 開發中 | 人員與工作協作 |
| Knowledge | Shared capability | Mr. KM 的知識來源 |
