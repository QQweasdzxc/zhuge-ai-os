import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const taskflowDir = path.dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.TASKFLOW_ENTRY_OUTPUT || path.join(taskflowDir, "dist");
const nativeHosts = new Set([
  "zhuge-multica-lab.onrender.com",
  "zhuge-multica-lab-api.onrender.com"
]);

function requireServiceOrigin(value, label) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} must be set to the TaskFlow Dev service origin.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an HTTPS origin without credentials, path, query or fragment.`);
  }
  if (nativeHosts.has(url.hostname)) {
    throw new Error(`${label} must not point to the Multica Native Lab service.`);
  }
  return url.origin;
}

async function build() {
  const apiUrl = requireServiceOrigin(process.env.TASKFLOW_API_URL, "TASKFLOW_API_URL");
  const webUrl = requireServiceOrigin(process.env.TASKFLOW_WEB_URL, "TASKFLOW_WEB_URL");
  if (apiUrl === webUrl) throw new Error("TaskFlow Web and API must use separate service origins.");

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  await fs.copyFile(path.join(taskflowDir, "index.html"), path.join(outputDir, "index.html"));
  await fs.writeFile(
    path.join(outputDir, "runtime-config.js"),
    `window.ZhugeTaskFlowConfig = Object.freeze(${JSON.stringify({ apiUrl, webUrl })});\n`,
    "utf8"
  );
  console.log("TaskFlow Dev launcher generated with non-secret service origins.");
}

build().catch(error => {
  console.error(`TaskFlow Dev launcher build failed: ${error.message}`);
  process.exitCode = 1;
});
