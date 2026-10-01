# Third-Party Notices and Reuse Boundary

## Genspark Stock AI

Repository: https://github.com/dvorak0727/Genspark-Stock-AI

Frozen reference SHA: `35182db578b0b8c693d34f52f3988534d4c52f83`

Use: feature/behavior reference only. This Sandbox does not copy, import, bundle, or redistribute Genspark source or assets. The frozen upstream working tree was left unchanged. No public redistribution of Genspark material is part of this Candidate.

## World Bank Commodity Price Data (Pink Sheet)

Source workbook: https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx

Dataset record: https://datacatalog.worldbank.org/search/dataset/0038238/commodity-prices-history-and-projections
The dataset record identifies CC BY 4.0. The UI attributes the source, describes the workbook-derived values as monthly references, and states that World Bank does not endorse Zhuge. Only Brent, WTI, and Copper columns are parsed. Verify dataset-specific terms again before any public redistribution or broader use.

## Taiwan official data

TWSE, TPEx, MOPS, TDCC, and TAIFEX sources are linked at evidence level. This private local Sandbox reads published endpoints and presents source attribution; endpoint availability does not itself grant a blanket republication license. Confirm each authority's current terms, rate limits, and attribution requirements before public deployment, caching beyond the private Lab, or redistribution.

## Browser-vendored software dependencies

- `fflate` 0.8.3: browser ESM file under `assets/vendor/fflate-browser.js`; MIT license is included alongside it.
- `fast-xml-parser` 5.7.3: browser parser bundle under `assets/vendor/fast-xml-parser.min.js`; MIT license is included alongside it.
- Node-side tests declare these dependencies in `package.json`; runtime browser imports use the local vendor files, not a CDN.

No provider secret, API key, account, Genspark source, or proprietary Genspark asset is included.
