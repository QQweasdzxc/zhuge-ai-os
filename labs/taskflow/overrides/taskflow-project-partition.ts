/**
 * TASKFLOW_WORKSPACE_GROUPS: project-origin partition of the Tasks overview.
 * "human" = projects not led by an AI agent, plus cards with no project.
 * "ai" = projects led by an AI agent only.
 * The server treats empty project_ids with include_no_project=false as "no
 * restriction", so an empty result is expressed with a nil-UUID match-none id.
 */
export const PARTITION_MATCH_NONE = "00000000-0000-0000-0000-000000000000";

export type ProjectPartition = "human" | "ai";

export interface PartitionProject {
  id: string;
  lead_type?: string | null;
}

export interface PartitionFilter {
  projectFilters: string[];
  includeNoProject: boolean;
}

export function resolveProjectPartitionFilter(
  partition: ProjectPartition,
  projects: readonly PartitionProject[] | undefined,
  userProjectFilters: readonly string[],
  userIncludeNoProject: boolean,
): PartitionFilter {
  const none: PartitionFilter = { projectFilters: [PARTITION_MATCH_NONE], includeNoProject: false };
  if (!projects) return none;
  const allowed = new Set(
    projects
      .filter((p) => (partition === "ai" ? p.lead_type === "agent" : p.lead_type !== "agent"))
      .map((p) => p.id),
  );
  const noProjectAllowed = partition === "human";
  if (userProjectFilters.length === 0) {
    if (userIncludeNoProject) {
      return noProjectAllowed ? { projectFilters: [], includeNoProject: true } : none;
    }
    const ids = [...allowed];
    return noProjectAllowed
      ? { projectFilters: ids, includeNoProject: true }
      : ids.length > 0
        ? { projectFilters: ids, includeNoProject: false }
        : none;
  }
  const ids = userProjectFilters.filter((id) => allowed.has(id));
  const keepNoProject = noProjectAllowed && userIncludeNoProject;
  if (ids.length > 0) return { projectFilters: ids, includeNoProject: keepNoProject };
  return keepNoProject ? { projectFilters: [], includeNoProject: true } : none;
}

interface FacetValueLike {
  key: string;
  count: number;
}
interface FacetLike {
  kind: string;
  values: FacetValueLike[];
}

/**
 * The project facet is disjunctive: the server clears the project filter while
 * counting it, so the group boundary has to be applied to the response. Other
 * facets already carry the group filter and pass through unchanged.
 */
export function scopeFacetsToPartition<T extends { facets: FacetLike[] } | undefined>(
  response: T,
  partition: ProjectPartition | undefined,
  projects: readonly PartitionProject[] | undefined,
): T {
  if (!response || !partition) return response;
  const allowed = new Set(
    (projects ?? [])
      .filter((p) => (partition === "ai" ? p.lead_type === "agent" : p.lead_type !== "agent"))
      .map((p) => p.id),
  );
  return {
    ...response,
    facets: response.facets.map((facet) =>
      facet.kind === "project"
        ? {
            ...facet,
            values: facet.values.filter((v) =>
              v.key === "__none__" ? partition === "human" : allowed.has(v.key),
            ),
          }
        : facet,
    ),
  } as T;
}
