import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dir, "..");
const dir = resolve(root, "evidence/cli");
await mkdir(dir, { recursive: true });
async function command(id: string, args: string[]) {
  const child = Bun.spawn([process.execPath, resolve(root, "tools/run-lab.ts"), ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  await Bun.write(resolve(dir, `${id}.json`), stdout);
  if (stderr) await Bun.write(resolve(dir, `${id}-stderr.txt`), stderr);
  return { exitCode, value: JSON.parse(stdout) };
}
const results = [];
const catalog = await command("catalog", ["catalog", "--all", "--json"]);
const functions = Array.isArray(catalog.value.data) ? catalog.value.data : [];
const tokens = functions.map((f: { token: string }) => f.token);
const required = ["TW", "GP", "FA", "HDS", "OMON"];
results.push({ id: "original-command-and-new-TW-discovery", status: required.every((v) => tokens.includes(v)) ? "PASS" : "FAIL", required,
  found: required.filter((v) => tokens.includes(v)), catalogCount: tokens.length });
for (const symbol of ["2330.TW", "0050.TW", "6488.TWO"]) {
  const { exitCode, value } = await command(symbol, ["fn", "TW", symbol, "--view", "all", "--json"]);
  const report = value.data?.metadata?.report;
  const okay = exitCode === 0 && value.ok === true && report?.symbol === symbol && report.quote.status === "PASS"
    && report.quote.dataTimestamp && report.quote.source.length && report.quote.fetchedAt;
  results.push({ id: symbol, status: okay ? "PASS" : "FAIL", exitCode, quote: report?.quote.status, date: report?.quote.dataTimestamp,
    complete: value.data?.complete, scope: "Real official data; partial reports remain complete=false" });
}
await Bun.write(resolve(root, "evidence/cli-acceptance.json"), JSON.stringify({ completedAt: new Date().toISOString(), results }, null, 2));
console.log(JSON.stringify(results, null, 2));
process.exitCode = results.every((r) => r.status === "PASS") ? 0 : 1;
