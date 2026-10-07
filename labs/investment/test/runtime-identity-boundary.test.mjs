import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const labRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoots = ["index.html", "app.js", "lab-product.css", "src"];
const runtimeExtensions = new Set([".html", ".js", ".mjs", ".css"]);

async function collectRuntimeFiles(entry) {
  const absolute = path.join(labRoot, entry);
  const entries = await readdir(absolute, { withFileTypes: true }).catch(() => null);
  if (!entries) return runtimeExtensions.has(path.extname(entry)) ? [absolute] : [];
  const nested = await Promise.all(entries
    .filter((item) => item.isFile() || item.isDirectory())
    .map((item) => collectRuntimeFiles(path.posix.join(entry, item.name))));
  return nested.flat();
}

test("Lab shipped runtime has no Genspark author account or license-worker dependency", async () => {
  const files = (await Promise.all(runtimeRoots.map(collectRuntimeFiles))).flat();
  const sources = await Promise.all(files.map(async (file) => ({
    file: path.relative(labRoot, file),
    source: await readFile(file, "utf8"),
  })));
  const forbidden = [
    ["upstream Worker host", /license-worker\.dvorak0727\.workers\.dev/i],
    ["original author identity", /dvorak0727(?:\.github\.io|@gmail\.com)/i],
    ["original license storage", /LICENSE_KV/i],
    ["original license verification route", /(?:fetch\s*\(\s*[^\n]{0,160})?\/verify(?:[/?'"`]|\b)/i],
    ["original plan gate", /\b(?:standard|vip|premium)\b/i],
    ["hard-coded account UUID", /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i],
    ["upstream product branding", /Genspark[- ]Stock[- ]AI/i],
  ];
  const violations = [];
  for (const { file, source } of sources) {
    for (const [label, pattern] of forbidden) {
      if (pattern.test(source)) violations.push(`${file}: ${label}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("Lab user-facing title identifies the Zhuge product surface rather than a sandbox label", async () => {
  const source = await readFile(path.join(labRoot, "index.html"), "utf8");
  assert.match(source, /<title>Lab_投資｜Zhuge AI OS<\/title>/);
  assert.doesNotMatch(source, /Zhuge Investment Sandbox/i);
});
