import assert from "node:assert/strict";
import test from "node:test";
import { createAlpacaUsMarketProvider } from "../../../supabase/functions/_shared/alpaca-us-market.mjs";

const NOW = Date.parse("2026-10-07T20:00:00.000Z");
const credentials = { apiKey: "server-key", apiSecret: "server-secret", now: () => NOW };

test("Alpaca US quote uses authenticated read-only IEX snapshot and truthful source identity", async () => {
  const calls = [];
  const provider = createAlpacaUsMarketProvider({
    ...credentials,
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, async json() { return { latestTrade: { p: 220.5, t: "2026-10-07T19:59:00Z" } }; } };
    },
  });
  const quote = await provider.getQuote("aapl");
  assert.equal(quote.provider, "alpaca-iex");
  assert.equal(quote.symbol, "AAPL");
  assert.equal(quote.price, 220.5);
  assert.equal(quote.market, "US");
  assert.equal(quote.priceKind, "latest IEX trade");
  assert.match(quote.coverage, /not consolidated/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /AAPL\/snapshot\?feed=iex/);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers["APCA-API-KEY-ID"], "server-key");
  assert.equal(calls[0].init.headers["APCA-API-SECRET-KEY"], "server-secret");
  assert.equal(provider.readOnly, true);
  assert.deepEqual(Object.keys(provider).sort(), ["getHistory", "getQuote", "provider", "readOnly"].sort());
});

test("Alpaca daily history is date-sorted and carries an explicit IEX-only feed", async () => {
  let calledUrl = "";
  const provider = createAlpacaUsMarketProvider({
    ...credentials,
    fetcher: async url => {
      calledUrl = url;
      return { ok: true, async json() { return { bars: [
        { t: "2026-10-06T04:00:00Z", o: 2, h: 3, l: 1, c: 2.5, v: 500 },
        { t: "2026-10-05T04:00:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 400 },
      ] }; } };
    },
  });
  const history = await provider.getHistory("NVDA");
  const url = new URL(calledUrl);
  assert.equal(url.pathname, "/v2/stocks/bars");
  assert.equal(url.searchParams.get("symbols"), "NVDA");
  assert.equal(url.searchParams.get("feed"), "iex");
  assert.equal(url.searchParams.get("timeframe"), "1Day");
  assert.equal(url.searchParams.get("adjustment"), "raw");
  assert.deepEqual(history.bars.map(bar => bar.close), [1.5, 2.5]);
  assert.equal(history.provider, "alpaca-iex-daily");
  assert.match(history.coverage, /not consolidated/);
});

test("Alpaca secrets are required only server-side and errors never include credential values", async () => {
  const missing = createAlpacaUsMarketProvider({ apiKey: "server-key" });
  await assert.rejects(() => missing.getQuote("AAPL"), error => error.code === "EXTERNAL_SECRET_REQUIRED" && !error.message.includes("server-key"));

  const rejected = createAlpacaUsMarketProvider({
    ...credentials,
    fetcher: async () => ({ ok: false, status: 401 }),
  });
  await assert.rejects(() => rejected.getHistory("AAPL"), error => error.code === "ALPACA_AUTH_REJECTED" && !error.message.includes("server-secret"));
});

test("Alpaca adapter rejects malformed symbols and never exposes unsafe caller URLs", async () => {
  let calls = 0;
  const provider = createAlpacaUsMarketProvider({ ...credentials, fetcher: async () => { calls += 1; throw new Error("should not call"); } });
  await assert.rejects(() => provider.getQuote("AAPL&feed=sip"), error => error.code === "US_SYMBOL_INVALID");
  assert.equal(calls, 0);
});
