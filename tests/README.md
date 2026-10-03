# Tests

## Shared Platform

`shared-platform.test.js` verifies the Gate 3 Identity, redacted Session,
Permission, Security Gate, and ModuleContext contracts. It runs without a
network or Supabase connection and must pass before Investment Runtime coding.

Future unit, integration, and browser regression tests belong here. Phase 1 contains no runtime business logic.

Browser regression executables are portable: set `CHROME_PATH`, `CHROMIUM_PATH`,
or `BROWSER_EXECUTABLE` to a Chrome/Chromium executable before running the
browser tests. If no executable is configured, the AI Board browser test is
reported as skipped rather than assuming a platform-specific installation path.

Browser fixture transport is owned by `tests/browser-executable.js`: repository
fixtures use loopback HTTP with their original repository paths and queries;
generated temporary fixtures load canonical assets using `fixturePath`.
Legacy DOM audits use the existing pinned Playwright Chromium driver through
`browserDOM`, wait for the completed audit selector, and close the browser in
`finally`, including failed checks. This avoids managed Chromium's blocked
`file://` transport and CLI `--dump-dom` lifecycle without changing product
contracts or assertions. `npm run test:browser` remains the regression authority.
