const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { resolveBrowserExecutable } = require("./browser-executable");

const ROOT = path.join(__dirname, "..");
const NAV_SOURCE = path.join(ROOT, "shared/components/zhuge-navigation.js");

const ROUTES = {
  worklog: [
    "shared/theme/zhuge-shell.css",
    "shared/theme/zhuge-navigation.css",
    "modules/worklog/worklog.css",
    "shared/theme/zhuge-os.css",
    "shared/theme/ai-product.css",
    "shared/theme/zhuge-workspace.css"
  ],
  investment: [
    "shared/theme/tokens.css",
    "shared/theme/variables.css",
    "shared/theme/typography.css",
    "shared/theme/dark.css",
    "shared/theme/zhuge-navigation.css",
    "shared/theme/zhuge-shell.css",
    "modules/investment/assets/investment.css",
    "shared/theme/zhuge-workspace.css"
  ],
  dashboard: [
    "shared/theme/zhuge-navigation.css",
    "shared/theme/zhuge-shell.css",
    "shared/theme/zhuge-dashboard.css"
  ],
  aiBoard: [
    "shared/theme/zhuge-navigation.css",
    "shared/theme/zhuge-shell.css",
    "shared/theme/zhuge-workspace.css"
  ]
};

function cssLinks(files) {
  return files.map(file => `<link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, file)).href}">`).join("");
}

function fixture(files, activeWorkspace) {
  return `<!doctype html><html><head><meta charset="utf-8">${cssLinks(files)}
    <script src="${pathToFileURL(NAV_SOURCE).href}"></script>
  </head><body><main class="zhuge-module-shell workspace-shell zhuge-nav-collapsed" style="width:1600px;height:1000px;">
    <div id="zhugeSharedNavigation"></div><div class="app"></div>
  </main><script>
    const shell = document.querySelector('.zhuge-module-shell');
    const target = document.getElementById('zhugeSharedNavigation');
    target.outerHTML = window.ZhugeSharedNavigation.render({ activeWorkspace: ${JSON.stringify(activeWorkspace)}, version: '0.9.0-alpha.9.12', build: '20260812-1014' });
    requestAnimationFrame(() => {
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
    });
  </script></body></html>`;
}

function runBrowser(browserExecutable, htmlFile) {
  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--disable-background-networking", "--disable-component-update",
    "--disable-sync", "--window-size=1600,1000", `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-nav-collapsed-"))}`,
    "--virtual-time-budget=1200", "--dump-dom", pathToFileURL(htmlFile).href
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(browserExecutable, args, { encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(stderr || "Chrome timed out while measuring collapsed navigation")), 30000);
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.includes("data-collapsed-metrics=")) {
        const match = stdout.match(/data-collapsed-metrics="([^"]+)"/);
        if (match) finish(null, JSON.parse(match[1].replace(/&quot;/g, '"')));
      }
    });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => finish(error));
    child.on("close", code => {
      if (settled) return;
      if (!stdout) return finish(new Error(stderr || `Chrome exited with code ${code}`));
      const match = stdout.match(/data-collapsed-metrics="([^"]+)"/);
      if (!match) return finish(new Error(`Collapsed navigation metrics missing for ${htmlFile}`));
      finish(null, JSON.parse(match[1].replace(/&quot;/g, '"')));
    });
  });
}

test("all Workspaces use the WorkLog collapsed rail geometry", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the collapsed navigation browser regression");

  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-nav-fixtures-"));
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
  const worklog = fs.readFileSync(path.join(ROOT, "modules/worklog/worklog.css"), "utf8");
  assert.match(nav, /--zhuge-sidebar-collapsed-width:\s*72px/);
  assert.match(nav, /--zhuge-sidebar-collapsed-item-padding-block:\s*9px/);
  assert.match(nav, /\.zhuge-module-shell\.zhuge-nav-collapsed\s*>\s*\.os-sidebar/);
  assert.doesNotMatch(worklog, /workspace-worklog\.zhuge-nav-collapsed/);
});
