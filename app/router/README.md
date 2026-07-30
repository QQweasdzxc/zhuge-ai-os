# Root Router

`index.js` defines the root application contract:

```text
/ → app/dashboard/ → modules/worklog/
```

The root router owns Dashboard-to-module navigation. A module owns its own
internal views and may depend on `shared/*` only; it must not import another
module.
