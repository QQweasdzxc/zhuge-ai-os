/**
 * Adding tickers the app does not have yet (`gloomberb/tickers`).
 *
 * A pane that resolves symbols a user (or a model) named has to turn a search
 * result into a saved ticker exactly as the command bar does: the same symbol
 * and exchange normalization, the same broker contract identity, the same
 * "already saved" rule. Doing it by hand produces near-duplicates the rest of
 * the app then disagrees about.
 *
 * It is a shared host module: the repository and the event bus are the running
 * app's, and a bundled copy would write into a store nothing else reads.
 *
 * Compatibility commitment: see the note in `./utils.ts`.
 */

import type { AppTickerRepositoryPort } from "../core/app-service-ports";
import { getSharedRegistry } from "../plugins/registry/shared";
import type { TickerRecord } from "../types/ticker";

export { findExactTickerSearchMatch, upsertTickerFromSearchResult } from "../tickers/search";

/**
 * The repository the running app saves tickers in, or null before services are
 * constructed (a CLI command that never initialized them, a unit test). Treat
 * null as "cannot save right now" rather than creating a second store.
 */
export function getTickerRepository(): AppTickerRepositoryPort | null {
  return getSharedRegistry()?.tickerRepository ?? null;
}

/**
 * Announces a ticker a plugin just created, so panes, watchlists, and other
 * plugins see it the same way they see one added from the command bar.
 */
export function emitTickerAdded(ticker: TickerRecord): void {
  getSharedRegistry()?.events.emit("ticker:added", {
    symbol: ticker.metadata.ticker,
    ticker,
  });
}
