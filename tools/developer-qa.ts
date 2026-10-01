import { mkdir } from "node:fs/promises";
import { resolve, delimiter } from "node:path";

const root = resolve(import.meta.dir, "..");
const cwd = resolve(root, "upstream");
const out = resolve(root, "evidence/qa");
await mkdir(out, { recursive: true });
const previousFile = Bun.file(resolve(root, "evidence/developer-qa.json"));
if (await previousFile.exists()) {
  const previous = await previousFile.json();
  const archive = resolve(root, "evidence/qa-history", String(previous.completedAt).replace(/[^0-9TZ]/g, "-"));
  await mkdir(archive, { recursive: true });
  for (const name of ["targeted", "typecheck", "manifest", "full-regression"]) {
    const old = Bun.file(resolve(out, `${name}.txt`));
    if (await old.exists() && !(await Bun.file(resolve(archive, `${name}.txt`)).exists())) await Bun.write(resolve(archive, `${name}.txt`), old);
  }
  if (!(await Bun.file(resolve(archive, "summary.json")).exists())) await Bun.write(resolve(archive, "summary.json"), previousFile);
}
await mkdir(resolve(root, ".cache/tmp"), { recursive: true });
await mkdir(resolve(root, ".cache/qa-home"), { recursive: true });
const bun = process.execPath;
const env: Record<string, string> = { PATH: `${resolve(root, ".bun/bin")}${delimiter}${process.env.PATH ?? "/usr/bin:/bin"}`,
  HOME: process.env.HOME ?? "", TERM: "xterm-256color", GLOOMBERB_HOME: resolve(root, "runtime-home/qa"),
  GLOOMBERB_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", TZ: "Asia/Taipei", TMPDIR: resolve(root, ".cache/tmp") };
const checks = [
  { id: "targeted", args: ["test", "src/plugins/builtin/taiwan/research.test.ts"] },
  { id: "typecheck", args: ["run", "typecheck"] },
  { id: "manifest", args: ["run", "plugins:manifest:check"] },
  { id: "full-regression", args: ["test"] },
];
const results = [];
for (const check of checks) {
  const start = Date.now();
  const checkEnv = { ...env };
  if (check.id === "full-regression") {
    // Original CLI tests install their own HOME fixtures. A global override
    // defeats those fixtures. Sandbox the child's fallback home instead.
    delete checkEnv.GLOOMBERB_HOME;
    checkEnv.HOME = resolve(root, ".cache/qa-home");
    // The upstream full suite uses UTC calendar fixtures; Taiwan targeted
    // and real runtime checks independently run in Asia/Taipei.
    checkEnv.TZ = "UTC";
  }
  const proc = Bun.spawn([bun, ...check.args], { cwd, env: checkEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  const log = `${stdout}\n${stderr}`;
  await Bun.write(resolve(out, `${check.id}.txt`), log);
  const pass = [...log.matchAll(/^\s*(\d+) pass\s*$/gm)].at(-1)?.[1] ?? null;
  const fail = [...log.matchAll(/^\s*(\d+) fail\s*$/gm)].at(-1)?.[1] ?? null;
  const result = { id: check.id, exitCode, status: exitCode === 0 ? "PASS" : "FAIL", durationMs: Date.now() - start, pass, fail,
    timezone: checkEnv.TZ, profileIsolation: "Lab-only child runtime / upstream temporary fixtures" };
  results.push(result); console.log(JSON.stringify(result));
}
await Bun.write(resolve(root, "evidence/developer-qa.json"), JSON.stringify({ completedAt: new Date().toISOString(), results }, null, 2));
process.exitCode = results.every((r) => r.exitCode === 0) ? 0 : 1;
