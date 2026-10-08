import assert from "node:assert/strict";
import test from "node:test";
import { XMLParser } from "fast-xml-parser";
import { strToU8, unzipSync, zipSync } from "fflate";
import { loadWorldBankCommodityRadar } from "../../../supabase/functions/_shared/world-bank-commodity-radar.mjs";
import { parseWorldBankMonthlyWorkbook, WORLD_BANK_LICENSE, WORLD_BANK_MONTHLY_SOURCE } from "../src/providers/world-bank-monthly-workbook.mjs";

function fixtureWorkbook() {
  const files = {
    "xl/sharedStrings.xml": `<sst><si><t>Crude oil, Brent</t></si><si><t>Crude oil, WTI</t></si><si><t>Copper</t></si><si><t>2026M01</t></si><si><t>2026M02</t></si></sst>`,
    "xl/workbook.xml": `<workbook xmlns:r="urn:test"><sheets><sheet name="Monthly Prices" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="5"><c r="B5" t="s"><v>0</v></c><c r="C5" t="s"><v>1</v></c><c r="D5" t="s"><v>2</v></c></row><row r="6"><c r="A6" t="s"><v>3</v></c><c r="B6"><v>80</v></c><c r="C6"><v>70</v></c><c r="D6"><v>9000</v></c></row><row r="7"><c r="A7" t="s"><v>4</v></c><c r="B7"><v>88</v></c><c r="C7"><v>77</v></c><c r="D7"><v>9900</v></c></row></sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])));
}

test("authenticated Edge projection reuses the shared World Bank parser and monthly evidence", async () => {
  const bytes = fixtureWorkbook();
  let requested = "";
  const result = await loadWorldBankCommodityRadar({
    fetchWorkbook: async url => { requested = url; return { value: bytes, fetchedAt: "2026-10-07T00:00:00.000Z", fallback: false }; },
    parseWorkbook: payload => parseWorldBankMonthlyWorkbook(payload, { unzipSync, XMLParser }),
    now: () => Date.parse("2026-10-08T00:00:00.000Z"),
  });
  assert.equal(requested, WORLD_BANK_MONTHLY_SOURCE);
  assert.deepEqual(result.map(item => item.data.id), ["oil", "copper"]);
  assert.equal(result[0].provider, "World Bank Pink Sheet");
  assert.equal(result[0].dataTimestamp, "2026-02");
  assert.equal(result[0].data.observations[0].value, 88);
  assert.ok(Math.abs(result[0].data.observations[0].changePercent - 10) < 1e-9);
  assert.equal(result[1].data.observations[0].value, 9900);
  assert.equal(result[0].license, `CC BY 4.0；${WORLD_BANK_LICENSE}`);
  assert.equal(result[0].delayed, true);
  assert.equal(result[0].stale, true);
  assert.equal(result[0].status, "PARTIAL");
});

test("World Bank fetch or workbook failure yields explicit unavailable evidence without values", async () => {
  const result = await loadWorldBankCommodityRadar({
    fetchWorkbook: async () => { throw Object.assign(new Error("network failed"), { code: "NETWORK_ERROR" }); },
    parseWorkbook: () => [],
  });
  assert.equal(result.length, 2);
  assert.ok(result.every(item => item.status === "UNAVAILABLE" && item.data.observations.length === 0));
  assert.ok(result.every(item => item.errorCode === "NETWORK_ERROR"));
});
