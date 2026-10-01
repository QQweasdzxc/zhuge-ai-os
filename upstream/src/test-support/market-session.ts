import { afterEach, beforeEach } from "bun:test";

/** Price-only fixtures represent a regular session. Their identity/cache tests
 * must not silently turn into pre/post-market freshness tests on the CI clock. */
export function useRegularMarketSession(): void {
  let originalNow: typeof Date.now;
  beforeEach(() => {
    originalNow = Date.now;
    Date.now = () => Date.parse("2026-09-14T18:00:00Z");
  });
  afterEach(() => { Date.now = originalNow; });
}
