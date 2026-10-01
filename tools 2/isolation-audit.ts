import { readdir, lstat, readFile, readlink, mkdir, writeFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";

const lab = resolve(import.meta.dir, "..");
const protectedRoots = [
  "/Users/qq/Documents/Gloomberb Original Runtime Evaluation",
  "/Users/qq/Documents/Gloomberb Taiwan Provider Spike",
  "/Users/qq/Documents/Zhuge AI OS",
];
const excluded = new Set([".git", "node_modules", ".bun", ".DS_Store", ".cache", "dist", "build", "runtime-home", "runtime-home-local", "data", "artifacts", "Archive", "Deliveries"]);
const ignoredExtensions = /\.(?:zip|tgz|pdf|mp4|sqlite|sqlite-shm|sqlite-wal|db|log)$/i;
type Entry = { bytes?: number; sha256?: string; symlink?: string };
async function sourceTree(root: string): Promise<Record<string, Entry>> {
  const result: Record<string, Entry> = {};
  async function walk(dir: string) {
    for (const name of (await readdir(dir)).sort()) {
      if (excluded.has(name) || ignoredExtensions.test(name)) continue;
      const file = join(dir, name);
      const stat = await lstat(file);
      const key = relative(root, file);
      if (stat.isSymbolicLink()) result[key] = { symlink: await readlink(file) };
      else if (stat.isDirectory()) await walk(file);
      else if (stat.isFile()) result[key] = { bytes: stat.size, sha256: createHash("sha256").update(await readFile(file)).digest("hex") };
    }
  }
  await walk(root);
  return result;
}
const file = join(lab, "baseline/protected-source-before.json");
const trees: Record<string, Record<string, Entry>> = {};
for (const root of protectedRoots) trees[root] = await sourceTree(root);
if (process.argv.includes("--record")) {
  await mkdir(join(lab, "baseline"), { recursive: true });
  try { await lstat(file); throw new Error("Baseline already exists; never overwrite"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  await writeFile(file, JSON.stringify({ createdAt: new Date().toISOString(), scope: "Source trees; excludes Git internals, dependencies, runtime caches and release archives", trees }, null, 2));
  console.log(JSON.stringify({ status: "PASS", mode: "record", counts: Object.fromEntries(Object.entries(trees).map(([root, entries]) => [root, Object.keys(entries).length])) }));
} else {
  const before = JSON.parse(await readFile(file, "utf8")).trees as typeof trees;
  const differences: string[] = [];
  for (const root of protectedRoots) for (const key of new Set([...Object.keys(before[root]), ...Object.keys(trees[root])])) {
    if (JSON.stringify(before[root][key]) !== JSON.stringify(trees[root][key])) differences.push(join(root, key));
  }
  const report = { checkedAt: new Date().toISOString(), status: differences.length ? "FAIL" : "PASS", sourceFiles: Object.values(trees).reduce((n, entries) => n + Object.keys(entries).length, 0), differences };
  await mkdir(join(lab, "evidence"), { recursive: true });
  await writeFile(join(lab, "evidence/isolation-audit.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  if (differences.length) process.exitCode = 1;
}
