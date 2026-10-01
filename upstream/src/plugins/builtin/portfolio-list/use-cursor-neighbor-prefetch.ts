import { useCallback, useEffect, useRef } from "react";
import { instrumentFromTicker, type InstrumentRef } from "../../../market-data/request-types";
import { hasAmbiguousTickerContracts } from "../../../core/state/app/instrument";
import type { TickerRecord } from "../../../types/ticker";

/** Shorter than the selection commit delay, so the target is warm by then. */
const NEAR_REST_MS = 80;
/** A cursor that has settled is worth a wider ring. */
const FAR_REST_MS = 600;
const NEAR_OFFSETS = [0, 1, -1] as const;
const FAR_OFFSETS = [2, -2] as const;

export interface CursorNeighborPrefetchOptions {
  tickers: readonly TickerRecord[];
  /** The list's own cursor, which may run ahead of the committed selection. */
  cursorSymbol: string | null;
  /** Scopes the instrument the way the follower pane resolves it. */
  portfolioId: string | undefined;
  enabled: boolean;
  prefetch: (instrument: InstrumentRef) => void;
}

/**
 * Warms the market-data caches for the row under the cursor and its
 * neighbours once the cursor rests, so the follower pane lands on cached
 * data. A held key moves faster than the rest timers and never fires, which
 * keeps this from turning into a fetch per row.
 */
export function useCursorNeighborPrefetch({
  tickers,
  cursorSymbol,
  portfolioId,
  enabled,
  prefetch,
}: CursorNeighborPrefetchOptions): (symbol: string | null) => void {
  const inputs = useRef({ tickers, portfolioId, enabled, prefetch });
  inputs.current = { tickers, portfolioId, enabled, prefetch };
  const lastSymbol = useRef<string | null>(null);
  const nearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const farTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (nearTimer.current) clearTimeout(nearTimer.current);
    if (farTimer.current) clearTimeout(farTimer.current);
    nearTimer.current = null;
    farTimer.current = null;
  }, []);

  const prefetchRing = useCallback((symbol: string, offsets: readonly number[]) => {
    const { tickers: rows, portfolioId: scope, enabled: active, prefetch: warm } = inputs.current;
    if (!active) return;
    const center = rows.findIndex((ticker) => ticker.metadata.ticker === symbol);
    if (center < 0) return;
    for (const offset of offsets) {
      const ticker = rows[center + offset];
      if (!ticker) continue;
      if (!scope && hasAmbiguousTickerContracts(ticker)) continue;
      const instrument = instrumentFromTicker(ticker, ticker.metadata.ticker, { portfolioId: scope });
      if (instrument) warm(instrument);
    }
  }, []);

  const noteCursor = useCallback((symbol: string | null) => {
    if (symbol === lastSymbol.current) return;
    lastSymbol.current = symbol;
    clearTimers();
    if (!symbol) return;
    nearTimer.current = setTimeout(() => {
      nearTimer.current = null;
      prefetchRing(symbol, NEAR_OFFSETS);
    }, NEAR_REST_MS);
    farTimer.current = setTimeout(() => {
      farTimer.current = null;
      prefetchRing(symbol, FAR_OFFSETS);
    }, FAR_REST_MS);
  }, [clearTimers, prefetchRing]);

  // The grid and external selection changes only surface through the
  // throttled cursor; the table reports its live cursor through noteCursor.
  useEffect(() => {
    noteCursor(cursorSymbol);
  }, [cursorSymbol, noteCursor]);

  useEffect(() => clearTimers, [clearTimers]);

  return noteCursor;
}
