import { makeEvidence, unavailableEvidence } from "../../../labs/investment/src/lib/contract.mjs";
import { WORLD_BANK_LICENSE, WORLD_BANK_MONTHLY_SOURCE } from "../../../labs/investment/src/providers/world-bank-monthly-workbook.mjs";

function staleMonth(month, now = Date.now()) {
  if (!/^\d{4}-\d{2}$/.test(String(month ?? ""))) return null;
  const end = new Date(`${month}-01T00:00:00.000Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return now - end.getTime() > 45 * 86_400_000;
}

function unavailable(errorCode = "PROVIDER_READ_FAILED") {
  const attribution = "World Bank, Commodity Price Data (Pink Sheet); Zhuge 彙整官方月資料並計算月變化；不代表 World Bank 背書。";
  const license = `CC BY 4.0；${WORLD_BANK_LICENSE}`;
  const note = "官方月均參考價，不是今日行情、期貨報價或個股曝險結論。月變化只供研究，不形成投資建議。";
  return ["oil", "copper"].map((id, index) => {
    const item = unavailableEvidence("World Bank Pink Sheet", [WORLD_BANK_MONTHLY_SOURCE], errorCode, "World Bank 官方月報暫時無法讀取；沒有用記錄資料或其他來源補值。");
    return makeEvidence({ ...item, attribution, license, delayed: true, data: { id, label: index ? "銅" : "WTI / Brent 原油", observations: [] }, note });
  });
}

/** Authenticated Edge read projection for the same workbook/parser used by Lab. */
export async function loadWorldBankCommodityRadar({ fetchWorkbook, parseWorkbook, now = () => Date.now() } = {}) {
  if (typeof fetchWorkbook !== "function" || typeof parseWorkbook !== "function") return unavailable("PROVIDER_CONFIGURATION_INVALID");
  try {
    const response = await fetchWorkbook(WORLD_BANK_MONTHLY_SOURCE);
    const observations = parseWorkbook(response?.value);
    const groups = [
      { id: "oil", label: "WTI / Brent 原油", values: observations.filter(item => item.group === "油價") },
      { id: "copper", label: "銅", values: observations.filter(item => item.group === "銅價") },
    ];
    return groups.map(({ id, label, values }) => {
      const month = values.map(item => item.month).sort().at(-1) ?? null;
      const stale = staleMonth(month, now());
      return makeEvidence({
        status: values.length ? stale ? "PARTIAL" : "AVAILABLE" : "UNAVAILABLE",
        dataTruth: response.fallback ? "FALLBACK" : "OFFICIAL",
        provider: "World Bank Pink Sheet",
        source: [WORLD_BANK_MONTHLY_SOURCE],
        dataTimestamp: month,
        fetchedAt: response.fetchedAt ?? null,
        stale,
        delayed: true,
        fallback: response.fallback === true,
        attribution: "World Bank, Commodity Price Data (Pink Sheet); Zhuge 彙整官方月資料並計算月變化；不代表 World Bank 背書。",
        license: `CC BY 4.0；${WORLD_BANK_LICENSE}`,
        note: "官方月均參考價，不是今日行情、期貨報價或個股曝險結論。月變化只供研究，不形成投資建議。",
        errorCode: response.errorCode ?? null,
        data: { id, label, observations: values },
      });
    });
  } catch (error) {
    return unavailable(String(error?.code || "PROVIDER_READ_FAILED").slice(0, 80));
  }
}
