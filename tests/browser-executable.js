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

module.exports = { resolveBrowserExecutable };
