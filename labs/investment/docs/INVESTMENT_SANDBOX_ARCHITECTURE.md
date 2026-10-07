# Lab_投資 — Runtime and Authority Architecture

```text
AIOS Global Shell / Sidebar
  └─ Lab 實驗室
      └─ Lab_投資
          ├─ local content navigation
          ├─ authenticated personal-data adapter (read-only)
          └─ existing Zhuge Investment Intelligence provider
                └─ authenticated Shared Data Gateway
                    └─ investment-intelligence-read Edge Function
                        ├─ bounded TWSE / TPEx / MOPS / TDCC evidence
                        ├─ SEC company identity / fundamentals
                        └─ external provider compatibility routes (gated)
```

## Navigation authority

AIOS Shared Navigation remains the only global sidebar. The Lab's tabs navigate
within the Investment Lab. The Genspark sidebar, menu, login, account, and
notification identity are not copied. Official Investment remains a parked
surface; the Lab label remains explicit.

## Identity and access

Personal holdings, watchlist, history, and transaction details share the
existing AIOS session and owner-resolution path. Each data read checks the
session, App Access, MFA policy, and the existing `auth_user_id` → `app_users.id`
mapping. Queries are owner- and portfolio-scoped. No Genspark license key,
original account, Worker identity, or plan value grants access.

The Lab Market Provider requires the same authenticated read authorization
before provider requests and calls the existing Shared Data Gateway. The Edge
Function validates the user session and accepts only bounded, typed market and
symbol requests. It does not expose an arbitrary URL proxy, private portfolio
rows, or write methods. Supabase Edge changes are not deployed by the GitHub
Pages workflow; verify the function deployment and runtime contract separately.

## Data identity and truth

- Market identity is explicit `TW` or `US`. Taiwan bare tickers must resolve to
  exactly one catalog venue before venue-specific evidence is read.
- Portfolio history is keyed by market + symbol. Bare tickers never cross-match
  Taiwan and US history.
- Portfolio valuation remains separate from market quote and research history.
- Source observation time, retrieval time, provider, freshness, delayed/fallback
  flags, and source URLs are carried through when available.
- No fabricated values, seeded runtime universe, fallback simulation, or
  portfolio-to-research quote substitution is allowed.

## Provider and source boundaries

The Lab reuses the existing Zhuge Investment Intelligence provider, strategy
analysis contracts, official Taiwan endpoints, SEC public identity/fundamental
datasets, and portfolio adapter. It does not depend on the Genspark Worker.
Sources that require paid credentials, have unresolved use terms, or lack a
verified Zhuge provider stay gated and are listed in
`GENSPARK_CAPABILITY_MATRIX.md`.

The current production-intended market provider has not yet received
authenticated Production verification. A static browser fixture or mocked Edge
response is not evidence of real user data availability.
