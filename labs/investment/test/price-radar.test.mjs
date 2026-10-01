import test from "node:test";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import { parseWorldBankMonthlyWorkbook } from "../src/providers/price-radar.mjs";

function tinyWorkbook() {
  const files = {
    "xl/sharedStrings.xml": `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Crude oil, Brent</t></si><si><t>Crude oil, WTI</t></si><si><t>Copper</t></si><si><t>2026M01</t></si><si><t>2026M02</t></si></sst>`,
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Monthly Prices" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="5"><c r="B5" t="s"><v>0</v></c><c r="C5" t="s"><v>1</v></c><c r="D5" t="s"><v>2</v></c></row><row r="6"><c r="A6" t="s"><v>3</v></c><c r="B6"><v>80</v></c><c r="C6"><v>70</v></c><c r="D6"><v>9000</v></c></row><row r="7"><c r="A7" t="s"><v>4</v></c><c r="B7"><v>88</v></c><c r="C7"><v>77</v></c><c r="D7"><v>9900</v></c></row></sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)])));
}

test("XLSX parser reads only monthly Brent, WTI and Copper columns from explicit test fixture", () => {
  const result = parseWorldBankMonthlyWorkbook(tinyWorkbook());
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
