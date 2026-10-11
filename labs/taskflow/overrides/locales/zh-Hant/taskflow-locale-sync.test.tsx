// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleAdapterProvider } from "./adapter-context";
import { I18nProvider } from "./provider";
import { UserLocaleSync } from "./user-locale-sync";
import type { SupportedLocale } from "./types";

const auth = vi.hoisted(() => ({ language: "zh-Hant" }));
vi.mock("../auth", () => ({
  useAuthStore: (select: (state: { user: { language: string } }) => unknown) =>
    select({ user: { language: auth.language } }),
}));

const resources = {
  en: { common: { save: "Save" } },
  "zh-Hant": { common: { save: "儲存" } },
};

afterEach(() => {
  cleanup();
});

describe("TaskFlow account locale synchronization", () => {
  it("persists zh-Hant once, then stops reloading when the saved locale is active", () => {
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload },
    });
    const adapter = {
      getUserChoice: () => null,
      getSystemPreferences: () => ["en"],
      persist: vi.fn(),
    };
    const tree = (locale: SupportedLocale) => (
      <I18nProvider locale={locale} resources={resources}>
        <LocaleAdapterProvider adapter={adapter}>
          <UserLocaleSync />
        </LocaleAdapterProvider>
      </I18nProvider>
    );

    try {
      const first = render(tree("en"));
      expect(adapter.persist).toHaveBeenCalledExactlyOnceWith("zh-Hant");
      expect(reload).toHaveBeenCalledTimes(1);
      first.unmount();

      adapter.persist.mockClear();
      reload.mockClear();
      render(tree("zh-Hant"));
      expect(adapter.persist).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });

  it("uses English for an old ko account preference without a reload loop", () => {
    const reload = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { reload },
    });
    auth.language = "ko";
    const adapter = {
      getUserChoice: () => "ko",
      getSystemPreferences: () => ["zh-TW"],
      persist: vi.fn(),
    };

    try {
      render(
        <I18nProvider locale="en" resources={resources}>
          <LocaleAdapterProvider adapter={adapter}>
            <UserLocaleSync />
          </LocaleAdapterProvider>
        </I18nProvider>,
      );
      expect(adapter.persist).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    } finally {
      auth.language = "zh-Hant";
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});
