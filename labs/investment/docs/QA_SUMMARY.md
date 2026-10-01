# Lab_投資 In-Repository Candidate QA Summary

## Identity

- Candidate Build: `20261001-1801`
- Base: `20261001-1509` / `66e3d44fef68459731c7bf8a9d15761bdfafc351`
- Candidate branch: `codex/lab-investment-inrepo-20261001`
- Candidate commit: recorded in external manifest after local commit.

## Results

| Gate | Result |
|---|---:|
| Lab Investment unit tests | 16 PASS / 0 FAIL |
| Lab Investment source checks | PASS |
| AIOS Lab architecture tests | 4 PASS / 0 FAIL |
| Full Node regression (all root `.test.js`, Investment tests, and Lab tests) | 865 PASS / 0 FAIL / 0 skipped |
| Existing Browser Regression runner | 18 PASS / 0 FAIL / 0 skipped |
| Lab Investment Desktop/Mobile browser journeys | 9 PASS / 0 FAIL |
| `git diff --check` | PASS |
| npm audit, root QA dependency set | 0 vulnerabilities after Playwright security patch |
| npm audit, Lab dependencies | 0 vulnerabilities after fflate security patch |
| Formal Investment source unchanged | PASS |
| Formal SkyEye source unchanged | PASS |
| GitHub remote mutation | 0 |
| Cloud / Product Data mutation | 0 |
| Deploy / Publish | 0 |

The full regression includes the Lab unit tests and AIOS Lab Center tests; counts are not additive. The Browser Regression runner includes the existing browser suite, standalone responsive/screenshot checks, and the Lab static-browser journey.

## Known runtime limits

Production/authenticated release runtime was not deployed or tested. Static browser access confirmed the TWSE daily quote CSV path for 2330/0050, while TPEx, TWSE OpenAPI, TAIFEX, World Bank XLSX, and MOPS paths are blocked by browser CORS in this static runtime and remain explicitly unavailable or `SERVER_PROXY_REQUIRED`. This does not block the same-origin Lab UI but it limits those data sections until an authorized server-side proxy is provided.

## Gate

Developer QA is complete for the local Candidate. It is ready for GPT Review / PM Review only; it is not deployed, published, or formally graduated into Investment.
