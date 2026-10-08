import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";
import { parseWorldBankMonthlyWorkbook as parseWorkbook, WORLD_BANK_LICENSE, WORLD_BANK_MONTHLY_SOURCE } from "./world-bank-monthly-workbook.mjs";
export { WORLD_BANK_LICENSE, WORLD_BANK_MONTHLY_SOURCE };
import { makeEvidence } from "../lib/contract.mjs";

export function parseWorldBankMonthlyWorkbook(bytes, options = {}) {
  return parseWorkbook(bytes, { ...options, unzipSync, XMLParser });
}

function reviewedItem({ id, label, provider, source, note, errorCode = "SOURCE_AUDIT_REQUIRES_REVIEW" }) {
  return makeEvidence({
    status: "PROVIDER_REVIEW_REQUIRED", dataTruth: "NOT_CONNECTED", provider, source,
    delayed: true, stale: null, fetchedAt: null, dataTimestamp: null, fallback: false,
    attribution: provider, license: "自動化／再使用授權尚待確認；僅保留來源參考。",
    note, errorCode, data: { id, label, observations: [] },
  });
}

export async function loadPriceRadar() {
  const references = [
    reviewedItem({ id: "dram-nand", label: "DRAM / NAND", provider: "TrendForce / DRAMeXchange", source: "https://www.dramexchange.com/", note: "公開報價不代表可自動擷取或再散布；未經授權審查，不呼叫來源、不顯示猜測值。" }),
    reviewedItem({ id: "sox", label: "半導體指數 / SOX", provider: "Nasdaq", source: "https://indexes.nasdaqomx.com/Index/Overview/SOX", note: "指數資料自動化與呈現授權未確認；不以 ETF 或產業印象代替 SOX。" }),
    reviewedItem({ id: "scfi", label: "SCFI", provider: "Shanghai Shipping Exchange", source: "https://en.sse.net.cn/indices/scfinew.jsp", note: "官方週指數頁；自動化／資料再散布授權未確認，不與 SCFIS 混用。" }),
  ];
  const unavailable = ["oil", "copper"].map((_, index) => makeEvidence({
    status: "UNAVAILABLE",
    dataTruth: "NOT_CONNECTED",
    provider: "World Bank Pink Sheet",
    source: [WORLD_BANK_MONTHLY_SOURCE],
    errorCode: "SERVER_PROXY_REQUIRED",
    note: "靜態瀏覽器不直接下載官方 XLSX；請由已認證 Investment Intelligence Edge 提供月資料。沒有用記錄值或其他來源補值。",
  }));
  const monthly = unavailable.map((item, index) => makeEvidence({
    ...item,
    attribution: "World Bank, Commodity Price Data (Pink Sheet); 不代表 World Bank 背書。",
    license: `CC BY 4.0；${WORLD_BANK_LICENSE}`,
    delayed: true,
    data: { id: index ? "copper" : "oil", label: index ? "銅" : "WTI / Brent 原油", observations: [] },
  }));
  return [...monthly, ...references];
}
