import { useState } from "react";
import type { OptionsChain } from "../../../types/financials";
import type { QueryEntry } from "../../../market-data/result-types";
import { resolveEntryValue } from "../../../market-data/coordinator";

type ChainEntry = QueryEntry<OptionsChain> | null;
interface CatalogueState {
  targetKey: string;
  catalogue: ChainEntry;
}

function newerObservation(entry: QueryEntry<OptionsChain>, previous: QueryEntry<OptionsChain>): boolean {
  if (entry.responseSequence != null && previous.responseSequence != null) {
    return entry.responseSequence > previous.responseSequence;
  }
  // Hydrated caches may lack runtime order. Attaching one is not a retrieval:
  // use its recorded time and keep the known observation when times tie.
  if (entry.fetchedAt !== previous.fetchedAt) return entry.fetchedAt! > previous.fetchedAt!;
  return entry.responseSequence != null && previous.responseSequence == null;
}

/** Keep successful catalogue observations across expiry switches and failures. */
export function useOptionsCatalogue(
  targetKey: string,
  initial: ChainEntry,
  selected: ChainEntry,
): { chain: OptionsChain | null; expirationDates: number[] } {
  const [previous, setPrevious] = useState<CatalogueState | null>(null);
  let catalogue = previous?.targetKey === targetKey ? previous.catalogue : null;
  for (const entry of [initial, selected]) {
    // Error/loading projections retain the last successful response and its
    // order. Idle or never-successful queries have no observation to compare.
    if (entry?.fetchedAt == null || resolveEntryValue(entry) == null) continue;
    if (!catalogue || newerObservation(entry, catalogue)) catalogue = entry;
  }
  if (!previous || previous.targetKey !== targetKey || previous.catalogue !== catalogue) {
    // Adjust before children render, preventing transient calculator/CSV seeds
    // from a catalogue which has already removed the selected expiration.
    setPrevious({ targetKey, catalogue });
  }
  const chain = catalogue ? resolveEntryValue(catalogue) : null;
  return { chain, expirationDates: chain?.expirationDates ?? [] };
}
