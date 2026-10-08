# Lab_投資 Final Candidate Preparation QA Summary

## Current release preparation — 2026-10-08

This is local QA evidence for the frozen `.9.27` release source. It is not a
Candidate manifest. Initial TDCC history publication has not completed, so the
required pre-Candidate gate remains blocked. No commit, package, Edge deployment,
push, or Production deployment has been performed.

Local HEAD: `256ee4c4d086edbab6ab25da194394b1e3b197f6`
`origin/main`: `07b6e57d85e2fb34619d88065fda7ad71c8070d4`
Product identity: `0.9.0-alpha.9.27` / `20261008-1337`.

| Gate | Result |
|---|---:|
| Lab/provider/adapter targeted tests | 204 PASS / 0 FAIL / 0 SKIP |
| Release governance/consistency tests | 51 PASS / 0 FAIL / 0 SKIP |
| Local Lab anonymous Desktop/Mobile browser journey | 16 PASS / 0 FAIL; 0 page errors, 0 console errors |
| Browser Regression | PASS / 0 FAIL / 0 SKIP (19 browser suites and 5 standalone checks) |
| Full Regression | 935 PASS / 0 FAIL / 0 SKIP |
| `git diff --check` | PASS |
| Initial TDCC data publication | PENDING first push; new workflow bootstrap trigger runs only when publisher/workflow changes |
| Investment Intelligence Edge deployment | NOT DEPLOYED |
| Git commit / Candidate package / push / Production deploy | NOT CREATED |

The provider and Lab implementation coverage is local. It does not claim live
authenticated Production data. The TDCC publisher writes a separate GitHub
Release data asset and does not commit data into the Product Source. The first
main push bootstraps that canonical workflow. Production anonymous smoke and PM
authenticated acceptance remain pending deployment/publication.

## Prior Lab candidate history

The following is a historical Candidate report from 2026-10-01. Its counts and
deployment state do not describe the current source.

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

## Release gate

Local QA is green for this source identity. Candidate packaging must wait for the
initial authenticated TDCC publication and readback. Lab remains distinct from
Official Investment and is not promoted by this release.
