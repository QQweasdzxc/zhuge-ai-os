import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createDefaultConfig } from "../upstream/src/types/config";
import { EXTRACTED_PLUGINS } from "../upstream/src/plugins/seed";

const root = resolve(import.meta.dir, "..");
const profile = process.env.ZHUGE_LAB_PROFILE ?? "research-v1";
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(profile)) throw new Error("INVALID_LAB_PROFILE");
const home = resolve(root, "runtime-home", profile);
await mkdir(home, { recursive: true });
const file = Bun.file(resolve(home, "config.json"));
if (!(await file.exists())) {
  const config = createDefaultConfig(home);
  config.language = "zh-TW";
  config.baseCurrency = "TWD";
  config.onboardingComplete = true;
  config.disabledSources = ["gloomberb-cloud", "yahoo"];
  // Match Gloomberb's canonical fresh-install path: this new Lab is not an
  // upgrade from extracted plugins. No automatic broker/AI plugin restoration.
  config.seededPlugins = EXTRACTED_PLUGINS.map((plugin) => plugin.id);
  config.layout = { dockRoot: { kind: "pane", instanceId: "taiwan-research:2330.TW" },
    instances: [{ paneId: "taiwan-research", instanceId: "taiwan-research:2330.TW", title: "台灣研究 2330.TW", binding: { kind: "fixed", symbol: "2330.TW" } }],
    floating: [], detached: [] };
  config.layouts = [{ name: "台灣研究 Lab", layout: config.layout, paneState: {} }];
  config.activeLayoutIndex = 0;
  await Bun.write(file, JSON.stringify(config, null, 2));
}

// Do not inherit Cloud/Yahoo/FinMind tokens or another application's profile.
const env: Record<string, string> = { GLOOMBERB_HOME: home, GLOOMBERB_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", TZ: "Asia/Taipei" };
for (const key of ["PATH", "HOME", "TERM", "COLORTERM", "LANG", "LC_ALL", "TMPDIR", "CHROME_PATH"]) {
  if (process.env[key]) env[key] = process.env[key]!;
}
env.PATH = `${resolve(root, ".bun/bin")}:${env.PATH ?? "/usr/bin:/bin"}`;
const args = process.argv.slice(2);
const child = Bun.spawn([process.execPath, "src/cli/entry.ts", ...args], {
  cwd: resolve(root, "upstream"), env, stdin: "inherit", stdout: "inherit", stderr: "inherit",
});
process.exit(await child.exited);
