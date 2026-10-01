# Coding Standard

- Keep UI, domain logic, and data access separate.
- Keep one implementation for Auth, Google, Supabase, Router, Theme, and AI.
- Prefer small pure functions and explicit contracts.
- Do not add a compatibility copy when a shared service already exists.
- Do not change validated WorkLog behavior as part of Foundation work.
- Avoid hidden network calls in rendering code.
- Use `zh-TW` and `Asia/Taipei` for product-facing dates and labels.
- Run syntax checks and static path checks before every release.
