import { useCallback } from "react";
import { Box, ScrollBox } from "../../../ui";
import { DataTableView, EmptyState, KeyValueRow, PaneStatusBody, Prose, Section, StatGrid, usePaneFooter, usePaneTabs } from "../../../components";
import type { PaneProps } from "../../../types/plugin";
import { useAsyncResource } from "../../../react/async-resource";
import { usePluginPaneState } from "../../runtime";
import { useBoundTicker } from "../shared/ticker-request";
import { useThemeColors } from "../../../theme/theme-context";
import { loadTaiwanResearch } from "./research";
import { displayValue, numberText, projectResearch, RESEARCH_VIEWS } from "./model";

export const TAIWAN_RESEARCH_PANE = "taiwan-research";

export function TaiwanResearchPane({ focused, width, height }: PaneProps) {
  const { symbol } = useBoundTicker();
  const colors = useThemeColors();
  const [view, setView] = usePluginPaneState("view", "overview");
  const loader = useCallback((force: boolean) => loadTaiwanResearch(symbol!, force), [symbol]);
  const resource = useAsyncResource(symbol ? loader : null, { clearOnError: true });
  const report = resource.data;
  const tabs = usePaneTabs({ tabs: RESEARCH_VIEWS, activeValue: view, onSelect: setView, focused });
  usePaneFooter(TAIWAN_RESEARCH_PANE, () => ({
    info: [{ id: "state", parts: [{ text: resource.loading ? "讀取官方資料中" : report ? `${report.symbol}｜${report.quote.status}｜收盤／定期資料` : resource.error ? "讀取失敗" : "選擇標的", tone: resource.error ? "warning" : "muted" }] }],
    hints: [{ id: "refresh", key: "r", label: "重新讀取", onPress: () => { void resource.reload(); } }],
  }), [resource.loading, resource.error, report, resource.reload]);
  if (!symbol) return <EmptyState title="輸入 TW 2330.TW、TW 0050.TW 或 TW 6488.TWO 開始研究。" />;
  if (!report) return <PaneStatusBody loading={resource.loading} loadingLabel="讀取官方資料與來源時間…" error={resource.error} errorTitle="此標的暫時無法讀取" />;
  const bodyWidth = Math.max(20, width - 2);
  const projected = projectResearch(report, view);
  return <Box flexDirection="column" flexGrow={1} overflow="hidden">
    {tabs.strip}
    <StatGrid width={width} items={[
      { label: "價格 TWD", value: numberText(report.quote.data?.price), detail: report.quote.dataTimestamp ?? "日期未提供" },
      { label: "漲跌", value: numberText(report.quote.data?.change), detail: report.quote.data?.changePercent == null ? "未提供" : `${numberText(report.quote.data.changePercent)}%` },
    ]} />
    <ScrollBox flexGrow={1} height={Math.max(4, height - tabs.rows - 3)} focused={focused} contentOptions={{ paddingX: 1 }}>
      {projected.sections.map((section, index) => <Section key={`${view}:${index}`} title={section.title} width={bodyWidth}>
        {section.entries ? section.entries.map((item, i) => {
          const text = item.formatted ?? displayValue(item.value);
          return text.length > Math.max(36, bodyWidth - 16)
            ? <Prose key={i} text={`${item.label}：${text}`} width={bodyWidth} color={colors.text} />
            : <KeyValueRow key={i} label={item.label} value={text} width={bodyWidth} labelWidth={Math.min(22, Math.floor(bodyWidth * 0.3))} />;
        }) : <Box height={Math.max(3, Math.min(18, section.rows.length + 2))} flexShrink={0}>
          <DataTableView focused={false} rootWidth={bodyWidth} rootHeight={Math.max(3, Math.min(18, section.rows.length + 2))}
          sortColumnId={null} sortDirection="asc" selection={{ kind: "none" }}
          columns={(section.columns ?? []).map((c) => ({ id: c.key, label: c.header, align: c.align === "right" ? "right" as const : "left" as const, width: Math.max(10, Math.floor(bodyWidth / (section.columns?.length || 1))) }))}
          items={section.rows} getItemKey={(_row, i) => String(i)}
          renderCell={(row, column) => ({ text: displayValue(row[column.id]), color: colors.text })}
          emptyStateTitle="此區塊尚未有可用資料；請看上方狀態與來源。" />
        </Box>}
      </Section>)}
    </ScrollBox>
  </Box>;
}
