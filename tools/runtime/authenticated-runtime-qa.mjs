#!/usr/bin/env node

/**
 * Authenticated runtime QA harness.
 *
 * A CI secret supplies an already-authorized Playwright storage state. The
 * harness never creates a session, never logs a token, and skips explicitly
 * when the secure state is unavailable.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const runtimeUrl = process.env.Zhuge_RUNTIME_URL || "https://qqweasdzxc.github.io/zhuge-ai-os/";
const encodedState = process.env.Zhuge_AUTH_STORAGE_STATE_B64;
const mobileViewport = { width: 375, height: 812, isMobile: true, hasTouch: true };
const desktopViewport = { width: 1440, height: 1000, isMobile: false, hasTouch: false };
const routes = [
  { name: "ai-board", path: "app/Board/ai/" },
  { name: "worktodo", path: "app/Board/worktodo/" },
  { name: "workflow-studio", path: "app/Board/template-preview/?templateView=workflow" },
  { name: "task-086-attachment-ai", path: "app/Board/worktodo/" },
  { name: "investment", path: "modules/investment/" },
  { name: "skyeye", path: "modules/skyeye/" },
  { name: "worklog", path: "modules/worklog/?app=1&workspace=dashboard" }
];

function emit(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

if (!encodedState) {
  emit({
    contract: "zhuge-authenticated-runtime-qa-v1",
    status: "SKIP",
    code: "AUTH_CREDENTIAL_UNAVAILABLE",
    runtimeUrl,
    secretValuesExposed: false,
    note: "Provide Zhuge_AUTH_STORAGE_STATE_B64 as a protected CI secret to run authenticated checks."
  });
  process.exit(0);
}

let state;
try {
  state = JSON.parse(Buffer.from(encodedState, "base64url").toString("utf8"));
} catch {
  emit({ contract: "zhuge-authenticated-runtime-qa-v1", status: "FAIL", code: "AUTH_STATE_INVALID", secretValuesExposed: false });
  process.exit(1);
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhuge-runtime-qa-"));
const statePath = path.join(tempDir, "storage-state.json");
const artifactDir = path.resolve("tests/evidence/authenticated-runtime-qa");
await fs.mkdir(artifactDir, { recursive: true });
await fs.writeFile(statePath, JSON.stringify(state), { mode: 0o600 });

let browser;
const results = [];
try {
  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
  for (const viewport of [desktopViewport, mobileViewport]) {
    const context = await browser.newContext({ storageState: statePath, viewport });
    for (const route of routes) {
      const page = await context.newPage();
      const url = new URL(route.path, runtimeUrl).toString();
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
      const bodyText = await page.locator("body").innerText().catch(() => "");
      const loginVisible = /google|登入|sign in|login/i.test(bodyText) && /登入|sign in|login/i.test(bodyText);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      const build = await page.locator("[data-build-id], [data-runtime-build], .runtime-build-id").first().textContent().catch(() => null);
      const screenshot = path.join(artifactDir, `${viewport.isMobile ? "mobile" : "desktop"}-${route.name}.png`);
      await page.screenshot({ path: screenshot, fullPage: true });
      results.push({
        viewport: viewport.isMobile ? "mobile-375x812" : "desktop-1440x1000",
        route: route.name,
        httpStatus: response?.status() ?? null,
        authenticatedSurface: !loginVisible,
        horizontalOverflow: overflow,
        buildIdentityPresent: Boolean(build),
        screenshot: path.relative(process.cwd(), screenshot)
      });
      await page.close();
    }
    await context.close();
  }
} catch (error) {
  emit({ contract: "zhuge-authenticated-runtime-qa-v1", status: "FAIL", code: "HARNESS_EXECUTION_FAILED", errorCategory: error?.name || "UNKNOWN", secretValuesExposed: false });
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await fs.rm(tempDir, { recursive: true, force: true });
}

const failures = results.filter((result) => result.httpStatus !== 200 || !result.authenticatedSurface || result.horizontalOverflow);
emit({
  contract: "zhuge-authenticated-runtime-qa-v1",
  status: failures.length === 0 ? "PASS" : "FAIL",
  code: failures.length === 0 ? null : "RUNTIME_ASSERTION_FAILED",
  runtimeUrl,
  secretValuesExposed: false,
  providerRuntime: process.env.Zhuge_LINE_RUNTIME_URL ? "configured-for-separate-readiness" : "provider-credential-optional",
  results
});
if (failures.length > 0) process.exitCode = 1;
