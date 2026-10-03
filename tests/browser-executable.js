const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

function resolveBrowserExecutable() {
  const configured = process.env.CHROME_PATH || process.env.CHROMIUM_PATH || process.env.BROWSER_EXECUTABLE;
  if (configured) {
    if (!fs.existsSync(configured)) throw new Error(`Configured browser executable does not exist: ${configured}`);
    return configured;
  }
  for (const command of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]) {
    const result = spawnSync("which", [command], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  return "";
}

// Fixtures use the same loopback HTTP transport as Module C runtime QA.
// Only repository assets and explicitly registered temporary fixtures are served.
const path = require("node:path");
const http = require("node:http");
const root = path.resolve(__dirname, "..");
const temporaryFixtures = new Map();
let fixtureServer;
let listening;

function fixturePath(file) {
  const relative = path.relative(root, path.resolve(file));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Fixture asset must be inside the repository");
  }
  return "/" + relative.split(path.sep).map(encodeURIComponent).join("/");
}

async function fixtureURL(file) {
  const absolute = path.resolve(file);
  let pathname;
  if (absolute.startsWith(root + path.sep)) pathname = fixturePath(absolute);
  else {
    pathname = `/__fixture/${temporaryFixtures.size}/${encodeURIComponent(path.basename(absolute))}`;
    temporaryFixtures.set(pathname, absolute);
  }
  if (!listening) {
    fixtureServer = http.createServer((request, response) => {
      try {
        const url = new URL(request.url, "http://127.0.0.1");
        if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
        const candidate = path.resolve(root, "." + decodeURIComponent(url.pathname));
        const file = temporaryFixtures.get(url.pathname) || candidate;
        if (!temporaryFixtures.has(url.pathname) && !file.startsWith(root + path.sep)) {
          response.writeHead(403); response.end(); return;
        }
        // Never expose runtime credentials through the fixture server.
        if (path.relative(root, file).split(path.sep).some(part => part === ".git" || part.startsWith(".env"))) {
          response.writeHead(403); response.end(); return;
        }
        const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
        const content = fs.readFileSync(file);
        response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
        response.end(content);
      } catch { response.writeHead(404); response.end(); }
    });
    listening = new Promise((resolve, reject) => {
      fixtureServer.once("error", reject);
      fixtureServer.listen(0, "127.0.0.1", () => { fixtureServer.unref(); resolve(); });
    });
  }
  await listening;
  return `http://127.0.0.1:${fixtureServer.address().port}${pathname}`;
}

async function browserDOM(executable, file, { width = 1600, height = 1000, ready, query = "" } = {}) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ executablePath: executable, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"] });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto((await fixtureURL(file)) + query, { waitUntil: "load" });
    await page.waitForSelector(ready, { state: "attached", timeout: 30000 });
    return await page.content();
  } finally { await browser.close(); }
}

module.exports = { resolveBrowserExecutable, fixturePath, fixtureURL, browserDOM };
