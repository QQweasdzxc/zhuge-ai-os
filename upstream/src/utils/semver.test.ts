import { describe, expect, test } from "bun:test";

import { compareSemver, formatVersion } from "./semver";

describe("compareSemver", () => {
  test("orders by major, minor, patch and ignores a leading v", () => {
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("1.2.3", "1.10.0")).toBeLessThan(0);
    expect(compareSemver("2.0", "1.99.99")).toBeGreaterThan(0);
  });

  test("a release outranks its own prerelease", () => {
    expect(compareSemver("1.0.0-beta.2", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("1.0.0-beta.1", "1.0.0-beta.2")).toBeLessThan(0);
  });

  test("returns null rather than guessing when either side is not a version", () => {
    // Plugins pin to tags like "main" or a commit; comparing those as versions
    // would report an update forever or never.
    expect(compareSemver("main", "1.0.0")).toBeNull();
    expect(compareSemver(undefined, "1.0.0")).toBeNull();
  });
});

describe("formatVersion", () => {
  test("normalizes spelling and passes non-versions through", () => {
    expect(formatVersion("v1.2")).toBe("1.2.0");
    expect(formatVersion("main")).toBe("main");
    expect(formatVersion("")).toBeNull();
  });
});
