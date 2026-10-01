export type ImpactType = "Revenue Tailwind" | "Revenue Headwind" | "Cost Tailwind" | "Cost Headwind" | "Demand Proxy" | "Industry Cycle Proxy" | "Macro Proxy" | "Mixed" | "Neutral";
export interface IndustrySignal {
  id: string; direction: "up" | "down" | "flat" | "unknown";
  source: string; dataTimestamp: string | null; stale: boolean | null;
  status: "PASS" | "PARTIAL" | "UNAVAILABLE" | "PROVIDER_REVIEW_REQUIRED";
}
export interface StockExposure {
  symbol: string; kind: "direct-revenue" | "direct-cost" | "demand-proxy" | "cycle-proxy" | "macro-proxy" | "mixed" | "unknown";
  source: string | null; verified: boolean; explanation: string;
}
export interface IndustryImpact {
  IndustrySignal: IndustrySignal;
  StockExposure: StockExposure;
  ImpactType: ImpactType;
  Direction: "Positive" | "Negative" | "Mixed" | "Neutral" | "Unknown";
  Confidence: { level: "未評估" | "低" | "中"; basis: string[]; meaning: "Evidence support, not return probability" };
  Explanation: string;
}

/** No recommendation, score, or return probability. Missing exposure means no sign. */
export function assessIndustryImpact(signal: IndustrySignal, exposure: StockExposure): IndustryImpact {
  const supported = (signal.status === "PASS" || signal.status === "PARTIAL") && !!signal.source && !!signal.dataTimestamp
    && signal.stale === false && signal.direction !== "unknown"
    && exposure.verified && !!exposure.source && exposure.kind !== "unknown";
  const basis = [
    `訊號狀態 ${signal.status}；資料時間 ${signal.dataTimestamp ?? "未提供"}；stale ${String(signal.stale)}`,
    exposure.verified && exposure.source ? `曝險來源 ${exposure.source}` : "公司／ETF 實際曝險尚無可驗證來源",
  ];
  let type: ImpactType = "Neutral", direction: IndustryImpact["Direction"] = "Unknown";
  if (supported && signal.direction === "flat") direction = "Neutral";
  else if (supported) switch (exposure.kind) {
    case "direct-revenue": type = signal.direction === "up" ? "Revenue Tailwind" : "Revenue Headwind"; direction = signal.direction === "up" ? "Positive" : "Negative"; break;
    case "direct-cost": type = signal.direction === "up" ? "Cost Headwind" : "Cost Tailwind"; direction = signal.direction === "up" ? "Negative" : "Positive"; break;
    case "demand-proxy": type = "Demand Proxy"; direction = "Mixed"; break;
    case "cycle-proxy": type = "Industry Cycle Proxy"; direction = "Mixed"; break;
    case "macro-proxy": type = "Macro Proxy"; direction = "Mixed"; break;
    case "mixed": type = "Mixed"; direction = "Mixed"; break;
  }
  return { IndustrySignal: signal, StockExposure: exposure, ImpactType: type, Direction: direction,
    Confidence: { level: !supported ? "未評估" : signal.status === "PARTIAL" ? "低" : exposure.kind.startsWith("direct-") ? "中" : "低", basis, meaning: "Evidence support, not return probability" },
    Explanation: supported ? `${exposure.explanation}；僅表示產業傳導方向，仍需驗證售價、成本轉嫁、庫存、匯率與時間落差。不是股價預測。`
      : "資料／公司曝險還不夠，暫不判定有利或不利。價格上漲不等於公司獲利上升，更不等於股價必漲。" };
}
