# Production Dependency Audit — 2026-10-01

## Results

| Surface | Canonical path kept | Removed Lab relationship | Evidence / consequence |
|---|---|---|---|
| SkyEye Production | `modules/skyeye/`, `supabase/functions/zhuge-skyeye-read/` | None | Formal entry, shared contract, provider adapter and tests remain. Searches outside `skyeye-next/` found no import, route, test, or build reference to `skyeye-next`. |
| SkyEye Jimmy/God's Eye | None in formal AIOS | `skyeye-next/` relocated | Standalone Vite application with its own package/scripts and relative internal imports. It was not a production module import. It was statically addressable under the root site; a later static-site publish from this candidate would remove that experimental URL. No deploy was performed. |
| Investment Production | `modules/investment/`, `app/Board/investment/` | None | AI Board Investment surface imports canonical Investment services/assets; related consumers, not duplicate implementations. Provider/Evidence/Context Pack/Analysis/P&L sources are untouched. |
| Fubon read-only SDK proof | None as a Production adapter | `tools/fubon-readonly-adapter/` plus workflow relocated | Manual workflow and adapter were the isolated proof surface. No surviving Production Edge Function or runtime import depends on this SDK package. Existing Fubon screenshot/source labels in Investment are provenance values and were intentionally preserved. |
| Lab Center | `labs/registry.json`, `labs/README.md`, `modules/labs/` | No Lab source import | Registry-driven metadata only. UI opens loopback Lab URLs; it does not bundle Lab source. Current start copy is Genspark-specific, so no new entries were fabricated. |
| Browser / FullSource build | Root static tree and formal modules | `skyeye-next/` removed from Candidate | This was static-tree exposure, not an import. Candidate is not deployed; URL impact is explicit in the hygiene record. |

## Search and retention checks

- Search across remaining AIOS source/tests/workflows for `skyeye-next` produced no consumer references.
- Search for `fubon-readonly-adapter`, `FUBON_`, and `skyeye-next` outside moved source found only canonical Investment screenshot-import/source-provenance references to Fubon; no SDK or credential dependency remains.
- Canonical `modules/investment/`, `modules/skyeye/`, `supabase/functions/zhuge-skyeye-read/`, `tests/investment/`, and `tests/skyeye-*` paths remain present.
- Existing Supabase Functions, migrations, Cloud contracts, workflow bindings, and Product Data were not changed.

## Runtime status

No Production deployment or authenticated Production runtime was performed. Consequently **Production Runtime is NOT RE-VERIFIED by this cleanup**. The cleanup does not claim a new Runtime PASS. It only preserves canonical Production source paths and separates experiment source.
