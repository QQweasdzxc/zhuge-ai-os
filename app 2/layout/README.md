# Application Layout

Layout is the structural layer between the root shell and a module view.

```text
Root Shell → Layout → Module View
```

Dashboard owns the portal content. Modules own their business screens. A
module must never render the root Dashboard hero inside its own layout.
