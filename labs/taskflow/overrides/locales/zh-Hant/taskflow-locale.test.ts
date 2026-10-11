import { describe, expect, it } from "vitest";
import { matchLocale } from "../../../packages/core/i18n/pick-locale";
import { SUPPORTED_LOCALES } from "../../../packages/core/i18n/types";
import { resolveStoredUserLocale } from "../../../packages/core/i18n/user-locale-sync";

describe("TaskFlow five-locale replacement", () => {
  it("exposes exactly the five approved locales and no Korean option", () => {
    expect(SUPPORTED_LOCALES).toEqual([
      "en",
      "zh-Hant",
      "zh-Hans",
      "ja",
      "fr",
    ]);
    expect(SUPPORTED_LOCALES).not.toContain("ko");
  });

  it("keeps Taiwan Traditional, China Simplified, and legacy zh distinct", () => {
    expect(matchLocale(["zh-TW"])).toBe("zh-Hant");
    expect(matchLocale(["zh-Hant"])).toBe("zh-Hant");
    expect(matchLocale(["zh-CN"])).toBe("zh-Hans");
    expect(matchLocale(["zh-Hans"])).toBe("zh-Hans");
    expect(matchLocale(["zh"])).toBe("zh-Hans");
  });

  it("maps stored legacy preferences without changing account data", () => {
    expect(resolveStoredUserLocale("zh")).toBe("zh-Hans");
    expect(resolveStoredUserLocale("zh-CN")).toBe("zh-Hans");
    expect(resolveStoredUserLocale("zh-TW")).toBe("zh-Hant");
    expect(resolveStoredUserLocale("ko")).toBe("en");
    expect(resolveStoredUserLocale("unknown")).toBeNull();
  });

  it("falls back to English for a removed Korean browser preference", () => {
    expect(matchLocale(["ko-KR"])).toBe("en");
  });
});
