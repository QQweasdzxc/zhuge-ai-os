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
