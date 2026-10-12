#!/usr/bin/env python3
"""Validate the TaskFlow-only five-locale replacement overlay."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import tempfile
import unittest
from pathlib import Path


NAMESPACES = (
    "common", "auth", "settings", "issues", "agents", "editor", "onboarding",
    "invite", "labels", "members", "my-issues", "search", "inbox", "workspace",
    "projects", "autopilots", "skills", "chat", "modals", "runtimes", "layout",
    "usage", "ui", "squads", "billing",
)
PLACEHOLDER = re.compile(r"\{\{\s*([^{}]+?)\s*\}\}")

WEB_PATCH_SOURCES = (
    "packages/core/i18n/types.ts",
    "packages/core/i18n/pick-locale.ts",
    "packages/core/i18n/pick-locale.test.ts",
    "packages/core/i18n/user-locale-sync.tsx",
    "packages/views/locales/index.ts",
    "packages/views/settings/components/preferences-tab.tsx",
    "packages/views/settings/components/preferences-tab.test.tsx",
    "packages/views/agents/components/tabs/task-failure.test.ts",
    "packages/views/locales/mcp.test.ts",
    "packages/views/onboarding/templates/index.ts",
    "packages/views/onboarding/templates/index.test.ts",
    "packages/views/workspace/celestial-workspace-names.ts",
    "packages/views/workspace/slug.ts",
    "packages/views/workspace/slug.test.ts",
    "packages/views/common/docs-locale.ts",
    "packages/views/common/docs-locale.test.ts",
    "packages/views/runtimes/components/runtime-docs.ts",
    "packages/views/runtimes/components/runtime-docs.test.ts",
    "packages/views/autopilots/components/webhook-event-filter-section.tsx",
    "apps/web/lib/html-lang.ts",
    "apps/web/lib/locale-routing.ts",
    "apps/web/lib/locale-routing.test.ts",
    "apps/web/lib/docs-href.ts",
    "apps/web/lib/docs-href.test.ts",
    "apps/web/lib/use-cases-i18n.ts",
    "apps/web/lib/use-cases-source.ts",
    "apps/web/lib/use-case-locale-fallback.test.ts",
    "apps/web/app/global-error.tsx",
    "apps/web/app/global-error.test.tsx",
    "apps/web/features/landing/i18n/types.ts",
    "apps/web/features/landing/i18n/dictionary.ts",
    "apps/web/features/landing/i18n/dictionary.test.ts",
    "apps/web/features/landing/components/changelog-page-client.test.ts",
    "apps/web/features/landing/components/inline-links.test.ts",
    "apps/web/app/globals.css",
    "apps/web/app/custom.css",
)
BACKEND_PATCH_SOURCES = (
    "server/internal/handler/auth.go",
    "server/internal/handler/handler_test.go",
    "server/internal/handler/user_language_test.go",
)


def load_patcher(path: Path):
    spec = importlib.util.spec_from_file_location("taskflow_zh_hant_overlay", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load overlay patcher: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def flatten(value, prefix=""):
    if isinstance(value, dict):
        for key, nested in value.items():
            path = f"{prefix}.{key}" if prefix else key
            yield from flatten(nested, path)
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            yield from flatten(nested, f"{prefix}[{index}]")
    else:
        yield prefix, value


def placeholders(value) -> tuple[str, ...]:
    if not isinstance(value, str):
        return ()
    # A locale may reorder or repeat a placeholder for natural phrasing. The
    # contract is that every interpolation variable remains available.
    return tuple(sorted(set(PLACEHOLDER.findall(value))))


class TaskFlowTraditionalChineseOverlayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo_root = Path(__file__).resolve().parents[3]
        cls.repo = Path(
            os.environ.get("TASKFLOW_ZH_HANT_ROOT", str(cls.repo_root / "third_party/multica"))
        ).resolve()
        cls.overlay = Path(
            os.environ.get(
                "TASKFLOW_ZH_HANT_OVERLAY_ROOT",
                str(cls.repo_root / "labs/taskflow/overrides"),
            )
        ).resolve()
        cls.patcher_path = Path(
            os.environ.get(
                "TASKFLOW_ZH_HANT_PATCH_SCRIPT",
                str(cls.repo_root / "labs/taskflow/patches/apply-taskflow-zh-hant.py"),
            )
        ).resolve()
        cls.patcher = load_patcher(cls.patcher_path)

    def test_five_locale_inventory_and_resource_parity(self):
        self.assertEqual(len(NAMESPACES), 25)
        self.assertEqual(
            sorted(path.stem for path in (self.overlay / "locales/zh-Hant").glob("*.json")),
            sorted(NAMESPACES),
        )

        for namespace in NAMESPACES:
            with self.subTest(namespace=namespace):
                en = json.loads(
                    (self.repo / "packages/views/locales/en" / f"{namespace}.json").read_text(
                        encoding="utf-8"
                    )
                )
                hant = json.loads(
                    (self.overlay / "locales/zh-Hant" / f"{namespace}.json").read_text(
                        encoding="utf-8"
                    )
                )
                en_entries = dict(flatten(en))
                hant_entries = dict(flatten(hant))
                self.assertEqual(set(hant_entries), set(en_entries), "translation keys differ from EN")
                for key, source in en_entries.items():
                    self.assertEqual(
                        placeholders(hant_entries[key]),
                        placeholders(source),
                        f"interpolation mismatch: {namespace}.{key}",
                    )

        settings = json.loads(
            (self.overlay / "locales/zh-Hant/settings.json").read_text(encoding="utf-8")
        )
        self.assertEqual(settings["preferences"]["language"]["chinese"], "简体中文（中国）")
        self.assertEqual(settings["preferences"]["language"]["korean"], "韓文")
        all_text = "\n".join(
            str(value)
            for namespace in NAMESPACES
            for _, value in flatten(
                json.loads(
                    (self.overlay / "locales/zh-Hant" / f"{namespace}.json").read_text(
                        encoding="utf-8"
                    )
                )
            )
        )
        for term in (
            "設定", "偏好設定", "專案", "任務", "工作區", "負責人", "到期日",
            "看板", "清單", "表格", "時間軸", "甘特圖", "泳道", "搜尋", "篩選",
        ):
            with self.subTest(taiwan_term=term):
                self.assertIn(term, all_text)

    def test_overlay_applies_to_a_temporary_copy_and_vendor_stays_unchanged(self):
        targets = WEB_PATCH_SOURCES + BACKEND_PATCH_SOURCES
        before = {
            relative: hashlib.sha256((self.repo / relative).read_bytes()).hexdigest()
            for relative in targets
        }
        with tempfile.TemporaryDirectory(prefix="taskflow-zh-hant-") as directory:
            staged = Path(directory)
            for relative in targets:
                source = self.repo / relative
                target = staged / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)

            self.patcher.patch_web(staged, self.overlay)
            self.patcher.patch_backend(staged, self.overlay)

            types = (staged / "packages/core/i18n/types.ts").read_text(encoding="utf-8")
            self.assertIn('"zh-Hant"', types)
            self.assertNotIn('"ko"', types)
            index = (staged / "packages/views/locales/index.ts").read_text(encoding="utf-8")
            self.assertIn('"zh-Hant": {', index)
            self.assertNotIn("ko: {", index)
            self.assertIn('./zh-Hant/settings.json', index)
            self.assertEqual(index.count('"zh-Hant": {'), 1)
            self.assertIn('"zh-Hans": {', index)
            menu = (staged / "packages/views/settings/components/preferences-tab.tsx").read_text(encoding="utf-8")
            self.assertIn('value: "zh-Hant"', menu)
            self.assertIn('label: "简体中文（中国）"', menu)
            self.assertIn('label: "繁體中文（台灣）"', menu)
            self.assertNotIn('value: "ko"', menu)
            html_lang = (staged / "apps/web/lib/html-lang.ts").read_text(encoding="utf-8")
            self.assertIn('"zh-Hant": "zh-TW"', html_lang)
            self.assertNotIn('ko: "ko-KR"', html_lang)
            self.assertIn('"zh-Hans": "zh-CN"', html_lang)
            auth = (staged / "server/internal/handler/auth.go").read_text(encoding="utf-8")
            self.assertIn('"zh-Hant": {}', auth)
            self.assertNotIn('"ko":', auth)
            handler_test = (staged / "server/internal/handler/handler_test.go").read_text(encoding="utf-8")
            self.assertIn('TASKFLOW_LOCALE_CONTRACT_ONLY', handler_test)
            language_api_test = (staged / "server/internal/handler/user_language_test.go").read_text(encoding="utf-8")
            self.assertIn("TestUpdateMePersistsTraditionalChineseLanguage", language_api_test)
            self.assertIn('SELECT language FROM "user" WHERE id = $1', language_api_test)
            self.assertIn('testHandler.GetMe', language_api_test)
            self.assertIn("TestUpdateMeRejectsRemovedKoreanLanguage", language_api_test)
            self.assertIn('"zh-Hant": {', (staged / "apps/web/app/global-error.tsx").read_text(encoding="utf-8"))

        after = {
            relative: hashlib.sha256((self.repo / relative).read_bytes()).hexdigest()
            for relative in targets
        }
        self.assertEqual(after, before, "overlay mutated the frozen vendor source tree")

    def test_patch_fails_closed_when_a_frozen_source_marker_changes(self):
        with self.assertRaises(SystemExit):
            self.patcher.patch_types("export type SupportedLocale = 'changed';")


if __name__ == "__main__":
    unittest.main(verbosity=2)
