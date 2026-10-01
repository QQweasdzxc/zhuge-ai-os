import type { AppState } from "../state/app/context";
import type { RemoteUiNodeSnapshot } from "./types";

export function commandBarResultsFromNodes(nodes: RemoteUiNodeSnapshot[]) {
  const directResults = nodes
    .filter((node) => node.role === "command-bar-result")
    .map((node) => {
      const metadata = node.metadata ?? {};
      const item = metadata.item && typeof metadata.item === "object"
        ? metadata.item as Record<string, unknown>
        : {};
      return {
        nodeId: node.id,
        index: metadata.index,
        label: node.label ?? item.label,
        detail: item.detail,
        category: item.category,
        kind: item.kind,
        right: item.right,
        selected: metadata.selected === true,
        disabled: node.disabled === true,
        actions: node.actions,
        itemId: item.id,
        actionInput: undefined,
        metadata,
      };
    });

  const listResults = nodes.flatMap((node) => {
    const metadata = node.metadata ?? {};
    if (node.role !== "list" && node.role !== "command-bar-list") return [];
    if (metadata.scope !== "command-bar") return [];
    const rawItems = Array.isArray(metadata.items) ? metadata.items : [];
    const selectedIndex = typeof metadata.selectedIndex === "number" ? metadata.selectedIndex : -1;
    return rawItems
      .map((entry, fallbackIndex) => (
        entry && typeof entry === "object"
          ? entry as Record<string, unknown>
          : { label: String(entry), index: fallbackIndex }
      ))
      .map((item, fallbackIndex) => {
        const index = typeof item.index === "number" ? item.index : fallbackIndex;
        return {
          nodeId: node.id,
          index,
          label: item.label,
          detail: item.detail,
          category: item.category ?? metadata.category,
          kind: item.kind ?? metadata.itemKind,
          right: item.right,
          selected: selectedIndex === index,
          disabled: item.disabled === true || node.disabled === true,
          actions: node.actions,
          itemId: item.id,
          actionInput: {
            index,
            id: item.id,
            label: item.label,
          },
          metadata: {
            ...metadata,
            item,
          },
        };
      });
  });

  return [...directResults, ...listResults].sort((left, right) => {
    const leftIndex = typeof left.index === "number" ? left.index : Number.MAX_SAFE_INTEGER;
    const rightIndex = typeof right.index === "number" ? right.index : Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

export function isCommandBarInputNode(node: RemoteUiNodeSnapshot): boolean {
  return (
    (node.role === "input" || node.role === "command-bar-input")
    && node.metadata?.scope === "command-bar"
  );
}

function commandBarInputValue(nodes: RemoteUiNodeSnapshot[], fallback: string): string {
  const focusedInput = nodes.find((node) => isCommandBarInputNode(node) && node.metadata?.focused === true);
  const value = focusedInput?.metadata?.value;
  return typeof value === "string" ? value : fallback;
}

export function commandBarSnapshot(state: AppState, nodes: RemoteUiNodeSnapshot[]) {
  const results = commandBarResultsFromNodes(nodes);
  return {
    open: state.commandBarOpen,
    query: commandBarInputValue(nodes, state.commandBarQuery),
    stateQuery: state.commandBarQuery,
    launchRequest: state.commandBarLaunchRequest,
    selectedIndex: results.find((result) => result.selected)?.index ?? null,
    results,
  };
}
