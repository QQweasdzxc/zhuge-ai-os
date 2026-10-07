# Zhuge Labs Registry

`registry.json` is the single source of truth for Lab Center entries. `Lab_投資` is the active Investment product-development and runtime surface. It remains clearly labeled as a Lab and does not replace or mutate the parked Official Investment data authority.

## Boundary

- Zhuge-owned Lab source lives under this AIOS source tree in `labs/`; external experiments remain outside the repository.
- The Lab Center and its entries are separate static paths. Production modules do not import or bundle Lab source.
- Lab access is one shared Module A navigation destination (`Lab 實驗室`), not one navigation item per Lab.
- `status`, `enabled`, `localEntry`, `source`, and `currentGate` are rendered from this registry. `ACTIVE` means the surface is available for product work and runtime review; it does not certify provider or Production acceptance.
- Provider credentials, plans, rate limits, and upstream licensing remain governed by their providers and rights holders. A Lab entry does not grant access or imply Runtime PASS.
- `localEntry` must resolve same-origin under `/labs/`; localhost and external destinations are rejected.

## Entry schema

Each item uses `id`, `name`, `category`, `status`, `enabled`, `localEntry`, `source`, and `currentGate`. Optional evidence fields may identify an upstream commit and license state. `dataTruthLabels` describes allowed UI evidence classes; it does not certify any individual response as real.
