import { expect, test } from "bun:test";
import type { BrokerContractRef } from "../types/instrument";
import { brokerContractIdentityKey, instrumentIdentityKey, scopedBrokerContractIdentityKey } from "./instrument-identity";

const contract: BrokerContractRef = { brokerId: "fixture", brokerInstanceId: "one", symbol: "ACME", localSymbol: "ACME LEGACY", secType: "OPT", exchange: "SMART", primaryExchange: "NASDAQ", currency: "USD", lastTradeDateOrContractMonth: "20261016", right: "C", strike: 100, multiplier: "100", tradingClass: "ACME" };

test("fallback identities distinguish every supplied financial definition even with a local symbol", () => {
  const base = brokerContractIdentityKey(contract);
  for (const change of [{ symbol: "OTHER" }, { localSymbol: "OTHER" }, { secType: "FOP" }, { exchange: "CBOE" }, { primaryExchange: "NYSE" }, { currency: "EUR" }, { lastTradeDateOrContractMonth: "20261120" }, { right: "P" }, { strike: 110 }, { multiplier: "10" }, { tradingClass: "ADJUSTED" }] as Partial<BrokerContractRef>[]) {
    expect(brokerContractIdentityKey({ ...contract, ...change })).not.toBe(base);
  }
  expect(brokerContractIdentityKey({ ...contract, strike: 0 })).not.toBe(brokerContractIdentityKey({ ...contract, strike: undefined }));
  expect(brokerContractIdentityKey({ ...contract, strike: NaN })).not.toBe(brokerContractIdentityKey({ ...contract, strike: undefined }));
  expect(base).toStartWith("definition-v1:");
  expect(brokerContractIdentityKey({ ...contract, symbol: " acme ", currency: "usd" })).toBe(base);
});

test("canonical IDs remain primary while source scope and public instruments remain distinct", () => {
  expect(brokerContractIdentityKey({ ...contract, conId: 0 })).toBe("0");
  expect(brokerContractIdentityKey({ ...contract, conId: 12, strike: 110 })).toBe(brokerContractIdentityKey({ ...contract, conId: 12 }));
  expect(scopedBrokerContractIdentityKey({ ...contract, brokerInstanceId: "two" })).not.toBe(scopedBrokerContractIdentityKey(contract));
  expect(brokerContractIdentityKey({ ...contract, brokerInstanceId: "two" })).toBe(brokerContractIdentityKey(contract));
  const target = { symbol: "ACME", exchange: "NASDAQ", brokerId: "fixture", brokerInstanceId: "one", instrument: contract };
  expect(instrumentIdentityKey({ ...target, symbol: "OTHER" })).not.toBe(instrumentIdentityKey(target));
  expect(instrumentIdentityKey({ symbol: " acme ", exchange: "nasdaq" })).toBe("ACME|NASDAQ|||");
});
