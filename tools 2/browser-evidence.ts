import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
await mkdir(resolve(root, "screenshots"), { recursive: true });
await mkdir(resolve(root, "evidence/browser"), { recursive: true });
const previousFile = Bun.file(resolve(root, "evidence/browser-runtime.json"));
if (await previousFile.exists()) {
  const previous = await previousFile.json();
  const archive = resolve(root, "evidence/browser-history", String(previous.completedAt).replace(/[^0-9TZ]/g, "-"));
  await mkdir(archive, { recursive: true });
  if (!(await Bun.file(resolve(archive, "summary.json")).exists())) await Bun.write(resolve(archive, "summary.json"), previousFile);
  for (const old of previous.results) {
    const name = `${old.symbol}-${old.view}`;
    for (const [file, destination] of [[resolve(root, `evidence/browser/${name}.json`), resolve(archive, `${name}.json`)],
      [resolve(root, `screenshots/${name}.png`), resolve(archive, `${name}.png`)]]) {
      if (await Bun.file(file!).exists() && !(await Bun.file(destination!).exists())) await Bun.write(destination!, Bun.file(file!));
    }
  }
}
const targets = [
  { symbol: "2330.TW", view: "overview", expected: ["TWSE", "月營收", "資料時間", "Fallback"] },
  { symbol: "2330.TW", view: "operations", expected: ["MOPS", "非單季", "MoM", "千元"] },
  { symbol: "2330.TW", view: "history", expected: ["TWSE", "2026-09-30", "原始 OHLCV"], requiresRows: true },
  { symbol: "2330.TW", view: "ownership", expected: ["TDCC", "股權分散", "股數"], requiresRows: true },
  { symbol: "0050.TW", view: "overview", expected: ["ETF", "PARTIAL", "NOT_CONNECTED", "不適用"] },
  { symbol: "6488.TWO", view: "overview", expected: ["TPEx", "環球晶", "EPS", "MOPS"] },
  { symbol: "6488.TWO", view: "history", expected: ["NOT_CONNECTED", "TPEX_HISTORY_NOT_CONNECTED"], expectedEmpty: true },
  { symbol: "2330.TW", view: "radar", expected: ["World Bank", "PROVIDER_REVIEW_REQUIRED", "CC BY 4.0", "BINARY_HTTP_TRANSPORT_UNAVAILABLE", "Bun 終端"], transportGap: true },
  { symbol: "2330.TW", view: "derivatives", expected: ["TAIFEX", "TXO", "PARTIAL", "IV"], requiresRows: true },
];
const results = [];
for (const target of targets) {
  const name = `${target.symbol}-${target.view}`;
  const output = resolve(root, `screenshots/${name}.png`);
  const proc = Bun.spawn([process.execPath, resolve(root, "tools/run-lab.ts"), "shot", "TW", target.symbol,
    "--view", target.view, "--width", "1280", "--height", "1008", "--output", output, "--json"],
  { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  await Bun.write(resolve(root, `evidence/browser/${name}.json`), stdout);
  if (stderr) await Bun.write(resolve(root, `evidence/browser/${name}-stderr.txt`), stderr);
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { parsed = null; }
  const data = parsed?.data;
  const text = data?.render?.visibleText ?? "";
  const missing = target.expected.filter((value) => !text.includes(value));
  if (target.view === "overview" && data?.render?.visibleKeyValues?.find((row: { label: string }) => row.label === "價格 TWD")?.text.includes("未提供")) missing.push("real quote value");
  const visibleRowCount = data?.render?.rows?.length ?? 0;
  if ("requiresRows" in target && target.requiresRows && visibleRowCount === 0) missing.push("visible data rows");
  const settled = !!data?.render && !data.render.loadingStateDetected && !data.render.errorStateDetected;
  const usable = data?.usable === true && settled;
  // This gate validates the explicit empty UI, NOT a working TPEx history provider.
  // Keep dataUsable=false in evidence; never turn a missing capability into PASS.
  const expectedEmptyVerified = "expectedEmpty" in target && target.expectedEmpty === true && settled
    && data.usable === false && data.render.emptyStateDetected === true
    && text.includes("NOT_CONNECTED") && text.includes("TPEX_HISTORY_NOT_CONNECTED");
  const status = exitCode === 0 && (usable || expectedEmptyVerified) && missing.length === 0 ? "PASS" : "FAIL";
  const transportGap = "transportGap" in target && target.transportGap;
  const result = { ...target, status, gate: expectedEmptyVerified ? "explicit-gap-ui" : transportGap ? "explicit-transport-gap-ui" : "live-data-ui", exitCode, dataUsable: usable && !transportGap,
    capabilityStatus: expectedEmptyVerified ? "NOT_CONNECTED" : transportGap ? "UNAVAILABLE" : null, expectedEmptyVerified, visibleRowCount, missing, output, truncated: data?.render?.truncated ?? null,
    activeView: data?.render?.semanticUi?.find((node: { role: string }) => node.role === "tabs")?.metadata?.activeValue ?? null };
  results.push(result); console.log(JSON.stringify(result));
}
await Bun.write(resolve(root, "evidence/browser-runtime.json"), JSON.stringify({ completedAt: new Date().toISOString(), renderer: "Gloomberb original Desktop pane renderer + real Chromium + Bun official HTTP bridge", results }, null, 2));
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
