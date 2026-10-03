const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveBrowserExecutable, fixturePath, browserDOM } = require("./browser-executable");

const ROOT = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("TASK-088 Batch B keeps one shared navigation state contract", () => {
  const navigation = read("shared/components/zhuge-navigation.js");
  const shell = read("shared/components/zhuge-shell.js");
  const css = read("shared/theme/zhuge-navigation.css");
  const responsive = read("shared/theme/responsive.css");

  assert.match(navigation, /id="zhugeSharedNavigationPanel"/);
  assert.match(navigation, /function setSidebarOpen\(shell, open\)/);
  assert.match(navigation, /shell\.dataset\.sidebarState = isOpen \? "open" : "closed"/);
  assert.match(navigation, /aria-expanded/);
  assert.match(navigation, /event\.key !== "Escape"/);
  assert.match(navigation, /function ensureSidebarBackdrop\(shell\)/);
  assert.match(shell, /aria-controls="zhugeSharedNavigationPanel"/);
  assert.match(css, /\.zhuge-module-shell\.sidebar-open > \.sidebar-backdrop/);
  assert.match(css, /data-nav-group="system"/);
  assert.match(responsive, /--zhuge-layer-modal: 10000/);
  assert.match(responsive, /--zhuge-layer-modal-content: 10010/);
  assert.match(responsive, /--zhuge-layer-modal-legacy: 10040/);
});

function fixture() {
  const navigation = fixturePath(path.join(ROOT, "shared/components/zhuge-navigation.js"));
  return `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${fixturePath(path.join(ROOT, "shared/theme/zhuge-navigation.css"))}">
  </head><body><div class="zhuge-module-shell"><div id="zhugeSharedNavigation" data-active-workspace="worklog"></div><header class="workspace-shell-header"><div class="zhuge-shared-header-main"></div></header><main class="app"></main></div>
    <script>window.ZhugeFoundationConfig={version:{version:"test",build:"test"}};</script>
    <script src="${navigation}"></script>
    <script>
      setTimeout(() => {
        const shell = document.querySelector('.zhuge-module-shell');
        const toggle = shell.querySelector('[data-toggle-sidebar]');
        toggle.click();
        const opened = {
          state: shell.dataset.sidebarState,
          aria: toggle.getAttribute('aria-expanded'),
          hasBackdrop: Boolean(shell.querySelector('.sidebar-backdrop')),
          backdropPointer: getComputedStyle(shell.querySelector('.sidebar-backdrop')).pointerEvents,
          sidebarPosition: getComputedStyle(shell.querySelector('.os-sidebar')).position,
          drawerLayer: getComputedStyle(shell.querySelector('.os-sidebar')).zIndex
        };
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        const closed = { state: shell.dataset.sidebarState, aria: toggle.getAttribute('aria-expanded') };
        document.body.dataset.task088Shell = JSON.stringify({ opened, closed, width: innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth });
      }, 250);
    </script>
  </body></html>`;
}

async function runBrowser(browserExecutable, htmlFile, width) {
  const output = await browserDOM(browserExecutable, htmlFile, { ready: '[data-task088-shell]', width: width || 1600, height: 900 });
  const match = output.match(/data-task088-shell="([^"]+)"/);
  return JSON.parse(match[1].replace(/&quot;/g, '"'));
}

test("TASK-088 Batch B sidebar opens/closes consistently across desktop, tablet and mobile", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Browser executable unavailable for shell runtime proof");

  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-task-088-shell-fixture-"));
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  const file = path.join(fixtureDir, "shell.html");
  fs.writeFileSync(file, fixture());
  for (const width of [1440, 1024, 500]) {
    const metrics = await runBrowser(browserExecutable, file, width);
    assert.equal(metrics.width, width);
    assert.equal(metrics.scrollWidth, metrics.clientWidth, `horizontal overflow at ${width}px`);
    assert.equal(metrics.opened.state, "open");
    assert.equal(metrics.opened.aria, "true");
    assert.equal(metrics.opened.hasBackdrop, true);
    assert.equal(metrics.closed.state, "closed");
    assert.equal(metrics.closed.aria, "false");
    if (width === 500) {
      assert.equal(metrics.opened.sidebarPosition, "fixed");
      assert.equal(metrics.opened.drawerLayer, "120");
      assert.equal(metrics.opened.backdropPointer, "auto");
    }
  }
});
