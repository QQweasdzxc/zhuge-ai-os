#!/usr/bin/env python3
"""Seed the issue-detail timeline virtual list with a nonzero first-paint height.

TaskFlow reliability overlay applied to the frozen build copy only; the
vendored upstream tree stays byte-identical.

Failure mode this closes: the issue-detail activity stream renders through
react-virtuoso with customScrollParent. Virtuoso derives the scroller height
from its measured totalHeight. On a cold mount no row has been measured and
no default height is set, so totalHeight starts at 0, the scroller collapses
to 0px, the viewport child (height: 100%) collapses with it, and Virtuoso
never mounts the first row it would measure. The stream stays empty with no
console error even though the timeline query returns healthy data (observed
on production ZG-45/ZG-46, 2026-11-02). Seeding defaultItemHeight gives the
first paint a nonzero totalHeight; real measured row heights replace the
estimate as rows mount.
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


EXPECTED_SHA256 = {
    "packages/views/issues/components/issue-detail.tsx": "6a8a1f592c54b8ac2699644e391005ca21c72e2bf2ca914e2691b2aa8ea7385b",
}

TIMELINE_VIRTUOSO_ANCHOR = (
    "                      customScrollParent={scrollContainerEl}\n"
    "                      data={items}\n"
)

TIMELINE_VIRTUOSO_PATCHED = (
    "                      customScrollParent={scrollContainerEl}\n"
    "                      // TaskFlow shell mount bootstrap: with no measured\n"
    "                      // rows and no default height, Virtuoso seeds\n"
    "                      // totalHeight at 0, the scroller collapses to 0px,\n"
    "                      // and the first row never mounts to be measured, so\n"
    "                      // the activity stream stays empty despite healthy\n"
    "                      // data. The estimate seeds a nonzero totalHeight;\n"
    "                      // measured row heights replace it on mount.\n"
    "                      defaultItemHeight={64}\n"
    "                      data={items}\n"
)


def replace_once(source: str, old: str, new: str, label: str) -> str:
    count = source.count(old)
    if count != 1:
        raise ValueError(f"{label}: expected one upstream marker, found {count}")
    return source.replace(old, new, 1)


def patch_issue_detail(source: str) -> str:
    return replace_once(source, TIMELINE_VIRTUOSO_ANCHOR, TIMELINE_VIRTUOSO_PATCHED, "timeline Virtuoso props")


def verify_and_patch(root: Path, relative: str, patcher) -> None:
    path = root / relative
    original = path.read_bytes()
    digest = hashlib.sha256(original).hexdigest()
    expected = EXPECTED_SHA256[relative]
    if digest != expected:
        raise ValueError(f"{relative}: pinned vendor sha256 mismatch: {digest} != {expected}")
    path.write_text(patcher(original.decode("utf-8")), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/src"))
    args = parser.parse_args()
    try:
        for relative in EXPECTED_SHA256:
            verify_and_patch(args.root, relative, patch_issue_detail)
    except (OSError, UnicodeError, ValueError, KeyError) as exc:
        raise SystemExit(f"TASKFLOW_TIMELINE_BOOTSTRAP_OVERLAY=FAIL {exc}") from exc
    print("TASKFLOW_TIMELINE_BOOTSTRAP_OVERLAY=PASS; vendor source remains unchanged")


if __name__ == "__main__":
    main()
