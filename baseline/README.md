# Phase 1 local baseline

Frozen upstream: `gloom-sh/gloomberb@62317c477c1ef9b8394a12eac971c5546441b76e` (MIT).

The inherited Taiwan source is the current, frozen working tree of `/Users/qq/Documents/Gloomberb Taiwan Provider Spike/upstream`: modified `src/plugins/catalog.ts`, plus `src/plugins/builtin/taiwan/` and `src/sources/taiwan-provider/`. The spike HEAD is still the frozen upstream SHA; those adapter files were not committed there. This Lab deliberately preserves them in its own baseline commit.

No profile, account configuration, credentials, cache or Git internals are copied. The upstream source and MIT notice are retained under `upstream/`. Lab runtime profiles and caches are isolated and ignored.

The protected source manifest records hash-only source evidence, not runtime cache or Git internals. Run `bun tools/isolation-audit.ts` after QA to compare the protected trees.
