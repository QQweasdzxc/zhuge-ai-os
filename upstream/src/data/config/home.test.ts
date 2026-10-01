import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { getDefaultGloomberbHome, getGloomberbHome, isGloomberbHomeOverridden } from "./home";
import { getDataDir, initDataDir } from "./store/node";

/**
 * #728: the only way to relocate `~/.gloomberb` used to be editing `dataDir`
 * in config.json, and that file lives in the folder being moved, so the next
 * launch started a fresh `~/.gloomberb`. `GLOOMBERB_HOME` moves the folder.
 */
describe("getGloomberbHome", () => {
  test("defaults to ~/.gloomberb", () => {
    expect(getGloomberbHome({ HOME: "/Users/ada" })).toBe(join("/Users/ada", ".gloomberb"));
    expect(isGloomberbHomeOverridden({ HOME: "/Users/ada" })).toBe(false);
  });

  test("honours GLOOMBERB_HOME, with a leading ~ expanded", () => {
    expect(getGloomberbHome({ GLOOMBERB_HOME: "/data/gloom" })).toBe("/data/gloom");
    expect(isGloomberbHomeOverridden({ GLOOMBERB_HOME: "/data/gloom" })).toBe(true);
    expect(getGloomberbHome({ HOME: "/Users/ada", GLOOMBERB_HOME: "~/gloom" })).toBe(join("/Users/ada", "gloom"));
  });

  test("treats a blank override as unset", () => {
    expect(getGloomberbHome({ HOME: "/Users/ada", GLOOMBERB_HOME: "   " })).toBe(getDefaultGloomberbHome({ HOME: "/Users/ada" }));
    expect(isGloomberbHomeOverridden({ GLOOMBERB_HOME: "" })).toBe(false);
  });
});

describe("getDataDir under GLOOMBERB_HOME", () => {
  const previous = process.env.GLOOMBERB_HOME;
  const scratch: string[] = [];

  afterEach(() => {
    if (previous === undefined) delete process.env.GLOOMBERB_HOME;
    else process.env.GLOOMBERB_HOME = previous;
    for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function home(config: Record<string, unknown>): string {
    const dir = mkdtempSync(join(tmpdir(), "gloom-home-"));
    scratch.push(dir);
    writeFileSync(join(dir, "config.json"), JSON.stringify(config));
    process.env.GLOOMBERB_HOME = dir;
    return dir;
  }

  test("reads the global config from the overridden home", async () => {
    const dir = home({ dataDir: join(tmpdir(), "somewhere-else") });
    mkdirSync(join(tmpdir(), "somewhere-else"), { recursive: true });
    scratch.push(join(tmpdir(), "somewhere-else"));

    expect(await getDataDir()).toBe(join(tmpdir(), "somewhere-else"));
    expect(dir).toBeTruthy();
  });

  test("a moved folder whose config still names the old, now missing, data directory lands in the new home", async () => {
    const dir = home({ dataDir: "/nonexistent/old/.gloomberb" });

    expect(await getDataDir()).toBe(dir);

    // The first launch records the new location, so later launches do not
    // depend on the old path staying absent.
    const config = await initDataDir(dir);
    expect(config.dataDir).toBe(dir);
    expect(JSON.parse(readFileSync(join(dir, "config.json"), "utf-8")).dataDir).toBe(dir);
  });
});
