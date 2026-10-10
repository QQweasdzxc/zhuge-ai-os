import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const taskflowDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(taskflowDir, "../..");
const outputDir = path.resolve(process.env.TASKFLOW_SHELL_OUTPUT || path.join(repoRoot, ".render-taskflow-shell"));
const nativeHosts = new Set([
  "zhuge-multica-lab.onrender.com",
  "zhuge-multica-lab-api.onrender.com",
]);
const publicPaths = [
  ".nojekyll",
  "index.html",
  "version.json",
  "app",
  "assets",
  "contact",
  "google-data",
  "labs",
  "modules",
  "privacy",
  "product",
  "public",
  "scopes",
  "shared",
  "support",
  "terms",
];

function requireOrigin(value, label) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch {
    throw new Error(`${label} must be set to a TaskFlow Dev service origin.`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be an HTTPS origin without credentials, path, query or fragment.`);
  }
  if (nativeHosts.has(url.hostname)) {
    throw new Error(`${label} must not point to Multica Native Lab.`);
  }
  return url.origin;
}

function shouldCopy(source) {
  const relative = path.relative(repoRoot, source);
  if (!relative || relative === ".") return true;
  const parts = relative.split(path.sep);
  if (parts.some((part) => [".git", "node_modules", "third_party", "tests", "dist"].includes(part))) return false;
  if (relative === "labs/taskflow/runtime-config.js") return false;
  return true;
}

async function build() {
  const apiUrl = requireOrigin(process.env.TASKFLOW_API_URL, "TASKFLOW_API_URL");
  const webUrl = requireOrigin(process.env.TASKFLOW_WEB_URL, "TASKFLOW_WEB_URL");
  const shellOrigin = requireOrigin(process.env.TASKFLOW_SHELL_ORIGIN, "TASKFLOW_SHELL_ORIGIN");
  if (new Set([apiUrl, webUrl, shellOrigin]).size !== 3) {
    throw new Error("TaskFlow shell, Web and API must use separate service origins.");
  }

  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });
  for (const relative of publicPaths) {
    const source = path.join(repoRoot, relative);
    await fs.cp(source, path.join(outputDir, relative), { recursive: true, filter: shouldCopy });
  }
  const runtimeConfigPath = path.join(outputDir, "labs/taskflow/runtime-config.js");
  await fs.mkdir(path.dirname(runtimeConfigPath), { recursive: true });
  await fs.writeFile(
    runtimeConfigPath,
    `window.ZhugeTaskFlowConfig = Object.freeze(${JSON.stringify({ apiUrl, webUrl })});\n`,
    "utf8",
  );
  console.log("TaskFlow Dev shell built from taskflow-dev with isolated TaskFlow service origins.");
}

build().catch((error) => {
  console.error(`TaskFlow Dev shell build failed: ${error.message}`);
  process.exitCode = 1;
});
