#!/usr/bin/env python3
"""Apply the TaskFlow-owned zh-Hant (Taiwan) locale overlay to the frozen build copy."""

from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path


NAMESPACES = (
    "common",
    "auth",
    "settings",
    "issues",
    "agents",
    "editor",
    "onboarding",
    "invite",
    "labels",
    "members",
    "my-issues",
    "search",
    "inbox",
    "workspace",
    "projects",
    "autopilots",
    "skills",
    "chat",
    "modals",
    "runtimes",
    "layout",
    "usage",
    "ui",
    "squads",
    "billing",
)

IMPORT_NAMES = {
    "common": "Common",
    "auth": "Auth",
    "settings": "Settings",
    "issues": "Issues",
    "agents": "Agents",
    "editor": "Editor",
    "onboarding": "Onboarding",
    "invite": "Invite",
    "labels": "Labels",
    "members": "Members",
    "my-issues": "MyIssues",
    "search": "Search",
    "inbox": "Inbox",
    "workspace": "Workspace",
    "projects": "Projects",
    "autopilots": "Autopilots",
    "skills": "Skills",
    "chat": "Chat",
    "modals": "Modals",
    "runtimes": "Runtimes",
    "layout": "Layout",
    "usage": "Usage",
    "ui": "Ui",
    "squads": "Squads",
    "billing": "Billing",
}


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"TaskFlow zh-Hant patch marker missing, ambiguous, or already patched: {label} (found {count})")
    return source.replace(old, new, 1)


def patch_types(source: str) -> str:
    source = replace_once(
        source,
        'export type SupportedLocale = "en" | "zh-Hans" | "ko" | "ja" | "fr";',
        'export type SupportedLocale = "en" | "zh-Hant" | "zh-Hans" | "ja" | "fr";',
        "SupportedLocale union",
    )
    source = replace_once(
        source,
        '  "zh-Hans",\n  "ko",',
        '  "zh-Hant",\n  "zh-Hans",',
        "SUPPORTED_LOCALES array",
    )
    return source


def patch_picker(source: str) -> str:
    old = '''export function matchLocale(candidates: string[]): SupportedLocale {
  if (candidates.length === 0) return DEFAULT_LOCALE;
  try {
    return match(
      candidates,
      SUPPORTED_LOCALES,
      DEFAULT_LOCALE,
    ) as SupportedLocale;
  } catch {
    return DEFAULT_LOCALE;
  }
}'''
    new = '''function normalizeChineseCandidate(candidate: string): string {
  try {
    const locale = new Intl.Locale(candidate.replaceAll("_", "-"));
    if (locale.language !== "zh") return candidate;

    // Preserve an explicit script first, then use the conventional region.
    // Bare legacy "zh" has always selected Simplified Chinese in this app.
    if (locale.script === "Hant" || ["TW", "HK", "MO"].includes(locale.region ?? "")) {
      return "zh-Hant";
    }
    if (locale.script === "Hans" || ["CN", "SG"].includes(locale.region ?? "")) {
      return "zh-Hans";
    }
    return "zh-Hans";
  } catch {
    return candidate;
  }
}

export function matchLocale(candidates: string[]): SupportedLocale {
  if (candidates.length === 0) return DEFAULT_LOCALE;
  try {
    return match(
      candidates.map(normalizeChineseCandidate),
      SUPPORTED_LOCALES,
      DEFAULT_LOCALE,
    ) as SupportedLocale;
  } catch {
    return DEFAULT_LOCALE;
  }
}'''
    return replace_once(source, old, new, "matchLocale implementation")


def patch_picker_test(source: str) -> str:
    source = replace_once(
        source,
        '    expect(matchLocale(["zh-Hans"])).toBe("zh-Hans");\n    expect(matchLocale(["ko"])).toBe("ko");',
        '    expect(matchLocale(["zh-Hans"])).toBe("zh-Hans");\n    expect(matchLocale(["zh-Hant"])).toBe("zh-Hant");',
        "five-locale core match",
    )
    source = replace_once(
        source,
        '    expect(matchLocale(["ko-KR"])).toBe("ko");',
        '    expect(matchLocale(["zh-TW"])).toBe("zh-Hant");',
        "legacy Korean browser locale expectation",
    )
    source = replace_once(
        source,
        '  it("zh-Hant (traditional) collapses to zh-Hans — same base subtag, better UX than English fallback", () => {\n    expect(matchLocale(["zh-Hant"])).toBe("zh-Hans");\n  });',
        '  it("keeps Traditional Chinese independent from Simplified Chinese", () => {\n    expect(matchLocale(["zh-Hant"])).toBe("zh-Hant");\n    expect(matchLocale(["zh-CN"])).toBe("zh-Hans");\n    expect(matchLocale(["zh"])).toBe("zh-Hans");\n  });',
        "legacy Hant collapse expectation",
    )
    source = replace_once(
        source,
        '    expect(matchLocale(["es", "ko-KR", "en"])).toBe("ko");',
        '    expect(matchLocale(["es", "zh-TW", "en"])).toBe("zh-Hant");',
        "candidate ordering Korean expectation",
    )
    return source


def import_name(namespace: str) -> str:
    return "zhHant" + IMPORT_NAMES[namespace]


def patch_resource_index(source: str) -> str:
    imports = "\n".join(
        f'import {import_name(namespace)} from "./zh-Hant/{namespace}.json";'
        for namespace in NAMESPACES
    )
    ko_imports = "\n".join(
        f'import ko{IMPORT_NAMES[namespace]} from "./ko/{namespace}.json";'
        for namespace in NAMESPACES
    )
    source = replace_once(source, ko_imports + "\n", imports + "\n", "Korean imports replaced by zh-Hant imports")

    resources = ['  "zh-Hant": {']
    for namespace in NAMESPACES:
        key = f'"{namespace}"' if "-" in namespace else namespace
        resources.append(f"    {key}: {import_name(namespace)},")
    resources.append("  },")
    block = "\n".join(resources)
    ko_resources = ['  ko: {']
    for namespace in NAMESPACES:
        key = f'"{namespace}"' if "-" in namespace else namespace
        ko_resources.append(f"    {key}: ko{IMPORT_NAMES[namespace]},")
    ko_resources.append("  },")
    return replace_once(
        source,
        "\n".join(ko_resources),
        block,
        "Korean resource registry replaced by zh-Hant",
    )


def patch_preferences(source: str) -> str:
    source = replace_once(
        source,
        '    { value: "zh-Hans", label: t(($) => $.preferences.language.chinese) },\n'
        '    { value: "ko", label: t(($) => $.preferences.language.korean) },',
        '    { value: "zh-Hans", label: "简体中文（中国）" },\n'
        '    { value: "zh-Hant", label: "繁體中文（台灣）" },',
        "language menu replaces Korean with Traditional Chinese",
    )
    return source.replace('"中文"', '"简体中文（中国）"')


def patch_preferences_test(source: str) -> str:
    if '"한국어"' not in source or '"繁體中文（台灣）"' in source:
        raise SystemExit(
            "TaskFlow five-locale preferences test marker missing or already patched"
        )
    source = source.replace('{ name: "한국어", locale: "ko" },', '{ name: "繁體中文（台灣）", locale: "zh-Hant" },')
    source = source.replace('"中文"', '"简体中文（中国）"')
    return replace_once(
        source,
        '{ name: "Français", locale: "fr" },',
        '{ name: "Français", locale: "fr" },\n    { name: "繁體中文（台灣）", locale: "zh-Hant" },',
        "logged-in Traditional Chinese language preference test",
    )


def patch_html_lang(source: str) -> str:
    source = replace_once(
        source,
        '  ko: "ko-KR",',
        '  "zh-Hant": "zh-TW",',
        "replace Korean HTML lang map entry",
    )
    source = source.replace(
        "i18next keeps zh-Hans internally because that is the resource\n// key, while the document uses zh-CN for accessibility and CJK fallback.",
        "i18next keeps script-specific Chinese resource keys; the document uses\n// BCP-47 region tags (zh-CN / zh-TW) for accessibility and CJK fallback.",
    )
    return source


def patch_global_error(source: str) -> str:
    return replace_once(
        source,
        '  ko: {\n    title: "문제가 발생했습니다",\n    description: "페이지에서 예기치 않은 오류가 발생했습니다. 다시 불러오세요.",\n    reload: "다시 불러오기",\n  },',
        '  "zh-Hant": {\n    title: "發生錯誤",\n    description: "頁面發生非預期錯誤，請重新載入。",\n    reload: "重新載入",\n  },',
        "replace Korean emergency error copy with Traditional Chinese",
    )


def patch_global_error_test(source: str) -> str:
    return replace_once(
        source,
        '{ locale: "zh-Hans", lang: "zh-CN", title: "出现了问题", reload: "重新加载" },',
        '{ locale: "zh-Hans", lang: "zh-CN", title: "出现了问题", reload: "重新加载" },\n'
        '    { locale: "zh-Hant", lang: "zh-TW", title: "發生錯誤", reload: "重新載入" },',
        "global error hydration test case",
    )


def patch_locale_routing(source: str) -> str:
    old = '''  const candidates: string[] = [];
  if (cookieLocale) candidates.push(cookieLocale);

  for (const part of (acceptLanguage ?? "").split(",")) {
    const tag = part.split(";")[0]?.trim();
    if (tag) candidates.push(tag);
  }

  return matchLocale(candidates);'''
    new = '''  // An explicit locale cookie is the user's choice. Resolve it alone so a
  // legacy unsupported value (for example `ko`) falls back to English instead
  // of being silently replaced by Accept-Language.
  if (cookieLocale) return matchLocale([cookieLocale]);

  const candidates = (acceptLanguage ?? "")
    .split(",")
    .map((part) => part.split(";")[0]?.trim())
    .filter((tag): tag is string => Boolean(tag));
  return matchLocale(candidates);'''
    return replace_once(source, old, new, "explicit cookie preference wins server locale resolution")


def patch_user_locale_sync(source: str) -> str:
    source = replace_once(
        source,
        'import { SUPPORTED_LOCALES, type SupportedLocale } from "./types";',
        'import { SUPPORTED_LOCALES, type SupportedLocale } from "./types";\n\n'
        'export function resolveStoredUserLocale(language: string): SupportedLocale | null {\n'
        '  if (language === "ko") return "en";\n'
        '  if (language === "zh" || language === "zh-CN") return "zh-Hans";\n'
        '  if (language === "zh-TW") return "zh-Hant";\n'
        '  return (SUPPORTED_LOCALES as readonly string[]).includes(language)\n'
        '    ? (language as SupportedLocale)\n'
        '    : null;\n'
        '}',
        "stored language compatibility resolver",
    )
    old = '''    if (!userLanguage) return;
    if (!(SUPPORTED_LOCALES as readonly string[]).includes(userLanguage)) {
      return;
    }
    if (userLanguage === i18n.language) return;
    adapter.persist(userLanguage as SupportedLocale);
    if (typeof window !== "undefined") window.location.reload();'''
    new = '''    if (!userLanguage) return;
    const locale = resolveStoredUserLocale(userLanguage);
    if (!locale) return;
    if (locale === i18n.language) return;
    adapter.persist(locale);
    if (typeof window !== "undefined") window.location.reload();'''
    return replace_once(source, old, new, "account locale sync supports zh-Hant and legacy fallbacks")


def patch_use_case_text(source: str) -> str:
    return replace_once(
        source,
        '  ko: {\n'
        '    indexTitle: "사용 사례",\n'
        '    indexSubtitle:\n'
        '      "팀이 Multica로 사람과 에이전트를 함께 구성하는 방법을 확인해 보세요.",\n'
        '    indexMetadataTitle: "사용 사례",\n'
        '    indexMetadataDescription:\n'
        '      "팀이 Multica로 사람과 에이전트를 함께 일하게 만드는 방법을 확인해 보세요.",\n'
        '    cardReadMore: "읽기 →",\n'
        '    tableOfContents: "이 페이지에서",\n'
        '  },',
        '  "zh-Hant": {\n'
        '    indexTitle: "使用案例",\n'
        '    indexSubtitle: "了解團隊如何運用 Multica，讓人員與 Agent 協同工作。",\n'
        '    indexMetadataTitle: "使用案例",\n'
        '    indexMetadataDescription: "了解團隊如何運用 Multica，讓人員與 Agent 協同工作。",\n'
        '    cardReadMore: "閱讀 →",\n'
        '    tableOfContents: "本頁目錄",\n'
        '  },',
        "Korean use-case copy replaced by Traditional Chinese",
    )


def patch_landing_locale_types(source: str) -> str:
    source = replace_once(
        source,
        'export type LandingDictionaryLocale = "en" | "zh" | "ko" | "ja";',
        'export type LandingDictionaryLocale = "en" | "zh" | "ja";',
        "landing dictionary locale removes Korean content option",
    )
    source = replace_once(
        source,
        'export const locales: Locale[] = ["en", "zh-Hans", "ko", "ja"];',
        'export const locales: Locale[] = ["en", "zh-Hant", "zh-Hans", "ja"];',
        "landing locale list replaces Korean",
    )
    source = replace_once(
        source,
        '  "zh-Hans": "\\u4e2d\\u6587",\n  ko: "\\ud55c\\uad6d\\uc5b4",',
        '  "zh-Hans": "简体中文（中国）",\n  "zh-Hant": "繁體中文（台灣）",',
        "landing locale label map replaces Korean",
    )
    source = replace_once(
        source,
        '  if (locale === "ko") return "ko";\n  if (locale === "ja") return "ja";\n  return locale === "zh-Hans" ? "zh" : "en";',
        '  if (locale === "ja") return "ja";\n'
        '  // No Taiwan-Traditional long-form landing copy ships in this overlay;\n'
        '  // use English rather than silently showing Simplified Chinese.\n'
        '  if (locale === "zh-Hant") return "en";\n'
        '  return locale === "zh-Hans" ? "zh" : "en";',
        "landing dictionary fallback replaces Korean",
    )
    return replace_once(
        source,
        '  return locale === "zh-Hans";',
        '  return locale === "zh-Hans" || locale === "zh-Hant";',
        "Chinese locale presentation helper",
    )


def patch_landing_dictionary(source: str) -> str:
    source = replace_once(
        source,
        'import { createKoDict } from "./ko";\n',
        "",
        "remove Korean landing dictionary import",
    )
    return replace_once(
        source,
        '  ko: createKoDict,\n',
        "",
        "remove Korean landing dictionary factory",
    )


def patch_onboarding_locale_map(source: str) -> str:
    source = replace_once(
        source,
        'type ContentLang = "en" | "zh" | "ko" | "ja";',
        'type ContentLang = "en" | "zh" | "ja";',
        "onboarding content type removes Korean locale",
    )
    return replace_once(
        source,
        '  "zh-Hans": "zh",\n  ko: "ko",',
        '  "zh-Hans": "zh",\n  // No Taiwan-Traditional Mika pack exists; use English rather than Simplified prompts.\n  "zh-Hant": "en",',
        "onboarding locale fallback",
    )


def patch_onboarding_locale_test(source: str) -> str:
    source = replace_once(
        source,
        '    expect(pickContentLang("zh-Hant")).toBe("zh");',
        '    expect(pickContentLang("zh-Hant")).toBe("en");',
        "Traditional onboarding prompt fallback test",
    )
    return replace_once(
        source,
        '    expect(pickContentLang("ko-KR")).toBe("ko");',
        '    expect(pickContentLang("ko-KR")).toBe("en");',
        "legacy Korean onboarding locale falls back to English",
    )


def patch_workspace_names(source: str, overlay: Path) -> str:
    mapping_path = overlay / "workspace-names-zh-Hant.json"
    if not mapping_path.exists():
        raise SystemExit("TaskFlow zh-Hant workspace name overlay is missing")
    names = json.loads(mapping_path.read_text(encoding="utf-8"))
    if not isinstance(names, dict) or not names:
        raise SystemExit("TaskFlow zh-Hant workspace name overlay is empty or invalid")
    inserted = set()
    for slug, value in names.items():
        start_marker = f'slugBase: "{slug}",'
        if source.count(start_marker) != 1:
            raise SystemExit(f"TaskFlow zh-Hant workspace name slug missing or ambiguous: {slug}")
        start = source.index(start_marker)
        next_start = source.find("slugBase:", start + len(start_marker))
        end = next_start if next_start >= 0 else len(source)
        segment = source[start:end]
        korean = re.search(r'(?m)^(\s*)ko: "([^"]*)",$', segment)
        if not korean:
            raise SystemExit(f"TaskFlow Korean workspace name marker missing for {slug}")
        line = korean.group(0)
        replacement = f'{korean.group(1)}"zh-Hant": {json.dumps(value, ensure_ascii=False)},'
        source = source[:start] + segment.replace(line, replacement, 1) + source[end:]
        inserted.add(slug)

    if inserted != set(names):
        raise SystemExit("TaskFlow zh-Hant workspace name postcondition failed")
    return source


def patch_docs_locale(source: str) -> str:
    return replace_once(
        source,
        '  if (language?.startsWith("zh")) return "/zh";',
        '  if (language === "zh-Hans" || language?.startsWith("zh-Hans-")) return "/zh";',
        "docs language route",
    )


def patch_docs_href(source: str) -> str:
    return replace_once(
        source,
        '  if (locale === "ko") return "/docs/ko";',
        '  // Taiwan-Traditional docs are not published yet; use the English route.\n  if (locale === "zh-Hant") return "/docs";',
        "remove Korean docs route and use English for zh-Hant",
    )


def patch_use_case_source(source: str) -> str:
    source = replace_once(
        source,
        '  if (locale === "ko") return "ko";',
        '  if (locale === "zh-Hant") return "en";',
        "Korean use-case locale replaced with English fallback for zh-Hant",
    )
    return replace_once(
        source,
        'languages: ["en", "zh", "ko", "ja"],',
        'languages: ["en", "zh", "ja"],',
        "remove Korean from public use-case content locale list",
    )


def patch_workspace_slug(source: str) -> str:
    source = replace_once(
        source,
        '  if (locale === "ja" || locale === "ko") return false;',
        '  if (locale === "ja") return false;',
        "workspace slug no longer excludes removed Korean locale",
    )
    source = source.replace(
        "Japanese or Korean, whose Han characters read differently.",
        "Japanese, whose Han characters read differently.",
    )
    return source


def patch_slug_test(source: str) -> str:
    return replace_once(
        source,
        'expect(nameToWorkspaceSlug("大韓民国", "ko")).toBe("");',
        'expect(nameToWorkspaceSlug("繁體名稱", "zh-Hant")).toBe("fantimingcheng");',
        "remove Korean locale slug test",
    )


def patch_use_case_fallback_test(source: str) -> str:
    pattern = re.compile(
        r'  it\("keeps localized and English-only pages in the production index wrapper", \(\) => \{.*?\n  \}\);(?=\n\n  it\("maps the ja locale)',
        re.S,
    )
    replacement = '''  it("uses English use-case pages for zh-Hant until Taiwan copy exists", () => {
    const englishPages = [
      { slugs: ["overview"], data: { title: "English" } },
      { slugs: ["research"], data: { title: "English only" } },
    ];
    vi.mocked(useCasesSource.getPages).mockReturnValue(
      englishPages as ReturnType<typeof useCasesSource.getPages>,
    );

    expect(
      getUseCasePagesForLocale("zh-Hant").map((page) => page.slugs.join("/")),
    ).toEqual(["overview", "research"]);
  });'''
    patched, count = pattern.subn(replacement, source)
    if count != 1:
        raise SystemExit(f"TaskFlow zh-Hant expected one use-case locale test to replace, found {count}")
    patched = replace_once(
        patched,
        'if (key === "ko:localized") {',
        'if (key === "en:localized") {',
        "Traditional use-case detail fallback uses English source",
    )
    return patched.replace(
        'getUseCasePageForLocale(["localized"], "ko")',
        'getUseCasePageForLocale(["localized"], "zh-Hant")',
    ).replace(
        'getUseCasePageForLocale(["english-only"], "ko")',
        'getUseCasePageForLocale(["english-only"], "zh-Hant")',
    )


def patch_docs_locale_test(source: str) -> str:
    return replace_once(
        source,
        '    ["ko", "/ko"],',
        '    ["zh-Hant", ""],',
        "docs language routing replaces Korean",
    )


def patch_runtime_docs_test(source: str) -> str:
    return replace_once(
        source,
        '    ["ko", "https://multica.ai/docs/ko/daemon-runtimes"],',
        '    ["zh-Hant", "https://multica.ai/docs/daemon-runtimes"],',
        "runtime docs fallback replaces Korean route",
    )


def patch_locale_routing_test(source: str) -> str:
    source = replace_once(
        source,
        '    expect(isSupportedLocale("ko")).toBe(true);',
        '    expect(isSupportedLocale("zh-Hant")).toBe(true);\n    expect(isSupportedLocale("ko")).toBe(false);',
        "supported locale list removes Korean",
    )
    return replace_once(
        source,
        '  it("matches Korean browser language signals", () => {\n'
        '    expect(\n'
        '      resolveLocaleFromSignals({\n'
        '        acceptLanguage: "ko-KR,ko;q=0.9,en;q=0.8",\n'
        '      }),\n'
        '    ).toBe("ko");\n'
        '  });',
        '  it("matches Taiwan and China browser language signals independently", () => {\n'
        '    expect(resolveLocaleFromSignals({ acceptLanguage: "zh-TW,zh;q=0.9,en;q=0.8" })).toBe("zh-Hant");\n'
        '    expect(resolveLocaleFromSignals({ acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8" })).toBe("zh-Hans");\n'
        '  });\n\n'
        '  it("falls back to English for an old Korean cookie even when the browser prefers Chinese", () => {\n'
        '    expect(resolveLocaleFromSignals({ cookieLocale: "ko", acceptLanguage: "zh-TW,zh;q=0.9" })).toBe("en");\n'
        '  });',
        "remove Korean browser selection and preserve old preference fallback",
    )
def patch_sans_fonts(source: str) -> str:
    return replace_once(
        source,
        'html[lang|="ja"] {',
        'html[lang|="zh-TW"] {\n'
        '  --font-sans: var(--font-inter), "PingFang TC", "Microsoft JhengHei",\n'
        '    "Noto Sans CJK TC", -apple-system, BlinkMacSystemFont, "Segoe UI",\n'
        '    "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;\n'
        '}\n\nhtml[lang|="ja"] {',
        "Traditional Chinese first font stack",
    )


def patch_custom_fonts(source: str) -> str:
    return replace_once(
        source,
        'html[lang|="ja"] .landing-light {',
        'html[lang|="zh-TW"] .landing-light {\n'
        '    --font-serif: var(--font-instrument-serif), "Songti TC", "PMingLiU",\n'
        '        "Noto Serif CJK TC", "Songti SC", "SimSun", "Noto Serif CJK SC",\n'
        '        ui-serif, serif;\n'
        '}\n\nhtml[lang|="ja"] .landing-light {',
        "Traditional Chinese landing serif stack",
    )


def patch_runtime_docs(source: str) -> str:
    return replace_once(
        source,
        '  if (language?.startsWith("zh")) {',
        '  if (language === "zh-Hans" || language?.startsWith("zh-Hans-")) {',
        "runtime docs language route",
    )


def patch_webhook_docs(source: str) -> str:
    return replace_once(
        source,
        '  const docsHref = i18n.language?.startsWith("zh")',
        '  const docsHref = (i18n.language === "zh-Hans" || i18n.language?.startsWith("zh-Hans-"))',
        "webhook docs language route",
    )


def patch_language_allowlist(source: str) -> str:
    return replace_once(
        source,
        '\t"zh-Hans": {},\n\t"ko":      {},',
        '\t"zh-Hans": {},\n\t"zh-Hant": {},',
        "authenticated user language allowlist replaces Korean",
    )


def patch_handler_test_main(source: str) -> str:
    return replace_once(
        source,
        "func TestMain(m *testing.M) {\n\tctx := context.Background()",
        "func TestMain(m *testing.M) {\n"
        '\tif os.Getenv("TASKFLOW_LOCALE_CONTRACT_ONLY") == "1" {\n'
        "\t\tos.Exit(m.Run())\n"
        "\t}\n"
        "\tctx := context.Background()",
        "database-free locale contract test mode",
    )


def patch_user_language_test(source: str) -> str:
    pattern = re.compile(
        r"func TestUpdateMeAcceptsKoreanLanguage\(t \*testing\.T\) \{.*?\n\}\n\n(?=func TestUpdateMeAcceptsJapaneseLanguage)",
        re.S,
    )
    replacement = '''func TestUpdateMePersistsTraditionalChineseLanguage(t *testing.T) {
\tuserID := newLanguageTestUser(t, "lang-zh-hant@multica.ai")
\tw := httptest.NewRecorder()
\treq := newPatchMeRequest(userID, `{"language":"zh-Hant"}`)
\ttestHandler.UpdateMe(w, req)
\tif w.Code != http.StatusOK {
\t\tt.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
\t}
\tvar resp map[string]any
\tif err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
\t\tt.Fatalf("decode response: %v", err)
\t}
\tif got, _ := resp["language"].(string); got != "zh-Hant" {
\t\tt.Fatalf("expected response language=zh-Hant, got %v", resp["language"])
\t}
\tvar stored *string
\tif err := testPool.QueryRow(context.Background(), `SELECT language FROM "user" WHERE id = $1`, userID).Scan(&stored); err != nil {
\t\tt.Fatalf("read persisted language: %v", err)
\t}
\tif stored == nil || *stored != "zh-Hant" {
\t\tt.Fatalf("persisted language = %v, want zh-Hant", stored)
\t}
\tget := newRequest(http.MethodGet, "/api/me", nil)
\tget.Header.Set("X-User-ID", userID)
\tvar reloaded UserResponse
\ttestutil.Call(t, testHandler.GetMe, get).Want(http.StatusOK).JSON(&reloaded)
\tif reloaded.Language == nil || *reloaded.Language != "zh-Hant" {
\t\tt.Fatalf("reloaded language = %v, want zh-Hant", reloaded.Language)
\t}
}

func TestUpdateMeRejectsRemovedKoreanLanguage(t *testing.T) {
\tuserID := newLanguageTestUser(t, "lang-ko-legacy@multica.ai")
\tw := httptest.NewRecorder()
\treq := newPatchMeRequest(userID, `{"language":"ko"}`)
\ttestHandler.UpdateMe(w, req)
\tif w.Code != http.StatusBadRequest {
\t\tt.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
\t}
}

'''
    patched, count = pattern.subn(replacement, source)
    if count != 1:
        raise SystemExit(f"TaskFlow zh-Hant expected one Korean API test to replace, found {count}")
    return patched


def patch_agent_failure_test(source: str) -> str:
    source = replace_once(
        source,
        'import koAgents from "../../../locales/ko/agents.json";',
        'import zhHantAgents from "../../../locales/zh-Hant/agents.json";',
        "agent failure test resource import",
    )
    source = replace_once(source, '  ko: koAgents,', '  "zh-Hant": zhHantAgents,', "agent failure resource registry")
    source = replace_once(
        source,
        '      ko: "시스템에서 취소함",',
        '      "zh-Hant": "已由系統取消",',
        "agent cancellation parity replaces Korean",
    )
    source = replace_once(
        source,
        'failureReasonLabel("agent_error.missing_config", fixedT("ko")),\n    ).toBe("API 키 또는 설정 누락");',
        'failureReasonLabel("agent_error.missing_config", fixedT("zh-Hant")),\n    ).toBe("缺少 API 金鑰或設定");',
        "agent failure copy uses Traditional Chinese",
    )
    return source


def patch_mcp_test(source: str) -> str:
    return replace_once(
        source,
        '["ko", "이름 변경", "설정 편집", "설정 교체"],',
        '["zh-Hant", "重新命名", "編輯設定", "取代設定"],',
        "MCP locale contract replaces Korean with Traditional Chinese",
    )


def patch_docs_href_test(source: str) -> str:
    return replace_once(
        source,
        '    expect(docsHrefForLocale("ko")).toBe("/docs/ko");',
        '    expect(docsHrefForLocale("zh-Hant")).toBe("/docs");',
        "docs href test replaces Korean with English fallback",
    )


def patch_landing_dictionary_test(source: str) -> str:
    return replace_once(
        source,
        '["ko", "/docs/ko"],',
        '["zh-Hant", "/docs"],',
        "landing dictionary test replaces Korean with English fallback",
    )


def patch_changelog_test(source: str) -> str:
    source = source.replace('"ko"', '"zh-Hant"')
    source = source.replace('"2026년 1월"', '"2026年1月"')
    source = source.replace('"2026년 1월 15일"', '"2026年1月15日"')
    return source


def patch_inline_links_test(source: str) -> str:
    return replace_once(
        source,
        '["en", "zh-Hans", "ja", "ko"] as const',
        '["en", "zh-Hans", "ja"] as const',
        "landing translated-content list removes Korean and excludes English fallback",
    )


def write_patch(root: Path, relative: str, patcher, *args) -> None:
    path = root / relative
    if not path.is_file():
        raise SystemExit(f"TaskFlow zh-Hant patch target is missing: {relative}")
    original = path.read_text(encoding="utf-8")
    patched = patcher(original, *args)
    path.write_text(patched, encoding="utf-8")


def copy_required(source: Path, target: Path) -> None:
    if not source.is_file():
        raise SystemExit(f"TaskFlow zh-Hant overlay file is missing: {source}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def patch_backend(root: Path, overlay: Path) -> None:
    write_patch(root, "server/internal/handler/auth.go", patch_language_allowlist)
    write_patch(root, "server/internal/handler/handler_test.go", patch_handler_test_main)
    write_patch(root, "server/internal/handler/user_language_test.go", patch_user_language_test)
    test = overlay / "taskflow_zh_hant_language_test.go"
    copy_required(test, root / "server/internal/handler/taskflow_zh_hant_language_test.go")
    print("TASKFLOW_ZH_HANT_BACKEND_OVERLAY=PASS; zh-Hant account preference accepted; vendor unchanged")


def patch_web(root: Path, overlay: Path) -> None:
    write_patch(root, "packages/core/i18n/types.ts", patch_types)
    write_patch(root, "packages/core/i18n/pick-locale.ts", patch_picker)
    write_patch(root, "packages/core/i18n/pick-locale.test.ts", patch_picker_test)
    write_patch(root, "packages/core/i18n/user-locale-sync.tsx", patch_user_locale_sync)
    write_patch(root, "apps/web/lib/locale-routing.ts", patch_locale_routing)
    write_patch(root, "apps/web/lib/locale-routing.test.ts", patch_locale_routing_test)
    write_patch(root, "packages/views/locales/index.ts", patch_resource_index)
    write_patch(root, "packages/views/settings/components/preferences-tab.tsx", patch_preferences)
    write_patch(root, "packages/views/settings/components/preferences-tab.test.tsx", patch_preferences_test)
    write_patch(root, "packages/views/agents/components/tabs/task-failure.test.ts", patch_agent_failure_test)
    write_patch(root, "packages/views/locales/mcp.test.ts", patch_mcp_test)
    write_patch(root, "apps/web/lib/html-lang.ts", patch_html_lang)
    write_patch(root, "apps/web/app/global-error.tsx", patch_global_error)
    write_patch(root, "apps/web/app/global-error.test.tsx", patch_global_error_test)
    write_patch(root, "apps/web/lib/docs-href.ts", patch_docs_href)
    write_patch(root, "apps/web/lib/docs-href.test.ts", patch_docs_href_test)
    write_patch(root, "apps/web/lib/use-cases-i18n.ts", patch_use_case_text)
    write_patch(root, "apps/web/lib/use-cases-source.ts", patch_use_case_source)
    write_patch(root, "apps/web/lib/use-case-locale-fallback.test.ts", patch_use_case_fallback_test)
    write_patch(root, "apps/web/features/landing/i18n/types.ts", patch_landing_locale_types)
    write_patch(root, "apps/web/features/landing/i18n/dictionary.ts", patch_landing_dictionary)
    write_patch(root, "apps/web/features/landing/i18n/dictionary.test.ts", patch_landing_dictionary_test)
    write_patch(root, "apps/web/features/landing/components/changelog-page-client.test.ts", patch_changelog_test)
    write_patch(root, "apps/web/features/landing/components/inline-links.test.ts", patch_inline_links_test)
    write_patch(root, "packages/views/onboarding/templates/index.ts", patch_onboarding_locale_map)
    write_patch(root, "packages/views/onboarding/templates/index.test.ts", patch_onboarding_locale_test)
    write_patch(root, "packages/views/workspace/celestial-workspace-names.ts", patch_workspace_names, overlay)
    write_patch(root, "packages/views/workspace/slug.ts", patch_workspace_slug)
    write_patch(root, "packages/views/workspace/slug.test.ts", patch_slug_test)
    write_patch(root, "packages/views/common/docs-locale.ts", patch_docs_locale)
    write_patch(root, "packages/views/common/docs-locale.test.ts", patch_docs_locale_test)
    write_patch(root, "packages/views/runtimes/components/runtime-docs.ts", patch_runtime_docs)
    write_patch(root, "packages/views/runtimes/components/runtime-docs.test.ts", patch_runtime_docs_test)
    write_patch(root, "packages/views/autopilots/components/webhook-event-filter-section.tsx", patch_webhook_docs)
    write_patch(root, "apps/web/app/globals.css", patch_sans_fonts)
    write_patch(root, "apps/web/app/custom.css", patch_custom_fonts)

    for namespace in NAMESPACES:
        src = overlay / "locales" / "zh-Hant" / f"{namespace}.json"
        copy_required(src, root / "packages/views/locales/zh-Hant" / f"{namespace}.json")

    copy_required(
        overlay / "locales" / "zh-Hant" / "taskflow-locale.test.ts",
        root / "packages/core/i18n/taskflow-locale.test.ts",
    )
    copy_required(
        overlay / "locales" / "zh-Hant" / "taskflow-locale-browser.test.ts",
        root / "packages/core/i18n/taskflow-locale-browser.test.ts",
    )
    copy_required(
        overlay / "locales" / "zh-Hant" / "taskflow-locale-sync.test.tsx",
        root / "packages/core/i18n/taskflow-locale-sync.test.tsx",
    )
    copy_required(
        overlay / "locales" / "zh-Hant" / "taskflow-locale-routing.test.ts",
        root / "apps/web/lib/taskflow-locale-routing.test.ts",
    )
    copy_required(
        overlay / "locales" / "zh-Hant" / "taskflow-html-lang.test.ts",
        root / "apps/web/lib/taskflow-html-lang.test.ts",
    )
    print("TASKFLOW_ZH_HANT_WEB_OVERLAY=PASS; independent resources, preference sync, SSR locale and HTML lang registered")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", choices=("web", "backend", "all"), default="all")
    parser.add_argument("--root", type=Path, default=Path("/src"))
    parser.add_argument("--overlays", type=Path, default=Path("/taskflow-zh-hant"))
    args = parser.parse_args()

    if args.target in ("backend", "all"):
        patch_backend(args.root, args.overlays)
    if args.target in ("web", "all"):
        patch_web(args.root, args.overlays)


if __name__ == "__main__":
    main()
