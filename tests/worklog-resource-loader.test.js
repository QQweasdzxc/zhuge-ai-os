const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "modules/worklog/index.html"), "utf8");
const BUILD = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).build;
const inlineScripts = [...SOURCE.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
const loaderSource = inlineScripts.find((source) => source.includes("const runtimeFiles = ["));
assert.ok(loaderSource, "WorkLog startup loader must remain in the entry document");

function readArray(name) {
  const match = loaderSource.match(new RegExp(`const ${name} = (\\[[\\s\\S]*?\\]);`));
  assert.ok(match, `${name} source array must exist`);
  return vm.runInNewContext(match[1]);
}

const APP_STYLES = readArray("appStyles");
const RUNTIME_FILES = readArray("runtimeFiles");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runLoader({ networkDelayMs = 60, executionDelayMs = 1, failStyle = "", failPreload = "", failScript = "", search = "?app=1&workspace=dashboard" } = {}) {
  const head = { children: [] };
  const body = { children: [] };
  const events = [];
  const root = { innerHTML: "" };
  const publicHomeStyles = { removed: false, remove() { this.removed = true; } };
  const local = new Map();
  const start = Date.now();

  const complete = (element, kind, failed, waitMs) => {
    const event = { kind, href: element.href || element.src || "", start: Date.now() - start };
    events.push(event);
    setTimeout(() => {
      event.end = Date.now() - start;
      if (failed) element.onerror?.(new Error(`fixture ${kind} failure`));
      else element.onload?.();
    }, waitMs);
  };

  const append = (parent, element) => {
    parent.children.push(element);
    if (element.tagName === "LINK" && element.rel === "stylesheet") {
      complete(element, "stylesheet", Boolean(failStyle) && element.href.includes(failStyle), networkDelayMs);
    } else if (element.tagName === "LINK" && element.rel === "preload") {
      complete(element, "preload", Boolean(failPreload) && element.href.includes(failPreload), networkDelayMs);
    } else if (element.tagName === "SCRIPT") {
      const isAppearance = element.src.includes("zhuge-appearance.js");
      complete(element, isAppearance ? "appearance" : "script", !isAppearance && Boolean(failScript) && element.src.includes(failScript), executionDelayMs);
    }
    return element;
  };

  const document = {
    head: { ...head, appendChild(element) { return append(this, element); } },
    body: { ...body, appendChild(element) { return append(this, element); } },
    createElement(tagName) {
      return {
        tagName: tagName.toUpperCase(),
        relList: { supports: (value) => value === "preload" },
        setAttribute(name, value) { this[name] = value; }
      };
    },
    getElementById(id) {
      if (id === "app") return root;
      if (id === "public-home-styles") return publicHomeStyles;
      return null;
    }
  };
  const window = { location: { search, hash: "" } };
  const localStorage = {
    getItem(key) { return local.get(key) ?? null; },
    setItem(key, value) { local.set(key, String(value)); }
  };
  const context = vm.createContext({ document, window, localStorage, URLSearchParams, console: { error() {} }, Promise, Error, Set, Date, setTimeout });
  vm.runInContext(loaderSource, context, { filename: "worklog/index.html#startup-loader" });

  if (!search.includes("app=1")) {
    return {
      elapsedMs: Date.now() - start,
      head: document.head.children,
      events,
      runtimeScripts: [],
      rootHtml: root.innerHTML,
      publicHomeStylesRemoved: publicHomeStyles.removed
    };
  }

  const timeoutAt = Date.now() + 5000;
  while (Date.now() < timeoutAt) {
    const runtimeScripts = document.body.children.filter((element) => element.tagName === "SCRIPT" && !element.src.includes("zhuge-appearance.js"));
    const failed = /工作空間暫時無法開啟/.test(root.innerHTML);
    if (failed || runtimeScripts.length === RUNTIME_FILES.length) break;
    await delay(2);
  }
  const runtimeScripts = document.body.children.filter((element) => element.tagName === "SCRIPT" && !element.src.includes("zhuge-appearance.js"));
  return {
    elapsedMs: Date.now() - start,
    head: document.head.children,
    events,
    runtimeScripts,
    rootHtml: root.innerHTML,
    publicHomeStylesRemoved: publicHomeStyles.removed
  };
}

test("WorkLog starts CSS and script downloads together while retaining CSS and execution order", async () => {
  const result = await runLoader();
  const styles = result.head.filter((element) => element.rel === "stylesheet");
  const preloads = result.head.filter((element) => element.rel === "preload");

  assert.deepEqual(JSON.parse(JSON.stringify(styles.map((element) => element.href))), JSON.parse(JSON.stringify(APP_STYLES)));
  assert.deepEqual(JSON.parse(JSON.stringify(preloads.map((element) => element.href))), JSON.parse(JSON.stringify(RUNTIME_FILES.map((file) => file.includes("://") ? file : `${file}?v=${BUILD}`))));
  assert.deepEqual(result.runtimeScripts.map((element) => element.src), preloads.map((element) => element.href));
  assert.ok(result.runtimeScripts.every((element) => element.async === false));
  assert.equal(result.runtimeScripts.length, 58);
  assert.equal(result.publicHomeStylesRemoved, true);

  const starts = result.events.filter((event) => event.kind === "stylesheet" || event.kind === "preload");
  const styleStarts = starts.filter((event) => event.kind === "stylesheet");
  const preloadStarts = starts.filter((event) => event.kind === "preload");
  assert.equal(styleStarts.length, 16);
  assert.equal(preloadStarts.length, 58);
  assert.ok(Math.max(...starts.map((event) => event.start)) - Math.min(...starts.map((event) => event.start)) < 20,
    "CSS and JavaScript resource requests should begin in parallel, not as serial chains");

  for (let index = 1; index < result.runtimeScripts.length; index += 1) {
    const priorExecution = result.events.find((event) => event.kind === "script" && event.href === result.runtimeScripts[index - 1].src);
    const nextExecution = result.events.find((event) => event.kind === "script" && event.href === result.runtimeScripts[index].src);
    assert.ok(priorExecution.end <= nextExecution.start, `script ${index} must wait for the prior script to execute`);
  }

  const serialNetworkFloorMs = (APP_STYLES.length + RUNTIME_FILES.length) * 60;
  console.log(`WORKLOG_LOADER_FIXTURE: styles=${APP_STYLES.length}, scripts=${RUNTIME_FILES.length}, simulatedResourceDelay=60ms, serialNetworkFloor=${serialNetworkFloorMs}ms, observedLoader=${result.elapsedMs}ms`);
});

test("WorkLog stops before executing scripts when any parallel stylesheet load fails", async () => {
  const result = await runLoader({ failStyle: "worklog.css" });
  assert.equal(result.runtimeScripts.length, 0);
  assert.match(result.rootHtml, /版面資源載入失敗/);
});

test("WorkLog stops before executing scripts when a parallel script preload fails", async () => {
  const result = await runLoader({ failPreload: "app-config.js" });
  assert.equal(result.runtimeScripts.length, 0);
  assert.match(result.rootHtml, /部分共用資源載入失敗/);
});

test("WorkLog stops subsequent script execution after a script load failure", async () => {
  const failedFile = RUNTIME_FILES[8];
  const result = await runLoader({ failScript: failedFile });
  assert.equal(result.runtimeScripts.length, 9);
  assert.match(result.rootHtml, /部分共用資源載入失敗/);
});

test("WorkLog does not load the application bundles on the public landing page", async () => {
  const result = await runLoader({ search: "" });
  assert.equal(result.head.filter((element) => element.rel === "stylesheet").length, 0);
  assert.equal(result.head.filter((element) => element.rel === "preload").length, 0);
  assert.equal(result.runtimeScripts.length, 0);
  assert.equal(result.publicHomeStylesRemoved, false);
});
