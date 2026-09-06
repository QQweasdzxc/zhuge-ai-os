# Shared AI Service

Mr. KM is a shared AI capability, not a WorkLog-owned implementation.

```text
Module → Mr. KM → Prompt / Memory / Knowledge / Embedding
```

The current `index.js` is a side-effect-free contract. Provider calls and
domain prompts must be implemented behind this boundary; modules must not copy
their own AI client or memory store.
