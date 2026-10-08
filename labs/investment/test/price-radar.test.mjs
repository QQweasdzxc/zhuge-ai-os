import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { loadPriceRadar, parseWorldBankMonthlyWorkbook } from "../src/providers/price-radar.mjs";

function tinyWorkbook() {
  const files = {
    "xl/sharedStrings.xml": `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Crude oil, Brent</t></si><si><t>Crude oil, WTI</t></si><si><t>Copper</t></si><si><t>2026M01</t></si><si><t>2026M02</t></si><si><t>2026M11</t></si><si><t>2026M13</t></si></sst>`,
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Monthly Prices" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="5"><c r="B5" t="s"><v>0</v></c><c r="C5" t="s"><v>1</v></c><c r="D5" t="s"><v>2</v></c></row><row r="6"><c r="A6" t="s"><v>3</v></c><c r="B6"><v>80</v></c><c r="C6"><v>70</v></c><c r="D6"><v>9000</v></c></row><row r="7"><c r="A7" t="s"><v>4</v></c><c r="B7"><v>88</v></c><c r="C7"><v>77</v></c><c r="D7"><v>9900</v></c></row><row r="8"><c r="A8" t="s"><v>5</v></c><c r="B8"><v>100</v></c><c r="C8"><v>90</v></c><c r="D8"><v>11000</v></c></row><row r="9"><c r="A9" t="s"><v>6</v></c><c r="B9"><v>120</v></c><c r="C9"><v>110</v></c><c r="D9"><v>12000</v></c></row></sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])));
}

test("XLSX parser reads only monthly Brent, WTI and Copper columns from explicit test fixture", () => {
  const result = parseWorldBankMonthlyWorkbook(tinyWorkbook(), { now: Date.parse("2026-10-08T00:00:00.000Z") });
  assert.deepEqual(result.map((item) => item.indicator), ["Brent", "WTI", "Copper"]);
  assert.deepEqual(result.map((item) => item.month), ["2026-02", "2026-02", "2026-02"]);
  assert.deepEqual(result.map((item) => item.value), [88, 77, 9900]);
  assert.ok(Math.abs(result[0].changePercent - 10) < 1e-9);
  assert.equal(result[2].unit, "USD / metric ton");
});

test("bad workbook and expansion boundary fail closed", () => {
  assert.throws(() => parseWorldBankMonthlyWorkbook(new Uint8Array()), /WORKBOOK_INVALID/);
  assert.throws(() => parseWorldBankMonthlyWorkbook(new Uint8Array(16 * 1024 * 1024 + 1)), /WORKBOOK_TOO_LARGE/);
});

test("static-browser price radar never downloads the World Bank workbook directly", async () => {
  const result = await loadPriceRadar();
  assert.equal(result[0].errorCode, "SERVER_PROXY_REQUIRED");
  assert.equal(result[1].errorCode, "SERVER_PROXY_REQUIRED");
  assert.ok(result.slice(0, 2).every(item => item.data.observations.length === 0));
  assert.ok(result.slice(2).every(item => item.status === "PROVIDER_REVIEW_REQUIRED"));
});
