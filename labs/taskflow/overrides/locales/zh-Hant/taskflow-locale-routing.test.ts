import { describe, expect, it } from "vitest";
import { resolveLocaleFromSignals } from "../../../apps/web/lib/locale-routing";

describe("TaskFlow SSR locale routing", () => {
  it("keeps an explicit saved choice ahead of browser preferences", () => {
    expect(
      resolveLocaleFromSignals({
        cookieLocale: "zh-Hant",
        acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
      }),
    ).toBe("zh-Hant");
  });

  it("maps browser Taiwan and China preferences to separate resources", () => {
    expect(resolveLocaleFromSignals({ acceptLanguage: "zh-TW,zh;q=0.9" })).toBe(
      "zh-Hant",
    );
    expect(resolveLocaleFromSignals({ acceptLanguage: "zh-CN,zh;q=0.9" })).toBe(
      "zh-Hans",
    );
  });

  it("maps a legacy zh cookie to Simplified and an old ko cookie to English", () => {
    expect(resolveLocaleFromSignals({ cookieLocale: "zh" })).toBe("zh-Hans");
    expect(
      resolveLocaleFromSignals({
        cookieLocale: "ko",
        acceptLanguage: "zh-TW,zh;q=0.9",
      }),
    ).toBe("en");
  });
});
