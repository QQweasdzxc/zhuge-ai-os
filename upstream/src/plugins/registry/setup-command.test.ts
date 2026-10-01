import { describe, expect, test } from "bun:test";

import type { GloomPlugin } from "../../types/plugin";
import { createPluginSetupCommand, isPluginConfigured } from "./setup-command";

const plugin: GloomPlugin = {
  id: "weather",
  name: "Weather",
  version: "1.0.0",
  configSchema: [
    { key: "apiKey", label: "API key", type: "password" },
    { key: "units", label: "Units", type: "select", required: false, options: [{ label: "C", value: "c" }], defaultValue: "c" },
    { key: "limit", label: "Limit", type: "number", required: false },
  ],
};

describe("isPluginConfigured", () => {
  test("requires every required field, and only those", () => {
    expect(isPluginConfigured(plugin, {})).toBe(false);
    expect(isPluginConfigured(plugin, { apiKey: "   " })).toBe(false);
    expect(isPluginConfigured(plugin, { apiKey: "k" })).toBe(true);
  });

  test("defers to the plugin's own rule when it has one", () => {
    const custom: GloomPlugin = { ...plugin, isConfigured: (values) => values.token === "yes" };
    expect(isPluginConfigured(custom, { apiKey: "k" })).toBe(false);
    expect(isPluginConfigured(custom, { token: "yes" })).toBe(true);
  });

  test("a plugin with no schema is always configured", () => {
    expect(isPluginConfigured({ id: "plain", name: "Plain", version: "1" }, {})).toBe(true);
  });
});

describe("createPluginSetupCommand", () => {
  test("reads current values as defaults each time the form opens", () => {
    let stored: Record<string, unknown> = {};
    const command = createPluginSetupCommand(plugin, {
      getValues: () => stored,
      setValues: async (values) => { stored = { ...stored, ...values }; },
      notify: () => {},
    })!;

    expect(command.wizard!.map((step) => step.defaultValue)).toEqual([undefined, "c", undefined]);
    stored = { apiKey: "abc" };
    expect(command.wizard![0]!.defaultValue).toBe("abc");
  });

  test("writes typed values and drops blanks so a cleared field does not save an empty string", async () => {
    let stored: Record<string, unknown> = {};
    const notes: string[] = [];
    const command = createPluginSetupCommand(plugin, {
      getValues: () => stored,
      setValues: async (values) => { stored = values; },
      notify: (body) => { notes.push(body); },
    })!;

    await command.execute({ apiKey: "abc", units: "", limit: "12" });
    expect(stored).toEqual({ apiKey: "abc", limit: 12 });
    expect(notes).toEqual(["Weather is set up."]);
  });
});
