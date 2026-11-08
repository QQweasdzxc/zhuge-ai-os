#!/usr/bin/env python3
"""Apply the TaskFlow TRQN theme overlay to the vendored Multica web app.

The overlay never edits the vendored token file (packages/ui/styles/tokens.css),
any vendored component, or the ThemeProvider default: the vendored
defaultTheme="system" and the in-app theme toggle keep working exactly as
upstream. It only:
  1. copies overrides/taskflow-tron-theme.css into apps/web/app/ inside the
     image-only source copy,
  2. appends its import right after the custom.css import in globals.css so
     the TRQN `:root` / `.dark` tokens win by cascade order in both modes.

Fail-closed: any missing, ambiguous, or drifted marker aborts the image build
instead of silently shipping a half-themed app.
"""
from pathlib import Path
import sys

GLOBALS_CSS = Path("apps/web/app/globals.css")
THEME_PROVIDER = Path("packages/ui/components/common/theme-provider.tsx")
TRON_CSS_TARGET = Path("apps/web/app/taskflow-tron-theme.css")

CUSTOM_IMPORT = '@import "./custom.css";'
TRON_IMPORT = '@import "./taskflow-tron-theme.css";'
SYSTEM_DEFAULT = 'defaultTheme="system"'


def apply_tron_theme(root: Path, css_source: Path) -> None:
    globals_path = root / GLOBALS_CSS
    provider_path = root / THEME_PROVIDER
    if not globals_path.is_file():
        raise SystemExit("Multica web globals.css marker file not found")
    if not provider_path.is_file():
        raise SystemExit("Multica theme-provider.tsx marker file not found")
    if not css_source.is_file():
        raise SystemExit("TRQN theme overlay css source not found")

    provider_text = provider_path.read_text()
    if provider_text.count(SYSTEM_DEFAULT) != 1:
        raise SystemExit("Multica theme-provider defaultTheme=system marker missing; refusing to alter theme defaults")

    globals_text = globals_path.read_text()
    if TRON_IMPORT not in globals_text:
        if globals_text.count(CUSTOM_IMPORT) != 1:
            raise SystemExit("Multica globals.css custom.css import marker missing or ambiguous")
        globals_text = globals_text.replace(CUSTOM_IMPORT, CUSTOM_IMPORT + "\n" + TRON_IMPORT, 1)
        globals_path.write_text(globals_text)

    (root / TRON_CSS_TARGET).write_text(css_source.read_text())

    globals_text = globals_path.read_text()
    if globals_text.count(TRON_IMPORT) != 1:
        raise SystemExit("TRQN theme import postcondition failed")
    provider_text = provider_path.read_text()
    if provider_text.count(SYSTEM_DEFAULT) != 1:
        raise SystemExit("TRQN theme overlay must leave defaultTheme=system untouched")


def main() -> None:
    args = sys.argv[1:]

    def option(name: str, default: str) -> Path:
        if name in args:
            return Path(args[args.index(name) + 1])
        return Path(default)

    apply_tron_theme(option("--root", "/src"), option("--css", "/tmp/taskflow-tron-theme.css"))


if __name__ == "__main__":
    main()
