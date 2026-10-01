import { describe, expect, test } from "bun:test";
import { applyJsonPatch } from "./json-patch";

describe("applyJsonPatch", () => {
  test("adds, replaces, and removes nested values without mutating the source", () => {
    const source: { panes: Array<{ id: string; state: Record<string, unknown> }> } = {
      panes: [
        { id: "one", state: { symbol: "NVDA", stale: true } },
      ],
    };

    const patched = applyJsonPatch(source, [
      { op: "replace", path: "/panes/0/state/symbol", value: "AAPL" },
      { op: "remove", path: "/panes/0/state/stale" },
      { op: "add", path: "/panes/0/state/tab", value: "chart" },
    ]);

    expect(patched).toEqual({
      panes: [
        { id: "one", state: { symbol: "AAPL", tab: "chart" } },
      ],
    });
    expect(source.panes[0]!.state).toEqual({ symbol: "NVDA", stale: true });
  });

  test("appends to arrays with dash pointer", () => {
    expect(applyJsonPatch({ values: ["a"] }, [
      { op: "add", path: "/values/-", value: "b" },
    ])).toEqual({ values: ["a", "b"] });
  });
});
