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

## Zhuge-owned U.S. market provider

Lab_投資 uses its bounded Zhuge-owned Yahoo-compatible read Edge as the primary
U.S. quote and daily-history provider. Returned observations retain source date,
retrieval time, delayed/freshness state, and provider identity. Alpaca is an
optional fallback only; no Alpaca credential is required for the primary route.
The Genspark author's Cloudflare Worker is not used by the Lab runtime.

## Alpaca US market data

The optional Lab fallback issues read-only quote snapshot and daily-bars requests
to Alpaca's official market-data API using the IEX feed. Credentials are held in
Zhuge Edge environment variables and are never bundled into browser code. IEX
coverage is a single exchange feed, not consolidated U.S. coverage. Alpaca is not
required for basic U.S. research. The adapter is not a trading or
order-execution integration.

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
