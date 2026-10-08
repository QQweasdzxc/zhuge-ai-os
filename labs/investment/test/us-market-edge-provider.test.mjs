import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fs.readFileSync(path.join(ROOT, "supabase/functions/investment-intelligence-read/index.ts"), "utf8");
const labApp = fs.readFileSync(path.join(ROOT, "labs/investment/app.js"), "utf8");

test("US quotes and OHLCV prefer the no-secret Zhuge-owned public chart adapter and keep Alpaca optional", () => {
  assert.match(source, /createAlpacaUsMarketProvider/);
  assert.match(source, /Deno\.env\.get\("ALPACA_API_KEY_ID"\)/);
  assert.match(source, /Deno\.env\.get\("ALPACA_API_SECRET_KEY"\)/);
  assert.match(source, /createYahooUsMarketProvider, loadYahooGlobalMarketContext/);
  assert.match(source, /provider: "zhuge-yahoo-chart", run: async \(\) => createYahooMarketProvider\(\)\.getQuote/);
  assert.match(source, /provider: "alpaca-iex", run: async \(\) => createAlpacaMarketProvider\(\)\.getQuote/);
  assert.match(source, /provider: "zhuge-yahoo-chart-daily", run: async \(\) => createYahooMarketProvider\(\)\.getHistory/);
  assert.match(source, /provider: "alpaca-iex-daily", run: async \(\) => createAlpacaMarketProvider\(\)\.getHistory/);
  assert.match(source, /createYahooUsMarketProvider\(\{ now: \(\) => Date\.now\(\) \}\)/);
  assert.match(source, /loadYahooGlobalMarketContext\(\{ provider: createYahooMarketProvider\(\) \}\)/);
  assert.match(source, /history: historiesResult\.trace/);
  assert.doesNotMatch(source, /dvorak0727\.workers\.dev/i);
  assert.doesNotMatch(source, /createClient|SUPABASE_SERVICE_ROLE_KEY|service_role/);
});

test("global context requests valid US equities instead of Yahoo index symbols and labels them as stocks", () => {
  assert.match(labApp, /GLOBAL_US_EQUITY_CONTEXT[\s\S]{0,220}symbol: "AAPL"[\s\S]{0,120}symbol: "NVDA"[\s\S]{0,120}symbol: "TSM"/);
  assert.doesNotMatch(labApp, /\["\^GSPC", "\^IXIC", "\^SOX", "\^VIX"/);
  assert.match(labApp, /不代表 S&amp;P \/ Nasdaq \/ SOX 指數/);
  assert.match(labApp, /股票報價，不代表指數行情/);
});

test("US and Taiwan research remain market-scoped and TPEx history uses its fixed official monthly source", () => {
  assert.match(source, /request\.market === "US"[\s\S]{0,180}request\.venue === "TWSE"/);
  assert.match(source, /parseTpexHistoryPayload, tpexHistoryRequestUrl/);
  assert.match(source, /if \(request\.market === "TW" && request\.venue === "TPEX"\)[\s\S]{0,1200}tpexHistoryRequestUrl\(request\.symbol, month\)/);
  assert.match(source, /歷史資料不含定價交易/);
  assert.match(source, /loadOfficialInstitutional/);
  assert.match(source, /loadOfficialHolders/);
  assert.match(source, /loadOfficialMargin/);
});

test("US company news prefers official SEC EDGAR company filings before RSS fallback", () => {
  assert.match(source, /mapSecCompanyFilings/);
  assert.match(source, /provider: "sec-edgar-company-filings"/);
  assert.match(source, /request\.market === "US"[\s\S]{0,1000}provider: "google-news-rss"/);
  assert.doesNotMatch(source, /dvorak0727\.workers\.dev/i);
});

test("SEC company facts and selected SEC catalog name remain visible as US research identity", () => {
  assert.match(source, /const entityName = text\(payload\.entityName, 180\)/);
  assert.match(source, /company_name=\$\{entityName\}/);
  assert.match(source, /name: request\.name \|\| request\.symbol/);
  assert.match(labApp, /const name = position\?\.name \|\| symbolLabelFor\(state\.symbol, market, context\.name \|\| canonical\)/);
});
