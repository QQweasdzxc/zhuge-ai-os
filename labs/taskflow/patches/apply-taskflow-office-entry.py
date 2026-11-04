#!/usr/bin/env python3
"""Install the native office sidebar entry in a copied web tree; frozen vendor is read-only.

The previous floating office overlay (a fixed-position iframe panel) covered
native controls on some pages, so the office entry is a normal sidebar item
instead: a same-tab navigation link that lives in the sidebar flow and can
never block page content.
"""
from __future__ import annotations

import argparse
from pathlib import Path

SIDEBAR = "packages/views/layout/app-sidebar.tsx"
SIDEBAR_TEST = "packages/views/layout/app-sidebar.test.tsx"

OFFICE_URL = "https://qqweasdzxc.github.io/zhuge-ai-os/"

ICON_IMPORT = 'import { Layers,\n'
ICON_IMPORT_NEW = 'import { Layers,\n  Building2,\n'

URL_ANCHOR = "const NAV_ITEM_CLASS_NAME =\n"
URL_CONSTANT = 'const TASKFLOW_OFFICE_URL = "%s";\n\n' % OFFICE_URL

CHAT_ITEM_TAIL = '''                        {item.key === "chat" && chatUnreadCount > 0 && (
                          <CappedNumberFlow
                            value={chatUnreadCount}
                            animated={false}
                            className="ml-auto text-caption"
                          />
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}'''

OFFICE_ITEM = '''
                {/* TASKFLOW_OFFICE_ENTRY_V1: native same-tab entry; no floating overlay */}
                <SidebarMenuItem key="office">
                  <SidebarMenuButton
                    render={<a href={TASKFLOW_OFFICE_URL} />}
                    className={NAV_ITEM_CLASS_NAME}
                  >
                    <Building2 />
                    <span>辦公室</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>'''

TEST_MARKER = 'describe("workspace-switcher unread dot", () => {'
TEST_BLOCK = '''
describe("TaskFlow office entry", () => {
  it("is a native same-tab sidebar link to the Zhuge office homepage", () => {
    // The mocked SidebarMenuButton surfaces the render-prop anchor as
    // data-href / data-target; no data-target means same-tab navigation.
    const { container } = render(<AppSidebar />);
    const link = container.querySelector(
      'button[data-href="https://qqweasdzxc.github.io/zhuge-ai-os/"]',
    );
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain("辦公室");
    expect(link).not.toHaveAttribute("data-target");
  });
});
'''

# The test-file mock renders SidebarMenuButton as a plain button and exposes
# only render.props.href. Surface target as well so the same-tab contract of
# the office anchor stays testable; undefined target renders no attribute.
MOCK_TYPE = "render?: React.ReactElement<{ href?: string }>;"
MOCK_TYPE_NEW = "render?: React.ReactElement<{ href?: string; target?: string }>;"
MOCK_BUTTON = 'data-href={render?.props.href}>'
MOCK_BUTTON_NEW = 'data-href={render?.props.href} data-target={render?.props.target}>'


def replace_exact(text: str, old: str, replacement: str, purpose: str) -> str:
    count = text.count(old)
    if count != 1:
        raise ValueError(f"{purpose}: exact upstream marker required, found {count}")
    return text.replace(old, replacement, 1)


def patch_sidebar(text: str) -> str:
    if "TASKFLOW_OFFICE_ENTRY_V1" in text:
        raise ValueError("office entry already patched")
    text = replace_exact(text, ICON_IMPORT, ICON_IMPORT_NEW, "office entry icon import")
    text = replace_exact(text, URL_ANCHOR, URL_CONSTANT + URL_ANCHOR, "office entry URL constant")
    return replace_exact(text, CHAT_ITEM_TAIL, CHAT_ITEM_TAIL + OFFICE_ITEM, "native office sidebar entry")


def patch_sidebar_test(text: str) -> str:
    if "TaskFlow office entry" in text:
        raise ValueError("office entry test already applied")
    text = replace_exact(text, MOCK_TYPE, MOCK_TYPE_NEW, "sidebar button mock target typing")
    text = replace_exact(text, MOCK_BUTTON, MOCK_BUTTON_NEW, "sidebar button mock target attribute")
    return replace_exact(text, TEST_MARKER, TEST_BLOCK + "\n" + TEST_MARKER, "office entry runtime contract test")


def apply(root: Path) -> None:
    root = root.resolve()
    # A mistaken --root must never edit the frozen source in-place.
    if root.name == "multica" and root.parent.name == "third_party":
        raise ValueError("refusing frozen third_party/multica; use a copied build tree")
    sidebar = root / SIDEBAR
    sidebar_test = root / SIDEBAR_TEST
    # Validate both targets before writing anything.
    new_sidebar = patch_sidebar(sidebar.read_text())
    new_test = patch_sidebar_test(sidebar_test.read_text())
    sidebar.write_text(new_sidebar)
    sidebar_test.write_text(new_test)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    apply(args.root)


if __name__ == "__main__":
    main()
