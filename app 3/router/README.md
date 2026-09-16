# Zhuge AI OS Root Router

`index.js` defines the single-entry application contract:

```text
/ → app/dashboard/ → modules/worklog/
```

The root router owns AI OS 首頁到工作模組的導航。A module owns its own
internal views and may depend on `shared/*` only; it must not import another
module.
