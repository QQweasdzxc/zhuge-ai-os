// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  createBrowserCookieLocaleAdapter,
  LOCALE_COOKIE,
} from "../../../packages/core/i18n/browser-cookie-adapter";

afterEach(() => {
  document.cookie = `${LOCALE_COOKIE}=;path=/;max-age=0`;
});

describe("TaskFlow locale preference cookie", () => {
  it.each(["zh-Hant", "zh-Hans"] as const)(
    "persists and restores %s independently",
    (locale) => {
      const adapter = createBrowserCookieLocaleAdapter();
      adapter.persist(locale);
      expect(adapter.getUserChoice()).toBe(locale);
    },
  );
});
