import { expect, test } from "bun:test";
import { AppPersistence } from "../data/app-persistence";
import { instrumentFromTicker } from "../market-data/request-types";
import { hydrateTickerMetadata } from "../tickers/metadata";
import type { BrokerPosition } from "../types/broker";
import type { BrokerInstanceConfig } from "../types/config";
import type { TickerRecord } from "../types/ticker";
import { brokerContractIdentityKey } from "../utils/instrument-identity";
import { upsertBrokerPositionTicker } from "./broker-ticker-sync";

const instance = { id: "feed", brokerType: "fixture", name: "Fixture", enabled: true, settings: {} } as BrokerInstanceConfig;
const position = (strike: number, accountId: string): BrokerPosition => ({ ticker: "ACME", exchange: "NASDAQ", shares: 1, avgCost: 5, currency: "USD", accountId, multiplier: 100, brokerContract: { brokerId: "fixture", symbol: "ACME", localSymbol: "LEGACY", secType: "OPT", currency: "USD", exchange: "SMART", lastTradeDateOrContractMonth: "20261016", right: "C", strike, multiplier: "100" } });

test("sync and persisted hydration preserve separate account definitions through a replacement", () => {
  const persistence = new AppPersistence(":memory:");
  const tickers = new Map<string, TickerRecord>();
  const apply = (strike: number, portfolioId: string) => {
    const { ticker } = upsertBrokerPositionTicker({ tickers, instance, portfolioId, position: position(strike, portfolioId) });
    persistence.tickers.save("ACME", ticker.metadata);
    const hydrated = { metadata: hydrateTickerMetadata(JSON.parse(persistence.tickers.get("ACME")!)) };
    tickers.set("ACME", hydrated); return hydrated;
  };
  try {
    apply(100, "a"); const both = apply(110, "b");
    expect(both.metadata.broker_contracts).toHaveLength(2);
    expect(instrumentFromTicker(both, "ACME", { portfolioId: "a" })?.instrument?.strike).toBe(100);
    expect(instrumentFromTicker(both, "ACME", { portfolioId: "b" })?.instrument?.strike).toBe(110);
    const replacement = apply(120, "a");
    expect(instrumentFromTicker(replacement, "ACME", { portfolioId: "a" })?.instrument?.strike).toBe(120);
    expect(instrumentFromTicker(replacement, "ACME", { portfolioId: "b" })?.instrument?.strike).toBe(110);
    expect(replacement.metadata.positions).toHaveLength(2);
    const saved = replacement.metadata.positions.find(p => p.portfolio === "a")!;
    expect(saved.brokerContractIdentity).toBe(brokerContractIdentityKey(position(120, "a").brokerContract!));
    expect(saved.brokerContractId).toBeUndefined();
    expect(saved.avgCost).toBe(5); expect(saved.multiplier).toBe(100);
  } finally { persistence.close(); }
});

test("explicit fallback identity cannot widen and old records retain unique legacy matching", () => {
  const tickers = new Map<string, TickerRecord>();
  const ticker = upsertBrokerPositionTicker({ tickers, instance, portfolioId: "a", position: position(100, "a") }).ticker;
  const lot = ticker.metadata.positions[0]!;
  delete lot.brokerContractIdentity;
  expect(instrumentFromTicker(ticker, "ACME", { portfolioId: "a" })?.instrument?.strike).toBe(100);
  lot.brokerContractIdentity = "unknown-version:unmatched";
  expect(instrumentFromTicker(ticker, "ACME", { portfolioId: "a" })).toBeNull();
  lot.brokerContractId = 123; ticker.metadata.broker_contracts![0]!.conId = 123;
  expect(instrumentFromTicker(ticker, "ACME", { portfolioId: "a" })?.instrument?.conId).toBe(123);
  lot.brokerContractId = 999;
  expect(instrumentFromTicker(ticker, "ACME", { portfolioId: "a" })).toBeNull();
});
