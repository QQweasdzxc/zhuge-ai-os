const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveBrowserExecutable, fixturePath, browserDOM } = require("./browser-executable");

const ROOT = path.join(__dirname, "..");
const NAV_SOURCE = path.join(ROOT, "shared/components/zhuge-navigation.js");

const ROUTES = {
  worklog: [
    "shared/theme/zhuge-shell.css",
    "modules/worklog/worklog.css",
    "shared/theme/zhuge-os.css",
    "shared/theme/ai-product.css",
    "shared/theme/zhuge-workspace.css",
    "shared/theme/zhuge-navigation.css"
  ],
  investment: [
    "shared/theme/tokens.css",
    "shared/theme/variables.css",
    "shared/theme/typography.css",
    "shared/theme/dark.css",
    "shared/theme/zhuge-shell.css",
    "modules/investment/assets/investment.css",
    "shared/theme/zhuge-workspace.css",
    "shared/theme/zhuge-navigation.css"
  ],
  dashboard: [
    "shared/theme/zhuge-shell.css",
    "shared/theme/zhuge-dashboard.css",
    "shared/theme/zhuge-navigation.css"
  ],
  aiBoard: [
    "shared/theme/zhuge-shell.css",
    "shared/theme/zhuge-workspace.css",
    "shared/theme/zhuge-navigation.css"
  ]
};

function cssLinks(files) {
  return files.map(file => `<link rel="stylesheet" href="${fixturePath(path.join(ROOT, file))}">`).join("");
}

function fixture(files, activeWorkspace) {
  return `<!doctype html><html><head><meta charset="utf-8">${cssLinks(files)}
    <script src="${fixturePath(NAV_SOURCE)}"></script>
  </head><body><main class="zhuge-module-shell workspace-shell zhuge-nav-collapsed" style="width:1600px;height:1000px;">
    <div id="zhugeSharedNavigation"></div><div class="app"></div>
  </main><script>
    const shell = document.querySelector('.zhuge-module-shell');
    const target = document.getElementById('zhugeSharedNavigation');
    target.outerHTML = window.ZhugeSharedNavigation.render({ activeWorkspace: ${JSON.stringify(activeWorkspace)}, version: '0.9.0-alpha.9.13', build: '20260818-1549' });
    // Chrome 152 macOS headless may not advance a compositor frame before
    // --dump-dom. A zero-delay timer still lets styles/layout settle while
    // keeping this geometry probe independent of the compositor.
    setTimeout(() => {
      const sidebar = shell.querySelector('.os-sidebar');
      const css = element => {
        const style = getComputedStyle(element);
        return { width: style.width, padding: style.padding, margin: style.margin, height: style.height, display: style.display };
      };
      const visible = selector => [...shell.querySelectorAll(selector)].filter(element => getComputedStyle(element).display !== 'none');
      const metrics = {
        grid: getComputedStyle(shell).gridTemplateColumns,
        sidebar: css(sidebar),
        brand: css(sidebar.querySelector('.sidebar-brand')),
        sections: visible('.side-section').map(css),
        items: visible('.side-item').map(css)
      };
      document.body.dataset.collapsedMetrics = JSON.stringify(metrics);
      document.body.textContent = document.body.dataset.collapsedMetrics;
    }, 0);
  </script></body></html>`;
}

async function runBrowser(browserExecutable, htmlFile, width) {
  const output = await browserDOM(browserExecutable, htmlFile, { ready: '[data-collapsed-metrics]', width: width || 1600, height: 900 });
  const match = output.match(/data-collapsed-metrics="([^"]+)"/);
  return JSON.parse(match[1].replace(/&quot;/g, '"'));
}

test("all Workspaces use the WorkLog collapsed rail geometry", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the collapsed navigation browser regression");

  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-nav-fixtures-"));
  t.after(() => fs.rmSync(fixtureDir, { recursive: true, force: true }));
  const metrics = {};
  for (const [route, files] of Object.entries(ROUTES)) {
    const file = path.join(fixtureDir, `${route}.html`);
    fs.writeFileSync(file, fixture(files, route === "aiBoard" ? "ai-board" : route));
    metrics[route] = await runBrowser(browserExecutable, file);
  }

  const baseline = metrics.worklog;
  for (const [route, value] of Object.entries(metrics)) {
    assert.deepEqual(value, baseline, `${route} collapsed rail differs from WorkLog Golden Master`);
  }
  assert.equal(baseline.grid, "72px 1478px");
  assert.equal(baseline.sidebar.width, "72px");
  assert.equal(baseline.sidebar.padding, "10px 8px");
  assert.ok(baseline.items.every(item => item.height === "46px" && item.padding === "9px 4px" && item.margin.startsWith("4px")), JSON.stringify(baseline.items));
});

test("collapsed rail geometry is owned by shared navigation, not WorkLog CSS", () => {
  const nav = fs.readFileSync(path.join(ROOT, "shared/theme/zhuge-navigation.css"), "utf8");
  const source = fs.readFileSync(NAV_SOURCE, "utf8");
  const worklog = fs.readFileSync(path.join(ROOT, "modules/worklog/worklog.css"), "utf8");
  assert.match(nav, /--zhuge-sidebar-collapsed-width:\s*72px/);
  assert.match(nav, /--zhuge-sidebar-collapsed-item-padding-block:\s*9px/);
  assert.match(nav, /\.zhuge-module-shell\.zhuge-nav-collapsed\s*>\s*\.os-sidebar/);
  assert.match(nav, /\.zhuge-module-shell\[data-shared-navigation-mode="template-only"\]\[data-shared-navigation-active="true"\]\.zhuge-nav-collapsed\s*\{\s*grid-template-columns:\s*var\(--zhuge-sidebar-collapsed-width\)\s+minmax\(0,1fr\)\s*!important/);
  assert.match(nav, /@media\s*\(max-width:\s*767px\)[\s\S]*?\.zhuge-module-shell\.zhuge-nav-collapsed\s*>\s*\.os-sidebar\s*\{\s*width:\s*min\(86vw,\s*320px\)/);
  assert.match(nav, /\.zhuge-module-shell\.zhuge-nav-collapsed \.side-section > h3\s*\{\s*display:\s*none/);
  assert.match(nav, /zhuge-module-shell\.zhuge-nav-collapsed \.side-item\.on/);
  assert.match(nav, /prefers-reduced-motion/);
  assert.match(source, /data-shared-nav-collapsed/);
  assert.match(source, /aria-expanded=\"\$\{collapsed \? \"false\" : \"true\"\}\"/);
  assert.match(source, /control\?\.setAttribute\("aria-expanded", String\(!nextCollapsed\)\)/);
  assert.match(source, /aria-current=\\\"page\\\"/);
  assert.doesNotMatch(worklog, /workspace-worklog\.zhuge-nav-collapsed/);
});
