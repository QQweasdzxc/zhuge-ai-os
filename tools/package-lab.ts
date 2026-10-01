import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { unzipSync } from "../upstream/node_modules/fflate";

const root = resolve(import.meta.dir, "..");
const run = async (args: string[]) => {
  const child = Bun.spawn(args, { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code !== 0) throw new Error(`PACKAGE_COMMAND_FAILED: ${args[0]} ${code} ${stderr}`);
  return stdout.trim();
};
if (await run(["git", "status", "--porcelain"])) throw new Error("PACKAGE_REQUIRES_CLEAN_SOURCE_COMMIT");
if (await run(["git", "remote"])) throw new Error("LAB_EXPECTS_NO_REMOTE");
const qa = await Bun.file(resolve(root, "evidence/developer-qa.json")).json();
const browser = await Bun.file(resolve(root, "evidence/browser-runtime.json")).json();
const cli = await Bun.file(resolve(root, "evidence/cli-acceptance.json")).json();
const tui = await Bun.file(resolve(root, "evidence/tui-runtime.json")).json();
const isolation = await Bun.file(resolve(root, "evidence/isolation-audit.json")).json();
if (!qa.results.every((r: { status: string }) => r.status === "PASS")
  || !browser.results.every((r: { status: string }) => r.status === "PASS")
  || !Array.isArray(cli.results) || !cli.results.every((r: { status: string }) => r.status === "PASS")
  || tui.failure || tui.warnings.length || !String(tui.cleanup).startsWith("PASS") || !tui.captures.every((r: { status: string }) => r.status === "PASS")
  || isolation.status !== "PASS") throw new Error("PACKAGE_QA_GATE_NOT_PASS");

const identity = await Bun.file(resolve(root, "lab-identity.json")).json();
const head = await run(["git", "rev-parse", "HEAD"]);
const branch = await run(["git", "branch", "--show-current"]);
const files = (await run(["git", "ls-files", "-z"])).split("\0").filter(Boolean);
if (files.some((file) => /(^|\/)(\.git|node_modules|\.bun|\.cache|runtime-home|artifacts)(\/|$)/.test(file))) throw new Error("PACKAGE_PRIVATE_RUNTIME_PATH_PRESENT");
const out = resolve(root, "artifacts");
await mkdir(out, { recursive: true });
const createdAt = new Date();
const localParts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(createdAt).map((part) => [part.type, part.value]));
const artifactStamp = `${localParts.year}${localParts.month}${localParts.day}-${localParts.hour}${localParts.minute}`;
const stem = `${artifactStamp}_Zhuge-Investment-Intelligence-Lab-Phase1-Build-${identity.build}-FullSource-Candidate`;
const zipPath = resolve(out, `${stem}.zip`);
const manifestPath = resolve(out, `${stem}.manifest.json`);
if (await Bun.file(zipPath).exists() || await Bun.file(manifestPath).exists()) throw new Error("CANDIDATE_ALREADY_EXISTS_NEVER_OVERWRITE");
await run(["git", "archive", "--format=zip", `--output=${zipPath}`, head]);
const bytes = new Uint8Array(await Bun.file(zipPath).arrayBuffer());
const zip = unzipSync(bytes);
const mismatches = [];
for (const file of files) {
  const archived = zip[file];
  const working = new Uint8Array(await Bun.file(resolve(root, file)).arrayBuffer());
  if (!archived || createHash("sha256").update(archived).digest("hex") !== createHash("sha256").update(working).digest("hex")) mismatches.push(file);
}
if (mismatches.length) throw new Error(`ZIP_SOURCE_MISMATCH_COUNT:${mismatches.length}`);
const manifest = {
  schema: "zhuge-independent-lab-candidate-v1", ...identity, sourceCommit: head, branch,
  artifactCreatedAt: createdAt.toISOString(), artifactCreatedAtTimezone: "Asia/Taipei", artifactLocalStamp: artifactStamp, zipPath,
  sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength,
  sourceFileCount: files.length, zipFileCount: Object.keys(zip).filter((name) => !name.endsWith("/")).length,
  byteLevelMatch: `${files.length}/${files.length}`, integrity: "PASS", qa, browser, cli, tui, isolation,
  knownLimitations: ["Desktop text-only bridge: Oil/Copper UNAVAILABLE; native Bun PASS", "6488 history NOT_CONNECTED", "0050 ETF constituents/weights/NAV missing",
    "DRAM/NAND, SOX, SCFI PROVIDER_REVIEW_REQUIRED", "Upstream ShortInterest render timing flake retained in QA history"],
  gate: "Developer QA complete; STOP for GPT Review -> PM Experience Review -> PM Phase 2 decision",
  mutations: { labLocalSourceAndCommit: true, push: false, pullRequest: false, merge: false, deploy: false, publish: false, protectedSources: false },
  excluded: ["executors/.bun", "native QA tools/.cache", "node_modules", "runtime-home", "credentials", "Git internals"],
};
await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ build: identity.build, branch, head, zipPath, manifestPath, sha256: manifest.sha256,
  sourceFileCount: files.length, byteLevelMatch: manifest.byteLevelMatch, integrity: manifest.integrity }, null, 2));
