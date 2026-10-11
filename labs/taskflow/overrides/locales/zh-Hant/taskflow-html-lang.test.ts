import { describe, expect, it } from "vitest";
import { HTML_LANG } from "../../../apps/web/lib/html-lang";

describe("TaskFlow HTML language mapping", () => {
  it("sets Taiwanese and Chinese language tags independently", () => {
    expect(HTML_LANG["zh-Hant"]).toBe("zh-TW");
    expect(HTML_LANG["zh-Hans"]).toBe("zh-CN");
  });
});
