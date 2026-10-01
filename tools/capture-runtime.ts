import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { LAB_SYMBOLS, loadTaiwanResearch } from "../upstream/src/plugins/builtin/taiwan/research";
import { taiwanOfficialApi, taiwanNormalization as n } from "../upstream/src/sources/taiwan-provider";
import { WORLD_BANK_MONTHLY_SOURCE } from "../upstream/src/plugins/builtin/taiwan/radar";

const root = resolve(import.meta.dir, "..");
const dir = resolve(root, "evidence");
await mkdir(resolve(dir, "fixtures"), { recursive: true });
const summaries = [];
for (const symbol of LAB_SYMBOLS) {
  const report = await loadTaiwanResearch(symbol);
  await Bun.write(resolve(dir, `${symbol}-runtime.json`), JSON.stringify(report, null, 2));
  const summary = { symbol, quote: report.quote.status, price: report.quote.data?.price ?? null, dataTimestamp: report.quote.dataTimestamp,
    history: report.history.status, bars: report.history.data?.length ?? 0, profile: report.profile.status, revenue: report.revenue.status,
    income: report.income.status, balance: report.balance.status, holders: report.holders.status, bands: report.holders.data?.length ?? 0,
    futures: report.futures.status, options: report.options.status, radar: report.radar.map((r) => ({ id: r.id, status: r.status, date: r.dataTimestamp })) };
  summaries.push(summary);
  console.log(JSON.stringify(summary));
}
const urls = ["https://openapi.twse.com.tw/v1/opendata/t187ap05_L", "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O",
  "https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci", "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap06_O_ci",
  "https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci", "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap07_O_ci"];
const officialRows = [];
for (const url of urls) {
  try { officialRows.push({ source: url, receipt: taiwanOfficialApi.receipt(url), rows: n.asRows(await taiwanOfficialApi.json(url, 600_000)).filter((row) => ["2330", "6488"].includes(n.codeOf(row))) }); }
  catch { officialRows.push({ source: url, receipt: taiwanOfficialApi.receipt(url), rows: [] }); }
}
await Bun.write(resolve(dir, "fixtures", "official-rows.json"), JSON.stringify(officialRows, null, 2));
const workbook = await fetch(WORLD_BANK_MONTHLY_SOURCE, { signal: AbortSignal.timeout(25_000) });
if (workbook.ok) await Bun.write(resolve(dir, "fixtures", "world-bank-monthly.xlsx"), await workbook.arrayBuffer());
await Bun.write(resolve(dir, "fixtures", "world-bank-attribution.json"), JSON.stringify({ source: WORLD_BANK_MONTHLY_SOURCE,
  license: "CC BY 4.0", provider: "World Bank Commodity Price Data (Pink Sheet)", fetchedAt: new Date().toISOString(),
  purpose: "Recorded actual public workbook for deterministic parser QA; not generated or simulated market data" }, null, 2));
await Bun.write(resolve(dir, "runtime-summary.json"), JSON.stringify({ capturedAt: new Date().toISOString(), summaries }, null, 2));
