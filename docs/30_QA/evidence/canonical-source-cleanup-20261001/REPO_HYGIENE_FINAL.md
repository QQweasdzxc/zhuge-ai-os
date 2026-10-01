# Repo Hygiene Final — 2026-10-01

## Result

The local cleanup candidate keeps one canonical AIOS source path per retained capability and moves confirmed standalone experiments out of the formal AIOS source tree. No mainline history or remote reference was changed.

## Removed from the cleanup candidate source tree

| Source path | Destination | Verification |
|---|---|---|
| `skyeye-next/` | `/Users/qq/Documents/GitHub/zhuge-labs/skyeye/jimmy-runtime-clone/` | 1,605 tracked files; byte-for-byte `diff -qr` match to source at starting commit `248b1f78e043886976e135681ed9d8f149eb078b`. |
| `tools/fubon-readonly-adapter/` | `/Users/qq/Documents/GitHub/zhuge-labs/investment/fubon-readonly-proof/tools/fubon-readonly-adapter/` | Adapter subtree byte-for-byte match. |
| `.github/workflows/fubon-readonly-proof.yml` | `/Users/qq/Documents/GitHub/zhuge-labs/investment/fubon-readonly-proof/.github/workflows/fubon-readonly-proof.yml` | Exact file match; moved with its isolated proof adapter. |

The Fubon path set is 15 tracked files total (adapter and workflow); combined with 1,605 SkyEye files, 1,620 tracked files were relocated. Copies were verified before removal. Git archive copied tracked files only. No runtime-store credential value was read or moved.

## Duplicate and archive reconciliation

- `contact 2/index.html` and `contact/index.html` have the same Git blob ID: `48f0f28243826e0f7b48464e88d7684f69586edc`. The duplicate is already absent in the starting candidate lineage; no live route/import/test reference was found.
- `google-data 2/index.html` and `google-data/index.html` have the same Git blob ID: `1b0f90b84bb27df428496584cf8f0464d775a03a`. The duplicate is already absent in the starting candidate lineage; no live route/import/test reference was found.
- `tools 2/` contained nine unique legacy Lab utilities, not duplicates. It is already outside the candidate at `/Users/qq/Documents/GitHub/zhuge-labs/archive/repo-hygiene-tools-2-at-7c49182/tools 2/`; all nine external file contents match the corresponding Git blob IDs at `7c49182f4f260bd87edc94362378a25859a1df2a`.
- No directory was deleted only because its name looked like `copy`, `backup`, `old`, or `final`.

## Final formal AIOS root

Directories:

```text
.github/  app/  assets/  backlog/  config/  contact/  docs/  google-data/
labs/  modules/  privacy/  product/  public/  scopes/  shared/  supabase/
support/  terms/  tests/  tools/
```

Root files:

```text
.gitignore  .nojekyll  AGENTS.md  README.md
googlea760c88b64a73d97.html  index.html  package-lock.json  package.json  version.json
```

The intended Lab surface inside AIOS remains `labs/registry.json`, `labs/README.md`, and `modules/labs/`; Lab source stays under `/Users/qq/Documents/GitHub/zhuge-labs/`.

## Safety and packaging impact

- The 1358 baseline comparison used Git commit/tree evidence, not a re-downloaded ZIP; ZIP byte identity remains unverified in this pass.
- The cleanup candidate is local and is not deployed. If a future static Pages deployment uses this tree, the experimental `/skyeye-next/` path will no longer be served from AIOS; canonical `modules/skyeye/` remains.
- Genspark code was not changed. No GitHub remote mutation, Cloud mutation, Product Data mutation, migration, or deployment was performed.
