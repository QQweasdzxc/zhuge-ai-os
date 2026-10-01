import type { HeadlessPaneDefinition } from "../../../types/plugin";
import { loadTaiwanResearch } from "./research";
import { projectResearch, RESEARCH_VIEWS } from "./model";

export const taiwanResearchHeadless: HeadlessPaneDefinition<"bundle"> = {
  shape: "bundle",
  argument: { kind: "ticker", placeholder: "2330.TW", description: "Phase 1 固定支援 2330.TW / 0050.TW / 6488.TWO" },
  options: [{ key: "view", type: "enum", values: [{ value: "all" }, ...RESEARCH_VIEWS.map(({ value }) => ({ value }))], defaultValue: "all", pluginState: { pluginId: "taiwan-official", key: "view" }, description: "研究分頁" }],
  describe: (args) => `台灣研究 | ${args.symbols[0] ?? args.argument}`,
  async load(args, context) {
    const report = await loadTaiwanResearch(String(args.symbols[0] ?? args.argument ?? ""), context.refresh === true);
    return projectResearch(report, String(args.options.view ?? "all"));
  },
};
