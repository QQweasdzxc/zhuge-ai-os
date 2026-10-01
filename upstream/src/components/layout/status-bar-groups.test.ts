import { describe, expect, test } from "bun:test";
import type { TeamSummary } from "../../api-client";
import {
  buildStatusBarTabGroups,
  focusCollapses,
  groupIdFromMarkerValue,
  groupMarkerValue,
} from "./status-bar-groups";

function team(id: string, name: string): TeamSummary {
  return {
    id,
    name,
    slug: name.toLowerCase(),
    accentColor: "blue",
    shortName: name.slice(0, 2).toUpperCase(),
    allowMemberInvites: false,
    channelId: `team:${id}`,
    createdAt: "2026-09-14T12:00:00.000Z",
    role: "member",
    memberCount: 2,
  };
}

const origin = (teamId: string) => ({
  kind: "team" as const,
  teamId,
  layoutId: "a".repeat(32),
  revision: 1,
  contentHash: "x",
  syncedAt: "2026-09-14T12:00:00.000Z",
});

const layouts = [
  { origin: undefined },
  { origin: origin("rates") },
  { origin: undefined },
  { origin: origin("macro") },
  { origin: origin("rates") },
];
const teams = [team("rates", "Rates"), team("macro", "Macro")];

describe("status bar tab groups", () => {
  test("puts personal tabs first, then teams by name, keeping indexes", () => {
    const groups = buildStatusBarTabGroups(layouts, 0, teams, "all", new Set());
    expect(groups.map((group) => [group.id, group.indexes, group.collapsed])).toEqual([
      ["personal", [0, 2], false],
      ["team:macro", [3], false],
      ["team:rates", [1, 4], false],
    ]);
  });

  test("FOCUS folds the other groups but never the one holding the active tab", () => {
    expect(focusCollapses("personal", "team:rates")).toBe(true);
    expect(focusCollapses("personal", "personal")).toBe(false);
    expect(focusCollapses({ teamId: "rates" }, "personal")).toBe(true);
    expect(focusCollapses({ teamId: "rates" }, "team:rates")).toBe(false);
    expect(focusCollapses("all", "team:rates")).toBe(false);

    const personalFocus = buildStatusBarTabGroups(layouts, 0, teams, "personal", new Set());
    expect(personalFocus.map((group) => group.collapsed)).toEqual([false, true, true]);

    const activeInRates = buildStatusBarTabGroups(layouts, 4, teams, "personal", new Set());
    expect(activeInRates.map((group) => group.collapsed)).toEqual([false, true, false]);

    const ratesFocus = buildStatusBarTabGroups(layouts, 1, teams, { teamId: "rates" }, new Set());
    expect(ratesFocus.map((group) => group.collapsed)).toEqual([true, true, false]);
  });

  test("a manual toggle flips what FOCUS decided", () => {
    const groups = buildStatusBarTabGroups(layouts, 0, teams, "personal", new Set(["team:macro"]));
    expect(groups.map((group) => group.collapsed)).toEqual([false, false, true]);
    const folded = buildStatusBarTabGroups(layouts, 1, teams, "all", new Set(["team:macro"]));
    expect(folded.map((group) => group.collapsed)).toEqual([false, true, false]);
  });

  test("groups without a known team still appear, after the known ones", () => {
    const groups = buildStatusBarTabGroups(layouts, 0, [team("rates", "Rates")], "all", new Set());
    expect(groups.map((group) => [group.id, group.team?.name ?? null])).toEqual([
      ["personal", null],
      ["team:rates", "Rates"],
      ["team:macro", null],
    ]);
  });

  test("marker values round-trip", () => {
    expect(groupIdFromMarkerValue(groupMarkerValue("team:rates"))).toBe("team:rates");
    expect(groupIdFromMarkerValue(groupMarkerValue("personal"))).toBe("personal");
    expect(groupIdFromMarkerValue("3")).toBeNull();
    expect(groupIdFromMarkerValue("group:nope")).toBeNull();
  });
});
