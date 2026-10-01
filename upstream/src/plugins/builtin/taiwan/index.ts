import type { GloomPlugin } from "../../../types/plugin";
import { assetDataProvider } from "../../../capabilities";
import { taiwanDataProvider } from "../../../sources/taiwan-provider";
import { TaiwanResearchPane, TAIWAN_RESEARCH_PANE } from "./pane";
import { taiwanResearchHeadless } from "./headless";
import { resolveLabSymbol } from "./research";

export const taiwanPlugin: GloomPlugin = {
  id: "taiwan-official",
  name: "Taiwan Official Open Data",
  version: "0.2.0-lab-phase-1",
  description: "Isolated Taiwan research workbench; official data authority, explicit missing evidence, three-symbol Phase 1 scope.",
  capabilities: [assetDataProvider(taiwanDataProvider)],
  panes: [{ id: TAIWAN_RESEARCH_PANE, name: "台灣研究", icon: "TW", component: TaiwanResearchPane,
    defaultPosition: "right", defaultMode: "floating", defaultFloatingSize: { width: 116, height: 42 } }],
  paneTemplates: [{ id: "taiwan-research-pane", paneId: TAIWAN_RESEARCH_PANE, label: "台灣研究",
    description: "台灣官方資料研究：行情／營收／財報／集保／產業／衍生商品", keywords: ["taiwan", "台股", "TWSE", "TPEx", "MOPS", "TDCC", "TAIFEX"],
    shortcut: { prefix: "TW", argPlaceholder: "2330.TW", argKind: "ticker", argOptional: false }, headless: taiwanResearchHeadless,
    createInstance: (_context, options) => {
      const symbol = resolveLabSymbol(options?.symbol ?? options?.ticker?.metadata.ticker ?? options?.arg ?? "");
      return { instanceId: `${TAIWAN_RESEARCH_PANE}:${symbol}`, title: `台灣研究 ${symbol}`, binding: { kind: "fixed", symbol }, placement: "floating" };
    } }],
};
