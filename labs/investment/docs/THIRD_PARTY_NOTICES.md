# Third-Party Notices and Reuse Boundary

## Genspark Stock AI

Repository: https://github.com/dvorak0727/Genspark-Stock-AI
Inspected reference commit: `7f9cfc5de61227faacd27d3baafa82bb41cba6ab`

The repository was inspected read-only at this exact commit. No standard
`LICENSE` or `COPYING` file was present at that revision. Zhuge uses the
repository as a feature and behavior reference only; no upstream source,
runtime, data file, image, or author-owned Worker response is copied or bundled.
Do not redistribute upstream material unless its license is separately
confirmed. The Genspark capability inventory is recorded in
`GENSPARK_CAPABILITY_MATRIX.md`.

## Yahoo Finance compatibility endpoint

The existing Zhuge Investment Intelligence Source contains a Yahoo Chart
compatibility provider for quote/history. Its use in Zhuge Production remains
subject to provider terms, source availability, and human release validation.
The Genspark author's Cloudflare Worker is not used. Until provider approval is
recorded, Yahoo-backed US data is an `EXTERNAL_PROVIDER_BLOCKED` release gate and
must not be reported as a verified Production capability.

## World Bank Commodity Price Data (Pink Sheet)

Source workbook: https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx

Dataset record: https://datacatalog.worldbank.org/search/dataset/0038238/commodity-prices-history-and-projections

The dataset record identifies CC BY 4.0. The UI attributes the source,
describes workbook-derived values as monthly references, and states that the
World Bank does not endorse Zhuge. Only Brent, WTI, and Copper columns are
parsed. Verify dataset-specific terms again before broader public
redistribution.

## Taiwan official data

TWSE, TPEx, MOPS, TDCC, TAIFEX, and SEC source endpoints are used only through
bounded read paths with source attribution where implemented. Endpoint
availability does not itself grant blanket republication rights. Confirm each
authority's current terms, rate limits, and attribution requirements before
Production deployment, caching beyond the private Lab, or redistribution.

## Browser-vendored software dependencies

- `fflate` 0.8.3: browser ESM file under `assets/vendor/fflate-browser.js`; MIT
  license is included alongside it.
- `fast-xml-parser` 5.7.3: browser parser bundle under
  `assets/vendor/fast-xml-parser.min.js`; MIT license is included alongside it.
- Node-side tests declare these pinned dependencies in `package.json`; runtime
  browser imports use local vendor files, not a CDN.

No provider secret, API key, Genspark author identity, license account, or
proprietary Genspark asset is included in the Lab runtime.
