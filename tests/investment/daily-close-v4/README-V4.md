# Daily-close v4 review candidate

Not deployed. No formal DB changes, holding updates, task changes, or live authenticated private UI visit were made by this candidate.

## Changes from reviewed v3

- Fixed-source public transport for TWSE and TPEx daily-close arrays and each exchange's own 2026 calendar. No holdings, symbols, owner IDs, or auth headers are sent to an exchange. TPEx's calendar uses its official site's read-only POST query.
- Separate authenticated AAL2-only Edge endpoint. JWT is checked through the project's Auth user endpoint, then subject and AAL/expiry are checked. The only accepted body is the close-only mode. There is no DB or RPC path. Browser origin is restricted to the existing Pages origin. This is a candidate for a new function, not an edit to the existing wide-provider function.
- Public-only 5-minute cache with in-flight deduplication. Failed refresh does not return stale cached data. A 15-minute response-age ceiling is a transport guard, not a 15-minute age limit on daily closes. Daily-close freshness uses the expected trading-session DATE.
- Per-exchange annual calendar content digests. Both actual 2026 originals independently yield 24 stock-market closed dates and 3 explicit open dates. The TPEx stock-specific Feb 12/13 settlement closure is included; bond-specific dates are not reused as stock closures. Changed calendar content and uncovered years fail closed for re-review. Build helper and originals are included.
- 18:00 Taipei is an explicit conservative application publication cutoff. It is not claimed to be an exchange publication guarantee. Before that, the prior open session is expected. After that, today's session is expected when open. Weekend rules are used only inside a verified annual calendar.
- Array shape/date/schema checks, mixed-date and duplicate conflicts, fixed source URLs, future dates and response-age guards. Minimum UNIQUE-code counts (TWSE 1000, TPEx 10000) are coarse truncation guards based on the captured arrays, not proof of the full security universe. Quality explicitly says transport-array-validated-not-universe-guaranteed. Both source arrays must pass for an unambiguous venue join. This is conservative: a failed/stale TWSE array prevents a venue mapping even for TPEx holdings, rather than guessing away a possible collision.
- Clear historical snapshot valuation fields ONLY on temporary operation copies, before normalization. Original rows, identities, quantity, cost, and historical valuation evidence stay intact. Neither source failure nor a rejected source removes the holdings/cost view. Account/session/generation changes still reject and clear private UI.
- Initial overview/refresh uses only the dedicated close-only consumer. It no longer automatically invokes the pre-existing wider US/FX/news/research providers or hardcoded samples/watchlists. Existing explicit research tools are not silently rewritten by this change.
- Module holdings navigation stays inside the investment module. The old Board projection was already read-only as a financial view, but entering that separate page auto-syncs task cards. The new module holdings/watchlist views do not enter it. The standalone Board code/data and other entry points are unchanged. Existing transaction/import/strategy/settings tools remain. Watchlists and holdings remain distinct.

## Tests

Run from this directory:

    node build-bundles.cjs
    node --test daily-close.test.cjs integration.test.cjs consumers-venue.test.cjs readonly-adapter.test.cjs source-policy.test.cjs daily-transport.test.cjs daily-consumer.test.cjs r3-*.test.js

70/70 pass. This includes real repository/raw-row/session cases, real normalizer/calculation flow, both calendar originals, captured-source freshness, coarse truncation and malformed data, public cache failure, full built Edge authentication boundary, source failure retaining cost and null current valuation, and account change BEFORE overlay as well as during awaits.

Unzip frontend-candidate.zip into ./frontend, then run verify-runtime-navigation.cjs with Playwright available (or set FRONTEND_ROOT to its extracted repository root). The script starts and closes its own local-only server/browser. No remote requests are allowed.

The real module runtime, local mocked authenticated platform and synthetic holdings pass overview/holdings at 320/390/1440, holdings-watchlist-holdings navigation, refresh, no task writer calls, source failure preserving cost, and private UI clearing on session change. Screenshots have been inspected. The public TWSE array DATE is changed to 1151117 ONLY in the synthetic local success fixture. Those images are not live financial evidence or authenticated acceptance.

Full frontend investment tests: 129 total, 127 pass, two existing old-brand wording expectations fail. All browser tests pass with Playwright available. This matches the previously recorded two baseline wording failures; no unrelated brand cleanup was done.

## Actual source evidence and known gap

The captured TWSE array is dated 1151116, while TPEx is dated 1151117. At 2026-11-18 00:10 Taipei, the expected completed session is 2026-11-17. The real source-policy test therefore REJECTS TWSE as STALE_DAILY_DATA and accepts TPEx. It does not substitute Nov 16 prices or pretend the synthetic success fixture is live. Until both source dates pass, current valuation remains missing, with a visible reason and all holding costs still shown.

Source URLs:
- https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL
- https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes
- https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json&date=20260101
- https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate (official page query: date=2026&response=json)
- https://accessibility.twse.com.tw/zh/trading/holiday.html
- https://www.tpex.org.tw/zh-tw/announce/market/holiday.html
- https://data.gov.tw/dataset/11549
- https://data.gov.tw/dataset/11370
- https://data.gov.tw/dataset/11371
- https://data.gov.tw/dataset/11761

Release governance, independent review of this delta, deployment under original scope, actual authenticated HTTP/UI checks, and live source-date verification remain. Existing formal receivables migration and the one authorized private received test row must NOT be repeated.
