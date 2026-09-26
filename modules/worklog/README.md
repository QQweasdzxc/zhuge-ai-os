# WorkLog Module

WorkLog is the first Zhuge AI OS module. Its business logic and validated UI
remain stable while the internal directory is prepared for staged modularization:

```text
modules/worklog/
├── pages/
├── components/
├── services/
├── models/
├── config/
├── assets/
└── index.html (current compatibility entry)
```

The module may depend on `shared/*` only. It must not own Google Login,
Supabase initialization, root routing, or the global theme.
