#!/usr/bin/env python3
"""Apply the TaskFlow-owned invisible Zhuge identity intake to the web shell.

Injects a before-interactive inline script (overrides/zhuge-token-intake-inline.ts)
into the Multica root layout so a #zhuge_token=... fragment is planted into
localStorage before any first-party or third-party code runs. Fail-closed: any
missing, ambiguous, or already-patched upstream marker aborts the build.
"""

from __future__ import annotations

import argparse
from pathlib import Path

LAYOUT_PATH = Path("apps/web/app/layout.tsx")
MODULE_PATH = Path("apps/web/app/zhuge-token-intake-inline.ts")

SCRIPT_IMPORT = 'import Script from "next/script";\n'
INTAKE_IMPORT = 'import { ZHUGE_TOKEN_INTAKE_INLINE } from "./zhuge-token-intake-inline";\n'
BODY_MARKER = '<body className="h-full overflow-hidden">'
INTAKE_SNIPPET = "\n".join(
    [
        BODY_MARKER,
        "        {/*",
        "          TaskFlow: invisible Zhuge identity intake. A Zhuge entry may carry the",
        "          TaskFlow credential in the URL fragment (#zhuge_token=...); plant it",
        "          into localStorage before any app code runs, then strip the fragment",
        "          before any validation can fail. Normal path shows no handoff page.",
        "        */}",
        "        <Script",
        '          id="zhuge-token-intake"',
        '          strategy="beforeInteractive"',
        "          dangerouslySetInnerHTML={{ __html: ZHUGE_TOKEN_INTAKE_INLINE }}",
        "        />",
    ]
)


def inject_token_intake(source: str) -> str:
    """Insert the intake import and before-interactive Script into layout.tsx."""
    if "zhuge-token-intake" in source:
        raise SystemExit("TaskFlow token intake marker missing, ambiguous, or already patched")
    if source.count(SCRIPT_IMPORT) != 1:
        raise SystemExit("Multica layout Script import marker missing or ambiguous")
    if source.count(BODY_MARKER) != 1:
        raise SystemExit("Multica layout body marker missing or ambiguous")
    source = source.replace(SCRIPT_IMPORT, SCRIPT_IMPORT + INTAKE_IMPORT, 1)
    source = source.replace(BODY_MARKER, INTAKE_SNIPPET, 1)
    # Postconditions on the in-memory snapshot, verified before any write.
    if source.count('id="zhuge-token-intake"') != 1:
        raise SystemExit("TaskFlow token intake Script postcondition failed")
    if source.count(INTAKE_IMPORT) != 1:
        raise SystemExit("TaskFlow token intake import postcondition failed")
    if source.count('strategy="beforeInteractive"') < 1:
        raise SystemExit("TaskFlow token intake strategy postcondition failed")
    return source


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/src", help="vendored Multica source root")
    parser.add_argument("--intake", default="/tmp/zhuge-token-intake-inline.ts", help="intake module input")
    args = parser.parse_args()
    root = Path(args.root)

    module_source = Path(args.intake).read_text()
    # The injected module must keep its security invariants verbatim.
    for marker in (
        'hash.indexOf("zhuge_token=")',
        "window.history.replaceState",
        'localStorage.setItem("multica_token", token)',
        "token.length > 16384",
        "resolved.origin !== window.location.origin",
        "window.location.replace(resolved.pathname",
    ):
        if marker not in module_source:
            raise SystemExit(f"TaskFlow token intake module invariant missing: {marker}")
    strip_at = module_source.index("window.history.replaceState")
    plant_at = module_source.index('localStorage.setItem("multica_token", token)')
    if not strip_at < plant_at:
        raise SystemExit("TaskFlow token intake must strip the fragment before planting the token")

    layout = root / LAYOUT_PATH
    if not layout.exists():
        raise SystemExit("Multica layout.tsx marker file not found")
    layout.write_text(inject_token_intake(layout.read_text()))
    (root / MODULE_PATH).write_text(module_source)
    print("TaskFlow token intake verified: before-interactive intake injected once into the root layout")


if __name__ == "__main__":
    main()
