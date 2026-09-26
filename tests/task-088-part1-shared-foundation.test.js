const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { resolveBrowserExecutable } = require("./browser-executable");

const ROOT = path.resolve(__dirname, "..");
const urlFor = file => pathToFileURL(path.join(ROOT, file)).href;

function fixture() {
  return `<!doctype html><html><head><meta charset="utf-8">
    <link rel="stylesheet" href="${urlFor("shared/theme/zhuge-shell.css")}">
    <link rel="stylesheet" href="${urlFor("shared/theme/zhuge-navigation.css")}">
    <link rel="stylesheet" href="${urlFor("shared/theme/task-drawer.css")}">
  </head><body>
    <main class="zhuge-module-shell workspace-shell" style="min-height:900px">
      <div id="zhugeSharedNavigation" data-active-workspace="worklog"></div>
      <section class="app"><button id="drawer-opener" type="button">開啟 TASK</button></section>
    </main>
    <div id="drawer-host" style="display:block"></div>
    <script>window.localStorage.removeItem("zhuge_shared_nav_collapsed_v1"); window.ZhugeFoundationConfig={version:{version:"test",build:"test"}};</script>
    <script src="${urlFor("shared/components/zhuge-navigation.js")}"></script>
    <script src="${urlFor("shared/components/task-drawer.js")}"></script>
    <script>
      const opener = document.getElementById("drawer-opener");
      opener.focus();
      const host = document.getElementById("drawer-host");
      host.innerHTML = window.ZhugeSharedTaskDrawer.render({
        title: "TASK-088｜Shared Foundation",
        titleCode: "TASK-088",
        subtitle: "Shared Task Drawer",
        properties: [{ key: "status", label: "目前狀態", value: "GPT preflight" }, { key: "owner", label: "負責人", value: "Co", interactive: true }],
        sections: [{ id: "requirements", title: "需求內容", html: "<p>Shared presentation contract</p>" }],
        activity: { title: "💬 工作進度", hint: "可讀取的正式紀錄", html: "<article class=shared-task-drawer-activity-row><div class=task-activity-dot></div><div>Evidence</div></article>" }
      });
      window.setTimeout(() => {
        const shell = document.querySelector(".zhuge-module-shell");
        // Establish the same expanded starting state at desktop and tablet so
        // the following click proves the real shared collapse interaction,
        // rather than depending on the viewport's default tablet preference.
        window.ZhugeSharedNavigation.setCollapsed(shell, false);
        const nav = shell.querySelector("[data-zhuge-shared-navigation='true']");
        const collapse = nav.querySelector("[data-shared-nav-collapse]");
        const drawer = document.querySelector("[data-shared-task-drawer]");
        const panel = drawer.querySelector("[data-shared-task-drawer-panel]");
        const backdrop = drawer.querySelector("[data-shared-task-drawer-close].shared-task-drawer-backdrop");
        const focusables = () => Array.from(panel.querySelectorAll("button,input,select,textarea,a[href],[tabindex]:not([tabindex='-1'])")).filter(node => getComputedStyle(node).display !== "none");
        const before = {
          drawerRole: panel.getAttribute("role"),
          drawerLabelledBy: panel.getAttribute("aria-labelledby"),
          drawerFocused: document.activeElement === drawer.querySelector(".shared-task-drawer-close"),
          scrollLocked: document.body.dataset.sharedTaskDrawerScrollLocked === "true",
          noHorizontalOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth,
          panelWidth: Math.round(panel.getBoundingClientRect().width),
          panelZIndex: getComputedStyle(panel).zIndex,
          backdropZIndex: getComputedStyle(backdrop).zIndex
        };
        collapse.click();
        const visibleItems = Array.from(nav.querySelectorAll("[data-shared-nav-item]")).filter(node => getComputedStyle(node).display !== "none");
        const collapsed = {
          grid: getComputedStyle(shell).gridTemplateColumns,
          navExpanded: collapse.getAttribute("aria-expanded"),
          navLabel: nav.getAttribute("aria-label"),
          activeCurrent: nav.querySelector("[aria-current='page']")?.dataset.sharedNavItem || "",
          everyVisibleItemHasLabel: visibleItems.every(node => node.getAttribute("aria-label") && node.getAttribute("title")),
          noHorizontalOverflow: document.documentElement.scrollWidth === document.documentElement.clientWidth
        };
        const nodes = focusables();
        nodes[nodes.length - 1]?.focus();
        panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
        const focusWrapped = document.activeElement === nodes[0];
        drawer.querySelector(".shared-task-drawer-close").click();
        const after = {
          scrollUnlocked: !document.body.dataset.sharedTaskDrawerScrollLocked,
          drawerState: drawer.dataset.sharedTaskDrawerState,
          focusReturned: document.activeElement === opener
        };
        document.body.dataset.task088Part1 = JSON.stringify({ before, collapsed, focusWrapped, after });
        document.body.textContent = document.body.dataset.task088Part1;
      }, 400);
    </script>
  </body></html>`;
}

function runBrowser(browserExecutable, htmlFile, width) {
  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--disable-background-networking", "--disable-component-update",
    "--disable-sync", `--window-size=${width},900`,
    `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-task-088-part1-"))}`,
    "--virtual-time-budget=1600", "--dump-dom", pathToFileURL(htmlFile).href
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
      try { child.kill("SIGKILL"); } catch {}
      error ? reject(error) : resolve(value);
    };
    const parse = () => {
      const match = stdout.match(/data-task088-part1="([^\"]+)"/);
      if (match) finish(null, JSON.parse(match[1].replace(/&quot;/g, '"')));
    };
    const timer = setTimeout(() => finish(new Error(stderr || "Shared Foundation browser fixture timed out"), true), 30000);
    child.stdout.on("data", chunk => { stdout += chunk; parse(); });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => finish(error, true));
    child.on("close", code => {
      if (settled) return;
      const match = stdout.match(/data-task088-part1="([^\"]+)"/);
      if (!match) return finish(new Error(`TASK-088 Part 1 metrics missing at ${width}px (exit ${code}): ${stderr}`), true);
      finish(null, JSON.parse(match[1].replace(/&quot;/g, '"')));
    });
  });
}

test("TASK-088 Part 1 shared Drawer and collapsed Navigation keep the desktop contract", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Browser executable unavailable for Shared Foundation runtime proof");
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-task-088-part1-fixture-"));
  const file = path.join(fixtureDir, "shared-foundation.html");
  fs.writeFileSync(file, fixture());
  for (const width of [1440, 1024]) {
    const metrics = await runBrowser(browserExecutable, file, width);
    assert.equal(metrics.before.drawerRole, "dialog");
    assert.equal(metrics.before.drawerLabelledBy, "taskDetailTitle");
    assert.equal(metrics.before.drawerFocused, true);
    assert.equal(metrics.before.scrollLocked, true);
    assert.equal(metrics.before.noHorizontalOverflow, true);
    assert.ok(metrics.before.panelWidth > 0);
    assert.ok(Number(metrics.before.panelZIndex) > Number(metrics.before.backdropZIndex));
    assert.equal(metrics.collapsed.navExpanded, "false", JSON.stringify(metrics));
    assert.equal(metrics.collapsed.navLabel, "全站導覽（已收合）");
    assert.equal(metrics.collapsed.activeCurrent, "worklog");
    assert.equal(metrics.collapsed.everyVisibleItemHasLabel, true);
    assert.equal(metrics.collapsed.noHorizontalOverflow, true);
    assert.equal(metrics.focusWrapped, true);
    assert.equal(metrics.after.scrollUnlocked, true);
    assert.equal(metrics.after.drawerState, "closed");
    assert.equal(metrics.after.focusReturned, true);
  }
});
