import { describe, expect, test } from "bun:test";
import { resolveOccludedPaneIds, type OcclusionPane } from "./pane-occlusion";

const bounds = { width: 40, height: 20 };

function pane(paneId: string, rect: [number, number, number, number], zIndex: number | null, order: number): OcclusionPane {
  return { paneId, rect: { x: rect[0], y: rect[1], width: rect[2], height: rect[3] }, zIndex, order };
}

describe("resolveOccludedPaneIds", () => {
  test("a window wholly inside a higher one is hidden, the higher one is not", () => {
    const occluded = resolveOccludedPaneIds([
      pane("under", [5, 5, 10, 6], 50, 0),
      pane("over", [4, 4, 14, 9], 51, 1),
    ], bounds);
    expect([...occluded]).toEqual(["under"]);
  });

  test("the union of two windows hides a pane neither covers alone", () => {
    const occluded = resolveOccludedPaneIds([
      pane("under", [0, 0, 20, 10], 50, 0),
      pane("left", [0, 0, 10, 10], 51, 1),
      pane("right", [10, 0, 10, 10], 51, 2),
    ], bounds);
    expect([...occluded]).toEqual(["under"]);
  });

  test("a single uncovered cell keeps the pane visible", () => {
    const occluded = resolveOccludedPaneIds([
      pane("under", [0, 0, 20, 10], 50, 0),
      pane("over", [0, 0, 20, 9], 51, 1),
    ], bounds);
    expect(occluded.size).toBe(0);
  });

  test("equal z-index stacks by render order and docked panes sit below floating ones", () => {
    const occluded = resolveOccludedPaneIds([
      pane("dock", [0, 0, 40, 20], null, 0),
      pane("first", [0, 0, 40, 20], 50, 1),
      pane("second", [0, 0, 40, 20], 50, 2),
    ], bounds);
    expect([...occluded].sort()).toEqual(["dock", "first"]);
  });

  test("a window off the content area does not count as covering", () => {
    const occluded = resolveOccludedPaneIds([
      pane("under", [0, 0, 10, 10], 50, 0),
      pane("outside", [40, 20, 10, 10], 51, 1),
    ], bounds);
    expect(occluded.size).toBe(0);
  });
});
