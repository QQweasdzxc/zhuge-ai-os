const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { resolveBrowserExecutable } = require("./browser-executable");

const ROOT = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("TASK-088 Batch C exposes one opt-in core component contract", () => {
  const css = read("shared/theme/core-components.css");
  const drawer = read("shared/components/task-drawer.js");
  const taskCss = read("shared/theme/task-drawer.css");

  for (const selector of [
    ".zhuge-core-button", ".zhuge-core-card", ".zhuge-core-form",
    ".zhuge-core-modal", ".zhuge-core-drawer", ".zhuge-core-list",
    ".zhuge-core-table", ".zhuge-core-toast"
  ]) assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  assert.match(css, /min-height: var\(--zhuge-touch-target-min\)/);
  assert.match(drawer, /shared-task-drawer zhuge-core-modal/);
  assert.match(drawer, /shared-task-drawer-panel zhuge-core-card zhuge-core-modal-panel/);
  assert.match(drawer, /shared-task-drawer-activity-list zhuge-core-list/);
  assert.match(drawer, /shared-task-drawer-close zhuge-core-button/);
  assert.match(taskCss, /z-index:var\(--zhuge-layer-modal\)/);
});

function fixture() {
  const styles = [
    "shared/theme/tokens.css",
    "shared/theme/responsive.css",
    "shared/theme/feedback.css",
    "shared/theme/core-components.css",
    "shared/theme/task-drawer.css"
  ].map(file => `<link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, file)).href}">`).join("");
  const drawer = pathToFileURL(path.join(ROOT, "shared/components/task-drawer.js")).href;
  return `<!doctype html><html><head><meta charset="utf-8">${styles}</head><body>
    <div id="fixture"></div>
    <script src="${drawer}"></script>
    <script>
      setTimeout(() => {
        ZhugeSharedTaskDrawer.mount(document.getElementById('fixture'), {
          title: '資源分享與參考', titleCode: 'TASK-088', subtitle: 'Task Detail',
          sections: [{ title: '工作內容', html: '<p>這是一段可換行的 PM-readable 內容。</p>' }],
          activity: { html: '<div class="zhuge-core-list-item">Activity</div>' },
          onClose: () => {}
        });
        const root = document.querySelector('[data-shared-task-drawer]');
        const close = root.querySelector('.shared-task-drawer-close');
        const panel = root.querySelector('.shared-task-drawer-panel');
        document.body.dataset.task088Core = JSON.stringify({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          rootLayer: getComputedStyle(root).zIndex,
          panelWidth: getComputedStyle(panel).width,
          closeMinHeight: getComputedStyle(close).minHeight,
          closeFocus: getComputedStyle(close).outlineStyle,
          activityList: Boolean(root.querySelector('.zhuge-core-list'))
        });
      }, 180);
    </script>
  </body></html>`;
}

function runBrowser(browserExecutable, htmlFile, width) {
  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--disable-background-networking", "--disable-component-update",
    "--disable-sync", `--window-size=${width},900`,
    `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-task-088-core-"))}`,
    "--virtual-time-budget=1200", "--dump-dom", pathToFileURL(htmlFile).href
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(browserExecutable, args, { encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value, failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch {}
      failed ? reject(value) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(stderr || "Chrome timed out"), true), 30000);
    const parse = () => {
      const match = stdout.match(/data-task088-core="([^"]+)"/);
      if (match) finish(JSON.parse(match[1].replace(/&quot;/g, '"')));
    };
    child.stdout.on("data", chunk => { stdout += chunk; parse(); });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => finish(error, true));
    child.on("close", code => {
      if (settled) return;
      const match = stdout.match(/data-task088-core="([^"]+)"/);
      if (!match) return finish(new Error(`TASK-088 core metrics missing at ${width}px (exit ${code})`), true);
      finish(JSON.parse(match[1].replace(/&quot;/g, '"')));
    });
  });
}

test("TASK-088 Batch C shared drawer uses core states at desktop, tablet and mobile widths", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Browser executable unavailable for core component proof");
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-task-088-core-fixture-"));
  const file = path.join(fixtureDir, "core.html");
  fs.writeFileSync(file, fixture());
  for (const width of [1440, 1024, 500]) {
    const metrics = await runBrowser(browserExecutable, file, width);
    assert.equal(metrics.width, width);
    assert.equal(metrics.scrollWidth, metrics.width, `horizontal overflow at ${width}px`);
    assert.equal(metrics.rootLayer, "10000");
    assert.equal(metrics.closeMinHeight, "44px");
    assert.equal(metrics.activityList, true);
  }
});
