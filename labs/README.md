# Zhuge Labs Registry

`registry.json` is the single source of truth for Lab Center entries. A Lab is an isolated experiment, not an Investment capability or a dependency of the formal Investment module.

## Boundary

- Zhuge-owned Lab source can live under this AIOS source tree in `labs/`; external experiments remain outside the repository.
- The Lab Center and its entries are separate static paths. Production modules do not import or bundle Lab source.
- Lab access is one shared Module A navigation destination (`Lab 實驗室`), not one navigation item per Lab.
- `status`, `enabled`, `localEntry`, `source`, and `currentGate` are rendered from this registry.
- Provider credentials, plans, rate limits, and upstream licensing remain governed by their providers and rights holders. A Lab entry does not grant access or imply Runtime PASS.
- `localEntry` must resolve same-origin under `/labs/`; localhost and external destinations are rejected.

## Entry schema

Each item uses `id`, `name`, `category`, `status`, `enabled`, `localEntry`, `source`, and `currentGate`. Optional evidence fields may identify an upstream commit and license state. `dataTruthLabels` describes allowed UI evidence classes; it does not certify any individual response as real.
