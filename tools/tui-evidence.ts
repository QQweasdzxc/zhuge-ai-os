import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const localTmux = resolve(root, ".cache/tool-source/tmux-3.5a/tmux");
const tmux = process.env.LAB_TMUX_PATH ?? (await Bun.file(localTmux).exists() ? localTmux : Bun.which("tmux"));
if (!tmux) throw new Error("TMUX_TOOL_UNAVAILABLE: install tmux or set LAB_TMUX_PATH for native TUI QA");
const socket = resolve(root, ".cache/tw-smoke.sock");
const dir = resolve(root, "evidence/tui");
await mkdir(dir, { recursive: true });
const profile = `tui-smoke-${Date.now()}`;
const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: process.env.HOME ?? "", TERM: "xterm-256color", LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8", ZHUGE_LAB_PROFILE: profile };
const run = async (...args: string[]) => {
  const process = Bun.spawn([tmux, "-S", socket, ...args], { cwd: root, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  return { stdout, stderr, code };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const captures: Array<{ id: string; status: string; file: string; required: string[] }> = [];
async function capture(id: string, required: string[]) {
  let text = "";
  for (let i = 0; i < 25; i++) {
    await sleep(1000);
    text = (await run("capture-pane", "-t", "lab", "-p")).stdout;
    if (required.every((value) => text.includes(value))) break;
  }
  const file = resolve(dir, `${id}.txt`);
  await Bun.write(file, text);
  const status = required.every((value) => text.includes(value)) ? "PASS" : "FAIL";
  captures.push({ id, status, file, required });
  console.log(JSON.stringify(captures.at(-1)));
  if (status === "FAIL") throw new Error(`TUI_GATE_FAILED:${id}`);
}
let cleanup;
let failure: string | null = null;
try {
  const start = await run("-f", "/dev/null", "new-session", "-d", "-s", "lab", "-x", "144", "-y", "70", `ZHUGE_LAB_PROFILE=${profile} .bun/bin/bun tools/run-lab.ts`);
  if (start.code !== 0) throw new Error(`TMUX_START_FAILED: ${start.stderr}`);
  await run("pipe-pane", "-o", "-t", "lab", `tee '${resolve(dir, "runtime.raw.txt")}' >/dev/null`);
  await capture("2330-start", ["2330.TW", "2,480", "TWSE"]);
  for (let i = 0; i < 3; i++) { await run("send-keys", "-t", "lab", "Right"); await sleep(200); }
  await capture("2330-ownership", ["TDCC", "股東持股級距", "人數", "占集保"]);
  await run("send-keys", "-t", "lab", "Right"); await sleep(300);
  await capture("2330-radar", ["World Bank", "90.9", "82.7", "CC BY 4.0"]);
  for (let i = 0; i < 4; i++) { await run("send-keys", "-t", "lab", "Left"); await sleep(200); }
  for (const [id, symbol, price] of [["0050-command", "0050.TW", "112.05"], ["6488-command", "6488.TWO", "1,035"]]) {
    await run("send-keys", "-t", "lab", "C-p"); await sleep(400);
    await run("send-keys", "-t", "lab", "-l", `TW ${symbol}`); await sleep(400);
    await run("send-keys", "-t", "lab", "Enter");
    await capture(id!, [symbol!, price!]);
  }
} catch (error) {
  failure = error instanceof Error ? error.message : "TUI_FAILED";
} finally {
  await run("kill-session", "-t", "lab");
  await run("kill-server");
  cleanup = await run("list-sessions");
}
const log = await Bun.file(resolve(dir, "runtime.raw.txt")).text().catch(() => "");
const warnings = [...log.matchAll(/Maximum update depth|MaxListeners|Invalid hook|Rendered more hooks|Rendered fewer hooks|React has detected/g)].map((m) => m[0]);
await Bun.write(resolve(root, "evidence/tui-runtime.json"), JSON.stringify({ completedAt: new Date().toISOString(),
  runtime: "Actual Bun/OpenTUI application, isolated tmux 3.5a socket, 144x70 terminal", profile, captures, warnings, failure,
  cleanup: cleanup.code !== 0 ? "PASS: isolated tmux session/server stopped" : "FAIL", longHorizonLeakAbsence: "NOT_PROVEN_BY_SHORT_SMOKE" }, null, 2));
process.exitCode = !failure && captures.every((c) => c.status === "PASS") && !warnings.length && cleanup.code !== 0 ? 0 : 1;
