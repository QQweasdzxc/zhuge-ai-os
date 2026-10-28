import { describe, expect, it } from "vitest";
import { PARTITION_MATCH_NONE, resolveProjectPartitionFilter, scopeFacetsToPartition } from "./taskflow-project-partition";

const projects = [
  { id: "h1", lead_type: "member" },
  { id: "h2", lead_type: null },
  { id: "a1", lead_type: "agent" },
  { id: "a2", lead_type: "agent" },
];
const NONE = { projectFilters: [PARTITION_MATCH_NONE], includeNoProject: false };

describe("project partition", () => {
  it("human keeps member-led, unled and no-project cards; never agent-led", () => {
    expect(resolveProjectPartitionFilter("human", projects, [], false)).toEqual({ projectFilters: ["h1", "h2"], includeNoProject: true });
  });
  it("ai only has agent-led projects and never no-project cards", () => {
    expect(resolveProjectPartitionFilter("ai", projects, [], false)).toEqual({ projectFilters: ["a1", "a2"], includeNoProject: false });
    expect(resolveProjectPartitionFilter("ai", projects, [], true)).toEqual(NONE);
  });
  it("saved-view filters intersect and an empty intersection matches nothing", () => {
    expect(resolveProjectPartitionFilter("human", projects, ["h1", "a1"], false)).toEqual({ projectFilters: ["h1"], includeNoProject: false });
    expect(resolveProjectPartitionFilter("human", projects, ["a1"], false)).toEqual(NONE);
    expect(resolveProjectPartitionFilter("human", projects, ["a1"], true)).toEqual({ projectFilters: [], includeNoProject: true });
    expect(resolveProjectPartitionFilter("ai", projects, ["h1"], false)).toEqual(NONE);
  });
  it("no agent-led projects: ai matches nothing, human is no-project plus all", () => {
    expect(resolveProjectPartitionFilter("ai", [{ id: "h1", lead_type: "member" }], [], false)).toEqual(NONE);
    expect(resolveProjectPartitionFilter("human", [], [], false)).toEqual({ projectFilters: [], includeNoProject: true });
  });
  it("holds match-none while the project list is unresolved", () => {
    expect(resolveProjectPartitionFilter("human", undefined, [], false)).toEqual(NONE);
  });
});

describe("project facet scoping", () => {
  const response = {
    total: 9,
    facets: [
      { kind: "project", values: [{ key: "h1", count: 2 }, { key: "a1", count: 3 }, { key: "__none__", count: 4 }] },
      { kind: "status", values: [{ key: "todo", count: 9 }] },
    ],
  };
  it("human drops agent-led buckets and keeps no-project", () => {
    const out = scopeFacetsToPartition(response, "human", projects);
    expect(out.facets[0]!.values.map((v) => v.key)).toEqual(["h1", "__none__"]);
    expect(out.facets[1]).toEqual(response.facets[1]);
  });
  it("ai keeps only agent-led buckets and drops no-project", () => {
    expect(scopeFacetsToPartition(response, "ai", projects).facets[0]!.values.map((v) => v.key)).toEqual(["a1"]);
  });
  it("leaves non-partition surfaces untouched and empties buckets while projects are unknown", () => {
    expect(scopeFacetsToPartition(response, undefined, projects)).toBe(response);
    expect(scopeFacetsToPartition(response, "human", undefined).facets[0]!.values.map((v) => v.key)).toEqual(["__none__"]);
  });
});
