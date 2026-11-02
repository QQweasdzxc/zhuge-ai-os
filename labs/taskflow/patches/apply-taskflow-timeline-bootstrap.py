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
on production ZG-45/ZG-46, 2026-11-02).

Two-part bootstrap, both verified empirically against the live build:
1. defaultItemHeight seeds a nonzero totalHeight so the first computed
   render window is sized from estimates; real measured row heights
   replace the estimate as rows mount.
2. A scroll nudge on the custom scroll parent, fired when the container
   attaches and whenever the timeline item count changes (the timeline
   query resolves after mount, so a mount-only nudge fires too early).
   Virtuoso recomputes its render window on scroll-parent scroll events;
   on a page too short to scroll, no scroll event ever fires, so the list
   would otherwise keep its empty initial window forever (verified live:
   defaultItemHeight alone leaves the window empty; one synthetic scroll
   event after data arrival renders all rows).
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


TIMELINE_ITEMS_ANCHOR = (
    "  const items = useMemo<TimelineItem[]>(\n"
    "    () => flattenGroups(timelineView.groups, expandedResolved),\n"
    "    [timelineView.groups, expandedResolved],\n"
    "  );\n"
)

TIMELINE_ITEMS_PATCHED = (
    "  const items = useMemo<TimelineItem[]>(\n"
    "    () => flattenGroups(timelineView.groups, expandedResolved),\n"
    "    [timelineView.groups, expandedResolved],\n"
    "  );\n"
    "\n"
    "  // TaskFlow shell bootstrap: with customScrollParent, react-virtuoso\n"
    "  // recomputes its render window only at mount and on scroll-parent\n"
    "  // scroll events. On a page too short to scroll, no scroll event ever\n"
    "  // fires, so the list keeps its empty initial window forever (the\n"
    "  // activity stream renders zero rows with healthy data). The timeline\n"
    "  // query resolves after mount, so nudge the scroll parent when the\n"
    "  // container is attached and whenever the item count changes: a real\n"
    "  // window is then computed from settled geometry with data present.\n"
    "  // Verified live: one synthetic scroll event renders all rows; without\n"
    "  // it the stream stays empty until the user happens to scroll.\n"
    "  const timelineItemCount = items.length;\n"
    "  useEffect(() => {\n"
    "    if (!scrollContainerEl) return;\n"
    "    const raf = requestAnimationFrame(() => {\n"
    "      scrollContainerEl.dispatchEvent(new Event(\"scroll\"));\n"
    "    });\n"
    "    return () => cancelAnimationFrame(raf);\n"
    "  }, [scrollContainerEl, timelineItemCount]);\n"
)


def patch_issue_detail(source: str) -> str:
    source = replace_once(source, TIMELINE_VIRTUOSO_ANCHOR, TIMELINE_VIRTUOSO_PATCHED, "timeline Virtuoso props")
    source = replace_once(source, TIMELINE_ITEMS_ANCHOR, TIMELINE_ITEMS_PATCHED, "timeline items render-window nudge")
    return source


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
