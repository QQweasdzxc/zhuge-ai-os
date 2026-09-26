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

test("TASK-088 Batch A keeps a single shared foundation token authority", () => {
  const tokens = read("shared/theme/tokens.css");
  const responsive = read("shared/theme/responsive.css");
  const feedback = read("shared/theme/feedback.css");

  for (const token of [
    "--zhuge-page-bg", "--zhuge-surface", "--zhuge-text", "--zhuge-muted",
    "--zhuge-font-family", "--zhuge-space-4", "--zhuge-radius-md",
    "--zhuge-shadow-card", "--shell-sidebar-width"
  ]) assert.match(tokens, new RegExp(`${token}:`));
  for (const token of [
    "--zhuge-breakpoint-mobile-max: 767px",
    "--zhuge-breakpoint-tablet-min: 768px",
    "--zhuge-breakpoint-tablet-max: 1180px",
    "--zhuge-breakpoint-desktop-min: 1181px",
    "--zhuge-touch-target-min: 44px",
    "--zhuge-safe-area-bottom: env(safe-area-inset-bottom, 0px)",
    "--zhuge-layer-backdrop: 110",
    "--zhuge-layer-drawer: 120",
    "--zhuge-layer-modal: 10000",
    "--zhuge-layer-hub: 1200",
    "--zhuge-layer-hub-chat: 1201"
  ]) assert.match(responsive, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const state of ["loading", "empty", "error", "unavailable", "insufficient-evidence"]) {
    assert.match(feedback, new RegExp(`data-zhuge-state=\\\"${state}\\\"`));
  }
});

test("TASK-088 compatibility theme files do not redeclare foundation values", () => {
  assert.doesNotMatch(read("shared/theme/variables.css"), /--zhuge-radius-(sm|md|lg)\s*:/);
  assert.doesNotMatch(read("shared/theme/spacing.css"), /--zhuge-space-\d+\s*:/);
  assert.doesNotMatch(read("shared/theme/typography.css"), /--zhuge-font-(family|xs|sm|md|lg|xl)\s*:/);
  assert.match(read("shared/theme/zhuge-shell.css"), /@import url\("\.\/tokens\.css"\)/);
  assert.match(read("shared/theme/zhuge-shell.css"), /@import url\("\.\/responsive\.css"\)/);
  assert.match(read("shared/theme/zhuge-shell.css"), /@import url\("\.\/feedback\.css"\)/);
  assert.match(read("shared/theme/zhuge-navigation.css"), /--zhuge-sidebar-item-height: var\(--zhuge-touch-target-min\)/);
  assert.match(read("shared/theme/global-floating-hub.css"), /z-index:var\(--zhuge-layer-hub\)/);
});

function fixture() {
  const styles = [
    "shared/theme/zhuge-shell.css",
    "shared/theme/zhuge-navigation.css",
    "shared/theme/global-floating-hub.css"
  ].map(file => `<link rel="stylesheet" href="${pathToFileURL(path.join(ROOT, file)).href}">`).join("");
  return `<!doctype html><html><head><meta charset="utf-8">${styles}</head><body>
    <main class="zhuge-module-shell">
      <aside class="os-sidebar"><button class="shared-nav-collapse" type="button">≡</button></aside>
      <section class="app"><button class="zhuge-touch-target" type="button">Action</button>
        <div class="zhuge-state" data-zhuge-state="insufficient-evidence"><strong data-zhuge-state-status>資料不足</strong><p data-zhuge-state-detail>不做推測。</p></div>
      </section>
    </main>
    <div class="zhuge-floating-hub"><button class="zhuge-hub-trigger" type="button">◎</button><div class="zhuge-hub-menu"></div></div>
    <div class="zhuge-hub-chat-overlay"><div class="zhuge-hub-chat-window"><div class="zhuge-hub-chat-heading"><button type="button">×</button></div></div></div>
    <script>
      setTimeout(() => {
        const root = getComputedStyle(document.documentElement);
        const shell = document.querySelector('.zhuge-module-shell');
        const sidebar = document.querySelector('.os-sidebar');
        const action = document.querySelector('.zhuge-touch-target');
        const hub = document.querySelector('.zhuge-floating-hub');
        const chat = document.querySelector('.zhuge-hub-chat-overlay');
        const state = document.querySelector('.zhuge-state');
        document.body.dataset.task088 = JSON.stringify({
          viewport: window.innerWidth,
          width: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          touch: getComputedStyle(action).minHeight,
          sidebarPosition: getComputedStyle(sidebar).position,
          drawerLayer: getComputedStyle(sidebar).zIndex,
          hubLayer: getComputedStyle(hub).zIndex,
          chatLayer: getComputedStyle(chat).zIndex,
          stateBorder: getComputedStyle(state).borderStyle,
          breakpointMobile: root.getPropertyValue('--zhuge-breakpoint-mobile-max').trim(),
          safeBottom: root.getPropertyValue('--zhuge-safe-area-bottom').trim()
        });
      }, 0);
    </script>
  </body></html>`;
}

function runBrowser(browserExecutable, htmlFile, width) {
  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--disable-background-networking", "--disable-component-update",
    "--disable-sync", `--window-size=${width},900`,
    `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-task-088-"))}`,
    "--virtual-time-budget=1200", "--dump-dom", pathToFileURL(htmlFile).href
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(browserExecutable, args, { encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => finish(new Error(stderr || "Chrome timed out"), true), 30000);
    const finish = (value, failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch {}
      failed ? reject(value) : resolve(value);
    };
    const parse = () => {
      const match = stdout.match(/data-task088="([^\"]+)"/);
      if (match) finish(JSON.parse(match[1].replace(/&quot;/g, '"')));
    };
    child.stdout.on("data", chunk => { stdout += chunk; parse(); });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => finish(error, true));
    child.on("close", code => {
      if (settled) return;
      if (!stdout) return finish(new Error(stderr || `Chrome exited with ${code}`), true);
      const match = stdout.match(/data-task088="([^\"]+)"/);
      if (!match) return finish(new Error(`TASK-088 runtime metrics missing at ${width}px`), true);
      finish(JSON.parse(match[1].replace(/&quot;/g, '"')));
    });
  });
}

test("TASK-088 Batch A runtime contract holds at desktop, tablet and mobile widths", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Browser executable unavailable for responsive runtime proof");

  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-task-088-fixture-"));
  const file = path.join(fixtureDir, "foundation.html");
  fs.writeFileSync(file, fixture());
  const metrics = {};
  /* Headless Chrome enforces a 500px minimum content viewport on this host;
   * 500px still exercises the mobile (<767px) contract. */
  for (const width of [1440, 1024, 500]) metrics[width] = await runBrowser(browserExecutable, file, width);

  for (const [width, value] of Object.entries(metrics)) {
    assert.equal(value.width, Number(width));
    assert.equal(value.scrollWidth, Number(width), `horizontal overflow at ${width}px`);
    assert.equal(value.touch, "44px", `touch target contract at ${width}px`);
    assert.equal(value.hubLayer, "1200");
    assert.equal(value.chatLayer, "1201");
    assert.equal(value.breakpointMobile, "767px");
    assert.match(value.safeBottom, /safe-area-inset-bottom|0px/);
  }
  assert.equal(metrics[1440].sidebarPosition, "sticky");
  assert.equal(metrics[1024].sidebarPosition, "sticky");
  assert.equal(metrics[500].sidebarPosition, "fixed");
  assert.equal(metrics[500].drawerLayer, "120");
  assert.equal(metrics[1440].stateBorder, "solid");
  assert.equal(metrics[1024].stateBorder, "solid");
  assert.equal(metrics[500].stateBorder, "solid");
});
